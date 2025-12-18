/**
 * ErrorFactory.test.ts - Tests for centralized error creation
 */

import { describe, it, expect } from '@jest/globals';
import {
  ErrorFactory,
  FileSystemError,
  LLMError,
  IPCError,
  ValidationError,
} from '@shared/errors';

describe('ErrorFactory', () => {
  describe('createFileSystemError()', () => {
    it('should create FileSystemError with correct properties', () => {
      const error = ErrorFactory.createFileSystemError(
        'FILE_NOT_FOUND',
        '/test/file.txt',
        'read'
      );

      expect(error instanceof FileSystemError).toBe(true);
      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.message).toContain('/test/file.txt');
      expect(error.metadata?.path).toBe('/test/file.txt');
      expect(error.metadata?.operation).toBe('read');
    });

    it('should generate appropriate messages for different error codes', () => {
      const errors = {
        'FILE_NOT_FOUND': 'File or directory not found',
        'PERMISSION_DENIED': 'Permission denied',
        'DISK_FULL': 'No space left',
        'PATH_TRAVERSAL': 'Path traversal attempt',
      } as const;

      Object.entries(errors).forEach(([code, messageFragment]) => {
        const error = ErrorFactory.createFileSystemError(
          code as any,
          '/test/path',
          'read'
        );
        expect(error.message).toContain(messageFragment);
      });
    });

    it('should include additional metadata', () => {
      const error = ErrorFactory.createFileSystemError(
        'FILE_TOO_LARGE',
        '/large.mp4',
        'read',
        { size: 1073741824, maxSize: 10485760 }
      );

      expect(error.metadata?.size).toBe(1073741824);
      expect(error.metadata?.maxSize).toBe(10485760);
    });
  });

  describe('fromFsError()', () => {
    it('should create FileSystemError from fs error', () => {
      const fsError = { code: 'ENOENT', message: 'no such file' };
      const error = ErrorFactory.fromFsError(fsError, '/test/file.txt', 'read');

      expect(error instanceof FileSystemError).toBe(true);
      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.metadata?.path).toBe('/test/file.txt');
      expect(error.metadata?.operation).toBe('read');
      expect(error.metadata?.originalCode).toBe('ENOENT');
    });
  });

  describe('createLLMError()', () => {
    it('should create LLMError with correct properties', () => {
      const error = ErrorFactory.createLLMError(
        'MODEL_NOT_FOUND',
        'Model not installed',
        { model: 'llama3.2', ollamaUrl: 'http://localhost:11434' }
      );

      expect(error instanceof LLMError).toBe(true);
      expect(error.code).toBe('MODEL_NOT_FOUND');
      expect(error.message).toBe('Model not installed');
      expect(error.metadata?.model).toBe('llama3.2');
    });
  });

  describe('createIPCError()', () => {
    it('should create IPCError with correct properties', () => {
      const error = ErrorFactory.createIPCError(
        'TIMEOUT',
        'FS:READ_FILE',
        'Request took too long'
      );

      expect(error instanceof IPCError).toBe(true);
      expect(error.code).toBe('TIMEOUT');
      expect(error.message).toContain('FS:READ_FILE');
      expect(error.message).toContain('Request took too long');
      expect(error.metadata?.channel).toBe('FS:READ_FILE');
    });

    it('should generate appropriate messages for different IPC error codes', () => {
      const codes = [
        'INVALID_CHANNEL',
        'SERIALIZATION_FAILED',
        'TIMEOUT',
        'UNAUTHORIZED_REQUEST',
        'MALFORMED_PAYLOAD',
      ] as const;

      codes.forEach(code => {
        const error = ErrorFactory.createIPCError(code, 'TEST:CHANNEL');
        expect(error.code).toBe(code);
        expect(error.message).toContain('TEST:CHANNEL');
      });
    });

    it('should include additional metadata', () => {
      const error = ErrorFactory.createIPCError(
        'TIMEOUT',
        'FS:READ_FILE',
        undefined,
        { timeout: 5000, sender: 'renderer' }
      );

      expect(error.metadata?.timeout).toBe(5000);
      expect(error.metadata?.sender).toBe('renderer');
    });
  });

  describe('createValidationError()', () => {
    it('should create ValidationError with correct properties', () => {
      const error = ErrorFactory.createValidationError(
        'OUT_OF_RANGE',
        'port',
        99999,
        'number between 1 and 65535',
        { min: 1, max: 65535 }
      );

      expect(error instanceof ValidationError).toBe(true);
      expect(error.code).toBe('OUT_OF_RANGE');
      expect(error.message).toContain('port');
      expect(error.message).toContain('number between 1 and 65535');
      expect(error.metadata?.field).toBe('port');
      expect(error.metadata?.value).toBe(99999);
      expect(error.metadata?.expected).toBe('number between 1 and 65535');
      expect(error.metadata?.min).toBe(1);
      expect(error.metadata?.max).toBe(65535);
    });

    it('should generate appropriate messages for different validation error codes', () => {
      const codes = [
        'INVALID_INPUT',
        'MISSING_REQUIRED_FIELD',
        'TYPE_MISMATCH',
        'OUT_OF_RANGE',
        'REGEX_MISMATCH',
      ] as const;

      codes.forEach(code => {
        const error = ErrorFactory.createValidationError(
          code,
          'testField',
          'testValue'
        );
        expect(error.code).toBe(code);
        expect(error.message).toContain('testField');
      });
    });
  });

  describe('Message generation', () => {
    it('should include operation in file system error messages', () => {
      const errorWithOp = ErrorFactory.createFileSystemError(
        'PERMISSION_DENIED',
        '/test',
        'write'
      );
      const errorWithoutOp = ErrorFactory.createFileSystemError(
        'PERMISSION_DENIED',
        '/test'
      );

      expect(errorWithOp.message).toContain('write');
      expect(errorWithoutOp.message).not.toContain('write');
    });

    it('should include additional message in IPC errors', () => {
      const errorWithAdditional = ErrorFactory.createIPCError(
        'TIMEOUT',
        'TEST:CHANNEL',
        'Additional details'
      );
      const errorWithoutAdditional = ErrorFactory.createIPCError(
        'TIMEOUT',
        'TEST:CHANNEL'
      );

      expect(errorWithAdditional.message).toContain('Additional details');
      expect(errorWithoutAdditional.message).not.toContain('Additional details');
    });

    it('should include expected value in validation error messages', () => {
      const errorWithExpected = ErrorFactory.createValidationError(
        'TYPE_MISMATCH',
        'age',
        'not a number',
        'number'
      );
      const errorWithoutExpected = ErrorFactory.createValidationError(
        'TYPE_MISMATCH',
        'age',
        'not a number'
      );

      expect(errorWithExpected.message).toContain('expected: number');
      expect(errorWithoutExpected.message).not.toContain('expected:');
    });
  });
});
