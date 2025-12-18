/**
 * ValidationError.ts - Input validation errors
 * 
 * Extends BaseError for validation-specific error codes.
 * Used when user input or data doesn't meet requirements.
 * 
 * Error Codes:
 * - INVALID_INPUT: Input doesn't meet validation rules
 * - MISSING_REQUIRED_FIELD: Required field not provided
 * - TYPE_MISMATCH: Value is wrong type
 * - OUT_OF_RANGE: Numeric value outside allowed range
 * - REGEX_MISMATCH: Value doesn't match required pattern
 * 
 * @example
 * throw new ValidationError(
 *   'MISSING_REQUIRED_FIELD',
 *   'Email is required',
 *   { field: 'email', value: undefined }
 * );
 */

import { BaseError } from './BaseError';

/**
 * Validation error codes.
 */
export type ValidationErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_REQUIRED_FIELD'
  | 'TYPE_MISMATCH'
  | 'OUT_OF_RANGE'
  | 'REGEX_MISMATCH'
  | 'UNKNOWN';

/**
 * Validation error metadata.
 */
export interface ValidationErrorMetadata {
  /** Field name that failed validation */
  field?: string;
  
  /** Actual value provided */
  value?: unknown;
  
  /** Expected value or type */
  expected?: string;
  
  /** Minimum value (for range errors) */
  min?: number;
  
  /** Maximum value (for range errors) */
  max?: number;
  
  /** Regex pattern (for pattern errors) */
  pattern?: string;
  
  /** All validation errors (for multiple fields) */
  errors?: Array<{ field: string; message: string }>;
  
  [key: string]: unknown;
}

/**
 * Error class for validation failures.
 * 
 * Used in input validation, config validation, etc.
 * Always operational (isOperational=true).
 */
export class ValidationError extends BaseError {
  /**
   * Create a validation error.
   * 
   * @param code - Specific validation error code
   * @param message - Human-readable error message
   * @param metadata - Additional context
   * 
   * @example
   * throw new ValidationError(
   *   'OUT_OF_RANGE',
   *   'Port must be between 1 and 65535',
   *   { field: 'port', value: 99999, min: 1, max: 65535 }
   * );
   */
  constructor(
    code: ValidationErrorCode,
    message: string,
    metadata?: ValidationErrorMetadata
  ) {
    super(code, message, true, metadata);
    this.name = 'ValidationError';
  }
}
