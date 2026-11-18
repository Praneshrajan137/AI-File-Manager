/**
 * OrganizerPlanner.ts - Read-only dry-run file organization planner (auto, smart_category,
 * by_type, by_date, deduplicate, heuristic & optional vector semantic clustering, optional LLM).
 *
 * Contains zero filesystem write or journal dependencies so read-only consumers (e.g. MCP)
 * can plan safely without pulling OperationJournal or write-capable modules.
 */

import * as crypto from 'crypto';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  GraphImpactCheckResult,
  GraphImpactReference,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
} from '@shared/contracts';
import { normalizePathKey } from '@main/platform/pathNormalize';
import { isSensitiveSecretFile, redactSensitiveText } from '@shared/security/SecretGuard';
import { ErrorFactory, FileSystemError } from '@shared/errors';
import type { PathValidator } from '@main/services/PathValidator';

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// eslint-disable-next-line no-control-regex
const INVALID_SEGMENT_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_RECURSIVE_DEPTH = 3;
const MAX_ORGANIZE_FILES = 300;
const FAST_HASH_BUFFER_LIMIT = 256 * 1024;
const ORGANIZER_IO_CONCURRENCY = 16;

const SKIPPED_RECURSIVE_DIRS = new Set([
  'node_modules',
  '.git',
  '.privatevault',
  '.file-manager',
  'trash-vault',
  'duplicates archive',
  'dist',
  'build',
]);

const SNIPPET_TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.yaml', '.yml', '.csv',
]);

