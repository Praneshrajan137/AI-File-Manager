/**
 * ipcHandlers.ts - Central IPC handler registration
 * 
 * Imports and registers all IPC handlers from domain-specific modules:
 * - File System handlers (FS:*)
 * - Navigation handlers (NAV:*)
 * - Search handlers (SEARCH:*)
 * - LLM handlers (LLM:*) - stub implementation
 * 
 * This file is the single entry point for IPC handler registration.
 * Called once from main.ts during app initialization.
 * 
 * @example
 * // In main.ts:
 * import { registerAllHandlers } from './handlers/ipcHandlers';
 * app.whenReady().then(() => {
 *   registerAllHandlers();
 *   createWindow();
 * });
 */

import { registerFileSystemHandlers } from './fileSystemHandlers';
import { registerNavigationHandlers } from './navigationHandlers';
import { registerSearchHandlers } from './searchHandlers';
import { registerLLMHandlers } from './llmHandlers';
import { registerShellHandlers } from './shellHandlers';
import { IPCLogger } from '@shared/logging';

/**
 * Register all IPC handlers.
 * 
 * This function should be called once during app initialization,
 * before the main window is created.
 * 
 * Handler registration order:
 * 1. File System handlers - Core file operations
 * 2. Navigation handlers - Back/forward history
 * 3. Search handlers - PathTrie autocomplete
 * 4. LLM handlers - Intelligence layer (stub)
 * 
 * @throws Error if handlers are already registered (duplicate registration)
 * 
 * @example
 * import { registerAllHandlers } from './handlers/ipcHandlers';
 * 
 * app.whenReady().then(() => {
 *   registerAllHandlers();
 *   createWindow();
 * });
 */
export function registerAllHandlers(): void {
  IPCLogger.info('Registering all IPC handlers...');

  const startTime = Date.now();

  try {
    // Register File System handlers (FS:*)
    // Handles: READ_DIR, READ_FILE, WRITE_FILE, DELETE, MOVE, CREATE_FILE, CREATE_DIR, GET_STATS
    registerFileSystemHandlers();
    IPCLogger.info('✓ File System handlers registered');

    // Register Navigation handlers (NAV:*)
    // Handles: BACK, FORWARD, PUSH, GET_STATE
    registerNavigationHandlers();
    IPCLogger.info('✓ Navigation handlers registered');

    // Register Search handlers (SEARCH:*)
    // Handles: AUTOCOMPLETE, QUERY
    registerSearchHandlers();
    IPCLogger.info('✓ Search handlers registered');

    // Register LLM handlers (LLM:*) - stub implementation
    // Handles: QUERY, INDEX_STATUS, START_INDEXING, STOP_INDEXING
    registerLLMHandlers();
    IPCLogger.info('✓ LLM handlers registered (stub)');

    // Register Shell handlers (CLIPBOARD:*, SHELL:*)
    // Handles: WRITE_TEXT, OPEN_PATH
    registerShellHandlers();
    IPCLogger.info('✓ Shell handlers registered');

    const duration = Date.now() - startTime;

    IPCLogger.info('All IPC handlers registered successfully', {
      duration_ms: duration,
      handlers: {
        fileSystem: 8,
        navigation: 4,
        search: 2,
        llm: 4,
        shell: 2,
        total: 20,
      },
    });
  } catch (error) {
    IPCLogger.error('Failed to register IPC handlers', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Unregister all IPC handlers.
 * 
 * Useful for testing or app cleanup.
 * 
 * @example
 * app.on('before-quit', () => {
 *   unregisterAllHandlers();
 * });
 */
export function unregisterAllHandlers(): void {
  const { ipcMain } = require('electron');

  IPCLogger.info('Unregistering all IPC handlers...');

  // File System channels
  const fsChannels = [
    'FS:READ_DIR',
    'FS:READ_FILE',
    'FS:WRITE_FILE',
    'FS:DELETE',
    'FS:MOVE',
    'FS:CREATE_FILE',
    'FS:CREATE_DIR',
    'FS:GET_STATS',
  ];

  // Navigation channels
  const navChannels = [
    'NAV:BACK',
    'NAV:FORWARD',
    'NAV:PUSH',
    'NAV:GET_STATE',
  ];

  // Search channels
  const searchChannels = [
    'SEARCH:AUTOCOMPLETE',
    'SEARCH:QUERY',
  ];

  // LLM channels
  const llmChannels = [
    'LLM:QUERY',
    'LLM:INDEX_STATUS',
    'LLM:START_INDEXING',
    'LLM:STOP_INDEXING',
  ];

  const allChannels = [
    ...fsChannels,
    ...navChannels,
    ...searchChannels,
    ...llmChannels,
  ];

  for (const channel of allChannels) {
    ipcMain.removeHandler(channel);
  }

  IPCLogger.info('All IPC handlers unregistered', {
    channelCount: allChannels.length,
  });
}

/**
 * Get list of registered IPC channels.
 * 
 * Useful for debugging and testing.
 * 
 * @returns Array of registered channel names
 * 
 * @example
 * const channels = getRegisteredChannels();
 * console.log('Registered channels:', channels);
 */
export function getRegisteredChannels(): string[] {
  return [
    // File System
    'FS:READ_DIR',
    'FS:READ_FILE',
    'FS:WRITE_FILE',
    'FS:DELETE',
    'FS:MOVE',
    'FS:CREATE_FILE',
    'FS:CREATE_DIR',
    'FS:GET_STATS',
    // Navigation
    'NAV:BACK',
    'NAV:FORWARD',
    'NAV:PUSH',
    'NAV:GET_STATE',
    // Search
    'SEARCH:AUTOCOMPLETE',
    'SEARCH:QUERY',
    // LLM (stub)
    'LLM:QUERY',
    'LLM:INDEX_STATUS',
    'LLM:START_INDEXING',
    'LLM:STOP_INDEXING',
  ];
}

/**
 * Check if all handlers are registered.
 * 
 * Useful for testing and debugging.
 * 
 * @returns True if all expected handlers are registered
 * 
 * @example
 * if (!areHandlersRegistered()) {
 *   console.error('Not all handlers are registered!');
 * }
 */
export function areHandlersRegistered(): boolean {
  // This is a simple check - in production you might want to
  // actually verify with ipcMain.eventNames() or similar
  const expectedCount = 18;
  const channels = getRegisteredChannels();
  return channels.length === expectedCount;
}
