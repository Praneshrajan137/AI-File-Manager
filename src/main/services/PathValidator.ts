import fs from 'fs';
import path from 'path';
import os from 'os';
import { ValidationResult } from '@shared/contracts';
import { SecurityLogger } from '@shared/logging';
import { ConfigManager } from '@shared/config';

/**
 * PathValidator - Security-hardened path validation.
 * 
 * CRITICAL SECURITY COMPONENT - Prevents:
 * 1. Path traversal attacks (../../etc/passwd)
 * 2. URL-encoded traversal (%2e%2e)
 * 3. Directory escape via prefix matching
 * 4. Access to system-critical paths
 * 5. Null byte injection
 * 6. Symlink / junction escapes outside allowed roots
 * 
 * ALL paths MUST be validated before ANY fs operation.
 */
export interface CanonicalValidationContext {
    dedupedForbidden: string[];
    canonicalForbidden: Array<{ raw: string; norm: string }>;
    canonicalRootsNorm: string[];
    canonicalRootsRaw: string[];
}

export class PathValidator {
    private allowedRoot: string;
    private allowedRoots: string[];
    private lexicalAllowedRoots: string[];
    private normalizedLexicalRoots: string[];
    private forbiddenPaths: string[];
    private dedupedForbiddenPaths: string[];
    private normalizedForbiddenPaths: string[];
    private maxPathLength: number;

    constructor(allowedRoots: string | string[]) {
        const candidates = Array.isArray(allowedRoots) ? allowedRoots : [allowedRoots];
        const normalized = candidates
            .map((root) => root.trim())
            .filter((root) => root.length > 0)
            .map((root) => this.stripTrailingSep(path.resolve(path.normalize(root))));

        this.allowedRoots = normalized.length > 0
            ? Array.from(new Set(normalized))
            : [this.stripTrailingSep(path.resolve(os.homedir()))];
        this.allowedRoot = this.allowedRoots[0];
        this.lexicalAllowedRoots = this.expandCanonicalAliases(this.allowedRoots);
        this.normalizedLexicalRoots = Array.from(
            new Set(this.lexicalAllowedRoots.map((root) => this.normalizeForCompare(root)))
        );
        this.maxPathLength = this.resolveMaxPathLength();

        // Initialize OS-specific forbidden paths (including canonical aliases for OS 8.3/symlink equivalence)
        const baseForbidden = this.getForbiddenPaths().map((entry) =>
            this.stripTrailingSep(path.resolve(path.normalize(entry)))
        );
        this.forbiddenPaths = this.expandCanonicalAliases(baseForbidden);
        const dedupMap = new Map<string, string>();
        for (const entry of this.forbiddenPaths) {
            const norm = this.normalizeForCompare(entry);
            if (!dedupMap.has(norm)) {
                dedupMap.set(norm, entry);
            }
        }
        this.dedupedForbiddenPaths = Array.from(dedupMap.values());
        this.normalizedForbiddenPaths = Array.from(dedupMap.keys());
    }

    /**
     * Include canonical realpath aliases alongside configured paths for existing directories
     * so OS short-path aliases (e.g. Windows RUNNER~1 <-> runneradmin) and symlinked roots
     * (/tmp <-> /private/tmp) remain consistent between lexical and canonical checks.
     */
    private expandCanonicalAliases(entries: string[]): string[] {
        const expanded = new Set<string>(entries);
        const realpathFns: Array<(p: string) => string> = [];
        if (typeof fs.realpathSync?.native === 'function') {
            realpathFns.push((p) => fs.realpathSync.native(p));
        }
        if (typeof fs.realpathSync === 'function') {
            realpathFns.push((p) => fs.realpathSync(p));
        }

        for (const entry of entries) {
            for (const resolveFn of realpathFns) {
                try {
                    const real = this.stripTrailingSep(resolveFn(entry));
                    if (real) {
                        expanded.add(real);
                    }
                } catch {
                    // Entry may not exist on disk yet; keep lexical entry only
                }
            }
        }
        return Array.from(expanded);
    }

    private stripTrailingSep(targetPath: string): string {
        const parsed = path.parse(targetPath);
        if (targetPath === parsed.root) {
            return targetPath;
        }
        return targetPath.replace(/[/\\]+$/, '');
    }

