import * as path from 'path';
import { TextChunk } from '../../shared/contracts';

export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'heading';
  lineNumber: number;
}

export interface ExtractedLink {
  targetRef: string;
  kind: 'wikilink' | 'mdlink' | 'import';
  lineNumber: number;
}

export interface StructuralChunk extends TextChunk {
  startLine: number;
  endLine: number;
  heading: string;
  contextHeader?: string;
}

export interface ChunkingOptions {
  maxTokens?: number;
  overlapTokens?: number;
  charsPerToken?: number;
  prependContextHeader?: boolean;
}

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'cpp', 'c', 'h', 'hpp',
  'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala',
]);

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'rst']);

const STRUCTURAL_CODE_BOUNDARY_RE =
  /^\s*(?:export\s+(?:async\s+)?)?(?:function|class|interface|type|enum|def|async\s+def|pub\s+(?:fn|struct|enum)|fn|struct|impl|const\s+[A-Za-z0-9_]+\s*=\s*(?:async\s*)?\()/;

const SYMBOL_PATTERNS: Array<{
  kind: ExtractedSymbol['kind'];
  regex: RegExp;
}> = [
  { kind: 'class', regex: /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/ },
  { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/ },
  { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/ },
  { kind: 'function', regex: /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/ },
  { kind: 'function', regex: /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: 'const', regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/ },
];

/**
 * Extracts symbols (headings, classes, interfaces, functions, constants) and
 * cross-file references (`[[wikilink]]`, `[text](link)`, `import`/`require`) in one pass.
 */
export function extractSymbolsAndLinks(
  content: string,
  filePath: string
): { symbols: ExtractedSymbol[]; links: ExtractedLink[] } {
  const symbols: ExtractedSymbol[] = [];
  const links: ExtractedLink[] = [];
  if (!content) {
    return { symbols, links };
  }

  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  const isCode = CODE_EXTENSIONS.has(ext);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext) || ext === 'txt';
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let inBlockComment = false;
  let multiImportBuf = '';
  let multiImportStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (isMarkdown && /^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (isMarkdown && !inFence) {
      const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
      if (headingMatch) {
        symbols.push({
          name: headingMatch[2].trim(),
          kind: 'heading',
          lineNumber: lineNum,
        });
      }

      const wikiRegex = /\[\[([^[\]|]+)(?:\|[^[\]]+)?\]\]/g;
      let wikiMatch: RegExpExecArray | null;
      while ((wikiMatch = wikiRegex.exec(line)) !== null) {
        const target = wikiMatch[1].trim();
        if (target) {
          links.push({ targetRef: target, kind: 'wikilink', lineNumber: lineNum });
        }
      }

      const mdLinkRegex = /\[[^\]]+\]\(([^)#\s]+(?:#[^)\s]*)?)\)/g;
      let mdMatch: RegExpExecArray | null;
      while ((mdMatch = mdLinkRegex.exec(line)) !== null) {
        const target = mdMatch[1].trim();
        if (target && !/^https?:\/\//i.test(target) && !target.startsWith('mailto:')) {
          links.push({ targetRef: target, kind: 'mdlink', lineNumber: lineNum });
        }
      }
    }

    if (isCode) {
      let codeLine = line;
      if (inBlockComment) {
        const closeIdx = codeLine.indexOf('*/');
        if (closeIdx === -1) {
          continue;
        }
        codeLine = codeLine.slice(closeIdx + 2);
        inBlockComment = false;
      }
      codeLine = codeLine.replace(/\/\*[\s\S]*?\*\//g, '');
      const openBlockIdx = codeLine.indexOf('/*');
      if (openBlockIdx !== -1) {
        codeLine = codeLine.slice(0, openBlockIdx);
        inBlockComment = true;
      }
      const lineCommentIdx = codeLine.indexOf('//');
      if (lineCommentIdx !== -1) {
        codeLine = codeLine.slice(0, lineCommentIdx);
      }

      if (!codeLine.trim()) {
        continue;
      }

      for (const { kind, regex } of SYMBOL_PATTERNS) {
        const match = codeLine.match(regex);
        if (match && match[1]) {
          symbols.push({ name: match[1], kind, lineNumber: lineNum });
          break;
        }
      }

      if (multiImportBuf) {
        multiImportBuf += ` ${codeLine.trim()}`;
        const multiMatch = multiImportBuf.match(/(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/);
        if (multiMatch?.[1]) {
          links.push({ targetRef: multiMatch[1], kind: 'import', lineNumber: multiImportStartLine });
          multiImportBuf = '';
        } else if (multiImportBuf.length > 600 || /;\s*$/.test(codeLine)) {
          multiImportBuf = '';
        }
      } else {
        const esImport = codeLine.match(/(?:import|export)\s+[^'"]*?from\s+['"]([^'"]+)['"]/);
        if (esImport?.[1]) {
          links.push({ targetRef: esImport[1], kind: 'import', lineNumber: lineNum });
        } else if (/^\s*(?:import|export)\s+type\b|^\s*(?:import|export)\s*\{/.test(codeLine) && !/\bfrom\s+['"]/.test(codeLine)) {
          multiImportBuf = codeLine.trim();
          multiImportStartLine = lineNum;
        }
      }

      const cjsRequire = codeLine.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
      if (cjsRequire?.[1]) {
        links.push({ targetRef: cjsRequire[1], kind: 'import', lineNumber: lineNum });
      }
      const pyImport = codeLine.match(/^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/);
      const pyTarget = pyImport?.[1] ?? pyImport?.[2];
      if (pyTarget) {
        links.push({ targetRef: pyTarget, kind: 'import', lineNumber: lineNum });
      }
    }
  }

  return { symbols, links };
}

/**
 * Structure-aware, contextual chunker targeting <= 420 tokens per chunk so embeddings
 * never truncate past BGE-small-en-v1.5's 512-token context window while preserving
 * exact line ranges (`startLine`, `endLine`) and active section/symbol headers.
 */
export class StructuralChunker {
  private readonly maxTokens: number;
  private readonly overlapTokens: number;
  private readonly charsPerToken: number;
  private readonly prependContextHeader: boolean;

  constructor(options: ChunkingOptions = {}) {
    this.maxTokens = options.maxTokens ?? 420;
    this.overlapTokens = options.overlapTokens ?? 48;
    this.charsPerToken = options.charsPerToken ?? 4;
    this.prependContextHeader = options.prependContextHeader ?? true;
  }

  chunk(text: string, filePath: string): StructuralChunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const fileName = path.basename(filePath) || filePath;
    const parentDir = path.basename(path.dirname(filePath));
    const displayFile =
      parentDir && parentDir !== '.' && parentDir !== '/' && !parentDir.endsWith(':')
        ? `${parentDir}/${fileName}`
        : fileName;
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
    const isCode = CODE_EXTENSIONS.has(ext);
    const isPython = ext === 'py';
    const isCsv = ext === 'csv' || ext === 'tsv';
    const csvHeader = isCsv && lines.length > 1 ? lines[0].trim() : '';

    const extractedMeta = extractSymbolsAndLinks(normalized, filePath);
    const topRefs = Array.from(
      new Set(
        extractedMeta.links
          .slice(0, 4)
          .map((l) => path.basename(l.targetRef.split('#')[0].split('|')[0].trim()))
          .filter(Boolean)
      )
    ).slice(0, 2);
    const refsSuffix = topRefs.length > 0 ? ` | Refs: ${topRefs.join(', ')}` : '';

    // Precompute start char offsets per line for accurate startChar/endChar
    const lineOffsets: number[] = new Array(lines.length);
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      lineOffsets[i] = offset;
      offset += lines[i].length + 1;
    }

    const estimatedHeaderOverhead = 36 + (refsSuffix ? 10 : 0);
    const maxBodyChars = Math.max(240, (this.maxTokens - estimatedHeaderOverhead) * this.charsPerToken);
    const overlapChars = Math.max(0, this.overlapTokens * this.charsPerToken);

    const chunks: StructuralChunk[] = [];
    const headingStack: Array<{ level: number; title: string }> = [];
    const codeScopeStack: Array<{ name: string; depth: number; indent: number }> = [];
    let braceDepth = 0;
    let currentLabel = csvHeader ? `Columns: ${csvHeader.slice(0, 120)}` : 'Document Root';
    let inCodeFence = false;

    let bufStartIdx = 0;
    let bufChars = 0;

    const currentContextLabel = (): string => {
      if (headingStack.length > 0) {
        return headingStack.map((h) => h.title).join(' > ');
      }
      if (codeScopeStack.length > 0) {
        return codeScopeStack.map((s) => s.name).join('.');
      }
      return currentLabel;
    };

    const countBraceDelta = (line: string): number => {
      let delta = 0;
      let quote: string | null = null;
      for (let idx = 0; idx < line.length; idx++) {
        const ch = line[idx];
        const prev = idx > 0 ? line[idx - 1] : '';
        if (quote) {
          if (ch === quote && prev !== '\\') quote = null;
          continue;
        }
        if (ch === '/' && line[idx + 1] === '/') break;
        if (ch === "'" || ch === '"' || ch === '`') {
          quote = ch;
          continue;
        }
        if (ch === '{') delta += 1;
        else if (ch === '}') delta -= 1;
      }
      return delta;
    };

    const flushSegment = (endIdxInclusive: number): void => {
      if (endIdxInclusive < bufStartIdx) return;
      const sliceLines = lines.slice(bufStartIdx, endIdxInclusive + 1);
      const rawBody = sliceLines.join('\n').trim();
      if (!rawBody) {
        bufStartIdx = endIdxInclusive + 1;
        bufChars = 0;
        return;
      }

      const startLine = bufStartIdx + 1;
      const endLine = endIdxInclusive + 1;
      const heading = currentContextLabel();

      const flushPiece = (pieceBody: string, pStartLine: number, pEndLine: number, sChar: number, eChar: number): void => {
        const prefix = this.prependContextHeader
          ? `[File: ${fileName} | ${heading} | Dir: ${displayFile} | L${pStartLine}-L${pEndLine}${refsSuffix}]\n`
          : '';
        const maxAllowedTotalChars = this.maxTokens * this.charsPerToken + 80;
        const maxPieceChars = Math.max(80, maxAllowedTotalChars - prefix.length);
        const boundedBody = pieceBody.length > maxPieceChars ? pieceBody.slice(0, maxPieceChars).trimEnd() : pieceBody;
        chunks.push({
          text: `${prefix}${boundedBody}`,
          startChar: sChar,
          endChar: eChar,
          startLine: pStartLine,
          endLine: pEndLine,
          heading,
          contextHeader: prefix ? prefix.trimEnd() : undefined,
          chunkIndex: chunks.length,
        });
      };

      const startChar = lineOffsets[bufStartIdx];
      const endChar = Math.min(normalized.length, lineOffsets[endIdxInclusive] + lines[endIdxInclusive].length);

      if (rawBody.length <= maxBodyChars) {
        flushPiece(rawBody, startLine, endLine, startChar, endChar);
      } else {
        // Split oversized single line/paragraph gracefully with overlap while mapping back to lines
        const stride = Math.max(120, maxBodyChars - overlapChars);
        let pos = 0;
        while (pos < rawBody.length) {
          let cut = Math.min(rawBody.length, pos + maxBodyChars);
          if (cut < rawBody.length) {
            const newlineIdx = rawBody.lastIndexOf('\n', cut);
            const sentenceIdx = Math.max(
              rawBody.lastIndexOf('. ', cut),
              rawBody.lastIndexOf('? ', cut),
              rawBody.lastIndexOf('! ', cut)
            );
            const boundary = newlineIdx > pos + maxBodyChars * 0.4
              ? newlineIdx + 1
              : sentenceIdx > pos + maxBodyChars * 0.5
                ? sentenceIdx + 2
                : cut;
            cut = boundary;
          }
          const subText = rawBody.slice(pos, cut).trim();
          if (subText) {
            const linesBeforeStart = rawBody.slice(0, pos).split('\n').length - 1;
            const linesInSub = subText.split('\n').length - 1;
            const subStartLine = Math.min(endLine, startLine + linesBeforeStart);
            const subEndLine = Math.min(endLine, subStartLine + linesInSub);
            flushPiece(subText, subStartLine, subEndLine, startChar + pos, startChar + cut);
          }
          if (cut >= rawBody.length) break;
          pos = Math.max(pos + stride, cut - overlapChars);
        }
      }

      bufStartIdx = endIdxInclusive + 1;
      bufChars = 0;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^\s*```/.test(line)) {
        inCodeFence = !inCodeFence;
      }

      // Detect structural split markers (Markdown headings, PDF [Page N], [Cell N], Code symbols & methods)
      const mdHeading = !isCode && !inCodeFence ? line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/) : null;
      const pageMarker = !inCodeFence ? line.match(/^\[Page\s+(\d+)\]/i) : null;
      const cellMarker = !inCodeFence ? line.match(/^\[Cell\s+(\d+\s*\([^)]+\))\]/i) : null;
      const topCodeBoundary = isCode && !inCodeFence ? STRUCTURAL_CODE_BOUNDARY_RE.test(line) : false;
      const methodBoundary =
        isCode && !inCodeFence && codeScopeStack.length > 0 && !topCodeBoundary
          ? line.match(/^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?::[^{=]+)?\s*\{/)
          : null;
      const validMethodName =
        methodBoundary?.[1] &&
        !new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor']).has(methodBoundary[1])
          ? methodBoundary[1]
          : null;
      const codeBoundary = topCodeBoundary || Boolean(validMethodName);

      if (isPython && line.trim().length > 0 && !line.trim().startsWith('#')) {
        const lineIndent = line.search(/\S|$/);
        while (codeScopeStack.length > 0 && codeScopeStack[codeScopeStack.length - 1].indent >= lineIndent) {
          codeScopeStack.pop();
        }
      }

      const isStructuralStart = Boolean(mdHeading || pageMarker || cellMarker || (codeBoundary && bufChars > maxBodyChars * 0.35));

      if (isStructuralStart && bufChars > 0) {
        flushSegment(i - 1);
        bufStartIdx = i;
      }

      if (mdHeading) {
        const level = mdHeading[1].length;
        const title = mdHeading[2].trim();
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        headingStack.push({ level, title });
      } else if (pageMarker) {
        headingStack.length = 0;
        codeScopeStack.length = 0;
        currentLabel = `Page ${pageMarker[1]}`;
      } else if (cellMarker) {
        headingStack.length = 0;
        codeScopeStack.length = 0;
        currentLabel = `Cell ${cellMarker[1]}`;
      } else if (codeBoundary) {
        const symMatch = line.match(/(?:function|class|interface|type|enum|def|const|fn|struct|impl)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
        const symName = symMatch?.[1] ?? validMethodName;
        if (symName) {
          headingStack.length = 0;
          const lineIndent = Math.max(0, line.search(/\S|$/));
          if (topCodeBoundary && codeScopeStack.length === 0) {
            codeScopeStack.push({ name: symName, depth: braceDepth, indent: lineIndent });
          } else if (validMethodName) {
            if (codeScopeStack.length > 1) {
              codeScopeStack.pop();
            }
            codeScopeStack.push({ name: symName, depth: braceDepth, indent: lineIndent });
          } else if (isPython) {
            codeScopeStack.push({ name: symName, depth: braceDepth, indent: lineIndent });
          } else {
            codeScopeStack.length = 0;
            codeScopeStack.push({ name: symName, depth: braceDepth, indent: lineIndent });
          }
          currentLabel = `Symbol: ${codeScopeStack.map((s) => s.name).join('.')}`;
        }
      }

      if (isCode && !isPython && !inCodeFence) {
        braceDepth = Math.max(0, braceDepth + countBraceDelta(line));
        while (codeScopeStack.length > 0 && braceDepth <= codeScopeStack[codeScopeStack.length - 1].depth && !codeBoundary) {
          codeScopeStack.pop();
        }
      }

      bufChars += line.length + 1;

      if (!inCodeFence && bufChars >= maxBodyChars) {
        flushSegment(i);
        // Backstep a few overlap lines for prose continuity if last flush was mid-section
        if (overlapChars > 0 && i > bufStartIdx - 2 && !mdHeading && !pageMarker && !cellMarker) {
          let carried = 0;
          let back = i;
          while (back > 0 && carried < overlapChars && lines[back].length < overlapChars) {
            carried += lines[back].length + 1;
            back--;
          }
          if (back <= i && i - back <= 4 && carried <= maxBodyChars * 0.35) {
            bufStartIdx = Math.max(0, back + 1);
            bufChars = lines.slice(bufStartIdx, i + 1).reduce((s, l) => s + l.length + 1, 0);
          }
        }
      }
    }

    if (bufStartIdx < lines.length) {
      flushSegment(lines.length - 1);
    }

    return chunks;
  }
}

export const ContextualChunker = StructuralChunker;
