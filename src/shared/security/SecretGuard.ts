/**
 * SecretGuard.ts - Zero-Honeypot Credential Protection & Token Redactor
 *
 * Defends SQLite, LanceDB, LLM prompts, and external MCP clients from silently
 * harvesting developer credentials, private keys, or inline API secrets.
 */

import path from 'path';

export interface SecretGuardFileCheck {
  blocked: boolean;
  reason?: string;
}

export interface SecretRedactionResult {
  sanitizedText: string;
  redactionsCount: number;
}

const SAFE_TEMPLATE_SUFFIXES = ['.example', '.sample', '.template', '.dist'] as const;

const SENSITIVE_BASENAMES = new Set([
  '.env',
  '.envrc',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.dockercfg',
  'credentials',
  'credentials.json',
  'secret.json',
  'secrets.json',
  'secret.yaml',
  'secrets.yaml',
  'secret.yml',
  'secrets.yml',
  'secrets.toml',
  'application_default_credentials.json',
  'msal_token_cache.json',
  'azureprofile.json',
  'accesstokens.json',
  '.htpasswd',
  '.git-credentials',
  '.pgpass',
  '.my.cnf',
  '.vault-token',
  '.s3cfg',
  '.rclone.conf',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'master.key',
  'kubeconfig',
]);

const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p8',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.kdbx',
  '.ppk',
  '.ovpn',
  '.tfvars',
  '.tfstate',
  '.kubeconfig',
]);

const SENSITIVE_PREFIXES = [
  '.env.',
  'id_rsa.',
  'id_ed25519.',
  'id_dsa.',
  'id_ecdsa.',
  'service-account',
  'service_account',
  'serviceaccount',
];

const SENSITIVE_PATH_SUFFIX_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /(?:^|\/)\.docker\/config\.json$/i, reason: 'Docker credential config blocked by SecretGuard' },
  { pattern: /(?:^|\/)\.kube\/config$/i, reason: 'Kubernetes kubeconfig blocked by SecretGuard' },
  { pattern: /(?:^|\/)\.git\/credentials$/i, reason: 'Git credentials store blocked by SecretGuard' },
  { pattern: /(?:^|\/)\.aws\/(?:credentials|config)$/i, reason: 'AWS credential file blocked by SecretGuard' },
  { pattern: /(?:^|\/)terraform\.tfstate(?:\.backup)?$/i, reason: 'Terraform state file blocked by SecretGuard' },
  { pattern: /(?:^|\/)\.cargo\/credentials(?:\.toml)?$/i, reason: 'Cargo registry credentials blocked by SecretGuard' },
  { pattern: /(?:^|\/)\.gem\/credentials$/i, reason: 'RubyGems credentials blocked by SecretGuard' },
  { pattern: /(?:^|\/)\.m2\/settings\.xml$/i, reason: 'Maven credentials config blocked by SecretGuard' },
  { pattern: /(?:^|\/)\.nuget\/nuget\.config$/i, reason: 'NuGet config blocked by SecretGuard' },
];

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

const PRIVATE_KEY_BEGIN_LINE_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;
const PRIVATE_KEY_END_LINE_RE = /-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;

