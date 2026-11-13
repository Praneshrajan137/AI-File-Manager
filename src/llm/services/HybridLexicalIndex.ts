import { VectorRecord } from '../../shared/contracts';

interface IndexedLexicalDoc {
  record: VectorRecord;
  length: number;
  tf: Map<string, number>;
}

export interface LexicalSearchMatch {
  record: VectorRecord;
  bm25Score: number;
}

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

/**
 * Tokenize document text and code identifiers into searchable terms.
 * Emits full identifier forms (e.g. `err_kernel_742`) alongside split sub-tokens
 * (`err`, `kernel`, `742`, camelCase segments) so natural-language queries find identifiers too.
 */
export function tokenizeLexicalText(input: string): string[] {
  if (!input || input.trim().length === 0) {
    return [];
  }

  const tokens: string[] = [];
  const rawParts = input.match(/[A-Za-z0-9_.-]+/g) ?? [];

  for (const part of rawParts) {
    const cleaned = part.replace(/^[.-]+|[.-]+$/g, '');
    if (cleaned.length < 2) {
      continue;
    }

    const wholeLower = cleaned.toLowerCase();
    tokens.push(wholeLower);

    // Split snake/kebab/dot tokens and camelCase boundaries
    const subParts = cleaned
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[_\-.\s]+/);

    if (subParts.length > 1) {
      for (const sub of subParts) {
        const subLower = sub.toLowerCase();
        if (subLower.length >= 2 && subLower !== wholeLower) {
          tokens.push(subLower);
        }
      }
    }
  }

  return tokens;
}

/**
 * Tokenize query text: keeps explicit compound tokens (snake_case, kebab-case, dot.names)
 * intact so exact identifier searches like `LEGACY_TOKEN_ALPHA_111` never false-match
 * unrelated generic words like `token`.
 */
export function tokenizeLexicalQuery(input: string): string[] {
  if (!input || input.trim().length === 0) {
    return [];
  }

  const tokens: string[] = [];
  const rawParts = input.match(/[A-Za-z0-9_.-]+/g) ?? [];

  for (const part of rawParts) {
    const cleaned = part.replace(/^[.-]+|[.-]+$/g, '');
    if (cleaned.length < 2) {
      continue;
    }
    tokens.push(cleaned.toLowerCase());
  }

  return tokens;
}

/**
 * Pure TypeScript Okapi BM25 inverted index mirroring VectorStore rows.
 * Deterministic rebuild from LanceDB rows ensures zero native binary deps on Windows/Electron.
 */
export class HybridLexicalIndex {
  private docs = new Map<string, IndexedLexicalDoc>();
  private postings = new Map<string, Set<string>>();
  private totalDocLength = 0;

  clear(): void {
    this.docs.clear();
    this.postings.clear();
    this.totalDocLength = 0;
  }

  size(): number {
    return this.docs.size;
  }

  fileCount(): number {
    const files = new Set<string>();
    for (const doc of this.docs.values()) {
      files.add(doc.record.file_path);
    }
    return files.size;
  }

  rebuildFromRecords(records: VectorRecord[]): void {
    this.clear();
    this.upsertBatch(records);
  }

  upsertBatch(records: VectorRecord[]): void {
    for (const record of records) {
      this.upsertDocument(record);
    }
  }

  upsertDocument(record: VectorRecord): void {
    if (this.docs.has(record.id)) {
      this.removeDocument(record.id);
    }

    const combinedText = `${record.file_path} ${record.chunk_text}`;
    const tokens = tokenizeLexicalText(combinedText);
    const tf = new Map<string, number>();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    this.docs.set(record.id, {
      record,
      length: Math.max(1, tokens.length),
      tf,
    });
    this.totalDocLength += Math.max(1, tokens.length);

    for (const term of tf.keys()) {
      let bucket = this.postings.get(term);
      if (!bucket) {
        bucket = new Set<string>();
        this.postings.set(term, bucket);
      }
      bucket.add(record.id);
    }
  }

  removeByFilePath(filePath: string): number {
    const idsToRemove: string[] = [];
    for (const [id, doc] of this.docs.entries()) {
      if (doc.record.file_path === filePath) {
        idsToRemove.push(id);
      }
    }

    for (const id of idsToRemove) {
      this.removeDocument(id);
    }

    return idsToRemove.length;
  }

  private removeDocument(docId: string): void {
    const existing = this.docs.get(docId);
    if (!existing) {
      return;
    }

    this.totalDocLength = Math.max(0, this.totalDocLength - existing.length);
    for (const term of existing.tf.keys()) {
      const bucket = this.postings.get(term);
      if (bucket) {
        bucket.delete(docId);
        if (bucket.size === 0) {
          this.postings.delete(term);
        }
      }
    }

    this.docs.delete(docId);
  }

  search(query: string, topK: number = 10): LexicalSearchMatch[] {
    const docCount = this.docs.size;
    if (docCount === 0 || topK <= 0) {
      return [];
    }

    const queryTokens = tokenizeLexicalQuery(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const avgDocLength = Math.max(1, this.totalDocLength / docCount);
    const scores = new Map<string, number>();
    const uniqueQueryTerms = Array.from(new Set(queryTokens));

    for (const term of uniqueQueryTerms) {
      const matchingDocs = this.postings.get(term);
      if (!matchingDocs || matchingDocs.size === 0) {
        continue;
      }

      const df = matchingDocs.size;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));

      for (const docId of matchingDocs) {
        const doc = this.docs.get(docId);
        if (!doc) {
          continue;
        }
        const tf = doc.tf.get(term) ?? 0;
        const numerator = tf * (DEFAULT_K1 + 1);
        const denominator =
          tf + DEFAULT_K1 * (1 - DEFAULT_B + DEFAULT_B * (doc.length / avgDocLength));
        const bm25TermScore = idf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) ?? 0) + bm25TermScore);
      }
    }

    const ranked: LexicalSearchMatch[] = [];
    for (const [docId, bm25Score] of scores.entries()) {
      const doc = this.docs.get(docId);
      if (doc && bm25Score > 0) {
        ranked.push({ record: doc.record, bm25Score });
      }
    }

    ranked.sort((a, b) => b.bm25Score - a.bm25Score);
    return ranked.slice(0, topK);
  }
}
