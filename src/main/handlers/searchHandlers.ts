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
import { IPCLogger, getLogger } from '@shared/logging';
import { IPCChannel } from '@shared/ipc/contracts';
import path from 'path';

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
      const queryLower = query.toLowerCase();
      const fileNodes: FileNode[] = [];

      // STRATEGY 1: Search current directory first (fast, no indexing required)
      try {
        const filesInCurrentDir = await this.fileSystemService.readDirectory(searchRoot);

        for (const file of filesInCurrentDir) {
          // Case-insensitive substring match
          if (file.name.toLowerCase().includes(queryLower)) {
            fileNodes.push(file);
          }
        }

        // If we found results in current directory, return them
        if (fileNodes.length > 0) {
          endTimer({ query, resultCount: fileNodes.length, source: 'current_dir' });
          return fileNodes;
        }
      } catch (error) {
        IPCLogger.warn('Failed to search current directory', {
          searchRoot,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // STRATEGY 2: Fall back to PathTrie for deeper search (requires indexing)
      // Use PathTrie to get candidate paths with case-insensitive matching
      const candidatePaths = this.pathTrie.autocomplete(query, 100);

      // Also try lowercase query for case-insensitive PathTrie search
      const lowerCandidates = this.pathTrie.autocomplete(queryLower, 100);
      const allCandidates = [...new Set([...candidatePaths, ...lowerCandidates])];

      // Filter candidates that start with searchRoot and match query (substring)
      const filteredPaths = allCandidates.filter(path => {
        const fileName = path.split('/').pop() || path.split('\\').pop() || path;
        return path.startsWith(searchRoot) && fileName.toLowerCase().includes(queryLower);
      });

      // Convert to FileNode objects
      for (const filePath of filteredPaths) {
        try {
          const stats = await this.fileSystemService.getStats(filePath);

          const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
          const extension = fileName.includes('.')
            ? fileName.split('.').pop() || ''
            : '';

          const fileNode: FileNode = {
            path: filePath,
            name: fileName,
            isDirectory: stats.isDirectory,
            size: stats.size,
            modified: stats.modified,
            extension,
            mimeType: this.getMimeType(extension),
            isHidden: fileName.startsWith('.'),
          };

          fileNodes.push(fileNode);
        } catch (error) {
          // Skip files we can't stat
          IPCLogger.debug('Failed to stat search result', {
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      endTimer({ query, resultCount: fileNodes.length, source: 'pathtrie' });

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

        // Scan directory recursively
        const files = await scanner.scan(root, {
          recursive: true,
          maxDepth: 3, // Limit depth to avoid excessive scanning
          skipErrors: true,
        });

        const trieUpdateStart = Date.now();
        // Insert all files into PathTrie
        for (const file of files) {
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
  const queryLower = input.query.toLowerCase().trim();
  const kernel = getReactiveWorkspaceKernel();
  const fsService = kernel.getFileSystemService();
  const pathTrie = kernel.getPathTrie();
  const entries = await fsService.readDirectory(input.searchRoot);
  kernel.warmDirectory(entries);

  const fileNodes =
    queryLower.length === 0
      ? [...entries]
      : entries.filter((entry) => entry.name.toLowerCase().includes(queryLower));

  if (queryLower.length > 0) {
    const seen = new Set(
      fileNodes.map((n) =>
        process.platform === 'win32' ? path.resolve(n.path).toLowerCase() : path.resolve(n.path)
      )
    );
    const normalizedRoot =
      process.platform === 'win32'
        ? path.resolve(input.searchRoot).toLowerCase()
        : path.resolve(input.searchRoot);
    const normalizedRootPrefix = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : `${normalizedRoot}${path.sep}`;

    const trieCandidates = Array.from(
      new Set([
        ...pathTrie.autocomplete(queryLower, 50),
        ...pathTrie.searchSubstring(queryLower, 50),
      ])
    );
    for (const candidatePath of trieCandidates) {
      const normalizedCandidate =
        process.platform === 'win32'
          ? path.resolve(candidatePath).toLowerCase()
          : path.resolve(candidatePath);
      if (seen.has(normalizedCandidate)) {
        continue;
      }
      if (
        normalizedCandidate !== normalizedRoot &&
        !normalizedCandidate.startsWith(normalizedRootPrefix)
      ) {
        continue;
      }
      if (!path.basename(candidatePath).toLowerCase().includes(queryLower)) {
        continue;
      }
      try {
        const stats = await fsService.getStats(candidatePath);
        const fileName = path.basename(candidatePath);
        const extension = path.extname(fileName).replace(/^\./, '').toLowerCase();
        seen.add(normalizedCandidate);
        fileNodes.push({
          path: candidatePath,
          name: fileName,
          isDirectory: stats.isDirectory,
          size: stats.size,
          modified: stats.modified,
          extension,
          mimeType: extension ? `application/${extension}` : 'application/octet-stream',
          isHidden: fileName.startsWith('.'),
        });
      } catch {
        // Ignore stale candidates
      }
    }
  }

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
  ).slice(0, 25);
}

/**
 * Get search service (exported for testing).
 * 
 * @returns SearchService instance
 */
export function getSearchServiceForTesting(): SearchService {
  return getSearchService();
}