const INLINE_SECRET_RULES: readonly RedactionRule[] = [
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_GITLAB_TOKEN]',
  },
  {
    pattern: /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\bhf_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED_HF_TOKEN]',
  },
  {
    pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED_NPM_TOKEN]',
  },
  {
    pattern: /\bpypi-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_PYPI_TOKEN]',
  },
  {
    pattern: /\b(?:xox[baprs]|xapp)-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  {
    pattern: /\bwhsec_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED_WEBHOOK_SECRET]',
  },
  {
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
    replacement: '[REDACTED_SENDGRID_KEY]',
  },
  {
    pattern: /\b(?:dop_v1_[a-f0-9]{32,}|dapi[a-f0-9]{24,})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: '[REDACTED_GOOGLE_API_KEY]',
  },
  {
    pattern: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
    replacement: '$1[REDACTED_BEARER_TOKEN]',
  },
  {
    pattern: /(\bBasic\s+)[A-Za-z0-9+/=]{12,}/gi,
    replacement: '$1[REDACTED_BASIC_AUTH]',
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    pattern: /([a-z][a-z0-9+.-]{1,20}:\/\/[^/\s:@"'`]*:)([^@\s"'`]+)(@[^\s"'`]+)/gi,
    replacement: '$1[REDACTED_PASSWORD]$3',
  },
  {
    pattern:
      /(['"]?[A-Za-z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_KEY|ACCESS_TOKEN|AUTH_TOKEN|REFRESH_TOKEN|PRIVATE_KEY|CLIENT_SECRET|WEBHOOK_SECRET|JWT_SECRET|DB_PASSWORD|DATABASE_PASSWORD|ENCRYPTION_KEY|apiKey|secretKey|accessKey|accessToken|authToken|refreshToken|privateKey|clientSecret|webhookSecret|jwtSecret|dbPassword|databasePassword|encryptionKey|api_key|secret_key|access_key|access_token|auth_token|refresh_token|private_key|client_secret|webhook_secret|jwt_secret|db_password|database_password|encryption_key)['"]?)(\s*[:=]\s*['"]?)([A-Za-z0-9+/=._-]{8,})(['"]?)/g,
    replacement: '$1$2[REDACTED_SECRET]$4',
  },
];

function isSafeTemplateFile(baseLower: string): boolean {
  return SAFE_TEMPLATE_SUFFIXES.some((suffix) => baseLower.endsWith(suffix));
}

/**
 * Determine whether a file path targets a credential or private key artifact
 * whose contents must never be extracted into vector/graph indexes or prompts.
 */
export function isSensitiveSecretFile(filePath: string): SecretGuardFileCheck {
  if (!filePath || typeof filePath !== 'string') {
    return { blocked: false };
  }

  const normalized = filePath.replace(/\\/g, '/');
  const baseLower = path.posix.basename(normalized).toLowerCase();

  if (!baseLower || baseLower.endsWith('.pub')) {
    return { blocked: false };
  }

  if (isSafeTemplateFile(baseLower)) {
    return { blocked: false };
  }

  if (SENSITIVE_BASENAMES.has(baseLower)) {
    return {
      blocked: true,
      reason: `Sensitive credential file blocked by SecretGuard (${baseLower})`,
    };
  }

  const extLower = path.posix.extname(baseLower);
  if (extLower && SENSITIVE_EXTENSIONS.has(extLower)) {
    return {
      blocked: true,
      reason: `Private key/certificate extension blocked by SecretGuard (${extLower})`,
    };
  }

  if (SENSITIVE_PREFIXES.some((prefix) => baseLower.startsWith(prefix))) {
    if (baseLower === '.env.example' || baseLower === '.env.sample' || baseLower === '.env.template') {
      return { blocked: false };
    }
    return {
      blocked: true,
      reason: `Sensitive environment or key file blocked by SecretGuard (${baseLower})`,
    };
  }

  const normalizedLower = normalized.toLowerCase();
  for (const suffixRule of SENSITIVE_PATH_SUFFIX_PATTERNS) {
    if (suffixRule.pattern.test(normalizedLower)) {
      return {
        blocked: true,
        reason: suffixRule.reason,
      };
    }
  }

  return { blocked: false };
}

function applyInlineRules(text: string, preserveLineCount: boolean): SecretRedactionResult {
  if (!text) {
    return { sanitizedText: text, redactionsCount: 0 };
  }

  let sanitizedText = text;
  let redactionsCount = 0;

  for (const rule of INLINE_SECRET_RULES) {
    const freshRegex = new RegExp(rule.pattern.source, rule.pattern.flags);
    sanitizedText = sanitizedText.replace(freshRegex, (...args) => {
      redactionsCount += 1;
      const fullMatch = String(args[0] ?? '');
      let replacement = rule.replacement;
      if (replacement.includes('$')) {
        replacement = replacement.replace(/\$(\d)/g, (_, idxText: string) => {
          const idx = Number(idxText);
          const cap = args[idx];
          return typeof cap === 'string' ? cap : '';
        });
      }
      if (preserveLineCount && fullMatch.includes('\n')) {
        const newlineCount = (fullMatch.match(/\n/g) ?? []).length;
        return replacement + '\n[REDACTED_PRIVATE_KEY_LINE]'.repeat(newlineCount);
      }
      return replacement;
    });
  }

  return { sanitizedText, redactionsCount };
}

/**
 * Redact high-confidence inline credentials (API keys, private keys, bearer
 * tokens, URL passwords) prior to indexing, RAG retrieval, or LLM prompting.
 */
export function redactSensitiveText(text: string): SecretRedactionResult {
  return applyInlineRules(text, false);
}

/**
 * Redact credentials across contiguous numbered file lines, preserving 1-to-1
 * line numbering while neutralizing multi-line PEM/PKCS8/PGP blocks—including
 * partial slices that start after BEGIN or end before END.
 */
export function redactFileRangeLines<T extends { lineNumber: number; text: string }>(
  lines: readonly T[]
): { lines: T[]; redactionsCount: number } {
  if (lines.length === 0) {
    return { lines: [], redactionsCount: 0 };
  }

  const joined = lines.map((line) => line.text).join('\n');
  const fullPass = applyInlineRules(joined, true);
  let redactionsCount = fullPass.redactionsCount;
  const splitTexts = fullPass.sanitizedText.split('\n');

  const firstBeginIdx = splitTexts.findIndex((line) => PRIVATE_KEY_BEGIN_LINE_RE.test(line));
  let lastEndIdx = -1;
  for (let i = splitTexts.length - 1; i >= 0; i -= 1) {
    if (PRIVATE_KEY_END_LINE_RE.test(splitTexts[i])) {
      lastEndIdx = i;
      break;
    }
  }

  if (lastEndIdx !== -1 && (firstBeginIdx === -1 || lastEndIdx < firstBeginIdx)) {
    for (let i = 0; i <= lastEndIdx; i += 1) {
      splitTexts[i] = i === lastEndIdx ? '[REDACTED_PRIVATE_KEY]' : '[REDACTED_PRIVATE_KEY_LINE]';
    }
    redactionsCount += 1;
  }

  const unclosedBeginIdx = splitTexts.findIndex((line) => PRIVATE_KEY_BEGIN_LINE_RE.test(line));
  if (unclosedBeginIdx !== -1) {
    for (let i = unclosedBeginIdx; i < splitTexts.length; i += 1) {
      splitTexts[i] =
        i === unclosedBeginIdx ? '[REDACTED_PRIVATE_KEY]' : '[REDACTED_PRIVATE_KEY_LINE]';
    }
    redactionsCount += 1;
  }

  const sanitizedLines = lines.map((line, idx) => {
    const nextText = splitTexts[idx] ?? line.text;
    return nextText !== line.text ? { ...line, text: nextText } : line;
  });

  return { lines: sanitizedLines, redactionsCount };
}

/**
 * Stateful streaming redactor for incremental LLM token emission.
 * Buffers incomplete boundary tokens and multi-line PEM private key blocks so
 * secrets split across chunk boundaries are masked before reaching the renderer.
 */
export function createStreamingSecretRedactor(): {
  push: (chunk: string) => string;
  flush: () => string;
} {
  let buffer = '';
  const TAIL_HOLD_CHARS = 140;
  const MAX_PEM_HOLD_CHARS = 8192;

  return {
    push(chunk: string): string {
      if (!chunk) return '';
      buffer += chunk;

      if (buffer.length <= TAIL_HOLD_CHARS) {
        return '';
      }

      const beginIdx = buffer.search(PRIVATE_KEY_BEGIN_LINE_RE);
      if (beginIdx !== -1) {
        const afterBegin = buffer.slice(beginIdx);
        if (!PRIVATE_KEY_END_LINE_RE.test(afterBegin) && buffer.length < MAX_PEM_HOLD_CHARS) {
          if (beginIdx > TAIL_HOLD_CHARS) {
            const safePrefix = buffer.slice(0, beginIdx);
            buffer = afterBegin;
            return redactSensitiveText(safePrefix).sanitizedText;
          }
          return '';
        }
      }

      let cut = buffer.length - TAIL_HOLD_CHARS;
      // Pull cut backward past any mid-token run or leading auth scheme prefix
      while (cut > 0 && !/\s/.test(buffer[cut - 1])) {
        cut -= 1;
      }
      if (cut > 0) {
        const beforeCut = buffer.slice(Math.max(0, cut - 16), cut);
        const prefixMatch = beforeCut.match(/(?:Bearer|Basic)\s+$/i);
        if (prefixMatch) {
          cut = Math.max(0, cut - prefixMatch[0].length);
        }
      }
      if (cut <= 0) {
        return '';
      }

      const emitRaw = buffer.slice(0, cut);
      buffer = buffer.slice(cut);
      return redactSensitiveText(emitRaw).sanitizedText;
    },
    flush(): string {
      if (!buffer) return '';
      const out = redactSensitiveText(buffer).sanitizedText;
      buffer = '';
      return out;
    },
  };
}
