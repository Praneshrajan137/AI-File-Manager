/**
 * Canonical OS-aware path normalization and containment predicates for Node backend layers.
 */

import fsSync from 'fs';
import path from 'path';

export function stripTrailingSep(targetPath: string): string {
  const parsed = path.parse(targetPath);
  if (targetPath === parsed.root) {
    return targetPath;
  }
  return targetPath.replace(/[/\\]+$/, '');
}

export function normalizePathKey(targetPath: string): string {
  const clean = stripTrailingSep(path.resolve(path.normalize(targetPath)));
  return process.platform === 'win32' ? clean.toLowerCase() : clean;
}

export function isNormalizedWithin(candidateNorm: string, rootNorm: string): boolean {
  if (candidateNorm === rootNorm) {
    return true;
  }
  const rootWithSep = rootNorm.endsWith(path.sep) ? rootNorm : `${rootNorm}${path.sep}`;
  return candidateNorm.startsWith(rootWithSep);
}

export function isWithinNormalizedRoot(candidatePath: string, rootPath: string): boolean {
  return isNormalizedWithin(normalizePathKey(candidatePath), normalizePathKey(rootPath));
}

export function canonicalizePathSync(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  const realpathFn: ((p: string) => string) | null =
    typeof fsSync.realpathSync?.native === 'function'
      ? (p: string): string => fsSync.realpathSync.native(p)
      : typeof fsSync.realpathSync === 'function'
        ? (p: string): string => fsSync.realpathSync(p)
        : null;
  if (!realpathFn) {
    return resolved;
  }
  try {
    return realpathFn(resolved) || resolved;
  } catch {
    return resolved;
  }
}

export function normalizeCanonicalKeySync(targetPath: string): string {
  const canonical = stripTrailingSep(canonicalizePathSync(targetPath));
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

export function dedupeNormalizedPaths(pathsList: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of pathsList) {
    const cleaned = entry?.trim();
    if (!cleaned) continue;
    const canonical = stripTrailingSep(canonicalizePathSync(cleaned));
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(canonical);
    }
  }
  return result;
}
