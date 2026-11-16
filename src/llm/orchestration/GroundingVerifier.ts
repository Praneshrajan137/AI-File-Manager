/**
 * GroundingVerifier.ts - Deterministic Post-Run Citation & Secret Safety Verifier
 *
 * Zero-LLM verification pass that checks every file/line citation emitted in an
 * AI answer against observed tool/retrieval provenance and enforces SecretGuard
 * before text reaches persistence or the UI.
 */

import * as path from 'path';
import {
  AgentCitationAudit,
  AgentVerificationReport,
  RetrievalSource,
} from '../../shared/contracts';
import { isSensitiveSecretFile, redactSensitiveText } from '../../shared/security/SecretGuard';

export interface GroundingVerificationInput {
  answer: string;
  sources: RetrievalSource[];
  observedPaths?: string[];
  stripUngroundedBrackets?: boolean;
}

export interface GroundingVerificationOutput {
  sanitizedAnswer: string;
  report: AgentVerificationReport;
}

interface ParsedBracketCitation {
  fullMatch: string;
  target: string;
  startLine?: number;
  endLine?: number;
}

// Linear-bounded matcher for Markdown/workspace bracket citations like [notes.md#L4-L10], [src/auth.ts], or [.env#L1]
const BRACKET_CITATION_REGEX =
  /\[((?:\.[A-Za-z][A-Za-z0-9_.-]{0,40}|[^[\]\r\n]{1,180}?\.[A-Za-z0-9]{1,12}))(?:#L(\d{1,7})(?:-L?(\d{1,7}))?)?\]/g;

function normalizePathForMatch(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function matchCitationAgainstObserved(
  citation: ParsedBracketCitation,
  sources: RetrievalSource[],
  observedPaths: string[]
): { verified: boolean; resolvedPath?: string; reason: string } {
  const normalizedTarget = normalizePathForMatch(citation.target.trim());
  const targetBase = path.posix.basename(normalizedTarget);
  const hasDirSegment = normalizedTarget.includes('/');

  if (isSensitiveSecretFile(normalizedTarget).blocked || isSensitiveSecretFile(targetBase).blocked) {
    return {
      verified: false,
      reason: 'Citation blocked by SecretGuard policy',
    };
  }

  const candidatePaths = new Set<string>();
  for (const s of sources) {
    if (s.filePath) candidatePaths.add(s.filePath);
  }
  for (const p of observedPaths) {
    if (p) candidatePaths.add(p);
  }

  let matchedPath: string | undefined;
  let exactLineMatch = false;

  for (const candidate of candidatePaths) {
    const normalizedCand = normalizePathForMatch(candidate);
    const candBase = path.posix.basename(normalizedCand);
    const isMatch = hasDirSegment
      ? normalizedCand === normalizedTarget || normalizedCand.endsWith(`/${normalizedTarget}`)
      : normalizedCand === normalizedTarget || candBase === targetBase;

    if (!isMatch) {
      continue;
    }

    if (!matchedPath) {
      matchedPath = candidate;
    }
    const matchingSources = sources.filter(
      (s) => normalizePathForMatch(s.filePath) === normalizedCand
    );

    if (citation.startLine === undefined || matchingSources.length === 0) {
      matchedPath = candidate;
      exactLineMatch = true;
      break;
    }

    const citeEnd = citation.endLine ?? citation.startLine;
    const lineMatches = matchingSources.some((src) => {
      if (src.startLine === undefined) return true;
      const effEnd = src.endLine ?? src.startLine;
      return citation.startLine! >= src.startLine - 5 && citeEnd <= effEnd + 5;
    });
    if (lineMatches) {
      matchedPath = candidate;
      exactLineMatch = true;
      break;
    }
  }

  if (!matchedPath) {
    return {
      verified: false,
      reason: 'File was not observed in retrieved chunks or tool results',
    };
  }

  if (!exactLineMatch && citation.startLine !== undefined) {
    return {
      verified: false,
      resolvedPath: matchedPath,
      reason: `Line #L${citation.startLine} falls outside observed read ranges for ${path.basename(matchedPath)}`,
    };
  }

  return {
    verified: true,
    resolvedPath: matchedPath,
    reason: 'Verified against observed workspace provenance',
  };
}

export function verifyGroundedResponse(
  input: GroundingVerificationInput
): GroundingVerificationOutput {
  const redaction = redactSensitiveText(input.answer ?? '');
  let workingAnswer = redaction.sanitizedText;
  const observedPaths = input.observedPaths ?? [];
  const audits: AgentCitationAudit[] = [];
  const ungroundedSet = new Set<string>();

  const matches: ParsedBracketCitation[] = [];
  BRACKET_CITATION_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACKET_CITATION_REGEX.exec(workingAnswer)) !== null) {
    // Do not rewrite Markdown hyperlink labels `[file.ts](./file.ts)`
    if (workingAnswer[m.index + m[0].length] === '(') {
      continue;
    }
    const startLine = m[2] ? Number.parseInt(m[2], 10) : undefined;
    const endLine = m[3] ? Number.parseInt(m[3], 10) : undefined;
    matches.push({
      fullMatch: m[0],
      target: m[1].trim(),
      startLine: Number.isFinite(startLine) ? startLine : undefined,
      endLine: Number.isFinite(endLine) ? endLine : undefined,
    });
  }

  let verifiedCitations = 0;
  for (const citation of matches) {
    const check = matchCitationAgainstObserved(citation, input.sources, observedPaths);
    audits.push({
      citedText: citation.fullMatch,
      resolvedPath: check.resolvedPath,
      verified: check.verified,
      reason: check.reason,
    });

    if (check.verified) {
      verifiedCitations += 1;
    } else {
      ungroundedSet.add(citation.fullMatch);
    }
  }

  const stripUngrounded = input.stripUngroundedBrackets !== false;
  if (stripUngrounded && ungroundedSet.size > 0) {
    for (const badCite of ungroundedSet) {
      const inner = badCite.slice(1, -1);
      // Convert ungrounded bracket syntax into inert parenthetical notation so renderer never creates false clickable citation pills
      workingAnswer = workingAnswer.split(badCite).join(`(unverified: ${inner})`);
    }
  }

  const ungroundedCitations = Array.from(ungroundedSet);
  const report: AgentVerificationReport = {
    grounded: ungroundedCitations.length === 0,
    totalCitations: matches.length,
    verifiedCitations,
    ungroundedCitations,
    redactionsApplied: redaction.redactionsCount,
    audits,
    checkedAt: Date.now(),
  };

  return {
    sanitizedAnswer: workingAnswer,
    report,
  };
}
