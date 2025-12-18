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
export { defaultConfig } from './defaults';
export { validateConfig, validateConfigOrThrow, type ConfigValidationResult } from './validator';
