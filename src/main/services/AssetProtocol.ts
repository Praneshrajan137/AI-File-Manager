import fsSync from 'fs';
import fs from 'fs/promises';
import { Readable } from 'stream';
import type { CustomScheme } from 'electron';
import { PathValidator } from './PathValidator';
import {
  getMimeTypeForAssetExtension,
  normalizeAssetExtension,
} from '@shared/utils/vaultAssetUrl';
import { SecurityLogger } from '@shared/logging';

export const VAULT_ASSET_SCHEME = 'vault-asset';

export type ResolvedVaultAssetResult =
  | {
      ok: true;
      canonicalPath: string;
      mimeType: string;
      isSvg: boolean;
      size: number;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

/**
 * Privileges registered before app.whenReady().
 * `bypassCSP` MUST stay `false` so Electron CSP restrictions continue protecting the renderer.
 */
export function getPrivilegedSchemeConfig(): CustomScheme {
  return {
    scheme: VAULT_ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      corsEnabled: false,
    },
  };
}

function extractRequestedAssetPath(requestUrl: string): string | null {
  try {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== `${VAULT_ASSET_SCHEME}:`) {
      return null;
    }
    const queryPath = parsed.searchParams.get('path');
    if (queryPath && queryPath.trim().length > 0) {
      return queryPath;
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveVaultAssetRequest(
  requestUrl: string,
  pathValidator: PathValidator
): Promise<ResolvedVaultAssetResult> {
  const requestedPath = extractRequestedAssetPath(requestUrl);
  if (!requestedPath) {
    return {
      ok: false,
      status: 400,
      message: 'Missing or invalid vault-asset path parameter',
    };
  }

  const validation = await pathValidator.validateCanonical(requestedPath);
  if (!validation.valid || !validation.canonicalPath) {
    SecurityLogger.warn('Blocked unauthorized vault-asset request', {
      error: validation.error ?? 'UNAUTHORIZED_ACCESS',
    });
    return {
      ok: false,
      status: 403,
      message: 'Access denied for requested asset path',
    };
  }

  const canonicalPath = validation.canonicalPath;
  let stats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stats = await fs.stat(canonicalPath);
  } catch {
    return {
      ok: false,
      status: 404,
      message: 'Requested asset does not exist',
    };
  }

  if (stats.isDirectory()) {
    return {
      ok: false,
      status: 400,
      message: 'Cannot stream a directory via vault-asset',
    };
  }

  const ext = normalizeAssetExtension(canonicalPath);
  const mimeType = getMimeTypeForAssetExtension(ext);
  if (!mimeType) {
    return {
      ok: false,
      status: 415,
      message: `Unsupported asset media type: .${ext || 'unknown'}`,
    };
  }

  return {
    ok: true,
    canonicalPath,
    mimeType,
    isSvg: ext === 'svg',
    size: stats.size,
  };
}

interface ByteRangeResult {
  start: number;
  end: number;
}

function parseByteRange(rangeHeader: string | null, totalSize: number): ByteRangeResult | 'invalid' | null {
  if (!rangeHeader || !rangeHeader.toLowerCase().startsWith('bytes=')) {
    return null;
  }
  const spec = rangeHeader.slice('bytes='.length).split(',')[0].trim();
  const dashIdx = spec.indexOf('-');
  if (dashIdx === -1) {
    return 'invalid';
  }
  const startStr = spec.slice(0, dashIdx).trim();
  const endStr = spec.slice(dashIdx + 1).trim();

  if (totalSize === 0) {
    return 'invalid';
  }

  if (startStr === '' && endStr !== '') {
    const suffixLen = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return 'invalid';
    const start = Math.max(0, totalSize - suffixLen);
    return { start, end: totalSize - 1 };
  }

  const start = Number.parseInt(startStr, 10);
  const end = endStr === '' ? totalSize - 1 : Number.parseInt(endStr, 10);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= totalSize
  ) {
    return 'invalid';
  }

  return { start, end: Math.min(end, totalSize - 1) };
}

function buildSecurityHeaders(mimeType: string, isSvg: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  };

  if (isSvg) {
    // Neutralize active SVG <script>/event-handler payloads even if opened directly
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }

  return headers;
}

export async function handleVaultAssetRequest(
  request: Request,
  getValidator: () => PathValidator
): Promise<Response> {
  const resolved = await resolveVaultAssetRequest(request.url, getValidator());
  if (!resolved.ok) {
    return new Response(resolved.message, {
      status: resolved.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  }

  const { canonicalPath, mimeType, isSvg, size } = resolved;
  const headers = buildSecurityHeaders(mimeType, isSvg);

  if (size === 0) {
    return new Response(new Uint8Array(0), {
      status: 200,
      headers: {
        ...headers,
        'Content-Length': '0',
      },
    });
  }

  const rangeHeader = request.headers.get('range');
  const parsedRange = parseByteRange(rangeHeader, size);
  if (parsedRange === 'invalid') {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: {
        ...headers,
        'Content-Range': `bytes */${size}`,
      },
    });
  }

  if (parsedRange) {
    const chunkSize = parsedRange.end - parsedRange.start + 1;
    const nodeStream = fsSync.createReadStream(canonicalPath, {
      start: parsedRange.start,
      end: parsedRange.end,
    });
    const webStream = Readable.toWeb(nodeStream) as unknown as BodyInit;
    return new Response(webStream, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${parsedRange.start}-${parsedRange.end}/${size}`,
        'Content-Length': String(chunkSize),
      },
    });
  }

  const nodeStream = fsSync.createReadStream(canonicalPath);
  const webStream = Readable.toWeb(nodeStream) as unknown as BodyInit;
  return new Response(webStream, {
    status: 200,
    headers: {
      ...headers,
      'Content-Length': String(size),
    },
  });
}

export function registerVaultAssetProtocol(validatorProvider?: () => PathValidator): void {
  try {
    // Lazy require avoids loading Electron browser-window runtime in pure unit tests
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronMod = require('electron') as {
      protocol?: {
        handle?: (scheme: string, listener: (req: Request) => Promise<Response> | Response) => void;
      };
    };

    if (typeof electronMod?.protocol?.handle !== 'function') {
      return;
    }

    const resolveValidator =
      validatorProvider ??
      (() : PathValidator => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getPathValidator } = require('@main/handlers/securityMiddleware') as {
          getPathValidator: () => PathValidator;
        };
        return getPathValidator();
      });

    electronMod.protocol.handle(VAULT_ASSET_SCHEME, (request: Request) =>
      handleVaultAssetRequest(request, resolveValidator)
    );
  } catch (error) {
    SecurityLogger.warn('Skipped vault-asset protocol registration', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
