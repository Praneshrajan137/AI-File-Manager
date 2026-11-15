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
 */
export function rewriteMarkdownLinksInContent(
  sourceFilePath: string,
  sourceContent: string,
  oldTargetPath: string,
  newTargetPath: string
): string {
  const sourceDir = path.dirname(sourceFilePath);
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

      const resolvedWithExt = normalizeCmp(path.resolve(sourceDir, pathPart));
      const resolvedAddedMd = normalizeCmp(path.resolve(sourceDir, `${pathPart}.md`));
      if (resolvedWithExt !== oldKey && resolvedAddedMd !== oldKey) {
        return full;
      }

      const newRel = toPosixRelative(sourceDir, newTargetPath);
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
