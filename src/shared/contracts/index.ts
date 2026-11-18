/**
 * contracts/index.ts - Domain-grouped shared interface contracts.
 *
 * Consumers may import directly from narrow domain modules (`@shared/contracts/fs`,
 * `@shared/contracts/vault`, `@shared/contracts/graph`, `@shared/contracts/search`,
 * `@shared/contracts/ai`, `@shared/contracts/diagnostics`, `@shared/contracts/core`)
 * or via `@shared/contracts`.
 */

export * from './core';
export * from './fs';
export * from './vault';
export * from './graph';
export * from './search';
export * from './ai';
export * from './diagnostics';
