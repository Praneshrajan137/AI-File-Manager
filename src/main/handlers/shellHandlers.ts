/**
 * shellHandlers.ts - IPC handlers for shell and clipboard operations
 *
 * SECURITY:
 * - Path validation enforced by withContract('SHELL:OPEN_PATH') against canonical allowed roots
 * - Clipboard text size bounded by contract schema (max 1MB)
 */

import { ipcMain, shell, clipboard, IpcMainInvokeEvent } from 'electron';
import { withContract } from './securityMiddleware';
import { IPCLogger } from '@shared/logging';
import { IPCChannel } from '@shared/ipc/contracts';

async function handleClipboardWrite(
  _event: IpcMainInvokeEvent,
  input: { text: string }
): Promise<{ success: boolean }> {
  clipboard.writeText(input.text);
  IPCLogger.debug('Text written to clipboard', { length: input.text.length });

  return { success: true };
}

async function handleShellOpenPath(
  _event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<{ success: boolean; error?: string }> {
  IPCLogger.info('Opening file with default application', { path: input.path });

  // shell.openPath returns empty string on success, error message on failure
  const errorMessage = await shell.openPath(input.path);

  if (errorMessage) {
    IPCLogger.warn('Failed to open file', { path: input.path, error: errorMessage });
    return { success: false, error: errorMessage };
  }

  IPCLogger.info('File opened successfully', { path: input.path });
  return { success: true };
}

const SHELL_CHANNELS: IPCChannel[] = ['CLIPBOARD:WRITE_TEXT', 'SHELL:OPEN_PATH'];

/**
 * Register all shell/clipboard IPC handlers.
 */
export function registerShellHandlers(): IPCChannel[] {
  IPCLogger.info('Registering shell/clipboard IPC handlers');

  ipcMain.handle(
    'CLIPBOARD:WRITE_TEXT',
    withContract('CLIPBOARD:WRITE_TEXT', handleClipboardWrite)
  );

  ipcMain.handle(
    'SHELL:OPEN_PATH',
    withContract('SHELL:OPEN_PATH', handleShellOpenPath)
  );

  IPCLogger.info('Shell/clipboard IPC handlers registered successfully');
  return [...SHELL_CHANNELS];
}
