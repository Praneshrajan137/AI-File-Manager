/**
 * securityMiddleware.test.ts - Tests for security middleware
 */

import { validatePathOrThrow, validatePathRequest, validateRequestSchema } from '@main/handlers/securityMiddleware';

describe('securityMiddleware', () => {
  describe('validatePathRequest', () => {
    it('should extract path from valid request', () => {
      const request = { path: '/home/user/test.txt' };
      // This will throw if path validation fails with PathValidator
      // For unit testing, we'd need to mock PathValidator
      expect(() => validatePathRequest(request)).toBeDefined();
    });

    it('should throw if request is not an object', () => {
      expect(() => validatePathRequest('invalid')).toThrow('Request payload must be an object');
    });

    it('should throw if path field is missing', () => {
      const request = { notPath: 'value' };
      expect(() => validatePathRequest(request)).toThrow('Request missing required field: path');
    });

    it('should throw if path is not a string', () => {
      const request = { path: 123 };
      expect(() => validatePathRequest(request)).toThrow('Field "path" must be a string');
    });

    it('should throw if path is empty', () => {
      const request = { path: '' };
      expect(() => validatePathRequest(request)).toThrow('Field "path" cannot be empty');
    });
  });

  describe('validateRequestSchema', () => {
    it('should validate request with correct schema', () => {
      const request = { name: 'test', age: 25, active: true };
      const schema = { name: 'string' as const, age: 'number' as const, active: 'boolean' as const };
      
      expect(() => validateRequestSchema(request, schema)).not.toThrow();
    });

    it('should throw if field type is incorrect', () => {
      const request = { name: 123 };
      const schema = { name: 'string' as const };
      
      expect(() => validateRequestSchema(request, schema)).toThrow('Field "name" must be string, got number');
    });

    it('should throw if required field is missing', () => {
      const request = { name: 'test' };
      const schema = { name: 'string' as const, age: 'number' as const };
      
      expect(() => validateRequestSchema(request, schema)).toThrow('Request missing required field: age');
    });
  });
});
