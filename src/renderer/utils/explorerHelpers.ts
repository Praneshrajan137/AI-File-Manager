import type { FileNode, SortCriteria, SortDirection } from '@shared/contracts';
import { extractBasename, normalizeComparablePath } from './pathHelpers';

export function toFileNodeStub(filePath: string, files: FileNode[]): FileNode {
  const existing = files.find(
    (f) => normalizeComparablePath(f.path) === normalizeComparablePath(filePath)
  );
  if (existing) return existing;
  const name = extractBasename(filePath);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return {
    path: filePath,
    name,
    isDirectory: false,
    size: 0,
    modified: Date.now(),
    extension,
    mimeType: 'text/plain',
  };
}

export function sortFileNodes(
  files: FileNode[],
  sortBy: SortCriteria,
  sortDirection: SortDirection
): FileNode[] {
  return [...files].sort((a, b) => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name) * direction;
      case 'size':
        return (a.size - b.size) * direction;
      case 'modified':
        return (a.modified - b.modified) * direction;
      case 'type':
        return a.extension.localeCompare(b.extension) * direction;
      default:
        return 0;
    }
  });
}

export interface SelectionModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function toggleMultiSelection(
  currentSelected: string[],
  orderedPaths: string[],
  clickedPath: string,
  modifiers: SelectionModifiers = {},
  anchorPath: string | null = null
): { selected: string[]; nextAnchor: string | null } {
  if (modifiers.shiftKey && anchorPath) {
    const startIdx = orderedPaths.indexOf(anchorPath);
    const endIdx = orderedPaths.indexOf(clickedPath);
    if (startIdx >= 0 && endIdx >= 0) {
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      return {
        selected: orderedPaths.slice(lo, hi + 1),
        nextAnchor: anchorPath,
      };
    }
  }

  if (modifiers.ctrlKey || modifiers.metaKey) {
    const exists = currentSelected.includes(clickedPath);
    const selected = exists
      ? currentSelected.filter((p) => p !== clickedPath)
      : [...currentSelected, clickedPath];
    return {
      selected,
      nextAnchor: clickedPath,
    };
  }

  return {
    selected: [clickedPath],
    nextAnchor: clickedPath,
  };
}

export interface GridGeometry {
  columnCount: number;
  rowCount: number;
  columnWidth: number;
  rowHeight: number;
  width: number;
  height: number;
}

export function computeGridGeometry(
  containerWidth: number,
  containerHeight: number,
  itemCount: number,
  targetColumnWidth: number = 156,
  rowHeight: number = 148
): GridGeometry {
  const safeWidth = Math.max(160, Math.floor(containerWidth));
  const safeHeight = Math.max(160, Math.floor(containerHeight));
  const columnCount = Math.max(1, Math.floor(safeWidth / targetColumnWidth));
  const columnWidth = Math.max(120, Math.floor(safeWidth / columnCount));
  const rowCount = itemCount > 0 ? Math.ceil(itemCount / columnCount) : 0;

  return {
    columnCount,
    rowCount,
    columnWidth,
    rowHeight,
    width: safeWidth,
    height: safeHeight,
  };
}

export interface ParsedTextSegment {
  type: 'text' | 'citation';
  content: string;
  fileName?: string;
  startLine?: number;
  endLine?: number;
}

const CITATION_REGEX = /\[([^[\]\r\n#]+)#L(\d+)(?:-L?(\d+))?\]/g;

export function parseCitationSegments(text: string): ParsedTextSegment[] {
  const segments: ParsedTextSegment[] = [];
  let lastIndex = 0;
  CITATION_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CITATION_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }
    const startLine = Number.parseInt(match[2], 10);
    const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;
    segments.push({
      type: 'citation',
      content: match[0],
      fileName: match[1].trim(),
      startLine,
      endLine: Math.max(startLine, endLine),
    });
    lastIndex = CITATION_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

export function extractDraggedPaths(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];
  const raw = dataTransfer.getData('application/x-fm-paths');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

/** Extracts absolute OS file paths dropped from the host desktop/Explorer into PrivateVault AI. */
export function extractExternalDroppedPaths(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];
  if (dataTransfer.types.includes('application/x-fm-paths')) {
    return [];
  }
  const files = Array.from(dataTransfer.files ?? []);
  if (files.length === 0) return [];
  const bridged =
    typeof window !== 'undefined' && typeof window.electronAPI?.fs?.getPathsForDroppedFiles === 'function'
      ? window.electronAPI.fs.getPathsForDroppedFiles(files)
      : [];
  const fallback =
    bridged.length > 0
      ? bridged
      : files.map((file) => (file as File & { path?: string }).path ?? '');
  return Array.from(
    new Set(fallback.filter((p): p is string => typeof p === 'string' && p.trim().length > 0))
  );
}

/** Resolves a non-colliding copy name (`name (copy).ext`, `name (copy 2).ext`) against existing siblings. */
export function resolveCopyCollisionName(
  originalName: string,
  existingNamesLower: Set<string>,
  preferOriginal: boolean = true
): string {
  if (preferOriginal && !existingNamesLower.has(originalName.toLowerCase())) {
    existingNamesLower.add(originalName.toLowerCase());
    return originalName;
  }
  const dotIdx = originalName.lastIndexOf('.');
  const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';

  for (let counter = 1; counter < 1000; counter++) {
    const suffix = counter === 1 ? ' (copy)' : ` (copy ${counter})`;
    const candidate = `${stem}${suffix}${ext}`;
    if (!existingNamesLower.has(candidate.toLowerCase())) {
      existingNamesLower.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const fallback = `${stem} (${Date.now()})${ext}`;
  existingNamesLower.add(fallback.toLowerCase());
  return fallback;
}
