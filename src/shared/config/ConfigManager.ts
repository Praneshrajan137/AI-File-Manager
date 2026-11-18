/**
 * ConfigManager.ts - Centralized configuration management
 * 
 * Singleton class that loads, merges, validates, and provides access to configuration.
 * 
 * Configuration sources (priority order):
 * 1. Command-line arguments (highest priority)
 * 2. Environment variables
 * 3. User config file (~/.project2-file-manager/config.json)
 * 4. Default values (lowest priority)
 * 
 * Features:
 * - Type-safe configuration access
 * - Hot-reload support (watch config file)
 * - Validation on load
 * - Automatic creation of missing config file
 * 
 * @example
 * import { ConfigManager } from '@shared/config';
 * 
 * ConfigManager.initialize();
 * const config = ConfigManager.getInstance();
 * 
 * const port = config.get('llm.ollamaUrl');
 * const maxSize = config.get('fileSystem.maxFileSize');
 */

import fs from 'fs';
import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { type AppConfig, type PartialAppConfig } from './schema';
import { defaultConfig, getDefaultForbiddenPaths } from './defaults';
import { validateConfigOrThrow } from './validator';
import { migrateLegacyConfigIfNeeded, resolveCanonicalConfigPath } from './appPaths';
import { atomicWriteFileSync } from '../utils/atomicFs';

type DeepPartialAppConfig = {
  [K in keyof AppConfig]?: Partial<AppConfig[K]>;
};

/**
 * Config manager options.
 */
export interface ConfigManagerOptions {
  /** Path to config file (default: ~/.project2-file-manager/config.json) */
  configPath?: string;
  
  /** Whether to watch config file for changes (default: false) */
  watchConfig?: boolean;
  
  /** Callback when config changes */
  onConfigChange?: (newConfig: AppConfig) => void;
}

