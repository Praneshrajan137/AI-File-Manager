/**
 * shellHandlers.ts - IPC handlers for shell and clipboard operations
 * 
 * Implements secure handlers for:
 * - CLIPBOARD:WRITE_TEXT - Copy text to clipboard
 * - SHELL:OPEN_PATH - Open file with default OS application
 * 
 * SECURITY: 
 * - Path validation before opening files
 * - Only opens files within allowed root directory
 */

import { ipcMain, shell, clipboard, IpcMainInvokeEvent } from 'electron';
import { withErrorHandling, validatePathOrThrow } from './securityMiddleware';
import { SecurityLogger, IPCLogger } from '@shared/logging';

/**
 * Handler: CLIPBOARD:WRITE_TEXT
 * Write text to system clipboard.
 * 
 * Input: string (text to copy)
 * Output: { success: boolean }
 */
async function handleClipboardWrite(
    event: IpcMainInvokeEvent,
    text: unknown
): Promise<{ success: boolean }> {
    if (typeof text !== 'string') {
        throw new TypeError('Clipboard text must be a string');
    }

    // Security: Limit clipboard content size to prevent memory attacks
    const MAX_CLIPBOARD_SIZE = 1024 * 1024; // 1MB
    if (text.length > MAX_CLIPBOARD_SIZE) {
        throw new Error('Text too large for clipboard');
    }

    clipboard.writeText(text);
    IPCLogger.debug('Text written to clipboard', { length: text.length });

    return { success: true };
}

/**
 * Handler: SHELL:OPEN_PATH
 * Open file with default OS application.
 * 
 * SECURITY: Validates path is within allowed root before opening.
 * 
 * Input: string (absolute path to file)
 * Output: { success: boolean, error?: string }
 */
async function handleShellOpenPath(
    event: IpcMainInvokeEvent,
    filePath: unknown
): Promise<{ success: boolean; error?: string }> {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
        throw new TypeError('File path must be a non-empty string');
    }

    // SECURITY: Validate path is within allowed root
    // This prevents opening arbitrary system files
    try {
        validatePathOrThrow(filePath);
    } catch (error) {
        SecurityLogger.warn('Blocked shell.openPath for unauthorized path', {
            path: filePath,
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            success: false,
            error: 'Access denied: path outside allowed directory'
        };
    }

    IPCLogger.info('Opening file with default application', { path: filePath });

    // shell.openPath returns empty string on success, error message on failure
    const errorMessage = await shell.openPath(filePath);

    if (errorMessage) {
        IPCLogger.warn('Failed to open file', { path: filePath, error: errorMessage });
        return { success: false, error: errorMessage };
    }

    IPCLogger.info('File opened successfully', { path: filePath });
    return { success: true };
}

/**
 * Register all shell/clipboard IPC handlers.
 * 
 * Call this once during app initialization.
 */
export function registerShellHandlers(): void {
    IPCLogger.info('Registering shell IPC handlers');

    ipcMain.handle(
        'CLIPBOARD:WRITE_TEXT',
        withErrorHandling(handleClipboardWrite, 'CLIPBOARD:WRITE_TEXT')
    );

    ipcMain.handle(
        'SHELL:OPEN_PATH',
        withErrorHandling(handleShellOpenPath, 'SHELL:OPEN_PATH')
    );

    IPCLogger.info('Shell IPC handlers registered successfully');
}
