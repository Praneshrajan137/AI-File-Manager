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
import os from 'os';
import { config as loadDotenv } from 'dotenv';
import { type AppConfig, type PartialAppConfig } from './schema';
import { defaultConfig } from './defaults';
import { validateConfigOrThrow } from './validator';

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
      console.warn('ConfigManager already initialized');
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
  get(path: string): any {
    const keys = path.split('.');
    let value: any = this.config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
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
  set(path: string, value: any, save: boolean = false): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let target: any = this.config;

    for (const key of keys) {
      if (!(key in target)) {
        target[key] = {};
      }
      target = target[key];
    }

    target[lastKey] = value;

    // Validate configuration after update
    this.config = validateConfigOrThrow(this.config);

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
      merged = this.deepMerge(merged, userConfig);
    }

    // Merge environment variables
    const envConfig = this.loadEnvConfig();
    merged = this.deepMerge(merged, envConfig);

    // Validate and return
    return validateConfigOrThrow(merged);
  }

  /**
   * Load configuration from file.
   * 
   * @returns User configuration or null if file doesn't exist
   */
  private loadConfigFile(): PartialAppConfig | null {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      }
      
      // Create default config file if it doesn't exist
      this.createDefaultConfigFile();
      return null;
    } catch (error) {
      console.warn(`Failed to load config file: ${this.configPath}`, error);
      return null;
    }
  }

  /**
   * Load configuration from environment variables.
   * 
   * @returns Configuration from environment
   */
  private loadEnvConfig(): PartialAppConfig {
    const env: any = {};

    // Map environment variables to config
    if (process.env.NODE_ENV) {
      env.app = { environment: process.env.NODE_ENV as any };
    }

    if (process.env.OLLAMA_URL) {
      env.llm = { ollamaUrl: process.env.OLLAMA_URL };
    }

    if (process.env.OLLAMA_MODEL) {
      env.llm = { ...env.llm, model: process.env.OLLAMA_MODEL };
    }

    if (process.env.APP_LOG_LEVEL) {
      env.logging = { level: process.env.APP_LOG_LEVEL as any };
    }

    if (process.env.MAX_CACHE_SIZE) {
      const size = parseInt(process.env.MAX_CACHE_SIZE, 10);
      if (!isNaN(size)) {
        env.fileSystem = { cacheSize: size };
      }
    }

    if (process.env.INDEXING_WORKERS) {
      const workers = parseInt(process.env.INDEXING_WORKERS, 10);
      if (!isNaN(workers)) {
        env.performance = { indexingConcurrency: workers };
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
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(defaultConfig, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.warn(`Failed to create default config file: ${this.configPath}`, error);
    }
  }

  /**
   * Save current configuration to file.
   */
  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error(`Failed to save config file: ${this.configPath}`, error);
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
          console.log('Config file changed, reloading...');
          this.reload();
        }
      });
    } catch (error) {
      console.warn('Failed to watch config file:', error);
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
    const homeDir = os.homedir();
    return path.join(homeDir, '.project2-file-manager', 'config.json');
  }

  /**
   * Deep merge two objects.
   * 
   * @param target - Target object
   * @param source - Source object
   * @returns Merged object
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}