/**
 * Configuration manager singleton.
 * 
 * Manages application configuration with validation and hot-reload support.
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null;
  private config: AppConfig;
  private configPath: string;
  private watchConfig: boolean;
  private fileWatcher: fs.FSWatcher | null = null;
  private onConfigChange?: (newConfig: AppConfig) => void;

  /**
   * Private constructor (singleton pattern).
   */
  private constructor(options: ConfigManagerOptions = {}) {
    this.configPath = options.configPath ?? this.getDefaultConfigPath();
    this.watchConfig = options.watchConfig ?? false;
    this.onConfigChange = options.onConfigChange;

    // Load environment variables from .env file (if exists)
    this.loadEnvFile();

    // Load and merge configuration
    this.config = this.loadConfig();

    // Watch config file if enabled
    if (this.watchConfig) {
      this.startWatching();
    }
  }

  /**
   * Initialize configuration manager.
   * 
   * Must be called once at app startup.
   * 
   * @param options - Configuration options
   * 
   * @example
   * ConfigManager.initialize({
   *   watchConfig: true,
   *   onConfigChange: (newConfig) => {
   *     console.log('Config changed:', newConfig);
   *   },
   * });
   */
  static initialize(options?: ConfigManagerOptions): void {
    if (ConfigManager.instance) {
      return;
    }

    ConfigManager.instance = new ConfigManager(options);
  }

  /**
   * Get configuration manager instance.
   * 
   * @returns ConfigManager instance
   * @throws Error if not initialized
   * 
   * @example
   * const config = ConfigManager.getInstance();
   * const port = config.get('llm.ollamaUrl');
   */
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      // Auto-initialize with defaults
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Reset singleton instance (test helper only).
   */
  static resetForTesting(): void {
    if (ConfigManager.instance) {
      ConfigManager.instance.stopWatching();
      ConfigManager.instance = null;
    }
  }

  /**
   * Get configuration value by path.
   * 
   * Uses dot notation to access nested values.
   * 
   * @param path - Configuration path (e.g., 'llm.model')
   * @returns Configuration value
   * 
   * @example
   * const model = config.get('llm.model'); // 'llama3.2'
   * const width = config.get('window.width'); // 1200
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K];
  get(path: string): unknown;
  get(path: string): unknown {
    const keys = path.split('.');
    let value: unknown = this.config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Set configuration value by path.
   * 
   * Updates configuration in memory and optionally saves to file.
   * 
   * @param path - Configuration path
   * @param value - New value
   * @param save - Whether to save to file (default: false)
   * 
   * @example
   * config.set('llm.model', 'llama3.3');
   * config.set('window.width', 1600, true); // Save to file
   */
  set(path: string, value: unknown, save: boolean = false): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let target: Record<string, unknown> = this.config as unknown as Record<string, unknown>;

    for (const key of keys) {
      const current = target[key];
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        target[key] = {};
      }
      target = target[key] as Record<string, unknown>;
    }

    target[lastKey] = value;

    // Validate configuration after update and keep built-in forbiddenPaths enforced
    this.config = this.enforceSecurityDefaults(validateConfigOrThrow(this.config));

    if (save) {
      this.saveConfig();
    }
  }

  /**
   * Get entire configuration object.
   * 
   * @returns Full configuration
   * 
   * @example
   * const fullConfig = config.getAll();
   * console.log(fullConfig.app.name);
   */
  getAll(): Readonly<AppConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Reload configuration from file.
   * 
   * Useful for forcing a config reload.
   * 
   * @example
   * config.reload();
   */
  reload(): void {
    this.config = this.loadConfig();
    
    if (this.onConfigChange) {
      this.onConfigChange(this.config);
    }
  }

  /**
   * Load configuration from multiple sources.
   * 
   * @returns Merged configuration
   */
  private loadConfig(): AppConfig {
    // Start with defaults
    let merged: PartialAppConfig = { ...defaultConfig };

    // Merge user config file (if exists)
    const userConfig = this.loadConfigFile();
    if (userConfig) {
      merged = this.deepMerge(
        merged as unknown as Record<string, unknown>,
        userConfig as unknown as Record<string, unknown>
      ) as PartialAppConfig;
    }

    // Merge environment variables
    const envConfig = this.loadEnvConfig();
    merged = this.deepMerge(
      merged as unknown as Record<string, unknown>,
      envConfig as unknown as Record<string, unknown>
    ) as PartialAppConfig;

    // Validate and return with non-strippable default forbiddenPaths protection
    return this.enforceSecurityDefaults(validateConfigOrThrow(merged));
  }

  private enforceSecurityDefaults(config: AppConfig): AppConfig {
    const configured = Array.isArray(config.security?.forbiddenPaths)
      ? config.security.forbiddenPaths
      : [];
    return {
      ...config,
      security: {
        ...config.security,
        forbiddenPaths: Array.from(new Set([...getDefaultForbiddenPaths(), ...configured])),
      },
    };
  }

  /**
   * Load configuration from file.
   * 
   * @returns User configuration or null if file doesn't exist
   */
  private loadConfigFile(): DeepPartialAppConfig | null {
    try {
      migrateLegacyConfigIfNeeded(this.configPath);
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      }
      
      // Create default config file if it doesn't exist
      this.createDefaultConfigFile();
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to load config file ${this.configPath}: ${detail}\n`);
      return null;
    }
  }

  /**
   * Load configuration from environment variables.
   * 
   * @returns Configuration from environment
   */
  private loadEnvConfig(): DeepPartialAppConfig {
    const env: DeepPartialAppConfig = {};

    // Map environment variables to config
    if (process.env.NODE_ENV) {
      env.app = {
        environment: process.env.NODE_ENV as AppConfig['app']['environment'],
      };
    }

    if (process.env.OLLAMA_URL) {
      env.llm = { ollamaUrl: process.env.OLLAMA_URL };
    }

    if (process.env.OLLAMA_MODEL) {
      env.llm = { ...env.llm, model: process.env.OLLAMA_MODEL };
    }

    if (process.env.APP_LOG_LEVEL) {
      env.logging = {
        level: process.env.APP_LOG_LEVEL as AppConfig['logging']['level'],
      };
    }

    if (process.env.MAX_CACHE_SIZE) {
      const size = parseInt(process.env.MAX_CACHE_SIZE, 10);
      if (!isNaN(size)) {
        env.fileSystem = { ...env.fileSystem, cacheSize: size };
      }
    }

    if (process.env.INDEXING_WORKERS) {
      const workers = parseInt(process.env.INDEXING_WORKERS, 10);
      if (!isNaN(workers)) {
        env.performance = { indexingConcurrency: workers };
      }
    }

    // Strict test/E2E override only: allows temp directories alongside default homedir root
    if (
      process.env.FILE_MANAGER_ALLOWED_ROOTS &&
      (process.env.NODE_ENV === 'test' || process.env.E2E_TEST === 'true')
    ) {
      const extraRoots = process.env.FILE_MANAGER_ALLOWED_ROOTS
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (extraRoots.length > 0) {
        env.fileSystem = {
          ...env.fileSystem,
          allowedRoots: Array.from(new Set([...defaultConfig.fileSystem.allowedRoots, ...extraRoots])),
        };
      }
    }

    return env;
  }

  /**
   * Load .env file if it exists.
   */
  private loadEnvFile(): void {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      loadDotenv({ path: envPath });
    }
  }

  /**
   * Create default config file.
   */
  private createDefaultConfigFile(): void {
    try {
      atomicWriteFileSync(
        this.configPath,
        JSON.stringify(defaultConfig, null, 2),
        'utf-8'
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to create default config file ${this.configPath}: ${detail}\n`);
    }
  }

  /**
   * Save current configuration to file.
   */
  private saveConfig(): void {
    try {
      atomicWriteFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to save config file ${this.configPath}: ${detail}\n`);
    }
  }

  /**
   * Start watching config file for changes.
   */
  private startWatching(): void {
    if (this.fileWatcher) {
      return;
    }

    try {
      this.fileWatcher = fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          this.reload();
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to watch config file: ${detail}\n`);
    }
  }

  /**
   * Stop watching config file.
   */
  stopWatching(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  /**
   * Get default config file path.
   * 
   * @returns Config file path
   */
  private getDefaultConfigPath(): string {
    return resolveCanonicalConfigPath();
  }

  /**
   * Deep merge two objects.
   * 
   * @param target - Target object
   * @param source - Source object
   * @returns Merged object
   */
  private deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
    const result: Record<string, unknown> = { ...target };

    for (const key of Object.keys(source)) {
      const sourceVal = source[key];
      const targetVal = result[key];
      if (
        sourceVal &&
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        targetVal &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        result[key] = this.deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>
        );
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal;
      }
    }

    return result as T;
  }
}
