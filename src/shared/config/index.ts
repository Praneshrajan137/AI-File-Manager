/**
 * config/index.ts - Central export for configuration system
 * 
 * @example
 * import { ConfigManager } from '@shared/config';
 * 
 * ConfigManager.initialize();
 * const config = ConfigManager.getInstance();
 * 
 * const model = config.get('llm.model');
 */

export { ConfigManager, type ConfigManagerOptions } from './ConfigManager';
export { type AppConfig, type PartialAppConfig } from './schema';
export { defaultConfig, DEFAULT_EXCLUDED_DIRS, getDefaultForbiddenPaths } from './defaults';
export { validateConfig, validateConfigOrThrow, type ConfigValidationResult } from './validator';
export {
  APP_BRAND_NAME,
  APP_SERVICE_SLUG,
  CANONICAL_DOT_DIR,
  LEGACY_CONFIG_DOT_DIR,
  LEGACY_DATA_DOT_DIR,
  migrateLegacyConfigIfNeeded,
  resolveCanonicalConfigPath,
  resolveCanonicalGraphDbPath,
  resolveCanonicalVectorDbDir,
  resolveDefaultLogDir,
  resolveDefaultModelCacheDir,
  resolveDefaultTrashVaultDir,
  resolveElectronUserDataDir,
  resolvePackagedMcpEntryPath,
} from './appPaths';
