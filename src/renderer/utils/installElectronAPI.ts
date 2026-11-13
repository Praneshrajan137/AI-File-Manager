import { IPCSerializedErrorPayload, isIPCEnvelope } from '@shared/ipc/envelope';

export interface RehydratedIPCError extends Error {
  code?: string;
  userMessage?: string;
  isOperational?: boolean;
  timestamp?: number;
  details?: Record<string, unknown>;
}

/**
 * Reconstruct a structured Error in the renderer's main JS world so custom
 * metadata fields (.code, .userMessage, .isOperational, .details) survive
 * Electron's contextBridge boundary (which strips custom Error properties when
 * Promises reject inside the preload world).
 */
export function createMainWorldIPCError(payload: IPCSerializedErrorPayload): RehydratedIPCError {
  const err: RehydratedIPCError = new Error(payload.userMessage || payload.message);
  err.name = payload.name || 'IPCError';
  err.code = payload.code;
  err.userMessage = payload.userMessage;
  err.isOperational = payload.isOperational;
  err.timestamp = payload.timestamp;
  err.details = payload.details;
  return err;
}

function unwrapEnvelope(raw: unknown): unknown {
  if (isIPCEnvelope(raw)) {
    if (raw.ok) {
      return raw.data;
    }
    throw createMainWorldIPCError(raw.error);
  }
  return raw;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in (value as Record<string, unknown>) &&
    typeof (value as { then: unknown }).then === 'function'
  );
}

/**
 * Wrap every function on an exposed preload bridge object so returned Promises
 * unwrap IPCEnvelope responses inside the renderer main world.
 */
export function wrapBridgeNamespace<T>(node: T): T {
  if (typeof node === 'function') {
    const fn = node as (...args: unknown[]) => unknown;
    const wrapped = (...args: unknown[]): unknown => {
      const result = fn(...args);
      if (isPromiseLike(result)) {
        return result.then(unwrapEnvelope);
      }
      return result;
    };
    return wrapped as unknown as T;
  }

  if (node !== null && typeof node === 'object') {
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(node as Record<string, unknown>)) {
      target[key] = wrapBridgeNamespace((node as Record<string, unknown>)[key]);
    }
    return Object.freeze(target) as T;
  }

  return node;
}

/**
 * Install frozen window.electronAPI backed by contextBridge's __electronIPCBridge.
 */
export function installElectronAPI(targetWindow: Window = window): void {
  const winRecord = targetWindow as unknown as Record<string, unknown>;
  if (winRecord.electronAPI !== undefined) {
    return;
  }

  const bridge = winRecord.__electronIPCBridge;
  if (!bridge || typeof bridge !== 'object') {
    return;
  }

  const wrappedApi = wrapBridgeNamespace(bridge);
  Object.defineProperty(targetWindow, 'electronAPI', {
    value: wrappedApi,
    writable: false,
    configurable: false,
    enumerable: true,
  });
}
