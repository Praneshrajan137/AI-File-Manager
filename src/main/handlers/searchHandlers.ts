/**
 * searchHandlers.ts - IPC handlers for file search with PathTrie
 * 
 * Implements fast O(L) autocomplete using PathTrie DSA.
 * 
 * Handlers:
 * - SEARCH:AUTOCOMPLETE - Get autocomplete suggestions for prefix
 * - SEARCH:QUERY - Search for files matching query pattern
 * 
 * The PathTrie is populated lazily on first search request and updated
 * incrementally as files change.
 * 
 * Performance: <50ms for autocomplete on 50,000 indexed files (PRD requirement).
 * 
 * @example
 * // In main.ts:
 * import { registerSearchHandlers } from './handlers/searchHandlers';
 * registerSearchHandlers();
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { PathTrie } from '@main/dsa/PathTrie';
import { DirectoryScanner } from '@main/services/DirectoryScanner';
import { FileSystemService } from '@main/services/FileSystemService';
import { getReactiveWorkspaceKernel } from '@main/services/ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import {
  withContract,
  resolveAllowedRoots,
  validateCanonicalPathOrThrow,
} from './securityMiddleware';
import { searchWorkspaceContent } from './llmHandlers';
import { ContentSearchMatch, FileNode, FileMetadata } from '@shared/contracts';
import { DEFAULT_EXCLUDED_DIRS } from '@shared/config';
import { IPCLogger, getLogger } from '@shared/logging';
import { IPCChannel } from '@shared/ipc/contracts';
import { isSensitiveSecretFile } from '@shared/security/SecretGuard';
import path from 'path';

function isWithinNormalizedRoot(candidatePath: string, rootPath: string): boolean {
  const normalize = (p: string): string =>
    process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  const normCandidate = normalize(candidatePath);
  const normRoot = normalize(rootPath);
  const prefix = normRoot.endsWith(path.sep) ? normRoot : `${normRoot}${path.sep}`;
  return normCandidate === normRoot || normCandidate.startsWith(prefix);
}

/**
 * SearchService using PathTrie for fast autocomplete.
 */
class SearchService {
  private pathTrie: PathTrie;
  private fileSystemService: FileSystemService;
  private isIndexing: boolean = false;
  private indexedPaths: Set<string> = new Set();

  constructor(
    pathTrie: PathTrie,
    fileSystemService: FileSystemService
  ) {
    this.pathTrie = pathTrie;
    this.fileSystemService = fileSystemService;
  }

