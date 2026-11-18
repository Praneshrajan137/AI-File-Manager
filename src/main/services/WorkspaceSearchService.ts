/**
 * WorkspaceSearchService.ts - PathTrie autocomplete and bounded workspace filename search service.
 */

import { PathTrie } from '@main/dsa/PathTrie';
import { DirectoryScanner } from '@main/services/DirectoryScanner';
import { FileSystemService } from '@main/services/FileSystemService';
import { getReactiveWorkspaceKernel } from '@main/services/ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { VaultRootAuthority } from '@main/platform/VaultRootAuthority';
import { isWithinNormalizedRoot, normalizePathKey } from '@main/platform/pathNormalize';
import { FileNode, FileMetadata } from '@shared/contracts';
import { DEFAULT_EXCLUDED_DIRS } from '@shared/config';
import { IPCLogger, getLogger } from '@shared/logging';
import { isSensitiveSecretFile } from '@shared/security/SecretGuard';

export type AllowedRootsProvider = () => string[];

let allowedRootsProvider: AllowedRootsProvider = (): string[] =>
  getReactiveWorkspaceKernel().getFileSystemService().getAllowedRoots();

/** Injects the canonical allowed-roots resolver without coupling services upward to handlers. */
export function setSearchAllowedRootsResolver(provider: AllowedRootsProvider): void {
  allowedRootsProvider = provider;
}

/**
 * SearchService using PathTrie for fast autocomplete and bounded concurrent filename search.
 */
export class SearchService {
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
   * Triggers background indexing on first call if not already indexed.
   */
  async autocomplete(prefix: string, maxResults: number = 10): Promise<string[]> {
    if (!this.isIndexing && this.indexedPaths.size === 0) {
      this.startBackgroundIndexing().catch((error) => {
        IPCLogger.error('Background indexing failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const logger = getLogger();
    const endTimer = logger.startTimer('search_autocomplete');

    try {
      const results = this.pathTrie.autocomplete(prefix, maxResults);
      endTimer({ prefix, resultCount: results.length });
      return results;
    } catch (error) {
      endTimer({ prefix, error: true });
      throw error;
    }
  }

  /** Search for files matching query pattern across live subtree + PathTrie. */
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
      const normKey = normalizePathKey;

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

  private async startBackgroundIndexing(): Promise<void> {
    if (this.isIndexing) {
      return;
    }

    this.isIndexing = true;
    IPCLogger.info('Starting background PathTrie indexing');

    try {
      const rootsToIndex = allowedRootsProvider();

      for (const root of rootsToIndex) {
        if (this.indexedPaths.has(root)) {
          continue;
        }

        IPCLogger.info('Indexing directory for search', { root });
        const scanner = new DirectoryScanner(this.fileSystemService);
        const files = await scanner.scan(root, {
          recursive: true,
          maxDepth: 3,
          skipErrors: true,
          skipSensitiveFiles: true,
        });

        const trieUpdateStart = Date.now();
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

let searchService: SearchService | null = null;
let unsubscribeSearchRoots: (() => void) | null = null;

export function getSearchService(): SearchService {
  const kernel = getReactiveWorkspaceKernel();
  if (!searchService) {
    searchService = new SearchService(kernel.getPathTrie(), kernel.getFileSystemService());
    unsubscribeSearchRoots?.();
    unsubscribeSearchRoots = VaultRootAuthority.getInstance().onRootsChanged(() => {
      resetSearchService();
    });
    IPCLogger.info('SearchService initialized with ReactiveWorkspaceKernel');
  }
  return searchService;
}

export function resetSearchService(): void {
  unsubscribeSearchRoots?.();
  unsubscribeSearchRoots = null;
  searchService = null;
}

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

export function getSearchServiceForTesting(): SearchService {
  return getSearchService();
}
