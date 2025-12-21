/**
 * schema.ts - Configuration schema and TypeScript types
 * 
 * Defines the complete configuration structure for the application.
 * Used by ConfigManager for validation and type-safe access.
 * 
 * @example
 * import { type AppConfig } from '@shared/config/schema';
 * 
 * const config: AppConfig = {
 *   app: { name: 'My App', version: '1.0.0', environment: 'development' },
 *   ...
 * };
 */

import { z } from 'zod';

/**
 * Application configuration schema (Zod).
 * 
 * Used for runtime validation of configuration.
 */
export const appConfigSchema = z.object({
  app: z.object({
    name: z.string().default('File Manager'),
    version: z.string().default('0.1.0'),
    environment: z.enum(['development', 'production', 'test']).default('development'),
  }),

  window: z.object({
    width: z.number().int().min(800).default(1200),
    height: z.number().int().min(600).default(800),
    minWidth: z.number().int().min(400).default(800),
    minHeight: z.number().int().min(300).default(600),
  }),

  fileSystem: z.object({
    allowedRoots: z.array(z.string()).default([]),
    maxFileSize: z.number().int().positive().default(10 * 1024 * 1024), // 10MB
    cacheSize: z.number().int().positive().default(100 * 1024 * 1024), // 100MB
    chunkSize: z.number().int().positive().default(500),
  }),

  llm: z.object({
    ollamaUrl: z.string().url().default('http://localhost:11434'),
    model: z.string().default('llama3.2'),
    maxTokens: z.number().int().positive().default(2048),
    temperature: z.number().min(0).max(1).default(0.7),
    embeddingDimensions: z.number().int().positive().default(384),
  }),

  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
    console: z.boolean().default(true),
    file: z.boolean().default(false),
    maxFiles: z.number().int().positive().default(30),
    maxSize: z.string().default('10m'),
  }),

  performance: z.object({
    renderBatchSize: z.number().int().positive().default(50),
    indexingConcurrency: z.number().int().positive().default(4),
    cacheEvictionStrategy: z.enum(['LRU', 'LFU']).default('LRU'),
  }),

  security: z.object({
    forbiddenPaths: z.array(z.string()).default([]),
    maxPathLength: z.number().int().positive().default(4096),
    enableSandbox: z.boolean().default(true),
  }),
});

/**
 * Application configuration type (TypeScript).
 * 
 * Use this for type-safe configuration access.
 */
export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Partial configuration type (for user overrides).
 */
export type PartialAppConfig = z.input<typeof appConfigSchema>;
