/**
 * searchHandlers.ts - IPC handlers for file search and semantic content lookup.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  getSearchService,
  getSearchServiceForTesting,
  resetSearchService,
  searchWorkspacePaths,
  setSearchAllowedRootsResolver,
} from '@main/services/WorkspaceSearchService';
import {
  withContract,
  resolveAllowedRoots,
  validateCanonicalPathOrThrow,
} from './securityMiddleware';
import { searchWorkspaceContent } from './llmHandlers';
import { ContentSearchMatch, FileNode } from '@shared/contracts';
import { IPCLogger } from '@shared/logging';
import { IPCChannel } from '@shared/ipc/contracts';

export { resetSearchService, searchWorkspacePaths, getSearchServiceForTesting };

setSearchAllowedRootsResolver(resolveAllowedRoots);

async function handleAutocomplete(
  _event: IpcMainInvokeEvent,
  input: { prefix: string; maxResults?: number }
): Promise<string[]> {
  const maxResults = input.maxResults ?? 10;

  IPCLogger.info('Autocomplete request', {
    prefix: input.prefix,
    maxResults,
  });

  const results = await getSearchService().autocomplete(input.prefix, maxResults);

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
  setSearchAllowedRootsResolver(resolveAllowedRoots);
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
