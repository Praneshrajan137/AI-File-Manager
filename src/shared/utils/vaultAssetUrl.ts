const IMAGE_ASSET_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'svg',
]);

const VIDEO_ASSET_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'mkv',
  'm4v',
]);

const AUDIO_ASSET_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'aac',
]);

const DOCUMENT_ASSET_EXTENSIONS = new Set(['pdf']);

const ASSET_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
};

export type VaultAssetKind = 'image' | 'pdf' | 'video' | 'audio' | 'unsupported';

export function normalizeAssetExtension(extOrPath: string): string {
  const cleaned = extOrPath.trim().toLowerCase();
  if (!cleaned) {
    return '';
  }
  const slashIdx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  const base = slashIdx >= 0 ? cleaned.slice(slashIdx + 1) : cleaned;
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx >= 0) {
    return base.slice(dotIdx + 1);
  }
  return base.replace(/^\./, '');
}

export function getVaultAssetKind(extOrPath: string): VaultAssetKind {
  const ext = normalizeAssetExtension(extOrPath);
  if (IMAGE_ASSET_EXTENSIONS.has(ext)) return 'image';
  if (DOCUMENT_ASSET_EXTENSIONS.has(ext)) return 'pdf';
  if (VIDEO_ASSET_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_ASSET_EXTENSIONS.has(ext)) return 'audio';
  return 'unsupported';
}

export function isPreviewableAssetExtension(extOrPath: string): boolean {
  return getVaultAssetKind(extOrPath) !== 'unsupported';
}

export function getMimeTypeForAssetExtension(extOrPath: string): string | null {
  const ext = normalizeAssetExtension(extOrPath);
  return ASSET_MIME_TYPES[ext] ?? null;
}

/**
 * Construct a safe custom protocol URL that avoids Windows drive-letter host
 * lowercasing or path separator mangling.
 */
export function buildVaultAssetUrl(filePath: string): string {
  return `vault-asset://local/file?path=${encodeURIComponent(filePath)}`;
}
