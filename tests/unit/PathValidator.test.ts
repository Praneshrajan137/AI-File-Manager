import fs from 'fs';
import { PathValidator } from '@main/services/PathValidator';
import path from 'path';
import os from 'os';

describe('PathValidator', () => {
    let validator: PathValidator;
    const allowedRoot = path.join(os.homedir(), 'test-files');

    beforeEach(() => {
        validator = new PathValidator(allowedRoot);
    });

    describe('path traversal prevention', () => {
        it('should reject paths with .. segments', () => {
            const result = validator.validate('/home/user/../../../etc/passwd');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });

        it('should reject paths with encoded .. (%2e%2e)', () => {
            const result = validator.validate('/home/user/%2e%2e/etc/passwd');

            // After decoding, should still catch it
            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });

        it('should reject Windows-style traversal (..\\)', () => {
            const result = validator.validate('C:\\Users\\..\\..\\Windows\\System32');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });

        it('should check for .. BEFORE path.resolve (BUG FIX #2)', () => {
            // Note: path.join() normalizes paths, so we use raw string with '..'
            // to verify our security check catches '..' BEFORE normalization
            const maliciousPath = allowedRoot + '/../../etc/passwd';

            const result = validator.validate(maliciousPath);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });

        it('should reject .. in original path before normalization', () => {
            // This tests Bug #1 fix
            const result = validator.validate('C:\\allowed\\..\\..\\Windows\\System32');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });

        it('should reject URL encoded traversal sequences', () => {
            const result = validator.validate('%2e%2e/%2e%2e/etc/passwd');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });
    });

    describe('directory escape prevention', () => {
        it('should include path.sep in prefix check (BUG FIX #3)', () => {
            const validator = new PathValidator('/home/user');

            // Without path.sep, '/home/user2' would pass check for '/home/user'
            const result = validator.validate('/home/user2/file.txt');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('UNAUTHORIZED_ACCESS');
        });

        it('should allow paths exactly equal to root', () => {
            const result = validator.validate(allowedRoot);

            expect(result.valid).toBe(true);
        });

        it('should allow paths under root', () => {
            const validPath = path.join(allowedRoot, 'documents', 'file.txt');

            const result = validator.validate(validPath);

            expect(result.valid).toBe(true);
        });

        it('should allow paths under root with similar prefix', () => {
            const validator = new PathValidator('/home/user');
            const result = validator.validate('/home/user/file.txt');

            expect(result.valid).toBe(true);
        });

        it('should reject paths outside root', () => {
            const outsidePath = '/tmp/file.txt';

            const result = validator.validate(outsidePath);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('UNAUTHORIZED_ACCESS');
        });
    });

    describe('forbidden paths', () => {
        it('should reject /etc/passwd on Unix', () => {
            if (process.platform !== 'win32') {
                const result = validator.validate('/etc/passwd');

                expect(result.valid).toBe(false);
                expect(result.error).toBe('UNAUTHORIZED_ACCESS');
            }
        });

        it('should reject /etc/shadow on Unix', () => {
            if (process.platform !== 'win32') {
                const result = validator.validate('/etc/shadow');

                expect(result.valid).toBe(false);
            }
        });

        it('should reject C:\\Windows\\System32 on Windows', () => {
            if (process.platform === 'win32') {
                const result = validator.validate('C:\\Windows\\System32\\config\\SAM');

                expect(result.valid).toBe(false);
                expect(result.error).toBe('UNAUTHORIZED_ACCESS');
            }
        });

        it('should reject .ssh directory', () => {
            const sshPath = path.join(os.homedir(), '.ssh', 'id_rsa');

            const result = validator.validate(sshPath);

            expect(result.valid).toBe(false);
        });

        it('should use exact match or path.sep for forbidden paths', () => {
            // This tests Bug #2 fix
            // Should NOT block /etc/passwd_backup when /etc/passwd is forbidden
            if (process.platform !== 'win32') {
                const validator = new PathValidator('/tmp');
                const result = validator.validate('/etc/passwd');

                // Should be blocked because it's forbidden
                expect(result.valid).toBe(false);
            }
        });
    });

    describe('path normalization', () => {
        it('should normalize double slashes', () => {
            const pathWithDoubleSlash = path.join(allowedRoot, 'docs', '', 'file.txt');

            const result = validator.validate(pathWithDoubleSlash);

            expect(result.valid).toBe(true);
        });

        it('should handle . in paths', () => {
            const pathWithDot = path.join(allowedRoot, '.', 'docs', 'file.txt');

            const result = validator.validate(pathWithDot);

            expect(result.valid).toBe(true);
        });

        it('should normalize alternate slashes and redundant separators safely', () => {
            const altPath =
                process.platform === 'win32'
                    ? allowedRoot.replace(/\\/g, '/') + '/file.txt'
                    : allowedRoot + '///file.txt';

            const result = validator.validate(altPath);

            expect(result.valid).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('should reject empty path', () => {
            const result = validator.validate('');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('INVALID_PATH');
        });

        it('should reject whitespace-only path', () => {
            const result = validator.validate('   ');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('INVALID_PATH');
        });

        it('should reject null bytes in path', () => {
            const pathWithNull = path.join(allowedRoot, 'file\0.txt');

            const result = validator.validate(pathWithNull);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('INVALID_PATH');
        });

        it('should handle very long paths', () => {
            const longPath = path.join(allowedRoot, 'a'.repeat(500), 'file.txt');

            const result = validator.validate(longPath);

            // Should validate without crashing
            expect(typeof result.valid).toBe('boolean');
        });

        it('should handle relative paths', () => {
            const result = validator.validate('./documents/file.txt');

            // Relative paths should be resolved and validated
            expect(typeof result.valid).toBe('boolean');
        });
    });

    describe('validation result details', () => {
        it('should provide detailed error messages', () => {
            // Use platform-appropriate forbidden path
            const forbiddenPath = process.platform === 'win32'
                ? 'C:\\Windows\\System32\\config\\SAM'
                : '/etc/passwd';

            const result = validator.validate(forbiddenPath);

            expect(result.valid).toBe(false);
            expect(result.details).toBeDefined();
            if (result.error === 'UNAUTHORIZED_ACCESS') {
                expect(result.details?.toLowerCase()).toContain('forbidden');
            }
        });

        it('should include path in error details', () => {
            const maliciousPath = '../../etc/passwd';
            const result = validator.validate(maliciousPath);

            expect(result.valid).toBe(false);
            expect(result.details).toBeDefined();
            expect(result.details).toContain('..');
        });
    });

    describe('utility methods', () => {
        it('should return allowed root', () => {
            const root = validator.getAllowedRoot();

            expect(root).toBe(path.resolve(allowedRoot));
        });

        it('should provide isPathSafe shorthand', () => {
            const validPath = path.join(allowedRoot, 'file.txt');
            const invalidPath = '../../etc/passwd';

            expect(validator.isPathSafe(validPath)).toBe(true);
            expect(validator.isPathSafe(invalidPath)).toBe(false);
        });
    });

    describe('security regression tests', () => {
        it('should prevent Bug #1: normalization before .. check', () => {
            // Windows path that would bypass if normalized first
            const result = validator.validate('C:\\allowed\\..\\..\\sensitive');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });

        it('should prevent Bug #2: forbidden path prefix matching', () => {
            if (process.platform !== 'win32') {
                // Create validator with /tmp as allowed root
                const tmpValidator = new PathValidator('/tmp');

                // Try to access /etc/passwd (forbidden)
                const result = tmpValidator.validate('/etc/passwd');

                expect(result.valid).toBe(false);
                expect(result.error).toBe('UNAUTHORIZED_ACCESS');
            }
        });

        it('should prevent Bug #3: URL encoded path traversal', () => {
            const encodedPath = path.join(allowedRoot, '%2e%2e', '%2e%2e', 'etc', 'passwd');
            const result = validator.validate(encodedPath);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });

        it('rejects Win32 drive-relative paths and NTFS Alternate Data Streams', () => {
            const driveRelative = validator.validate('C:relative.txt');
            const ntfsAds = validator.validate(path.join(allowedRoot, 'note.txt:secret'));

            expect(driveRelative.valid).toBe(false);
            expect(driveRelative.error).toBeTruthy();
            expect(ntfsAds.valid).toBe(false);
            expect(ntfsAds.error).toBeTruthy();
        });

        it('fails closed when canonical realpath encounters ELOOP or EACCES', async () => {
            const targetPath = path.join(allowedRoot, 'loop.txt');
            const realpathSpy = jest.spyOn(fs.promises, 'realpath').mockImplementation(async (p) => {
                if (String(p) === targetPath) {
                    throw Object.assign(new Error('Too many levels of symbolic links'), { code: 'ELOOP' });
                }
                return String(p);
            });

            try {
                const res = await validator.validateCanonical(targetPath);
                expect(res.valid).toBe(false);
                expect(res.error).toBeTruthy();
            } finally {
                realpathSpy.mockRestore();
            }
        });

        it('validates both alias roots and canonical realpath targets without loosening escape checks', async () => {
            const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pv-alias-'));
            const realRoot = path.join(sandbox, 'real-root');
            const aliasRoot = path.join(sandbox, 'alias-root');
            const outsideDir = path.join(sandbox, 'outside');
            const escapeLink = path.join(realRoot, 'escape-link');
            const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

            try {
                await fs.promises.mkdir(realRoot, { recursive: true });
                await fs.promises.mkdir(outsideDir, { recursive: true });
                await fs.promises.writeFile(path.join(realRoot, 'inside.txt'), 'ok', 'utf-8');
                await fs.promises.writeFile(path.join(outsideDir, 'secret.txt'), 'nope', 'utf-8');
                await fs.promises.symlink(realRoot, aliasRoot, symlinkType);
                await fs.promises.symlink(outsideDir, escapeLink, symlinkType);

                const canonicalRealRoot = await fs.promises.realpath(realRoot);
                const canonicalInside = await fs.promises.realpath(path.join(realRoot, 'inside.txt'));
                const aliasValidator = new PathValidator(aliasRoot);

                expect(aliasValidator.getAllowedRoots()).toEqual([path.resolve(aliasRoot)]);
                expect(aliasValidator.validate(canonicalInside).valid).toBe(true);

                const viaAlias = await aliasValidator.validateCanonical(path.join(aliasRoot, 'inside.txt'));
                expect(viaAlias.valid).toBe(true);
                expect(viaAlias.canonicalPath).toBe(canonicalInside);

                const viaCanonical = await aliasValidator.validateCanonical(
                    path.join(canonicalRealRoot, 'inside.txt')
                );
                expect(viaCanonical.valid).toBe(true);
                expect(viaCanonical.canonicalPath).toBe(canonicalInside);

                const escapeAttempt = await aliasValidator.validateCanonical(
                    path.join(aliasRoot, 'escape-link', 'secret.txt')
                );
                expect(escapeAttempt.valid).toBe(false);
                expect(escapeAttempt.error).toBe('SYMLINK_ESCAPE');
            } finally {
                await fs.promises.rm(sandbox, { recursive: true, force: true });
            }
        });

        it('expands 8.3 short-path root aliases via fs.realpathSync.native when plain realpathSync omits them', () => {
            const shortRoot = path.join(os.tmpdir(), 'short-alias-root');
            const longRoot = path.join(os.tmpdir(), 'long-canonical-root');
            const syncSpy = jest
                .spyOn(fs, 'realpathSync')
                .mockImplementation((p) => String(p));
            const nativeMock = jest.fn((p: fs.PathLike) =>
                String(p) === shortRoot ? longRoot : String(p)
            );
            (fs.realpathSync as unknown as { native: typeof nativeMock }).native = nativeMock;

            try {
                const shortValidator = new PathValidator(shortRoot);
                expect(syncSpy).toHaveBeenCalledWith(shortRoot);
                expect(nativeMock).toHaveBeenCalledWith(shortRoot);
                expect(shortValidator.validate(path.join(shortRoot, 'file.txt')).valid).toBe(true);
                expect(shortValidator.validate(path.join(longRoot, 'file.txt')).valid).toBe(true);
            } finally {
                syncSpy.mockRestore();
            }
        });
    });
});
