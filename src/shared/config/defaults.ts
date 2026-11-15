/**
 * defaults.ts - Default configuration values
 * 
 * Provides sensible defaults for all configuration options.
 * Used as fallback when user doesn't provide specific values.
 */

import os from 'os';
import path from 'path';
import { type AppConfig } from './schema';

/**
 * Get OS-specific forbidden paths.
 */
export function getDefaultForbiddenPaths(): string[] {
  const homeDir = os.homedir();
  const common = [
    path.join(homeDir, '.ssh'),
    path.join(homeDir, '.aws'),
    path.join(homeDir, '.gnupg'),
  ];

  if (process.platform === 'win32') {
    return [
      ...common,
      'C:\\Windows\\System32',
      'C:\\Windows\\SysWOW64',
      'C:\\Program Files\\WindowsApps',
    ];
  } else {
    return [
      ...common,
      '/etc/passwd',
      '/etc/shadow',
      '/etc/sudoers',
      '/root',
      '/var/log',
      '/sys',
      '/proc',
    ];
  }
}

export const DEFAULT_EXCLUDED_DIRS: string[] = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '__pycache__',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'dist-packages',
  'coverage',
  '$RECYCLE.BIN',
  'System Volume Information',
  'AppData',
  '.Trash',
  '.file-manager',
  'trash-vault',
];

/**
 * Get default allowed roots.
 */
function getDefaultAllowedRoots(): string[] {
  const homeDir = os.homedir();

  // Include home directory itself to allow navigation to all user folders
  // (Home, Documents, Downloads, Pictures, Desktop, etc.)
  return [homeDir];
}

/**
 * Default configuration.
 * 
 * All values are sensible defaults that work across platforms.
 */
export const defaultConfig: AppConfig = {
  app: {
    name: 'File Manager',
    version: '0.1.0',
    environment: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
  },

  window: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
  },

  fileSystem: {
    allowedRoots: getDefaultAllowedRoots(),
    indexedRoots: [],
    excludedDirs: [...DEFAULT_EXCLUDED_DIRS],
    favorites: [],
    defaultDeleteMode: 'vault',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    cacheSize: 100 * 1024 * 1024, // 100MB
    chunkSize: 500,
  },

  llm: {
    provider: 'ollama',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    openAiBaseUrl: process.env.OPENAI_BASE_URL || 'http://localhost:1234',
    model: process.env.OLLAMA_MODEL || 'llama3.2',
    maxTokens: 2048,
    temperature: 0.7,
    embeddingDimensions: 384,
    embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/bge-small-en-v1.5',
    embeddingDtype: 'q8',
    embeddingDevice: 'auto',
    rerankerModel: 'Xenova/ms-marco-MiniLM-L-6-v2',
    enableWebGPU: false,
    enableVisionCaptioning: false,
    allowRemoteModels: true,
  },

  ui: {
    theme: 'dark',
    explorerLens: 'files',
    viewMode: 'list',
    splitPaneOpen: false,
  },

  logging: {
    level: (process.env.APP_LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug' | 'trace') || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
    console: process.env.NODE_ENV === 'development',
    file: process.env.NODE_ENV === 'production',
    maxFiles: 30,
    maxSize: '10m',
  },

  performance: {
    renderBatchSize: 50,
    indexingConcurrency: Number(process.env.INDEXING_WORKERS) || 4,
    cacheEvictionStrategy: 'LRU',
  },

  security: {
    forbiddenPaths: getDefaultForbiddenPaths(),
    maxPathLength: 4096,
    enableSandbox: true,
  },
};
