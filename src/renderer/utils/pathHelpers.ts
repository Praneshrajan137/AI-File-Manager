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

export function extractParentDirectory(targetPath: string): string {
  if (!targetPath) {
    return targetPath;
  }
  const uncRootMatch = /^(\\\\[^\\/]+[\\/][^\\/]+)(?:[\\/](.*))?$/.exec(targetPath);
  if (uncRootMatch) {
    const root = uncRootMatch[1];
    const rest = (uncRootMatch[2] || '').replace(/[\\/]+$/, '');
    if (!rest) {
      return root;
    }
    const lastSep = Math.max(rest.lastIndexOf('/'), rest.lastIndexOf('\\'));
    return lastSep >= 0 ? `${root}\\${rest.slice(0, lastSep)}` : root;
  }

  const driveRootMatch = /^([A-Za-z]:[\\/])(.*)$/.exec(targetPath);
  const trimmed = targetPath.replace(/[\\/]+$/, '');
  if (!trimmed) {
    return targetPath.startsWith('/') ? '/' : targetPath;
  }
  if (/^[A-Za-z]:$/.test(trimmed) && driveRootMatch) {
    return driveRootMatch[1];
  }
  const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (lastSep < 0) {
    return trimmed;
  }
  if (lastSep === 0 && trimmed.startsWith('/')) {
    return '/';
  }
  const parent = trimmed.slice(0, lastSep);
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}${trimmed[lastSep]}`;
  }
  return parent;
}

export function normalizeComparablePath(targetPath: string): string {
  const forward = targetPath.replace(/\\/g, '/');
  if (forward === '/' || /^\/+$/.test(forward)) {
    return '/';
  }
  if (/^[A-Za-z]:\/+$/.test(forward)) {
    return `${forward[0].toLowerCase()}:/`;
  }
  const trimmed = forward.replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
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
  if (normalizedChild === normalizedDir) {
    return true;
  }
  if (normalizedDir === '/') {
    return normalizedChild.startsWith('/');
  }
  if (/^[a-z]:\/$/.test(normalizedDir)) {
    return normalizedChild.startsWith(normalizedDir);
  }
  return normalizedChild.startsWith(`${normalizedDir}/`);
}

export function joinChildPath(parentDir: string, childName: string): string {
  const sep = parentDir.includes('\\') && !parentDir.includes('/') ? '\\' : '/';
  if (parentDir.endsWith('/') || parentDir.endsWith('\\')) {
    return `${parentDir}${childName}`;
  }
  return `${parentDir}${sep}${childName}`;
}
