/**
 * ipcHandlers.ts - Central IPC handler registry driven by shared contracts
 *
 * Registers every declared channel in ALL_IPC_CHANNELS, tracks live registration state,
 * and exposes clean verification and unregistration for tests and lifecycle shutdown.
 */

import { ipcMain } from 'electron';
import { registerFileSystemHandlers } from './fileSystemHandlers';
import { registerNavigationHandlers, resetNavigationServices } from './navigationHandlers';
import { registerSearchHandlers, resetSearchService } from './searchHandlers';
import { registerLLMHandlers } from './llmHandlers';
import { registerShellHandlers } from './shellHandlers';
import { registerVaultHandlers } from './vaultHandlers';
import { resetOperationJournal } from '../services/OperationJournal';
import { withContract, resolveAllowedRoots } from './securityMiddleware';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { resetReactiveWorkspaceKernelSync } from '@main/services/ReactiveWorkspaceKernel';
import { IPCLogger } from '@shared/logging';
import { ALL_IPC_CHANNELS, IPCChannel } from '@shared/ipc/contracts';

const registeredChannels = new Set<IPCChannel>();

function registerRuntimeHandlers(): IPCChannel[] {
  ipcMain.handle(
    'RUNTIME:GET_DIAGNOSTICS',
    withContract('RUNTIME:GET_DIAGNOSTICS', async () => {
      resolveAllowedRoots();
      return RuntimeDiagnostics.getInstance().getSnapshot();
    })
  );

  ipcMain.handle(
    'ping',
    withContract('ping', async () => 'pong' as const)
  );

  return ['RUNTIME:GET_DIAGNOSTICS', 'ping'];
}

/**
 * Register all IPC handlers across Main domains + runtime diagnostics.
 */
export function registerAllHandlers(): void {
  IPCLogger.info('Registering all IPC handlers...');
  const startTime = Date.now();
  registeredChannels.clear();

  try {
    const groups: IPCChannel[][] = [
      registerFileSystemHandlers(),
      registerNavigationHandlers(),
      registerSearchHandlers(),
      registerLLMHandlers(),
      registerShellHandlers(),
      registerRuntimeHandlers(),
      registerVaultHandlers(),
    ];

    for (const channels of groups) {
      for (const ch of channels) {
        registeredChannels.add(ch);
      }
    }

    RuntimeDiagnostics.getInstance().setRegisteredChannels(registeredChannels.size);
    const duration = Date.now() - startTime;

    IPCLogger.info('All IPC handlers registered successfully', {
      duration_ms: duration,
      registeredCount: registeredChannels.size,
      expectedCount: ALL_IPC_CHANNELS.length,
    });
  } catch (error) {
    IPCLogger.error('Failed to register IPC handlers', {
      error: error instanceof Error ? error.message : String(error),
    });
    unregisterAllHandlers();
    throw error;
  }
}

/**
 * Unregister all declared IPC handlers cleanly.
 */
export function unregisterAllHandlers(): void {
  IPCLogger.info('Unregistering all IPC handlers...');

  for (const channel of ALL_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  registeredChannels.clear();
  resetSearchService();
  resetNavigationServices();
  resetOperationJournal();
  resetReactiveWorkspaceKernelSync();
  RuntimeDiagnostics.getInstance().setRegisteredChannels(0);

  IPCLogger.info('All IPC handlers unregistered', {
    channelCount: ALL_IPC_CHANNELS.length,
  });
}

/**
 * Get list of currently registered IPC channels.
 */
export function getRegisteredChannels(): IPCChannel[] {
  return Array.from(registeredChannels);
}

/**
 * Verify dynamically that every contract-declared IPC channel is registered.
 */
export function areHandlersRegistered(): boolean {
  return (
    registeredChannels.size === ALL_IPC_CHANNELS.length &&
    ALL_IPC_CHANNELS.every((channel) => registeredChannels.has(channel))
  );
}
