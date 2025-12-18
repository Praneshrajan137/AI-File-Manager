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
 * 
 * ALL paths MUST be validated before ANY fs operation.
 * 
 * Security fixes applied:
 * - BUG FIX #1: Check '..' in ORIGINAL path BEFORE normalization
 * - BUG FIX #2: Decode URL encoding to prevent %2e%2e attacks
 * - BUG FIX #3: Use exact match OR path.sep for forbidden paths
 * 
 * @example
 * const validator = new PathValidator('/home/user/documents');
 * const result = validator.validate('/home/user/documents/file.txt');
 * if (!result.valid) {
 *   throw new Error(result.error);
 * }
 */
export class PathValidator {
    private allowedRoot: string;
    private forbiddenPaths: string[];

    /**
     * Create path validator for specific root directory.
     * 
     * @param allowedRoot - Root directory that paths must be under
     * 
     * @example
     * const validator = new PathValidator('/home/user/documents');
     * const result = validator.validate('/home/user/documents/file.txt');
     * if (!result.valid) {
     *   throw new Error(result.error);
     * }
     */
    constructor(allowedRoot: string) {
        // Normalize and resolve root to absolute path
        this.allowedRoot = path.resolve(path.normalize(allowedRoot));

        // Initialize OS-specific forbidden paths
        this.forbiddenPaths = this.getForbiddenPaths();
    }

    /**
     * Validate path for security.
     * 
     * @param requestedPath - Path to validate
     * @returns Validation result with error details if invalid
     * 
     * @example
     * const result = validator.validate('/home/user/../../etc/passwd');
     * // Returns: { valid: false, error: 'PATH_TRAVERSAL', details: '...' }
     */
    validate(requestedPath: string): ValidationResult {
        // Step 1: Check for empty path
        if (!requestedPath || requestedPath.trim() === '') {
            SecurityLogger.warn('Empty path validation attempt');
            return {
                valid: false,
                error: 'INVALID_PATH',
                details: 'Path cannot be empty',
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
        let decoded: string;
        try {
            decoded = decodeURIComponent(requestedPath);
        } catch (e) {
            // If decoding fails, use original (might be malformed URL encoding)
            decoded = requestedPath;
        }

        // Step 4: CHECK FOR '..' IN ORIGINAL PATH FIRST (BUG FIX #1)
        // This is CRITICAL - must check BEFORE any normalization
        // because path.normalize() and path.resolve() remove '..'
        if (decoded.includes('..')) {
            SecurityLogger.error('Path traversal attempt detected', {
                originalPath: requestedPath,
                decodedPath: decoded,
            });
            return {
                valid: false,
                error: 'PATH_TRAVERSAL',
                details: `Path traversal detected: relative paths with ".." are not allowed`,
            };
        }

        // Step 5: Normalize path (handle //, ./, etc.)
        const normalized = path.normalize(decoded);

        // Step 6: Resolve to absolute path
        const resolved = path.resolve(normalized);

        // Step 7: Check against forbidden paths FIRST (BUG FIX #3)
        // Check this BEFORE allowed root check to ensure forbidden paths
        // are always blocked with the correct error message
        // Use exact match OR prefix match with path.sep
        for (const forbidden of this.forbiddenPaths) {
            // Exact match OR starts with forbidden path + separator
            // This prevents '/etc/passwd_backup' from being blocked when '/etc/passwd' is forbidden
            // But still blocks '/etc/passwd/file' when '/etc/passwd' is forbidden
            if (resolved === forbidden ||
                resolved.startsWith(forbidden + path.sep)) {
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

        // Step 8: Ensure within allowed root (BUG FIX #3)
        // CRITICAL: Must append path.sep to prevent prefix escape
        // Without this: '/home/user2' passes check for '/home/user'
        const rootWithSep = this.allowedRoot.endsWith(path.sep)
            ? this.allowedRoot
            : this.allowedRoot + path.sep;

        if (!resolved.startsWith(rootWithSep) && resolved !== this.allowedRoot) {
            SecurityLogger.error('Unauthorized directory access attempt', {
                requestedPath,
                resolvedPath: resolved,
                allowedRoot: this.allowedRoot,
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
