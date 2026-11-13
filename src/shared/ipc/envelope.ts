/**
 * envelope.ts - Zero-dependency IPC envelope helpers
 *
 * Kept dependency-free so sandboxed preload bundles without pulling Zod.
 */

export interface IPCSerializedErrorPayload {
  name: string;
  code: string;
  message: string;
  userMessage?: string;
  isOperational?: boolean;
  timestamp?: number;
  details?: Record<string, unknown>;
}

export interface IPCSuccessEnvelope<T> {
  ok: true;
  data: T;
}

export interface IPCErrorEnvelope {
  ok: false;
  error: IPCSerializedErrorPayload;
}

export type IPCEnvelope<T> = IPCSuccessEnvelope<T> | IPCErrorEnvelope;

export function wrapIPCSuccess<T>(data: T): IPCSuccessEnvelope<T> {
  return { ok: true, data };
}

export function wrapIPCError(error: IPCSerializedErrorPayload): IPCErrorEnvelope {
  return { ok: false, error };
}

export function isIPCEnvelope<T = unknown>(value: unknown): value is IPCEnvelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok: unknown }).ok === 'boolean' &&
    (((value as { ok: boolean }).ok === true && 'data' in value) ||
      ((value as { ok: boolean }).ok === false && 'error' in value))
  );
}
