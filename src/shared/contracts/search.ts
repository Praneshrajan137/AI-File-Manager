/**
 * contracts/search.ts - Filename autocomplete, scoped search, and lexical/content search contracts.
 */

import type { VectorRecord } from './core';
import type { FileNode } from './fs';

export interface ContentSearchMatch {
  chunkId: string;
  filePath: string;
  fileName: string;
  chunkIndex: number;
  startLine?: number;
  endLine?: number;
  heading?: string;
  snippet: string;
  score?: number;
}

export interface LexicalSearchMatch {
  record: VectorRecord;
  bm25Score: number;
}

export interface SearchScopeFilter {
  /** Restrict retrieval strictly to files under this directory subtree */
  folderPath?: string;
  /** Restrict retrieval strictly to an explicit set of files */
  filePaths?: string[];
  /** Restrict retrieval to specific lowercase extensions (without leading dot) */
  fileExtensions?: string[];
}

/**
 * Search Service Interface.
 * Handles file search and autocomplete.
 */
export interface ISearchService {
  /**
   * Get autocomplete suggestions for partial path.
   */
  autocomplete(prefix: string, maxResults?: number): Promise<string[]>;

  /**
   * Search for files matching query.
   */
  search(query: string, searchRoot: string): Promise<FileNode[]>;
}