const SMART_EXTENSION_GROUPS: Array<{ category: string; extensions: ReadonlySet<string> }> = [
  {
    category: 'Source Code',
    extensions: new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
      '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.sh', '.sql', '.css', '.html',
    ]),
  },
  {
    category: 'Documents',
    extensions: new Set(['.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.markdown', '.mdx']),
  },
  {
    category: 'Data & Config',
    extensions: new Set(['.json', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.xml', '.env', '.ini']),
  },
  {
    category: 'Images & Design',
    extensions: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.fig']),
  },
  {
    category: 'Audio & Video',
    extensions: new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.mp4', '.webm', '.mov', '.mkv']),
  },
  {
    category: 'Archives',
    extensions: new Set(['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2']),
  },
];

export interface CandidateFileEntry {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtimeMs: number;
  sha256: string;
  depth: number;
}

export interface OrganizerLlmBatchSuggestion {
  category?: string;
  newName?: string;
  reason?: string;
  confidence?: number;
}

export interface OrganizerVectorClusterInput {
  filePath: string;
  name: string;
  fileType: string;
  chunkCount: number;
  vector: number[];
  topSymbols: string[];
  textSample: string;
}

export interface OrganizerVectorClusterGroup {
  label: string;
  cohesionScore: number;
  files: Array<{ path: string }>;
  memberCosineByPath: Map<string, number>;
}

export interface OrganizerPlannerDeps {
  validator: PathValidator;
  findImpactForPaths?: (targetPaths: string[]) => GraphImpactReference[];
  getDocumentVectors?: (filePaths: string[], canonicalRoot: string) => Promise<Map<string, number[]>>;
  embedTexts?: (texts: string[]) => Promise<number[][]>;
  clusterVectors?: (
    items: OrganizerVectorClusterInput[]
  ) => OrganizerVectorClusterGroup[];
  suggestWithLlm?: (input: {
    canonicalRoot: string;
    files: Array<{
      path: string;
      relPath: string;
      name: string;
      ext: string;
      size: number;
      redactedSnippet: string;
    }>;
    signal?: AbortSignal;
  }) => Promise<{
    suggestions: Map<string, OrganizerLlmBatchSuggestion> | null;
    batchCount: number;
    degradedReason?: string;
  }>;
}

export function normalizeOrganizerKey(targetPath: string): string {
  return normalizePathKey(targetPath);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await fn(items[idx], idx);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

export async function computeFileSha256(filePath: string, knownSize?: number): Promise<string> {
  if (knownSize !== undefined && knownSize <= FAST_HASH_BUFFER_LIMIT) {
    const buf = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  }
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function pathExistsOnDisk(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readOrganizerSnippetSample(
  filePath: string,
  ext: string,
  size: number
): Promise<string> {
  if (!SNIPPET_TEXT_EXTENSIONS.has(ext) || size === 0 || size > 512 * 1024) {
    return '';
  }
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const len = Math.min(size, 1024);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      return buf.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

function sanitizeSingleSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/\.\./g, '')
    .replace(INVALID_SEGMENT_CHARS, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 64)
    .replace(/^[-.\s]+|[-.\s]+$/g, '');

  const stem = cleaned.split('.')[0] ?? '';
  if (
    !cleaned ||
    cleaned === '.' ||
    cleaned === '..' ||
    WINDOWS_RESERVED_NAMES.test(cleaned) ||
    WINDOWS_RESERVED_NAMES.test(stem)
  ) {
    return fallback;
  }
  return cleaned;
}

function classifyFileDeterministic(
  fileName: string,
  ext: string,
  mtimeMs: number,
  strategy: OrganizeStrategy
): { category: string; reason: string } {
  if (strategy === 'by_date') {
    const d = new Date(mtimeMs);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return {
      category: `${year}-${month}`,
      reason: `Grouped by UTC modified month (${year}-${month})`,
    };
  }

  const lowerName = fileName.toLowerCase();
  if (strategy === 'auto' || strategy === 'smart_category' || strategy === 'ai_suggested') {
    if (/(invoice|receipt|tax|statement|bill|expense|ledger)/.test(lowerName)) {
      return {
        category: 'Finance & Receipts',
        reason: 'Matched financial document filename cue',
      };
    }
    if (/(spec|architecture|design|rfc|adr|readme|notes|meeting)/.test(lowerName)) {
      return {
        category: 'Specs & Notes',
        reason: 'Matched engineering documentation cue',
      };
    }
    if (/(test|spec\.)/.test(lowerName) && ['.ts', '.tsx', '.js', '.py'].includes(ext)) {
      return {
        category: 'Tests',
        reason: 'Matched automated test file pattern',
      };
    }
  }

  for (const group of SMART_EXTENSION_GROUPS) {
    if (group.extensions.has(ext)) {
      return {
        category: group.category,
        reason: `Grouped by extension (${ext || 'unknown'})`,
      };
    }
  }

  return {
    category: 'Misc Files',
    reason: ext ? `Grouped unmatched extension (${ext})` : 'Grouped extensionless file',
  };
}

async function classifySemanticHeuristicFallback(
  file: CandidateFileEntry
): Promise<{ category: string; reason: string } | null> {
  const sample = (await readOrganizerSnippetSample(file.path, file.ext, file.size)).toLowerCase();
  const combined = `${file.name.toLowerCase()}\n${sample}`;
  if (/(oauth|jwt|encrypt|hmac|secretguard|pathvalidator|auth|security|firewall|token)/.test(combined)) {
    return {
      category: 'Security & Auth',
      reason: 'Topic heuristic fallback (ONNX embeddings unavailable): authentication or security controls',
    };
  }
  if (/(invoice|budget|revenue|arr_usd|expense|ledger|tax|fiscal|payroll)/.test(combined)) {
    return {
      category: 'Finance & Legal',
      reason: 'Topic heuristic fallback (ONNX embeddings unavailable): financial or accounting records',
    };
  }
  if (/(kubernetes|dockerfile|github\/workflows|terraform|ci-watch|autoscaler|postgres|replication)/.test(combined)) {
    return {
      category: 'Infrastructure & CI',
      reason: 'Topic heuristic fallback (ONNX embeddings unavailable): deployment or operations config',
    };
  }
  if (/(react|usestate|tailwind|component|modal|drawer|tsx|css|dark-slate)/.test(combined)) {
    return {
      category: 'UI & Frontend',
      reason: 'Topic heuristic fallback (ONNX embeddings unavailable): UI components or styling',
    };
  }
  if (/(architecture|runbook|protocol|adr-|rfc-|specification|design doc)/.test(combined)) {
    return {
      category: 'Specs & Notes',
      reason: 'Topic heuristic fallback (ONNX embeddings unavailable): architecture specs or runbooks',
    };
  }
  return null;
}

export class OrganizerPlanner {
  constructor(private readonly deps: OrganizerPlannerDeps) {}

  async proposeOrganizationPlan(input: {
    targetDir: string;
    strategy?: OrganizeStrategy;
    useLLM?: boolean;
    recursive?: boolean;
    signal?: AbortSignal;
  }): Promise<OrganizePlanResult> {
    const strategy: OrganizeStrategy = input.strategy ?? 'auto';
    const rootValidation = await this.deps.validator.validateCanonical(input.targetDir);
    if (!rootValidation.valid || !rootValidation.canonicalPath) {
      throw new FileSystemError(
        'UNAUTHORIZED_ACCESS',
        rootValidation.details || rootValidation.error || 'Target directory denied',
        { path: input.targetDir }
      );
    }

    const canonicalRoot = rootValidation.canonicalPath;
    const rootStats = await fs.lstat(canonicalRoot);
    if (!rootStats.isDirectory()) {
      throw ErrorFactory.createValidationError(
        'INVALID_INPUT',
        'targetDir',
        input.targetDir,
        'AI Organizer targetDir must be an existing directory'
      );
    }

    const recursive = input.recursive === true || strategy === 'deduplicate';
    const { files: fileCandidates, skippedFiles } = await this.collectCandidateFiles(
      canonicalRoot,
      recursive
    );

    const reservedDestinations = new Set<string>();
    const folderListingCache = new Map<string, Set<string>>();
    const operations: OrganizePlanOperation[] = [];
    let usedLLM = false;
    let batchCount = 0;
    let degradedReason: string | undefined;

    if (strategy === 'deduplicate') {
      const bySha = new Map<string, CandidateFileEntry[]>();
      for (const file of fileCandidates) {
        if (file.size === 0) continue;
        const group = bySha.get(file.sha256) ?? [];
        group.push(file);
        bySha.set(file.sha256, group);
      }

      for (const [sha, cluster] of bySha.entries()) {
        if (cluster.length < 2) continue;
        const sorted = [...cluster].sort((a, b) => {
          if (a.depth !== b.depth) return a.depth - b.depth;
          if (a.name.length !== b.name.length) return a.name.length - b.name.length;
          return a.path.localeCompare(b.path);
        });
        const primary = sorted[0];
        const shortHash = sha.slice(0, 8);
        const category = path.join('Duplicates Archive', shortHash);

        for (const dup of sorted.slice(1)) {
          const destinationPath = await this.allocateUniqueDestination(
            canonicalRoot,
            category,
            dup.name,
            reservedDestinations,
            undefined,
            folderListingCache
          );
          if (destinationPath === dup.path) continue;
          operations.push({
            id: crypto.randomUUID(),
            action: 'move',
            sourcePath: dup.path,
            destinationPath,
            sourceSha256: dup.sha256,
            size: dup.size,
            category: `Duplicate (${shortHash})`,
            reason: `Exact SHA-256 duplicate of "${primary.name}" (${dup.size} bytes)`,
            confidence: 1,
            classificationSource: 'deduplicate',
          });
        }
      }
    } else {
      const llmEnabled =
        fileCandidates.length > 0 &&
        (input.useLLM === true || strategy === 'ai_suggested') &&
        Boolean(this.deps.suggestWithLlm);

      const llmOutcome = llmEnabled
        ? await this.runLlmSuggestionHook(canonicalRoot, fileCandidates, input.signal)
        : { suggestions: null, batchCount: 0 };

      usedLLM = llmOutcome.suggestions !== null && llmOutcome.suggestions.size > 0;
      batchCount = llmOutcome.batchCount;
      degradedReason = llmOutcome.degradedReason;

      const vectorSemanticAssignments =
        strategy === 'semantic_cluster'
          ? await this.buildVectorSemanticAssignments(canonicalRoot, fileCandidates)
          : new Map<string, { category: string; reason: string; confidence: number }>();
      const usedVectorClustering = vectorSemanticAssignments.size >= 2;
      if (strategy === 'semantic_cluster' && !usedVectorClustering) {
        degradedReason =
          degradedReason ??
          'Dense embedding vectors unavailable for this folder; used keyword topic heuristic fallback.';
      }

      for (const file of fileCandidates) {
        const relKey = path.relative(canonicalRoot, file.path).replace(/\\/g, '/');
        const llmHint = llmOutcome.suggestions?.get(relKey) ?? llmOutcome.suggestions?.get(file.name);
        const vectorHint =
          strategy === 'semantic_cluster'
            ? vectorSemanticAssignments.get(normalizeOrganizerKey(file.path))
            : undefined;
        const semanticHint =
          strategy === 'semantic_cluster'
            ? vectorHint ?? (await classifySemanticHeuristicFallback(file))
            : null;
        const fallback =
          semanticHint ?? classifyFileDeterministic(file.name, file.ext, file.mtimeMs, strategy);

        const classificationSource: OrganizePlanOperation['classificationSource'] = llmHint
          ? 'llm'
          : vectorHint || semanticHint
            ? 'semantic'
            : 'deterministic';
        const confidence =
          classificationSource === 'llm'
            ? llmHint?.confidence ?? 0.85
            : vectorHint
              ? vectorHint.confidence
              : semanticHint
                ? 0.62
                : strategy === 'by_type' || strategy === 'by_date'
                  ? 0.92
                  : 0.75;

        const category = sanitizeSingleSegment(llmHint?.category || fallback.category, fallback.category);
        const desiredFileName = sanitizeSingleSegment(llmHint?.newName || file.name, file.name);
        const safeFileName =
          path.extname(desiredFileName).toLowerCase() === file.ext || !file.ext
            ? desiredFileName
            : `${desiredFileName}${file.ext}`;

        const destinationPath = await this.allocateUniqueDestination(
          canonicalRoot,
          category,
          safeFileName,
          reservedDestinations,
          file.path,
          folderListingCache
        );

        if (normalizeOrganizerKey(destinationPath) === normalizeOrganizerKey(file.path)) {
          continue;
        }

        operations.push({
          id: crypto.randomUUID(),
          action: path.dirname(destinationPath) === canonicalRoot ? 'rename' : 'move',
          sourcePath: file.path,
          destinationPath,
          sourceSha256: file.sha256,
          size: file.size,
          category,
          reason: llmHint?.reason?.trim() || fallback.reason,
          confidence,
          classificationSource,
        });
      }
    }

    const planId = crypto.randomUUID();
    const linkImpact = this.buildImpactSummary(operations.map((o) => o.sourcePath));
    const impactNote = linkImpact
      ? ` (${linkImpact.totalAffectedFiles} file(s) link here; ${linkImpact.markdownRepairableCount} Markdown links auto-repairable).`
      : '';
    const summary =
      operations.length > 0
        ? strategy === 'deduplicate'
          ? `Proposed archiving ${operations.length} redundant duplicate file(s) into reversible Duplicates Archive${impactNote}.`
          : `Proposed ${operations.length} file moves across ${new Set(operations.map((o) => o.category)).size} folders (${usedLLM ? 'Local LLM assisted' : `deterministic ${strategy}`})${impactNote}.`
        : strategy === 'deduplicate'
          ? 'No exact byte-identical duplicates found inside this directory.'
          : 'No files require reorganization in this folder.';

    return {
      planId,
      targetDir: canonicalRoot,
      strategy,
      usedLLM,
      createdAt: Date.now(),
      operations,
      skippedFiles,
      summary,
      ...(linkImpact ? { linkImpact } : {}),
      ...(typeof batchCount === 'number' && batchCount > 0 ? { batchCount } : {}),
      ...(degradedReason ? { degradedReason } : {}),
    };
  }

  private async runLlmSuggestionHook(
    canonicalRoot: string,
    fileCandidates: CandidateFileEntry[],
    signal?: AbortSignal
  ): Promise<{
    suggestions: Map<string, OrganizerLlmBatchSuggestion> | null;
    batchCount: number;
    degradedReason?: string;
  }> {
    if (!this.deps.suggestWithLlm) {
      return { suggestions: null, batchCount: 0 };
    }
    const sorted = [...fileCandidates].sort(
      (a, b) => a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name)
    );
    const prepared = await Promise.all(
      sorted.map(async (f) => {
        const rawSnippet = await readOrganizerSnippetSample(f.path, f.ext, f.size);
        const redactedSnippet = rawSnippet
          ? redactSensitiveText(rawSnippet).sanitizedText.replace(/\s+/g, ' ').trim().slice(0, 120)
          : '';
        return {
          path: f.path,
          relPath: path.relative(canonicalRoot, f.path).replace(/\\/g, '/'),
          name: f.name,
          ext: f.ext,
          size: f.size,
          redactedSnippet,
        };
      })
    );
    return this.deps.suggestWithLlm({ canonicalRoot, files: prepared, signal });
  }

  private async collectCandidateFiles(
    canonicalRoot: string,
    recursive: boolean
  ): Promise<{ files: CandidateFileEntry[]; skippedFiles: number }> {
    let skippedFiles = 0;
    const rawCandidates: Array<{ fullPath: string; name: string; depth: number }> = [];
    const queue: Array<{ dir: string; depth: number }> = [{ dir: canonicalRoot, depth: 0 }];
    let head = 0;

    while (head < queue.length && rawCandidates.length < MAX_ORGANIZE_FILES) {
      const levelBatch: Array<{ dir: string; depth: number }> = [];
      while (head < queue.length && levelBatch.length < 8) {
        levelBatch.push(queue[head]);
        head += 1;
      }

      const dirEntriesList = await Promise.all(
        levelBatch.map(async (item) => ({
          item,
          entries: await fs.readdir(item.dir, { withFileTypes: true }).catch(() => []),
        }))
      );

      for (const { item, entries } of dirEntriesList) {
        for (const entry of entries) {
          if (entry.name.startsWith('.')) {
            skippedFiles += 1;
            continue;
          }
          const fullPath = path.join(item.dir, entry.name);
          if (entry.isSymbolicLink()) {
            skippedFiles += 1;
            continue;
          }
          if (entry.isDirectory()) {
            if (
              recursive &&
              item.depth < MAX_RECURSIVE_DEPTH &&
              !SKIPPED_RECURSIVE_DIRS.has(entry.name.toLowerCase())
            ) {
              queue.push({ dir: fullPath, depth: item.depth + 1 });
            }
            continue;
          }
          if (!entry.isFile()) continue;
          if (isSensitiveSecretFile(fullPath).blocked) {
            skippedFiles += 1;
            continue;
          }
          rawCandidates.push({ fullPath, name: entry.name, depth: item.depth });
          if (rawCandidates.length >= MAX_ORGANIZE_FILES) break;
        }
        if (rawCandidates.length >= MAX_ORGANIZE_FILES) break;
      }
    }

    if (rawCandidates.length === 0) {
      return { files: [], skippedFiles };
    }

    const validations = await this.deps.validator.validateCanonicalBatch(
      rawCandidates.map((c) => c.fullPath),
      ORGANIZER_IO_CONCURRENCY
    );

    const validated: Array<{ canonicalPath: string; name: string; depth: number }> = [];
    for (let i = 0; i < rawCandidates.length; i += 1) {
      const check = validations[i];
      if (!check.valid || !check.canonicalPath) {
        skippedFiles += 1;
        continue;
      }
      validated.push({
        canonicalPath: check.canonicalPath,
        name: rawCandidates[i].name,
        depth: rawCandidates[i].depth,
      });
    }

    const entries = await mapWithConcurrency(
      validated,
      ORGANIZER_IO_CONCURRENCY,
      async (item): Promise<CandidateFileEntry | null> => {
        try {
          const stat = await fs.stat(item.canonicalPath);
          const sha256 = await computeFileSha256(item.canonicalPath, stat.size);
          return {
            path: item.canonicalPath,
            name: item.name,
            ext: path.extname(item.name).toLowerCase(),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sha256,
            depth: item.depth,
          };
        } catch {
          return null;
        }
      }
    );

    const files: CandidateFileEntry[] = [];
    for (const entry of entries) {
      if (entry) files.push(entry);
      else skippedFiles += 1;
    }

    return { files, skippedFiles };
  }

  private async buildVectorSemanticAssignments(
    canonicalRoot: string,
    fileCandidates: CandidateFileEntry[]
  ): Promise<Map<string, { category: string; reason: string; confidence: number }>> {
    const assignments = new Map<string, { category: string; reason: string; confidence: number }>();
    if (
      fileCandidates.length < 2 ||
      !this.deps.clusterVectors ||
      (!this.deps.getDocumentVectors && !this.deps.embedTexts)
    ) {
      return assignments;
    }

    const sampleByPath = new Map<string, string>();
    for (const file of fileCandidates) {
      const sample = await readOrganizerSnippetSample(file.path, file.ext, file.size);
      if (sample.trim().length > 0) {
        sampleByPath.set(file.path, sample);
      }
    }

    let vectorByPath = new Map<string, number[]>();
    if (this.deps.getDocumentVectors) {
      try {
        vectorByPath = await this.deps.getDocumentVectors(
          fileCandidates.map((f) => f.path),
          canonicalRoot
        );
      } catch {
        vectorByPath = new Map();
      }
    }

    const normalizedVecMap = new Map<string, number[]>();
    for (const [k, vec] of vectorByPath.entries()) {
      if (Array.isArray(vec) && vec.length > 0) {
        normalizedVecMap.set(normalizeOrganizerKey(k), vec);
      }
    }

    if (this.deps.embedTexts) {
      const uncachedCandidates = fileCandidates
        .filter((f) => !normalizedVecMap.has(normalizeOrganizerKey(f.path)) && sampleByPath.has(f.path))
        .slice(0, 60);
      if (uncachedCandidates.length > 0) {
        try {
          const texts = uncachedCandidates.map(
            (f) => `${f.name}\n${sampleByPath.get(f.path) ?? ''}`
          );
          const embedded = await this.deps.embedTexts(texts);
          uncachedCandidates.forEach((file, idx) => {
            const vec = embedded[idx];
            if (Array.isArray(vec) && vec.length > 0) {
              normalizedVecMap.set(normalizeOrganizerKey(file.path), vec);
            }
          });
        } catch {
          // Graceful fallback if embedding worker unavailable
        }
      }
    }

    const clusterInputs: OrganizerVectorClusterInput[] = fileCandidates
      .map((f): OrganizerVectorClusterInput | null => {
        const vec = normalizedVecMap.get(normalizeOrganizerKey(f.path));
        if (!vec || vec.length === 0) return null;
        return {
          filePath: f.path,
          name: f.name,
          fileType: f.ext.replace(/^\./, '') || 'file',
          chunkCount: 1,
          vector: vec,
          topSymbols: [],
          textSample: sampleByPath.get(f.path) ?? '',
        };
      })
      .filter((item): item is OrganizerVectorClusterInput => item !== null);

    if (clusterInputs.length < 2) {
      return assignments;
    }

    const groups = this.deps.clusterVectors(clusterInputs);
    for (const group of groups) {
      for (const file of group.files) {
        const sim = group.memberCosineByPath.get(file.path) ?? group.cohesionScore;
        const confidence = Number(Math.max(0.55, Math.min(0.96, sim)).toFixed(2));
        assignments.set(normalizeOrganizerKey(file.path), {
          category: group.label,
          reason: `Vector embedding cluster "${group.label}" (cosine ${sim.toFixed(2)}, cohesion ${group.cohesionScore.toFixed(2)})`,
          confidence,
        });
      }
    }

    return assignments;
  }

  private buildImpactSummary(paths: string[]): GraphImpactCheckResult | undefined {
    if (!this.deps.findImpactForPaths || paths.length === 0) {
      return undefined;
    }
    try {
      const references = this.deps.findImpactForPaths(paths);
      if (references.length === 0) return undefined;
      const uniqueSources = new Set(references.map((r) => r.sourcePath));
      const markdownRepairableCount = references.filter((r) => r.isMarkdownLink).length;
      return {
        totalAffectedFiles: uniqueSources.size,
        markdownRepairableCount,
        references,
      };
    } catch {
      return undefined;
    }
  }

  private async allocateUniqueDestination(
    canonicalRoot: string,
    category: string,
    fileName: string,
    reserved: Set<string>,
    selfSourcePath?: string,
    folderListingCache?: Map<string, Set<string>>
  ): Promise<string> {
    const folder = path.join(canonicalRoot, category);
    const folderKey = normalizeOrganizerKey(folder);
    let existingNames: Set<string> | undefined;
    if (folderListingCache) {
      existingNames = folderListingCache.get(folderKey);
      if (!existingNames) {
        try {
          const names = await fs.readdir(folder);
          existingNames = new Set(
            names.map((n) => (process.platform === 'win32' ? n.toLowerCase() : n))
          );
        } catch {
          existingNames = new Set<string>();
        }
        folderListingCache.set(folderKey, existingNames);
      }
    }

    const ext = path.extname(fileName);
    const stem = ext ? fileName.slice(0, -ext.length) : fileName;
    const selfKey = selfSourcePath ? normalizeOrganizerKey(selfSourcePath) : null;

    for (let attempt = 0; attempt < 1000; attempt++) {
      const candidateName = attempt === 0 ? fileName : `${stem}_${attempt}${ext}`;
      const candidatePath = path.join(folder, candidateName);
      const key = normalizeOrganizerKey(candidatePath);
      const isSelf = selfKey !== null && key === selfKey;
      const diskExists = existingNames
        ? existingNames.has(process.platform === 'win32' ? candidateName.toLowerCase() : candidateName)
        : await pathExistsOnDisk(candidatePath);
      if (!reserved.has(key) && (isSelf || !diskExists)) {
        reserved.add(key);
        return candidatePath;
      }
    }

    const unique = path.join(folder, `${stem}_${crypto.randomUUID().slice(0, 6)}${ext}`);
    reserved.add(normalizeOrganizerKey(unique));
    return unique;
  }
}
