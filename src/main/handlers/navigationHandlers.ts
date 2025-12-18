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
import {
  validatePathRequest,
  withErrorHandling,
  checkRateLimit,
} from './securityMiddleware';
import { IPCLogger } from '@shared/logging';
import { INavigationService } from '@shared/contracts';

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
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<string | null> {
  checkRateLimit('NAV:BACK');
  
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
 * 
 * Input: {}
 * Output: string | null
 */
async function handleForward(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<string | null> {
  checkRateLimit('NAV:FORWARD');
  
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
 * 
 * Input: { path: string } or just string
 * Output: { success: boolean }
 */
async function handlePush(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean }> {
  checkRateLimit('NAV:PUSH');
  
  // Handle both string and object formats
  let path: string;
  if (typeof request === 'string') {
    path = request;
  } else {
    path = validatePathRequest(request, 'path');
  }
  
  const service = getNavigationService();
  service.push(path);
  
  IPCLogger.info('Path pushed to navigation history', { path });
  
  return { success: true };
}

/**
 * Handler: NAV:GET_STATE
 * Get current navigation state.
 * 
 * Input: {}
 * Output: { canGoBack: boolean, canGoForward: boolean }
 */
async function handleGetState(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ canGoBack: boolean; canGoForward: boolean }> {
  // No rate limit for state queries (cheap operation)
  
  const service = getNavigationService();
  const state = service.getState();
  
  IPCLogger.debug('Navigation state requested', state);
  
  return state;
}

/**
 * Register all navigation IPC handlers.
 * 
 * Call this once during app initialization.
 * 
 * @example
 * // In main.ts:
 * registerNavigationHandlers();
 */
export function registerNavigationHandlers(): void {
  IPCLogger.info('Registering navigation IPC handlers');
  
  // Register all handlers with error handling middleware
  ipcMain.handle(
    'NAV:BACK',
    withErrorHandling(handleBack, 'NAV:BACK')
  );
  
  ipcMain.handle(
    'NAV:FORWARD',
    withErrorHandling(handleForward, 'NAV:FORWARD')
  );
  
  ipcMain.handle(
    'NAV:PUSH',
    withErrorHandling(handlePush, 'NAV:PUSH')
  );
  
  ipcMain.handle(
    'NAV:GET_STATE',
    withErrorHandling(handleGetState, 'NAV:GET_STATE')
  );
  
  IPCLogger.info('Navigation IPC handlers registered successfully');
}

/**
 * Get navigation service (exported for testing).
 * 
 * @returns NavigationService instance
 */
export function getNavigationServiceForTesting(): NavigationService {
  return getNavigationService();
}
