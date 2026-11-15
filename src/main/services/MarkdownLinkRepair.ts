/**
 * MarkdownLinkRepair.ts - Deterministic, undo-safe Markdown link rewriting helper.
 *
 * Computes relative `[label](./target.md)` and `[[wikilink]]` patches when
 * moving or renaming Markdown documents so links never silently rot inside vaults.
 * Code imports remain warning-only so source AST semantics are never altered blindly.
 */

import fs from 'fs/promises';
import path from 'path';
import type { BatchOperationStep } from './OperationJournal';

function normalizeCmp(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPosixRelative(fromDir: string, targetFile: string): string {
  const rawRel = path.relative(fromDir, targetFile).replace(/\\/g, '/');
  if (!rawRel.startsWith('.')) {
    return `./${rawRel}`;
  }
  return rawRel;
}

/**
 * Rewrite Markdown links in `sourceContent` pointing from `oldTargetPath` to `newTargetPath`.
 * Optional `originalSourceFilePath` resolves pre-move relative hrefs when the source file itself moves.
 */
export function rewriteMarkdownLinksInContent(
  sourceFilePath: string,
  sourceContent: string,
  oldTargetPath: string,
  newTargetPath: string,
  originalSourceFilePath: string = sourceFilePath
): string {
  const newSourceDir = path.dirname(sourceFilePath);
  const resolveSourceDir = path.dirname(originalSourceFilePath);
  const oldKey = normalizeCmp(oldTargetPath);
  const oldExt = path.extname(oldTargetPath);
  const oldStem = path.basename(oldTargetPath, oldExt);
  const oldBase = path.basename(oldTargetPath);

  const newExt = path.extname(newTargetPath);
  const newStem = path.basename(newTargetPath, newExt);
  let updated = sourceContent;

  // 1. Rewrite standard relative markdown links `[label](./old.md#sec)`
  updated = updated.replace(
    /(\[[^\]]*\]\()([^)\s]+)(\))/g,
    (full: string, open: string, href: string, close: string) => {
      if (/^[a-z]+:\/\//i.test(href) || href.startsWith('#')) {
        return full;
      }
      const hashIdx = href.indexOf('#');
      const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
      const anchor = hashIdx >= 0 ? href.slice(hashIdx) : '';
      if (!pathPart) {
        return full;
      }

      const resolvedWithExt = normalizeCmp(path.resolve(resolveSourceDir, pathPart));
      const resolvedAddedMd = normalizeCmp(path.resolve(resolveSourceDir, `${pathPart}.md`));
      if (resolvedWithExt !== oldKey && resolvedAddedMd !== oldKey) {
        return full;
      }

      const newRel = toPosixRelative(newSourceDir, newTargetPath);
      return `${open}${newRel}${anchor}${close}`;
    }
  );

  // 2. Rewrite `[[wikilinks]]` only if document basename changed (moves across dirs keep [[stem]] intact)
  if (oldStem.toLowerCase() !== newStem.toLowerCase()) {
    const wikiPattern = new RegExp(
      `(\\[\\[)(?:${escapeRegExp(oldBase)}|${escapeRegExp(oldStem)})((?:[|#][^\\]]*)?\\]\\])`,
      'gi'
    );
    updated = updated.replace(wikiPattern, `$1${newStem}$2`);
  }

  return updated;
}

/**
 * Plan safe `edit_links` batch steps for Markdown files referencing `oldTargetPath`.
 */
export async function buildMarkdownLinkRepairSteps(
  referencingSourceFiles: string[],
  oldTargetPath: string,
  newTargetPath: string
): Promise<Array<Extract<BatchOperationStep, { type: 'edit_links' }>>> {
  const uniqueSources = Array.from(new Set(referencingSourceFiles.map((p) => path.resolve(p))));
  const steps: Array<Extract<BatchOperationStep, { type: 'edit_links' }>> = [];
  const oldKey = normalizeCmp(oldTargetPath);

  for (const srcPath of uniqueSources) {
    if (normalizeCmp(srcPath) === oldKey) {
      continue;
    }
    const ext = path.extname(srcPath).toLowerCase();
    if (ext !== '.md' && ext !== '.markdown') {
      continue;
    }
    try {
      const prev = await fs.readFile(srcPath, 'utf-8');
      const next = rewriteMarkdownLinksInContent(srcPath, prev, oldTargetPath, newTargetPath);
      if (next !== prev) {
        steps.push({
          type: 'edit_links',
          filePath: srcPath,
          previousContent: prev,
          nextContent: next,
        });
      }
    } catch {
      // Skip unreadable/stale referencing files silently
    }
  }

  return steps;
}

/**
 * Plan safe post-move `edit_links` steps across multi-file batches (e.g., AI Organizer),
 * resolving relative hrefs from each referencing file's pre-move directory to final destinations.
 */
export async function buildBatchMarkdownLinkRepairSteps(
  movedFiles: Array<{ source: string; destination: string }>,
  references: Array<{ sourcePath: string; targetPath: string; isMarkdownLink: boolean }>
): Promise<Array<Extract<BatchOperationStep, { type: 'edit_links' }>>> {
  const moveMap = new Map<string, { source: string; destination: string }>();
  for (const m of movedFiles) {
    moveMap.set(normalizeCmp(m.source), {
      source: path.resolve(m.source),
      destination: path.resolve(m.destination),
    });
  }

  // Group Markdown target pairs per original source file
  const refsBySource = new Map<string, Array<{ oldTarget: string; newTarget: string }>>();
  for (const ref of references) {
    if (!ref.isMarkdownLink) continue;
    const ext = path.extname(ref.sourcePath).toLowerCase();
    if (ext !== '.md' && ext !== '.markdown') continue;

    const movedTarget = moveMap.get(normalizeCmp(ref.targetPath));
    if (!movedTarget) continue;

    const canonicalSource = path.resolve(ref.sourcePath);
    const list = refsBySource.get(canonicalSource) ?? [];
    if (!list.some((item) => normalizeCmp(item.oldTarget) === normalizeCmp(movedTarget.source))) {
      list.push({ oldTarget: movedTarget.source, newTarget: movedTarget.destination });
    }
    refsBySource.set(canonicalSource, list);
  }

  const steps: Array<Extract<BatchOperationStep, { type: 'edit_links' }>> = [];
  for (const [origSourcePath, targets] of refsBySource.entries()) {
    const movedSource = moveMap.get(normalizeCmp(origSourcePath));
    const finalSourcePath = movedSource ? movedSource.destination : origSourcePath;

    try {
      const prev = await fs.readFile(origSourcePath, 'utf-8');
      let next = prev;
      for (const pair of targets) {
        next = rewriteMarkdownLinksInContent(
          finalSourcePath,
          next,
          pair.oldTarget,
          pair.newTarget,
          origSourcePath
        );
      }
      if (next !== prev) {
        steps.push({
          type: 'edit_links',
          filePath: finalSourcePath,
          previousContent: prev,
          nextContent: next,
        });
      }
    } catch {
      // Skip unreadable files cleanly
    }
  }

  return steps;
}
