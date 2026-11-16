/**
 * shellHandlers.ts - IPC handlers for shell and clipboard operations
 *
 * SECURITY:
 * - Path validation enforced by withContract('SHELL:OPEN_PATH') against canonical allowed roots
 * - Clipboard text size bounded by contract schema (max 1MB)
 */

import { ipcMain, shell, clipboard, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { withContract } from './securityMiddleware';
import { IPCLogger, SecurityLogger } from '@shared/logging';
import { IPCChannel } from '@shared/ipc/contracts';
import { FileSystemError } from '@shared/errors';

export const BLOCKED_SHELL_OPEN_EXTENSIONS = new Set([
  '.exe', '.msi', '.msp', '.msu', '.bat', '.cmd', '.com', '.cpl',
  '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.js', '.jse', '.wsf',
  '.wsh', '.hta', '.lnk', '.url', '.scf', '.reg', '.inf', '.scr',
  '.pif', '.jar', '.sh', '.bash', '.zsh', '.command', '.app',
  '.action', '.workflow', '.appimage', '.run', '.desktop', '.dll',
  '.sys', '.drv', '.ocx',
]);

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
  const ext = path.extname(input.path).toLowerCase();
  if (BLOCKED_SHELL_OPEN_EXTENSIONS.has(ext)) {
    SecurityLogger.warn('Blocked external launch of executable/script file via SHELL:OPEN_PATH', {
      path: input.path,
      extension: ext,
    });
    throw new FileSystemError(
      'UNAUTHORIZED_ACCESS',
      `Opening executable or script files (${ext}) via system shell is blocked for security. Use Reveal in Folder instead.`,
      { path: input.path, operation: 'shellOpenPath' }
    );
  }

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

async function handleShellRevealInFolder(
  _event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<{ success: boolean }> {
  IPCLogger.info('Revealing path in OS file manager', { path: input.path });
  shell.showItemInFolder(input.path);
  return { success: true };
}

const SHELL_CHANNELS: IPCChannel[] = [
  'CLIPBOARD:WRITE_TEXT',
  'SHELL:OPEN_PATH',
  'SHELL:REVEAL_IN_FOLDER',
];

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

  ipcMain.handle(
    'SHELL:REVEAL_IN_FOLDER',
    withContract('SHELL:REVEAL_IN_FOLDER', handleShellRevealInFolder)
  );

  IPCLogger.info('Shell/clipboard IPC handlers registered successfully');
  return [...SHELL_CHANNELS];
}
