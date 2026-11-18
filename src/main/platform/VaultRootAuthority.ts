/**
 * VaultRootAuthority.ts - Sole owner of workspace allowedRoots and canonical PathValidator instances.
 *
 * Unifies root resolution across IPC middleware, ReactiveWorkspaceKernel, AssetProtocol,
 * SearchService, OperationJournal, ConfigManager reloads, and standalone WorkspaceMcpServer.
 */

import os from 'os';
import path from 'path';
import { PathValidator } from '@main/services/PathValidator';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { ConfigManager } from '@shared/config';
import { ValidationResult } from '@shared/contracts';
import { SecurityLogger } from '@shared/logging';
import { normalizePathKey } from './pathNormalize';

export type RootsChangedListener = (roots: string[]) => void;

function isLegacyUncustomizedSubfolderDefault(roots: readonly string[], homeDir: string): boolean {
  if (roots.length !== 3) {
    return false;
  }
  const legacyDefaults = new Set([
    normalizePathKey(path.join(homeDir, 'Documents')),
    normalizePathKey(path.join(homeDir, 'Downloads')),
    normalizePathKey(path.join(homeDir, 'Desktop')),
  ]);
  return roots.every((entry) => legacyDefaults.has(normalizePathKey(entry)));
}

/**
 * Resolves effective allowed roots from explicit configuration or ConfigManager,
 * normalizing legacy default `[Documents, Downloads, Desktop]` profiles to `[os.homedir()]`.
 */
export function resolveEffectiveAllowedRoots(configuredRoots?: readonly string[] | null): string[] {
  const homeDir = os.homedir();
  let roots: string[] = [homeDir];

  if (Array.isArray(configuredRoots) && configuredRoots.length > 0) {
    roots = isLegacyUncustomizedSubfolderDefault(configuredRoots, homeDir)
      ? [homeDir]
      : Array.from(new Set(configuredRoots.map((entry) => path.resolve(entry))));
  } else {
    try {
      const config = ConfigManager.getInstance();
      const configured = config.get('fileSystem')?.allowedRoots;
      if (Array.isArray(configured) && configured.length > 0) {
        roots = isLegacyUncustomizedSubfolderDefault(configured, homeDir)
          ? [homeDir]
          : Array.from(new Set(configured.map((entry) => path.resolve(entry))));
      }
    } catch (error) {
      SecurityLogger.debug('ConfigManager unavailable during root resolution, using homedir', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return roots;
}

export class VaultRootAuthority {
  private static instance: VaultRootAuthority | null = null;
  private cachedValidator: PathValidator | null = null;
  private activeRoots: string[] | null = null;
  private lastConfigSignature: string = '';
  private hasExplicitOverride = false;
  private listeners = new Set<RootsChangedListener>();

  static getInstance(): VaultRootAuthority {
    if (!VaultRootAuthority.instance) {
      VaultRootAuthority.instance = new VaultRootAuthority();
    }
    return VaultRootAuthority.instance;
  }

  /**
   * Resolves effective allowed roots, keeps diagnostics synced, and propagates updates
   * if underlying ConfigManager state drifted since last resolution.
   */
  resolveAllowedRoots(): string[] {
    const configRoots = resolveEffectiveAllowedRoots();
    const configSignature = this.computeSignature(configRoots);

    if (this.hasExplicitOverride && this.activeRoots && configSignature === this.lastConfigSignature) {
      RuntimeDiagnostics.getInstance().setAllowedRoots(this.activeRoots);
      return [...this.activeRoots];
    }

    const hadPriorRoots = this.activeRoots !== null;
    const prevActiveSignature = this.activeRoots ? this.computeSignature(this.activeRoots) : '';
    this.hasExplicitOverride = false;
    this.activeRoots = configRoots;
    this.lastConfigSignature = configSignature;
    RuntimeDiagnostics.getInstance().setAllowedRoots(configRoots);

    if (!this.cachedValidator || (hadPriorRoots && configSignature !== prevActiveSignature)) {
      this.cachedValidator = this.createScopedValidator(configRoots);
      if (hadPriorRoots && configSignature !== prevActiveSignature) {
        this.notifyListeners(configRoots);
      }
    }

    return [...configRoots];
  }

  getValidator(): PathValidator {
    const roots = this.resolveAllowedRoots();
    if (!this.cachedValidator) {
      this.cachedValidator = this.createScopedValidator(roots);
      SecurityLogger.info('Path validator initialized', { roots });
    }
    return this.cachedValidator;
  }

  /** Apply an explicit updated list of roots atomically across validator + all subscribers. */
  applyAllowedRoots(nextRoots: readonly string[]): string[] {
    const configRoots = resolveEffectiveAllowedRoots();
    this.lastConfigSignature = this.computeSignature(configRoots);
    const effective = resolveEffectiveAllowedRoots(nextRoots);
    this.hasExplicitOverride = true;
    this.activeRoots = effective;
    this.cachedValidator = this.createScopedValidator(effective);
    RuntimeDiagnostics.getInstance().setAllowedRoots(effective);
    this.notifyListeners(effective);
    return [...effective];
  }

  /** Force validator rebuild from ConfigManager on next access. */
  invalidate(): void {
    this.hasExplicitOverride = false;
    this.activeRoots = null;
    this.lastConfigSignature = '';
    this.cachedValidator = null;
  }

  /** Validate adding a candidate workspace root against existing root rules. */
  async validateNewRoot(candidatePath: string, currentRoots?: readonly string[]): Promise<ValidationResult> {
    const validator = currentRoots ? this.createScopedValidator(currentRoots) : this.getValidator();
    return validator.validateNewRoot(candidatePath);
  }

  /** Create a scoped validator sharing the canonical PathValidator constructor contract. */
  createScopedValidator(roots: string | readonly string[]): PathValidator {
    return new PathValidator(Array.isArray(roots) ? [...roots] : (roots as string));
  }

  onRootsChanged(listener: RootsChangedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(roots: string[]): void {
    for (const listener of this.listeners) {
      try {
        listener([...roots]);
      } catch (error) {
        SecurityLogger.warn('Root subscriber notification failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private computeSignature(roots: readonly string[]): string {
    return roots.map(normalizePathKey).sort().join('\0');
  }
}