    private normalizeForCompare(targetPath: string): string {
        const clean = this.stripTrailingSep(path.resolve(path.normalize(targetPath)));
        return process.platform === 'win32' ? clean.toLowerCase() : clean;
    }

    private isNormalizedWithin(candidateNorm: string, rootNorm: string): boolean {
        if (candidateNorm === rootNorm) {
            return true;
        }
        const rootWithSep = rootNorm.endsWith(path.sep) ? rootNorm : rootNorm + path.sep;
        return candidateNorm.startsWith(rootWithSep);
    }

    private isWithinDirectory(candidatePath: string, rootPath: string): boolean {
        return this.isNormalizedWithin(
            this.normalizeForCompare(candidatePath),
            this.normalizeForCompare(rootPath)
        );
    }

    private decodeSafe(requestedPath: string): string {
        try {
            return decodeURIComponent(requestedPath);
        } catch {
            return requestedPath;
        }
    }

    /**
     * Resolve OS short/8.3 or case aliases along real, non-symlink ancestor components.
     * Stops strictly before any symbolic link/junction so outside symlinks never bypass lexical containment.
     */
    private resolveNonSymlinkCanonicalSync(resolvedPath: string): string | null {
        if (typeof fs.lstatSync !== 'function' || typeof fs.realpathSync !== 'function') {
            return null;
        }
        const parsed = path.parse(resolvedPath);
        const remainder = resolvedPath.slice(parsed.root.length);
        if (!remainder) {
            return null;
        }

        const parts = remainder.split(/[\\/]+/).filter(Boolean);
        let prefix = parsed.root;
        let consumed = 0;

        for (let i = 0; i < parts.length; i += 1) {
            const candidate = path.join(prefix, parts[i]);
            try {
                const stats = fs.lstatSync(candidate);
                if (typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink()) {
                    break;
                }
                prefix = candidate;
                consumed = i + 1;
            } catch {
                break;
            }
        }

        if (consumed === 0) {
            return null;
        }

        const realpathFn: ((p: string) => string) =
            typeof fs.realpathSync.native === 'function'
                ? (p: string): string => fs.realpathSync.native(p)
                : (p: string): string => fs.realpathSync(p);

        try {
            const canonicalPrefix = realpathFn(prefix);
            const tail = parts.slice(consumed);
            const combined = tail.length > 0 ? path.join(canonicalPrefix, ...tail) : canonicalPrefix;
            return this.stripTrailingSep(path.resolve(combined));
        } catch {
            return null;
        }
    }

