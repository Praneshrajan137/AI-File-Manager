/**
 * validator.ts - Configuration validation utilities
 * 
 * Validates configuration using Zod schema.
 * Provides helpful error messages for invalid configurations.
 */

import { ZodError } from 'zod';
import { appConfigSchema, type AppConfig, type PartialAppConfig } from './schema';
import { ValidationError } from '@shared/errors';

/**
 * Validation result.
 */
export interface ConfigValidationResult {
  valid: boolean;
  config?: AppConfig;
  errors?: string[];
}

/**
 * Validate configuration.
 * 
 * @param config - Configuration to validate
 * @returns Validation result
 * 
 * @example
 * const result = validateConfig(userConfig);
 * if (!result.valid) {
 *   console.error('Invalid config:', result.errors);
 * }
 */
export function validateConfig(config: PartialAppConfig): ConfigValidationResult {
  try {
    const validatedConfig = appConfigSchema.parse(config);
    return {
      valid: true,
      config: validatedConfig,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = error.errors.map(err => {
        const path = err.path.join('.');
        return `${path}: ${err.message}`;
      });
      
      return {
        valid: false,
        errors,
      };
    }

    return {
      valid: false,
      errors: ['Unknown validation error'],
    };
  }
}

/**
 * Validate configuration and throw on error.
 * 
 * @param config - Configuration to validate
 * @returns Validated configuration
 * @throws ValidationError if configuration is invalid
 * 
 * @example
 * try {
 *   const config = validateConfigOrThrow(userConfig);
 *   // Use config...
 * } catch (err) {
 *   console.error('Invalid configuration:', err.message);
 * }
 */
export function validateConfigOrThrow(config: PartialAppConfig): AppConfig {
  const result = validateConfig(config);
  
  if (!result.valid) {
    throw new ValidationError(
      'INVALID_INPUT',
      'Configuration validation failed',
      {
        field: 'config',
        errors: result.errors?.map(err => ({ field: 'config', message: err })),
      }
    );
  }

  return result.config!;
}
