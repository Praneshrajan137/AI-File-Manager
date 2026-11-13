/**
 * Cross-platform path helpers for the renderer UI.
 */

export function extractBasename(targetPath: string): string {
  const normalized = targetPath.replace(/[\\/]+$/, '');
  if (!normalized) {
    return targetPath;
  }
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || normalized;
}

export function normalizeComparablePath(targetPath: string): string {
  const forward = targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(forward) ? forward.toLowerCase() : forward;
}

export function isPathInsideDirectory(childPath: string, directoryPath: string): boolean {
  if (!childPath || !directoryPath) {
    return false;
  }
  const normalizedChild = normalizeComparablePath(childPath);
  const normalizedDir = normalizeComparablePath(directoryPath);
  if (!normalizedChild || !normalizedDir) {
    return false;
  }
  return (
    normalizedChild === normalizedDir ||
    normalizedChild.startsWith(`${normalizedDir}/`)
  );
}