    private resolveMaxPathLength(): number {
        try {
            const configured = ConfigManager.getInstance().get('security')?.maxPathLength;
            if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 260) {
                return Math.floor(configured);
            }
        } catch {
            // Optional if ConfigManager is uninitialized in isolated unit tests
        }
        return 4096;
    }

    /**
     * Validate path for security (lexical validation).
     */
    validate(requestedPath: string): ValidationResult {
        // Step 1: Check for empty path or oversized path strings
        if (!requestedPath || requestedPath.trim() === '') {
            SecurityLogger.warn('Empty path validation attempt');
            return {
                valid: false,
                error: 'INVALID_PATH',
                details: 'Path cannot be empty',
            };
        }
        if (requestedPath.length > this.maxPathLength) {
            SecurityLogger.warn('Path exceeds maximum configured length', {
                length: requestedPath.length,
                maxPathLength: this.maxPathLength,
            });
            return {
                valid: false,
                error: 'INVALID_PATH',
                details: `Path length exceeds maximum limit of ${this.maxPathLength} characters`,
            };
        }

        // Step 2: Check for null bytes (security vulnerability)
        if (requestedPath.includes('\0')) {
            SecurityLogger.error('Null byte injection attempt', {
                path: requestedPath.replace(/\0/g, '[NULL]'),
            });
            return {
                valid: false,
                error: 'INVALID_PATH',
                details: 'Path contains null byte',
            };
        }

        // Step 3: Decode URL encoding to prevent %2e%2e attacks (BUG FIX #2)
        const decoded = this.decodeSafe(requestedPath);

        // Step 3b: Reject Windows drive-relative paths (C:foo) & NTFS Alternate Data Streams (:)
        const driveRelativeMatch = /^[A-Za-z]:(?![\\/])/.test(decoded);
        const colonRemainder = /^[A-Za-z]:/.test(decoded) ? decoded.slice(2) : decoded;
        if (driveRelativeMatch || colonRemainder.includes(':')) {
            SecurityLogger.error('Invalid drive-relative or alternate data stream path rejected', {
                originalPath: requestedPath,
            });
            return {
                valid: false,
                error: 'INVALID_PATH',
                details: 'Drive-relative paths and alternate data stream colons are not allowed',
            };
        }

        // Step 4: CHECK FOR '..' IN ORIGINAL PATH FIRST (BUG FIX #1)
        if (decoded.includes('..')) {
            SecurityLogger.error('Path traversal attempt detected', {
                originalPath: requestedPath,
                decodedPath: decoded,
            });
            return {
                valid: false,
                error: 'PATH_TRAVERSAL',
                details: 'Path traversal detected: relative paths with ".." are not allowed',
            };
        }

        // Step 5-6: Normalize and resolve to absolute path
        const resolved = this.stripTrailingSep(path.resolve(path.normalize(decoded)));

        // Step 7: Check against forbidden paths FIRST (exact match or nested child, case-safe on Windows)
        let nonSymlinkAlias: string | null | undefined;
        const getNonSymlinkAlias = (): string | null => {
            if (nonSymlinkAlias === undefined) {
                nonSymlinkAlias = this.resolveNonSymlinkCanonicalSync(resolved);
            }
            return nonSymlinkAlias;
        };

        const pathsToCheckForbidden = [resolved];
        if (process.platform === 'win32' && resolved.includes('~')) {
            const alias = getNonSymlinkAlias();
            if (alias && alias !== resolved) {
                pathsToCheckForbidden.push(alias);
            }
        }

        for (const candidate of pathsToCheckForbidden) {
            const candidateNorm = this.normalizeForCompare(candidate);
            for (let i = 0; i < this.normalizedForbiddenPaths.length; i += 1) {
                if (this.isNormalizedWithin(candidateNorm, this.normalizedForbiddenPaths[i])) {
                    const forbidden = this.dedupedForbiddenPaths[i];
                    SecurityLogger.error('Forbidden path access attempt', {
                        requestedPath,
                        resolvedPath: resolved,
                        forbiddenPath: forbidden,
                    });
                    return {
                        valid: false,
                        error: 'UNAUTHORIZED_ACCESS',
                        details: `Access to system path "${forbidden}" is forbidden`,
                    };
                }
            }
        }

        // Step 8: Ensure within at least one allowed root (supporting non-symlink OS short-path aliases)
        const resolvedNorm = this.normalizeForCompare(resolved);
        let insideAllowedRoot = this.normalizedLexicalRoots.some((rootNorm) =>
            this.isNormalizedWithin(resolvedNorm, rootNorm)
        );
        if (!insideAllowedRoot) {
            const alias = getNonSymlinkAlias();
            if (alias) {
                const aliasNorm = this.normalizeForCompare(alias);
                const hitsForbidden = this.normalizedForbiddenPaths.some((forbiddenNorm) =>
                    this.isNormalizedWithin(aliasNorm, forbiddenNorm)
                );
                if (!hitsForbidden) {
                    insideAllowedRoot = this.normalizedLexicalRoots.some((rootNorm) =>
                        this.isNormalizedWithin(aliasNorm, rootNorm)
                    );
                }
            }
        }
        if (!insideAllowedRoot) {
            SecurityLogger.error('Unauthorized directory access attempt', {
                requestedPath,
                resolvedPath: resolved,
                allowedRoot: this.allowedRoot,
                allowedRoots: this.allowedRoots,
            });
            return {
                valid: false,
                error: 'UNAUTHORIZED_ACCESS',
                details: `Path "${resolved}" is outside allowed directory "${this.allowedRoot}"`,
            };
        }

        // Step 9: All checks passed
        SecurityLogger.debug('Path validation successful', {
            requestedPath,
            resolvedPath: resolved,
        });
        return { valid: true };
    }

    /**
     * Validate the canonical parent directory for a path whose leaf may be a symbolic link.
     * Ensures ancestor traversal/symlinks cannot escape allowed roots while allowing
     * unlink/rename operations on an in-vault symlink without dereferencing its target.
     */
    async validateParentCanonicalForLink(requestedPath: string): Promise<ValidationResult & { canonicalLinkPath?: string }> {
        const lexical = this.validate(requestedPath);
        if (!lexical.valid) {
            return lexical;
        }

        const decoded = this.decodeSafe(requestedPath);
        const resolved = this.stripTrailingSep(path.resolve(path.normalize(decoded)));
        const parentDir = path.dirname(resolved);
        const leafName = path.basename(resolved);

        const parentCanonical = await this.validateCanonical(parentDir);
        if (!parentCanonical.valid) {
            return parentCanonical;
        }

        try {
            const realParent = await fs.promises.realpath(parentDir);
            const canonicalLinkPath = path.join(realParent, leafName);
            const linkCheck = this.validate(canonicalLinkPath);
            if (!linkCheck.valid) {
                return linkCheck;
            }
            return { valid: true, canonicalLinkPath };
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'ENOENT') {
                return { valid: true, canonicalLinkPath: resolved };
            }
            return {
                valid: false,
                error: 'INVALID_PATH',
                details: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * Resolve canonical path via fs.realpath while also catching dangling symlinks
     * and non-existent creation targets under existing symlinked ancestors.
     */
    private async resolveCanonicalTarget(
        resolvedTarget: string,
        visitedSymlinks: Set<string> = new Set()
    ): Promise<string> {
        try {
            return await fs.promises.realpath(resolvedTarget);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code !== 'ENOENT' && code !== 'ENOTDIR') {
                throw err instanceof Error
                    ? err
                    : new Error(`Failed to resolve canonical path: ${String(err)}`);
            }
        }

        // Walk up to inspect existing ancestors (catching both dangling symlinks and missing leaf creations)
        const pendingSegments: string[] = [];
        let cursor = resolvedTarget;
        let walkedUp = 0;

        while (walkedUp < 256) {
            walkedUp += 1;
            try {
                const lstat = await fs.promises.lstat(cursor);
                if (lstat.isSymbolicLink()) {
                    const normalizedCursor = this.normalizeForCompare(cursor);
                    if (visitedSymlinks.has(normalizedCursor)) {
                        throw new Error(`Circular symbolic link detected at "${cursor}"`);
                    }
                    visitedSymlinks.add(normalizedCursor);
                    const rawLinkTarget = await fs.promises.readlink(cursor);
                    const linkDestination = path.resolve(path.dirname(cursor), rawLinkTarget);
                    const resolvedDestination = await this.resolveCanonicalTarget(
                        linkDestination,
                        visitedSymlinks
                    );
                    return pendingSegments.length > 0
                        ? path.join(resolvedDestination, ...pendingSegments.reverse())
                        : resolvedDestination;
                }

                const realExisting = await fs.promises.realpath(cursor);
                return pendingSegments.length > 0
                    ? path.join(realExisting, ...pendingSegments.reverse())
                    : realExisting;
            } catch (err: unknown) {
                if (err instanceof Error && err.message.startsWith('Circular symbolic link')) {
                    throw err;
                }
                const errCode = (err as { code?: string })?.code;
                if (errCode !== 'ENOENT' && errCode !== 'ENOTDIR') {
                    throw err instanceof Error
                        ? err
                        : new Error(`Canonical path inspection failed: ${String(err)}`);
                }
                const parent = path.dirname(cursor);
                if (parent === cursor) {
                    throw err instanceof Error
                        ? err
                        : new Error(`Unable to resolve root canonical path for "${resolvedTarget}"`);
                }
                pendingSegments.push(path.basename(cursor));
                cursor = parent;
            }
        }

        throw new Error(`Maximum path depth exceeded while resolving "${resolvedTarget}"`);
    }

    private async safeRealpathOrResolved(targetPath: string): Promise<string> {
        try {
            return await fs.promises.realpath(targetPath);
        } catch {
            return targetPath;
        }
    }

    /**
     * Resolve static forbidden/allowed root canonical boundaries once for reuse across a single batch.
     */
    async createCanonicalContext(): Promise<CanonicalValidationContext> {
        const [canonicalForbiddenRaw, canonicalRootsRaw] = await Promise.all([
            Promise.all(this.dedupedForbiddenPaths.map((p) => this.safeRealpathOrResolved(p))),
            Promise.all(this.allowedRoots.map((root) => this.safeRealpathOrResolved(root))),
        ]);
        return {
            dedupedForbidden: this.dedupedForbiddenPaths,
            canonicalForbidden: canonicalForbiddenRaw.map((raw) => ({
                raw,
                norm: this.normalizeForCompare(raw),
            })),
            canonicalRootsRaw,
            canonicalRootsNorm: canonicalRootsRaw.map((root) => this.normalizeForCompare(root)),
        };
    }

    /**
     * Validate a single path lexically and canonically against a pre-resolved root/forbidden context.
     * Target path resolution is always performed live via fs.promises.realpath / lstat walk.
     */
    async validateCanonicalWithContext(
        requestedPath: string,
        context: CanonicalValidationContext
    ): Promise<ValidationResult> {
        const lexical = this.validate(requestedPath);
        if (!lexical.valid) {
            return lexical;
        }

        const decoded = this.decodeSafe(requestedPath);
        const resolvedLexical = this.stripTrailingSep(path.resolve(path.normalize(decoded)));

        let canonicalTarget: string;
        try {
            canonicalTarget = this.stripTrailingSep(
                await this.resolveCanonicalTarget(resolvedLexical)
            );
        } catch (err: unknown) {
            return {
                valid: false,
                error: 'SYMLINK_ESCAPE',
                details: err instanceof Error ? err.message : 'Symlink resolution failed',
            };
        }

        const canonicalTargetNorm = this.normalizeForCompare(canonicalTarget);
        for (const forbidden of context.canonicalForbidden) {
            if (this.isNormalizedWithin(canonicalTargetNorm, forbidden.norm)) {
                SecurityLogger.error('Canonical path resolves to forbidden path', {
                    requestedPath,
                    canonicalTarget,
                    forbidden: forbidden.raw,
                });
                return {
                    valid: false,
                    error: 'SYMLINK_ESCAPE',
                    details: `Canonical target "${canonicalTarget}" escapes into forbidden path "${forbidden.raw}"`,
                };
            }
        }

        const insideCanonicalRoot = context.canonicalRootsNorm.some((rootNorm) =>
            this.isNormalizedWithin(canonicalTargetNorm, rootNorm)
        );
        if (!insideCanonicalRoot) {
            SecurityLogger.error('Symlink escape outside allowed roots blocked', {
                requestedPath,
                resolvedLexical,
                canonicalTarget,
                allowedRoots: context.canonicalRootsRaw,
            });
            return {
                valid: false,
                error: 'SYMLINK_ESCAPE',
                details: `Path "${requestedPath}" resolves outside allowed roots ("${canonicalTarget}")`,
            };
        }

        return {
            valid: true,
            canonicalPath: canonicalTarget,
        };
    }

    /**
     * Validate path both lexically AND canonically (resolving symlinks & junctions).
     */
    async validateCanonical(requestedPath: string): Promise<ValidationResult> {
        const context = await this.createCanonicalContext();
        return this.validateCanonicalWithContext(requestedPath, context);
    }

    /**
     * Validate a batch of paths canonically while resolving root/forbidden boundaries only once
     * per call and bounding concurrent target symlink resolution.
     */
    async validateCanonicalBatch(
        requestedPaths: readonly string[],
        concurrency: number = 16
    ): Promise<ValidationResult[]> {
        if (requestedPaths.length === 0) {
            return [];
        }
        const context = await this.createCanonicalContext();
        const results = new Array<ValidationResult>(requestedPaths.length);
        const workerCount = Math.max(1, Math.min(concurrency, requestedPaths.length));
        let nextIndex = 0;

        const runWorker = async (): Promise<void> => {
            while (nextIndex < requestedPaths.length) {
                const idx = nextIndex;
                nextIndex += 1;
                results[idx] = await this.validateCanonicalWithContext(requestedPaths[idx], context);
            }
        };

        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
        return results;
    }

    /**
     * Get OS-specific list of forbidden paths.
     * 
     * @returns Array of absolute paths that should never be accessible
     */
    private getForbiddenPaths(): string[] {
        // Try to load forbidden paths from config
        try {
            const config = ConfigManager.getInstance();
            const securityConfig = config.get('security');
            const configPaths = securityConfig.forbiddenPaths;
            
            if (configPaths && Array.isArray(configPaths) && configPaths.length > 0) {
                SecurityLogger.info('Loaded forbidden paths from config', {
                    count: configPaths.length,
                });
                return configPaths;
            }
        } catch (error) {
            // Config not initialized yet, use defaults
            SecurityLogger.debug('Using default forbidden paths (config not available)');
        }

        // Fallback to default forbidden paths
        const common = [
            path.join(os.homedir(), '.ssh'),
            path.join(os.homedir(), '.aws'),
            path.join(os.homedir(), '.gnupg'),
        ];

        if (process.platform === 'win32') {
            // Windows forbidden paths
            return [
                ...common,
                'C:\\Windows\\System32',
                'C:\\Windows\\SysWOW64',
                'C:\\Program Files\\WindowsApps',
            ];
        } else {
            // Unix/Linux/Mac forbidden paths
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

    /**
     * Get the allowed root directory.
     * 
     * @returns Absolute path to allowed root
     */
    getAllowedRoot(): string {
        return this.allowedRoot;
    }

    /**
     * Get all configured allowed root directories.
     */
    getAllowedRoots(): string[] {
        return [...this.allowedRoots];
    }

    /**
     * Validate a candidate new workspace/vault root before adding it to allowedRoots.
     * Ensures the path is well-formed, resolves canonically to an existing directory,
     * is not a filesystem drive root, and is not inside forbidden OS paths.
     */
    async validateNewRoot(requestedPath: string): Promise<ValidationResult> {
        if (!requestedPath || requestedPath.trim() === '') {
            return { valid: false, error: 'INVALID_PATH', details: 'Workspace path cannot be empty' };
        }
        if (requestedPath.length > this.maxPathLength) {
            return {
                valid: false,
                error: 'INVALID_PATH',
                details: `Workspace path length exceeds maximum limit of ${this.maxPathLength} characters`,
            };
        }
        if (requestedPath.includes('\0')) {
            return { valid: false, error: 'INVALID_PATH', details: 'Workspace path contains null byte' };
        }
        const decoded = this.decodeSafe(requestedPath);
        const driveRelativeMatch = /^[A-Za-z]:(?![\\/])/.test(decoded);
        const colonRemainder = /^[A-Za-z]:/.test(decoded) ? decoded.slice(2) : decoded;
        if (driveRelativeMatch || colonRemainder.includes(':') || decoded.includes('..')) {
            return {
                valid: false,
                error: 'PATH_TRAVERSAL',
                details: 'Invalid workspace path characters or traversal sequence',
            };
        }

        const resolvedLexical = this.stripTrailingSep(path.resolve(path.normalize(decoded)));
        let canonicalRoot: string;
        try {
            canonicalRoot = this.stripTrailingSep(await fs.promises.realpath(resolvedLexical));
            const stats = await fs.promises.stat(canonicalRoot);
            if (!stats.isDirectory()) {
                return {
                    valid: false,
                    error: 'INVALID_PATH',
                    details: 'Workspace root must be an existing directory',
                };
            }
        } catch {
            return {
                valid: false,
                error: 'INVALID_PATH',
                details: `Workspace directory "${resolvedLexical}" does not exist or is inaccessible`,
            };
        }

        const parsedCanonical = path.parse(canonicalRoot);
        if (canonicalRoot === this.stripTrailingSep(parsedCanonical.root)) {
            return {
                valid: false,
                error: 'UNAUTHORIZED_ACCESS',
                details: 'Entire drive/filesystem root cannot be added as a workspace vault',
            };
        }

        const canonicalForbidden = await Promise.all(
            this.forbiddenPaths.map((p) => this.safeRealpathOrResolved(p))
        );
        for (const forbidden of canonicalForbidden) {
            if (this.isWithinDirectory(canonicalRoot, forbidden)) {
                return {
                    valid: false,
                    error: 'UNAUTHORIZED_ACCESS',
                    details: `Workspace cannot point inside protected system path "${forbidden}"`,
                };
            }
        }

        return {
            valid: true,
            canonicalPath: canonicalRoot,
        };
    }

    /**
     * Check if path would be valid without full validation.
     * Useful for quick checks.
     * 
     * @param requestedPath - Path to check
     * @returns True if path appears valid
     */
    isPathSafe(requestedPath: string): boolean {
        return this.validate(requestedPath).valid;
    }
}
