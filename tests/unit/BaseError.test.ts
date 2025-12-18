/**
 * BaseError.test.ts - Unit tests for BaseError abstract class
 * 
 * Tests the abstract base error class that all domain-specific errors extend.
 * Follows TDD approach: Tests written first, then implementation.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { BaseError } from '@shared/errors/BaseError';

// Test implementation class (concrete class for testing abstract BaseError)
class TestError extends BaseError {
  constructor(
    code: string,
    message: string,
    isOperational: boolean = true,
    metadata?: Record<string, unknown>
  ) {
    super(code, message, isOperational, metadata);
  }
}

describe('BaseError', () => {
  describe('Constructor', () => {
    it('should create error with code and message', () => {
      const error = new TestError('TEST_CODE', 'Test message');

      expect(error.code).toBe('TEST_CODE');
      expect(error.message).toBe('Test message');
      expect(error.name).toBe('TestError');
    });

    it('should set timestamp automatically', () => {
      const before = Date.now();
      const error = new TestError('TEST_CODE', 'Test message');
      const after = Date.now();

      expect(error.timestamp).toBeGreaterThanOrEqual(before);
      expect(error.timestamp).toBeLessThanOrEqual(after);
    });

    it('should default isOperational to true', () => {
      const error = new TestError('TEST_CODE', 'Test message');

      expect(error.isOperational).toBe(true);
    });

    it('should accept custom isOperational value', () => {
      const error = new TestError('TEST_CODE', 'Test message', false);

      expect(error.isOperational).toBe(false);
    });

    it('should store metadata when provided', () => {
      const metadata = { userId: '123', action: 'read' };
      const error = new TestError('TEST_CODE', 'Test message', true, metadata);

      expect(error.metadata).toEqual(metadata);
    });

    it('should have undefined metadata when not provided', () => {
      const error = new TestError('TEST_CODE', 'Test message');

      expect(error.metadata).toBeUndefined();
    });

    it('should capture stack trace', () => {
      const error = new TestError('TEST_CODE', 'Test message');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('TestError');
    });
  });

  describe('toJSON()', () => {
    it('should serialize all properties to JSON', () => {
      const metadata = { path: '/test/path' };
      const error = new TestError('TEST_CODE', 'Test message', true, metadata);
      const json = error.toJSON();

      expect(json.name).toBe('TestError');
      expect(json.code).toBe('TEST_CODE');
      expect(json.message).toBe('Test message');
      expect(json.timestamp).toBeDefined();
      expect(json.isOperational).toBe(true);
      expect(json.metadata).toEqual(metadata);
      expect(json.stack).toBeDefined();
    });

    it('should handle error without metadata', () => {
      const error = new TestError('TEST_CODE', 'Test message');
      const json = error.toJSON();

      expect(json.metadata).toBeUndefined();
    });

    it('should be JSON.stringify compatible', () => {
      const error = new TestError('TEST_CODE', 'Test message');
      const jsonString = JSON.stringify(error);

      expect(() => JSON.parse(jsonString)).not.toThrow();
      const parsed = JSON.parse(jsonString);
      expect(parsed.code).toBe('TEST_CODE');
      expect(parsed.message).toBe('Test message');
    });
  });

  describe('toString()', () => {
    it('should format error as string with name, code, and message', () => {
      const error = new TestError('TEST_CODE', 'Test message');
      const str = error.toString();

      expect(str).toBe('TestError [TEST_CODE]: Test message');
    });

    it('should work with different error codes and messages', () => {
      const error = new TestError('FILE_NOT_FOUND', 'Cannot find file.txt');
      const str = error.toString();

      expect(str).toBe('TestError [FILE_NOT_FOUND]: Cannot find file.txt');
    });
  });

  describe('getContext()', () => {
    it('should return context object with all error properties', () => {
      const metadata = { path: '/test', size: 1024 };
      const error = new TestError('TEST_CODE', 'Test message', true, metadata);
      const context = error.getContext();

      expect(context.code).toBe('TEST_CODE');
      expect(context.timestamp).toBeDefined();
      expect(context.isOperational).toBe(true);
      expect(context.metadata).toEqual(metadata);
    });

    it('should not include message or stack in context', () => {
      const error = new TestError('TEST_CODE', 'Test message');
      const context = error.getContext();

      expect(context).not.toHaveProperty('message');
      expect(context).not.toHaveProperty('stack');
    });
  });

  describe('Error instanceof checks', () => {
    it('should be instance of Error', () => {
      const error = new TestError('TEST_CODE', 'Test message');

      expect(error instanceof Error).toBe(true);
    });

    it('should be instance of TestError', () => {
      const error = new TestError('TEST_CODE', 'Test message');

      expect(error instanceof TestError).toBe(true);
    });

    it('should have correct constructor name', () => {
      const error = new TestError('TEST_CODE', 'Test message');

      expect(error.constructor.name).toBe('TestError');
    });
  });

  describe('Operational vs Programmer errors', () => {
    it('should distinguish operational errors (isOperational=true)', () => {
      const operationalError = new TestError('FILE_NOT_FOUND', 'File missing', true);

      expect(operationalError.isOperational).toBe(true);
    });

    it('should distinguish programmer errors (isOperational=false)', () => {
      const programmerError = new TestError('NULL_POINTER', 'Unexpected null', false);

      expect(programmerError.isOperational).toBe(false);
    });
  });

  describe('Metadata handling', () => {
    it('should support complex metadata objects', () => {
      const complexMetadata = {
        user: { id: '123', role: 'admin' },
        request: { method: 'GET', path: '/api/files' },
        timestamp: new Date().toISOString(),
      };
      const error = new TestError('TEST_CODE', 'Test', true, complexMetadata);

      expect(error.metadata).toEqual(complexMetadata);
    });

    it('should support nested metadata', () => {
      const metadata = {
        level1: {
          level2: {
            level3: 'deep value',
          },
        },
      };
      const error = new TestError('TEST_CODE', 'Test', true, metadata);

      expect(error.metadata).toEqual(metadata);
    });
  });
});
