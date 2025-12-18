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
import {
  validateRequestSchema,
  withErrorHandling,
  checkRateLimit,
} from './securityMiddleware';
import { FileNode, FileMetadata } from '@shared/contracts';
import { IPCLogger, getLogger } from '@shared/logging';
import { ConfigManager } from '@shared/config';
import os from 'os';

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
   * Uses PathTrie for prefix matching, then filters results.
   * 
   * @param query - Search query
   * @param searchRoot - Root directory to search in
   * @returns Array of matching FileNode objects
   */
  async search(query: string, searchRoot: string): Promise<FileNode[]> {
    const logger = getLogger();
    const endTimer = logger.startTimer('search_query');
    
    try {
      // Use PathTrie to get candidate paths
      const candidatePaths = this.pathTrie.autocomplete(query, 100);
      
      // Filter candidates that start with searchRoot
      const filteredPaths = candidatePaths.filter(path => 
        path.startsWith(searchRoot)
      );
      
      // Convert to FileNode objects
      const fileNodes: FileNode[] = [];
      
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
          IPCLogger.warn('Failed to stat search result', {
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      endTimer({ query, resultCount: fileNodes.length });
      
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
      // Index home directory (or allowed roots from config)
      let rootsToIndex: string[];
      try {
        const config = ConfigManager.getInstance();
        rootsToIndex = config.get('fileSystem').allowedRoots || [os.homedir()];
      } catch {
        rootsToIndex = [os.homedir()];
      }
      
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
          maxDepth: 5, // Limit depth to avoid excessive scanning
          skipErrors: true,
        });
        
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
  if (!searchService) {
    try {
      const config = ConfigManager.getInstance();
      const allowedRoots = config.get('fileSystem').allowedRoots;
      const defaultRoot = allowedRoots && allowedRoots.length > 0
        ? allowedRoots[0]
        : os.homedir();
      
      const pathTrie = new PathTrie();
      const fileSystemService = new FileSystemService(defaultRoot);
      
      searchService = new SearchService(pathTrie, fileSystemService);
      IPCLogger.info('SearchService initialized');
    } catch (error) {
      // Fallback
      const pathTrie = new PathTrie();
      const fileSystemService = new FileSystemService(os.homedir());
      
      searchService = new SearchService(pathTrie, fileSystemService);
      IPCLogger.info('SearchService initialized with fallback');
    }
  }
  
  return searchService;
}

/**
 * Handler: SEARCH:AUTOCOMPLETE
 * Get autocomplete suggestions for prefix.
 * 
 * Input: { prefix: string, maxResults?: number }
 * Output: string[]
 */
async function handleAutocomplete(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<string[]> {
  checkRateLimit('SEARCH:AUTOCOMPLETE');
  
  // Validate request schema
  if (!request || typeof request !== 'object' || !('prefix' in request)) {
    throw new TypeError('Request missing required field: prefix');
  }
  
  const { prefix, maxResults } = request as { prefix: string; maxResults?: number };
  
  if (typeof prefix !== 'string') {
    throw new TypeError('Field "prefix" must be a string');
  }
  
  if (maxResults !== undefined && typeof maxResults !== 'number') {
    throw new TypeError('Field "maxResults" must be a number');
  }
  
  IPCLogger.info('Autocomplete request', {
    prefix,
    maxResults: maxResults || 10,
  });
  
  const service = getSearchService();
  const results = await service.autocomplete(prefix, maxResults || 10);
  
  IPCLogger.info('Autocomplete completed', {
    prefix,
    resultCount: results.length,
  });
  
  return results;
}

/**
 * Handler: SEARCH:QUERY
 * Search for files matching query.
 * 
 * Input: { query: string, searchRoot: string }
 * Output: FileNode[]
 */
async function handleQuery(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<FileNode[]> {
  checkRateLimit('SEARCH:QUERY');
  
  // Validate request schema
  validateRequestSchema(request, {
    query: 'string',
    searchRoot: 'string',
  });
  
  const { query, searchRoot } = request as { query: string; searchRoot: string };
  
  IPCLogger.info('Search query request', {
    query,
    searchRoot,
  });
  
  const service = getSearchService();
  const results = await service.search(query, searchRoot);
  
  IPCLogger.info('Search query completed', {
    query,
    resultCount: results.length,
  });
  
  return results;
}

/**
 * Register all search IPC handlers.
 * 
 * Call this once during app initialization.
 * 
 * @example
 * // In main.ts:
 * registerSearchHandlers();
 */
export function registerSearchHandlers(): void {
  IPCLogger.info('Registering search IPC handlers');
  
  // Register all handlers with error handling middleware
  ipcMain.handle(
    'SEARCH:AUTOCOMPLETE',
    withErrorHandling(handleAutocomplete, 'SEARCH:AUTOCOMPLETE')
  );
  
  ipcMain.handle(
    'SEARCH:QUERY',
    withErrorHandling(handleQuery, 'SEARCH:QUERY')
  );
  
  IPCLogger.info('Search IPC handlers registered successfully');
}

/**
 * Get search service (exported for testing).
 * 
 * @returns SearchService instance
 */
export function getSearchServiceForTesting(): SearchService {
  return getSearchService();
}
