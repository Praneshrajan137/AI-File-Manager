const NODE_BUILTIN_MODULES = [
  'fs',
  'fs/promises',
  'path',
  'os',
  'crypto',
  'child_process',
  'worker_threads',
  'net',
  'http',
  'https',
  'stream',
  'zlib',
  'perf_hooks',
  'readline',
];

module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2021: true,
  },
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'warn',
  },
  overrides: [
    {
      files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['electron', ...NODE_BUILTIN_MODULES],
            patterns: [
              'node:*',
              '@main/*',
              '@llm/*',
              '../main/*',
              '../../main/*',
              '../../../main/*',
              '../llm/*',
              '../../llm/*',
              '../../../llm/*',
              '@shared/config*',
              '@shared/logging*',
              '@shared/utils/atomicFs*',
              '@shared/utils/processWarnings*',
            ],
          },
        ],
      },
    },
    {
      files: [
        'src/shared/pure/**/*.ts',
        'src/shared/contracts/**/*.ts',
        'src/shared/ipc/**/*.ts',
        'src/shared/diagnostics.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['electron', ...NODE_BUILTIN_MODULES],
            patterns: [
              'node:*',
              '@main/*',
              '@llm/*',
              '@renderer/*',
              '@shared/config*',
              '@shared/logging*',
              '@shared/utils/*',
              '../config*',
              '../logging*',
              '../utils/*',
            ],
          },
        ],
      },
    },
    {
      files: ['src/llm/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['electron'],
            patterns: [
              '@main/*',
              '@renderer/*',
              '../main/*',
              '../../main/*',
              '../../../main/*',
              '../mcp/*',
              '../../mcp/*',
              '../renderer/*',
              '../../renderer/*',
            ],
          },
        ],
      },
    },
    {
      files: [
        'src/main/services/**/*.ts',
        'src/main/platform/**/*.ts',
        'src/main/kernel/**/*.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              '@main/handlers/*',
              '../handlers/*',
              '../../handlers/*',
              '@llm/*',
              '../llm/*',
              '../../llm/*',
              '../../../llm/*',
              '@renderer/*',
            ],
          },
        ],
      },
    },
    {
      files: ['src/main/platform/**/*.ts', 'src/main/kernel/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['electron'],
            patterns: [
              '@main/handlers/*',
              '../handlers/*',
              '../../handlers/*',
              '@llm/*',
              '../llm/*',
              '../../llm/*',
              '../../../llm/*',
              '@renderer/*',
            ],
          },
        ],
      },
    },
    {
      files: ['src/mcp/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['electron'],
            patterns: [
              '@llm/*',
              '../llm/*',
              '../../llm/*',
              '@main/services/OperationJournal*',
              '@main/services/AIOrganizerService*',
              '../main/services/OperationJournal*',
              '../main/services/AIOrganizerService*',
            ],
          },
        ],
      },
    },
    {
      files: ['src/main/handlers/fileSystemHandlers.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['@lancedb/lancedb', '@huggingface/transformers'],
            patterns: ['./llmHandlers*', '@llm/*', '../llm/*', '../../llm/*'],
          },
        ],
      },
    },
  ],
};