  /**
   * Get autocomplete suggestions for prefix.
   * 
   * Triggers background indexing on first call if not already indexed.
   * 
   * @param prefix - Search prefix
   * @param maxResults - Maximum results to return
   * @returns Array of matching file paths
   */
  async autocomplete(prefix: string, maxResults: number = 10): Promise<string[]> {
    // Trigger indexing if not already done (async, non-blocking)
    if (!this.isIndexing && this.indexedPaths.size === 0) {
      this.startBackgroundIndexing().catch(error => {
        IPCLogger.error('Background indexing failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const logger = getLogger();
    const endTimer = logger.startTimer('search_autocomplete');

    try {
      // Query PathTrie (O(L) complexity)
      const results = this.pathTrie.autocomplete(prefix, maxResults);

      endTimer({ prefix, resultCount: results.length });

      return results;
    } catch (error) {
      endTimer({ prefix, error: true });
      throw error;
    }
  }

  /**
   * Search for files matching query pattern.
   * 
   * Strategy:
   * 1. First, search current directory with case-insensitive substring matching
   * 2. If no results, fall back to PathTrie for indexed paths
   * 
   * @param query - Search query (case-insensitive)
   * @param searchRoot - Root directory to search in
   * @returns Array of matching FileNode objects
   */
  async search(query: string, searchRoot: string): Promise<FileNode[]> {
    const logger = getLogger();
    const endTimer = logger.startTimer('search_query');

    try {
      const queryLower = query.trim().toLowerCase();
      if (queryLower.length === 0) {
        const entries = await this.fileSystemService.readDirectory(searchRoot, {
          bypassCache: true,
        });
        const visible = entries.filter((entry) => !isSensitiveSecretFile(entry.path).blocked);
        endTimer({ query, resultCount: visible.length, source: 'dir_list' });
        return visible;
      }

      const fileNodes: FileNode[] = [];
      const seenResultKeys = new Set<string>();
      const normKey = (p: string): string =>
        process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);

      // STRATEGY 1: Bounded concurrent recursive subtree scan (depth <= 4, max 200 dirs, max 100 hits)
      const excludedDirs = new Set(DEFAULT_EXCLUDED_DIRS.map((d) => d.toLowerCase()));
      const visitedDirs = new Set<string>();
      const dirQueue: Array<{ dir: string; depth: number }> = [{ dir: searchRoot, depth: 0 }];
      let queueHead = 0;
      let scannedDirs = 0;
      let inFlight = 0;
      const BFS_CONCURRENCY = 8;

      try {
        await new Promise<void>((resolve) => {
          const pump = (): void => {
            while (
              inFlight < BFS_CONCURRENCY &&
              queueHead < dirQueue.length &&
              scannedDirs < 200 &&
              fileNodes.length < 100
            ) {
              const current = dirQueue[queueHead];
              queueHead += 1;
              const visitKey = normKey(current.dir);
              if (visitedDirs.has(visitKey)) {
                continue;
              }
              visitedDirs.add(visitKey);
              scannedDirs += 1;
              inFlight += 1;

              void this.fileSystemService
                .readDirectory(current.dir, { bypassCache: true })
                .then((entries) => {
                  if (fileNodes.length >= 100) {
                    return;
                  }
                  for (const file of entries) {
                    if (isSensitiveSecretFile(file.path).blocked) {
                      continue;
                    }
                    if (file.name.toLowerCase().includes(queryLower)) {
                      const key = normKey(file.path);
                      if (!seenResultKeys.has(key)) {
                        seenResultKeys.add(key);
                        fileNodes.push(file);
                        if (fileNodes.length >= 100) {
                          break;
                        }
                      }
                    }
                    if (
                      file.isDirectory &&
                      !file.isSymbolicLink &&
                      current.depth < 4 &&
                      !excludedDirs.has(file.name.toLowerCase())
                    ) {
                      dirQueue.push({ dir: file.path, depth: current.depth + 1 });
                    }
                  }
                })
                .catch(() => undefined)
                .finally(() => {
                  inFlight -= 1;
                  pump();
                });
            }

            if (
              inFlight === 0 &&
              (queueHead >= dirQueue.length || scannedDirs >= 200 || fileNodes.length >= 100)
            ) {
              resolve();
            }
          };

          pump();
        });
      } catch (error) {
        IPCLogger.warn('Failed recursive directory search', {
          searchRoot,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // STRATEGY 2: Merge PathTrie deep/warmed matches when under cap
      if (fileNodes.length < 100) {
        const candidatePaths = this.pathTrie.autocomplete(query.trim(), 100);
        const substringCandidates = this.pathTrie.searchSubstring(queryLower, 100);
        const allCandidates = [...new Set([...candidatePaths, ...substringCandidates])];

        // Filter candidates that belong under searchRoot, aren't SecretGuard-blocked, and match query
        const filteredPaths = allCandidates.filter((candidate) => {
          if (seenResultKeys.has(normKey(candidate))) {
            return false;
          }
          if (isSensitiveSecretFile(candidate).blocked) {
            return false;
          }
          const fileName = candidate.split('/').pop() || candidate.split('\\').pop() || candidate;
          return (
            isWithinNormalizedRoot(candidate, searchRoot) &&
            fileName.toLowerCase().includes(queryLower)
          );
        });

        const remainingQuota = 100 - fileNodes.length;
        const statCandidates = filteredPaths.slice(0, Math.min(filteredPaths.length, remainingQuota * 2));
        const statNodes = new Array<FileNode | null>(statCandidates.length).fill(null);
        const STAT_CONCURRENCY = 16;
        let nextStatIdx = 0;

        const runStatWorker = async (): Promise<void> => {
          while (nextStatIdx < statCandidates.length) {
            const idx = nextStatIdx;
            nextStatIdx += 1;
            const filePath = statCandidates[idx];
            try {
              const stats = await this.fileSystemService.getStats(filePath);
              const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
              const extension = fileName.includes('.')
                ? fileName.split('.').pop() || ''
                : '';

              statNodes[idx] = {
                path: filePath,
                name: fileName,
                isDirectory: stats.isDirectory,
                size: stats.size,
                modified: stats.modified,
                extension,
                mimeType: this.getMimeType(extension),
                isHidden: fileName.startsWith('.'),
              };
            } catch (error) {
              IPCLogger.debug('Failed to stat search result', {
                path: filePath,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        };

        if (statCandidates.length > 0) {
          const workerCount = Math.min(STAT_CONCURRENCY, statCandidates.length);
          await Promise.all(Array.from({ length: workerCount }, () => runStatWorker()));
        }

        for (const node of statNodes) {
          if (!node) continue;
          if (fileNodes.length >= 100) break;
          const key = normKey(node.path);
          if (seenResultKeys.has(key)) continue;
          seenResultKeys.add(key);
          fileNodes.push(node);
        }
      }

      endTimer({ query, resultCount: fileNodes.length, source: 'recursive_and_pathtrie' });

      return fileNodes;
    } catch (error) {
      endTimer({ query, error: true });
      throw error;
    }
  }

  /**
   * Start background indexing of home directory.
   * 
   * Runs asynchronously to avoid blocking search requests.
   */
  private async startBackgroundIndexing(): Promise<void> {
    if (this.isIndexing) {
      return;
    }

    this.isIndexing = true;

    IPCLogger.info('Starting background PathTrie indexing');

    try {
      // Index allowed roots resolved from canonical ConfigManager boundary
      const rootsToIndex = resolveAllowedRoots();

      for (const root of rootsToIndex) {
        if (this.indexedPaths.has(root)) {
          continue; // Already indexed
        }

        IPCLogger.info('Indexing directory for search', { root });

        // Create DirectoryScanner for this root
        const scanner = new DirectoryScanner(this.fileSystemService);

        // Scan directory recursively (skip sensitive secret files from PathTrie)
        const files = await scanner.scan(root, {
          recursive: true,
          maxDepth: 3, // Limit depth to avoid excessive scanning
          skipErrors: true,
          skipSensitiveFiles: true,
        });

        const trieUpdateStart = Date.now();
        // Insert non-sensitive files into PathTrie
        for (const file of files) {
          if (isSensitiveSecretFile(file.path).blocked) {
            continue;
          }
          try {
            const metadata: FileMetadata = {
              filePath: file.path,
              totalChunks: 0,
              indexedAt: Date.now(),
              fileSize: file.size,
              language: file.extension,
            };

            this.pathTrie.insert(file.path, metadata);
            this.indexedPaths.add(file.path);
          } catch (error) {
            // Skip files that fail to index
            IPCLogger.debug('Failed to index file', {
              path: file.path,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        RuntimeDiagnostics.getInstance().setPathTrieStats({
          entryCount: this.pathTrie.size(),
          indexedRoots: rootsToIndex,
          lastIndexDurationMs: Date.now() - trieUpdateStart,
        });

        IPCLogger.info('Directory indexing complete', {
          root,
          totalIndexed: this.indexedPaths.size,
        });
      }
    } catch (error) {
      IPCLogger.error('Background indexing failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Get MIME type for extension.
   * 
   * @param extension - File extension
   * @returns MIME type
   */
  private getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      txt: 'text/plain',
      md: 'text/markdown',
      js: 'text/javascript',
      ts: 'text/typescript',
      json: 'application/json',
      html: 'text/html',
      css: 'text/css',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      zip: 'application/zip',
    };

    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }
}

/**
 * Singleton SearchService instance.
 */
let searchService: SearchService | null = null;

/**
 * Get or create SearchService instance.
 * 
 * @returns SearchService instance
 */
function getSearchService(): SearchService {
  const kernel = getReactiveWorkspaceKernel();
  if (!searchService) {
    searchService = new SearchService(kernel.getPathTrie(), kernel.getFileSystemService());
    IPCLogger.info('SearchService initialized with ReactiveWorkspaceKernel');
  }

  return searchService;
}

export function resetSearchService(): void {
  searchService = null;
}

async function handleAutocomplete(
  _event: IpcMainInvokeEvent,
  input: { prefix: string; maxResults?: number }
): Promise<string[]> {
  const maxResults = input.maxResults ?? 10;

  IPCLogger.info('Autocomplete request', {
    prefix: input.prefix,
    maxResults,
  });

  const service = getSearchService();
  const results = await service.autocomplete(input.prefix, maxResults);

  IPCLogger.info('Autocomplete completed', {
    prefix: input.prefix,
    resultCount: results.length,
  });

  return results;
}

async function handleQuery(
  _event: IpcMainInvokeEvent,
  input: { query: string; searchRoot: string }
): Promise<FileNode[]> {
  const fileNodes = await getSearchService().search(input.query, input.searchRoot);

  IPCLogger.info('Search query completed', {
    query: input.query,
    searchRoot: input.searchRoot,
    resultCount: fileNodes.length,
  });

  return fileNodes;
}

async function handleContentSearch(
  _event: IpcMainInvokeEvent,
  input: { query: string; topK?: number; searchRoot?: string }
): Promise<ContentSearchMatch[]> {
  let canonicalRoot: string | undefined;
  if (input.searchRoot && input.searchRoot.trim().length > 0) {
    canonicalRoot = await validateCanonicalPathOrThrow(input.searchRoot);
  }
  return searchWorkspaceContent(input.query, input.topK ?? 20, canonicalRoot);
}

const SEARCH_CHANNELS: IPCChannel[] = ['SEARCH:AUTOCOMPLETE', 'SEARCH:QUERY', 'SEARCH:CONTENT'];

export function registerSearchHandlers(): IPCChannel[] {
  IPCLogger.info('Registering search IPC handlers');

  ipcMain.handle(
    'SEARCH:AUTOCOMPLETE',
    withContract('SEARCH:AUTOCOMPLETE', handleAutocomplete)
  );

  ipcMain.handle(
    'SEARCH:QUERY',
    withContract('SEARCH:QUERY', handleQuery)
  );

  ipcMain.handle(
    'SEARCH:CONTENT',
    withContract('SEARCH:CONTENT', handleContentSearch)
  );

  IPCLogger.info('Search IPC handlers registered successfully');
  return [...SEARCH_CHANNELS];
}

/**
 * Shared workspace path lookup helper reused by bounded ReAct agent tools.
 */
export async function searchWorkspacePaths(
  query: string,
  rootPath?: string
): Promise<string[]> {
  const kernel = getReactiveWorkspaceKernel();
  if (rootPath) {
    const matches = await getSearchService().search(query, rootPath);
    return matches.map((m) => m.path);
  }
  const q = query.trim();
  if (!q) {
    return Array.from(kernel.getFileSystemService().getAllowedRoots());
  }
  const trie = kernel.getPathTrie();
  return Array.from(
    new Set([
      ...trie.autocomplete(q, 25),
      ...trie.autocomplete(q.toLowerCase(), 25),
      ...trie.searchSubstring(q.toLowerCase(), 25),
    ])
  )
    .filter((candidate) => !isSensitiveSecretFile(candidate).blocked)
    .slice(0, 25);
}

/**
 * Get search service (exported for testing).
 * 
 * @returns SearchService instance
 */
export function getSearchServiceForTesting(): SearchService {
  return getSearchService();
}
