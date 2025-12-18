/**
 * DomainErrors.test.ts - Tests for domain-specific error classes
 * 
 * Tests FileSystemError, LLMError, IPCError, ValidationError.
 */

import { describe, it, expect } from '@jest/globals';
import {
  FileSystemError,
  LLMError,
  IPCError,
  ValidationError,
} from '@shared/errors';

describe('FileSystemError', () => {
  it('should create error with correct properties', () => {
    const error = new FileSystemError(
      'FILE_NOT_FOUND',
      'File missing',
      { path: '/test/file.txt' }
    );

    expect(error.name).toBe('FileSystemError');
    expect(error.code).toBe('FILE_NOT_FOUND');
    expect(error.message).toBe('File missing');
    expect(error.isOperational).toBe(true);
    expect(error.metadata).toEqual({ path: '/test/file.txt' });
  });

  it('should be instance of Error and BaseError', () => {
    const error = new FileSystemError('FILE_NOT_FOUND', 'Test');

    expect(error instanceof Error).toBe(true);
    expect(error instanceof FileSystemError).toBe(true);
  });

  describe('fromFsError()', () => {
    it('should map ENOENT to FILE_NOT_FOUND', () => {
      const fsError = { code: 'ENOENT', message: 'no such file' };
      const error = FileSystemError.fromFsError(fsError, '/test/file.txt', 'read');

      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.message).toContain('/test/file.txt');
      expect(error.metadata?.path).toBe('/test/file.txt');
      expect(error.metadata?.operation).toBe('read');
      expect(error.metadata?.originalCode).toBe('ENOENT');
    });

    it('should map EACCES to PERMISSION_DENIED', () => {
      const fsError = { code: 'EACCES', message: 'permission denied' };
      const error = FileSystemError.fromFsError(fsError, '/root/secret');

      expect(error.code).toBe('PERMISSION_DENIED');
      expect(error.message).toContain('Permission denied');
    });

    it('should map ENOSPC to DISK_FULL', () => {
      const fsError = { code: 'ENOSPC', message: 'no space left' };
      const error = FileSystemError.fromFsError(fsError);

      expect(error.code).toBe('DISK_FULL');
      expect(error.message).toContain('No space left');
    });

    it('should map EEXIST to ALREADY_EXISTS', () => {
      const fsError = { code: 'EEXIST', message: 'file exists' };
      const error = FileSystemError.fromFsError(fsError, '/test/file.txt');

      expect(error.code).toBe('ALREADY_EXISTS');
      expect(error.message).toContain('already exists');
    });

    it('should map unknown codes to UNKNOWN', () => {
      const fsError = { code: 'EUNKNOWN', message: 'unknown error' };
      const error = FileSystemError.fromFsError(fsError);

      expect(error.code).toBe('UNKNOWN');
      expect(error.message).toContain('EUNKNOWN');
    });
  });
});

describe('LLMError', () => {
  it('should create error with correct properties', () => {
    const error = new LLMError(
      'MODEL_NOT_FOUND',
      'llama3.2 not installed',
      { model: 'llama3.2', ollamaUrl: 'http://localhost:11434' }
    );

    expect(error.name).toBe('LLMError');
    expect(error.code).toBe('MODEL_NOT_FOUND');
    expect(error.message).toBe('llama3.2 not installed');
    expect(error.isOperational).toBe(true);
    expect(error.metadata?.model).toBe('llama3.2');
  });

  it('should support all LLM error codes', () => {
    const codes = [
      'MODEL_NOT_FOUND',
      'INFERENCE_FAILED',
      'CONTEXT_TOO_LARGE',
      'EMBEDDING_FAILED',
      'INDEXING_FAILED',
      'OLLAMA_UNAVAILABLE',
      'RATE_LIMIT_EXCEEDED',
    ] as const;

    codes.forEach(code => {
      const error = new LLMError(code, 'Test message');
      expect(error.code).toBe(code);
    });
  });
});

describe('IPCError', () => {
  it('should create error with correct properties', () => {
    const error = new IPCError(
      'INVALID_CHANNEL',
      'Unknown channel',
      { channel: 'INVALID:CHANNEL', sender: 'renderer' }
    );

    expect(error.name).toBe('IPCError');
    expect(error.code).toBe('INVALID_CHANNEL');
    expect(error.message).toBe('Unknown channel');
    expect(error.isOperational).toBe(true);
    expect(error.metadata?.channel).toBe('INVALID:CHANNEL');
    expect(error.metadata?.sender).toBe('renderer');
  });

  it('should support all IPC error codes', () => {
    const codes = [
      'INVALID_CHANNEL',
      'SERIALIZATION_FAILED',
      'TIMEOUT',
      'UNAUTHORIZED_REQUEST',
      'MALFORMED_PAYLOAD',
    ] as const;

    codes.forEach(code => {
      const error = new IPCError(code, 'Test message');
      expect(error.code).toBe(code);
    });
  });
});

describe('ValidationError', () => {
  it('should create error with correct properties', () => {
    const error = new ValidationError(
      'MISSING_REQUIRED_FIELD',
      'Email is required',
      { field: 'email', value: undefined }
    );

    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('MISSING_REQUIRED_FIELD');
    expect(error.message).toBe('Email is required');
    expect(error.isOperational).toBe(true);
    expect(error.metadata?.field).toBe('email');
  });

  it('should support range validation metadata', () => {
    const error = new ValidationError(
      'OUT_OF_RANGE',
      'Port must be between 1 and 65535',
      { field: 'port', value: 99999, min: 1, max: 65535 }
    );

    expect(error.metadata?.value).toBe(99999);
    expect(error.metadata?.min).toBe(1);
    expect(error.metadata?.max).toBe(65535);
  });

  it('should support all validation error codes', () => {
    const codes = [
      'INVALID_INPUT',
      'MISSING_REQUIRED_FIELD',
      'TYPE_MISMATCH',
      'OUT_OF_RANGE',
      'REGEX_MISMATCH',
    ] as const;

    codes.forEach(code => {
      const error = new ValidationError(code, 'Test message');
      expect(error.code).toBe(code);
    });
  });
});

describe('Error serialization', () => {
  it('should serialize all error types to JSON', () => {
    const errors = [
      new FileSystemError('FILE_NOT_FOUND', 'Test', { path: '/test' }),
      new LLMError('MODEL_NOT_FOUND', 'Test', { model: 'llama3.2' }),
      new IPCError('TIMEOUT', 'Test', { channel: 'FS:READ' }),
      new ValidationError('INVALID_INPUT', 'Test', { field: 'email' }),
    ];

    errors.forEach(error => {
      const json = error.toJSON();
      expect(json.name).toBeDefined();
      expect(json.code).toBeDefined();
      expect(json.message).toBeDefined();
      expect(json.timestamp).toBeDefined();
      expect(json.isOperational).toBe(true);
      expect(json.metadata).toBeDefined();
    });
  });

  it('should convert all error types to string', () => {
    const fsError = new FileSystemError('FILE_NOT_FOUND', 'File missing');
    const llmError = new LLMError('MODEL_NOT_FOUND', 'Model missing');

    expect(fsError.toString()).toBe('FileSystemError [FILE_NOT_FOUND]: File missing');
    expect(llmError.toString()).toBe('LLMError [MODEL_NOT_FOUND]: Model missing');
  });
});
