/**
 * navigationHandlers.ts - IPC handlers for navigation history
 * 
 * Implements browser-style back/forward navigation using HistoryStack DSA.
 * 
 * Handlers:
 * - NAV:BACK - Navigate to previous path
 * - NAV:FORWARD - Navigate to next path
 * - NAV:PUSH - Add path to history
 * - NAV:GET_STATE - Get navigation state (canGoBack, canGoForward)
 * 
 * The NavigationService maintains state across all IPC calls (singleton pattern).
 * 
 * @example
 * // In main.ts:
 * import { registerNavigationHandlers } from './handlers/navigationHandlers';
 * registerNavigationHandlers();
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { HistoryStack } from '@main/dsa/HistoryStack';
import { withContract } from './securityMiddleware';
import { IPCLogger } from '@shared/logging';
import { INavigationService } from '@shared/contracts';
import { IPCChannel } from '@shared/ipc/contracts';

/**
 * NavigationService implementation using HistoryStack.
 * 
 * Provides back/forward navigation with O(1) operations.
 */
class NavigationService implements INavigationService {
  private historyStack: HistoryStack;

  constructor(historyStack: HistoryStack) {
    this.historyStack = historyStack;
  }

  /**
   * Navigate backward in history.
   * 
   * @returns Previous path or null if at start
   */
  back(): string | null {
    const prevPath = this.historyStack.back();

    if (prevPath) {
      IPCLogger.debug('Navigated back', { path: prevPath });
    } else {
      IPCLogger.debug('Cannot navigate back - at start of history');
    }

    return prevPath;
  }

  /**
   * Navigate forward in history.
   * 
   * @returns Next path or null if at end
   */
  forward(): string | null {
    const nextPath = this.historyStack.forward();

    if (nextPath) {
      IPCLogger.debug('Navigated forward', { path: nextPath });
    } else {
      IPCLogger.debug('Cannot navigate forward - at end of history');
    }

    return nextPath;
  }

  /**
   * Add new path to history.
   * 
   * This clears any forward history.
   * 
   * @param path - Path to add
   */
  push(path: string): void {
    this.historyStack.push(path);
    IPCLogger.debug('Path added to history', { path });
  }

  /**
   * Get current navigation state.
   * 
   * @returns Whether back/forward are available
   */
  getState(): { canGoBack: boolean; canGoForward: boolean } {
    return {
      canGoBack: this.historyStack.canGoBack(),
      canGoForward: this.historyStack.canGoForward(),
    };
  }

  /**
   * Get current path without navigating.
   * 
   * @returns Current path or null if no history
   */
  getCurrentPath(): string | null {
    return this.historyStack.currentPath();
  }
}

/**
 * Singleton NavigationService instance.
 * Maintains state across all IPC requests.
 */
let navigationService: NavigationService | null = null;

/**
 * Get or create NavigationService instance.
 * 
 * @returns NavigationService instance
 */
function getNavigationService(): NavigationService {
  if (!navigationService) {
    const historyStack = new HistoryStack(50); // Max 50 history entries
    navigationService = new NavigationService(historyStack);
    IPCLogger.info('NavigationService initialized');
  }

  return navigationService;
}

/**
 * Handler: NAV:BACK
 * Navigate backward in history.
 * 
 * Input: {}
 * Output: string | null
 */
async function handleBack(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<string | null> {
  const service = getNavigationService();
  const prevPath = service.back();

  IPCLogger.info('Navigation back requested', {
    prevPath,
    success: prevPath !== null,
  });

  return prevPath;
}

/**
 * Handler: NAV:FORWARD
 * Navigate forward in history.
 */
async function handleForward(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<string | null> {
  const service = getNavigationService();
  const nextPath = service.forward();

  IPCLogger.info('Navigation forward requested', {
    nextPath,
    success: nextPath !== null,
  });

  return nextPath;
}

/**
 * Handler: NAV:PUSH
 * Add path to navigation history.
 */
async function handlePush(
  _event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<{ success: boolean }> {
  const service = getNavigationService();
  service.push(input.path);

  IPCLogger.info('Path pushed to navigation history', { path: input.path });

  return { success: true };
}

/**
 * Handler: NAV:GET_STATE
 * Get current navigation state.
 */
async function handleGetState(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<{ canGoBack: boolean; canGoForward: boolean }> {
  const service = getNavigationService();
  const state = service.getState();

  IPCLogger.debug('Navigation state requested', state);

  return state;
}

const NAVIGATION_CHANNELS: IPCChannel[] = [
  'NAV:BACK',
  'NAV:FORWARD',
  'NAV:PUSH',
  'NAV:GET_STATE',
];

/**
 * Register all navigation IPC handlers.
 */
export function registerNavigationHandlers(): IPCChannel[] {
  IPCLogger.info('Registering navigation IPC handlers');

  ipcMain.handle('NAV:BACK', withContract('NAV:BACK', handleBack));
  ipcMain.handle('NAV:FORWARD', withContract('NAV:FORWARD', handleForward));
  ipcMain.handle('NAV:PUSH', withContract('NAV:PUSH', handlePush));
  ipcMain.handle('NAV:GET_STATE', withContract('NAV:GET_STATE', handleGetState));

  IPCLogger.info('Navigation IPC handlers registered successfully');
  return [...NAVIGATION_CHANNELS];
}

/**
 * Get navigation service (exported for testing).
 * 
 * @returns NavigationService instance
 */
export function getNavigationServiceForTesting(): NavigationService {
  return getNavigationService();
}
