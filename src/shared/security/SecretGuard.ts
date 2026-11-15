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
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.dockercfg',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  '.htpasswd',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'master.key',
]);

const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.kdbx',
  '.ppk',
  '.ovpn',
]);

const SENSITIVE_PREFIXES = ['.env.', 'id_rsa.', 'id_ed25519.', 'id_dsa.', 'id_ecdsa.', 'service-account', 'service_account'];

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

const INLINE_SECRET_RULES: readonly RedactionRule[] = [
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
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
    pattern: /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\bhf_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED_HF_TOKEN]',
  },
  {
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
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
    pattern: /(https?:\/\/[^/\s:@]+:)([^@\s]+)(@[^\s]+)/gi,
    replacement: '$1[REDACTED_PASSWORD]$3',
  },
  {
    pattern:
      /\b([A-Z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_KEY|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|CLIENT_SECRET|DB_PASSWORD|DATABASE_PASSWORD))\b(\s*[:=]\s*['"]?)([A-Za-z0-9+/=._-]{8,})(['"]?)/g,
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

  if (normalized.toLowerCase().endsWith('/.docker/config.json')) {
    return {
      blocked: true,
      reason: 'Docker credential config blocked by SecretGuard',
    };
  }

  return { blocked: false };
}

/**
 * Redact high-confidence inline credentials (API keys, private keys, bearer
 * tokens, URL passwords) prior to indexing, RAG retrieval, or LLM prompting.
 */
export function redactSensitiveText(text: string): SecretRedactionResult {
  if (!text) {
    return { sanitizedText: text, redactionsCount: 0 };
  }

  let sanitizedText = text;
  let redactionsCount = 0;

  for (const rule of INLINE_SECRET_RULES) {
    const freshRegex = new RegExp(rule.pattern.source, rule.pattern.flags);
    sanitizedText = sanitizedText.replace(freshRegex, (...args) => {
      redactionsCount += 1;
      // Preserve capture groups when replacement references $1/$2/$3/$4
      if (!rule.replacement.includes('$')) {
        return rule.replacement;
      }
      return rule.replacement.replace(/\$(\d)/g, (_, idxText: string) => {
        const idx = Number(idxText);
        const cap = args[idx];
        return typeof cap === 'string' ? cap : '';
      });
    });
  }

  return { sanitizedText, redactionsCount };
}
