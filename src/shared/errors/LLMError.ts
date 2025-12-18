/**
 * LLMError.ts - LLM and AI operation errors
 * 
 * Extends BaseError for LLM-specific error codes.
 * Used in Intelligence Layer (indexing, retrieval, inference).
 * 
 * Error Codes:
 * - MODEL_NOT_FOUND: Ollama model not available
 * - INFERENCE_FAILED: Model inference/generation failed
 * - CONTEXT_TOO_LARGE: Input exceeds context window
 * - EMBEDDING_FAILED: Failed to generate embeddings
 * - INDEXING_FAILED: File indexing operation failed
 * - OLLAMA_UNAVAILABLE: Ollama server not reachable
 * - RATE_LIMIT_EXCEEDED: Too many requests to LLM
 * 
 * @example
 * throw new LLMError(
 *   'MODEL_NOT_FOUND',
 *   'llama3.2 model not found',
 *   { model: 'llama3.2', ollamaUrl: 'http://localhost:11434' }
 * );
 */

import { BaseError } from './BaseError';

/**
 * LLM error codes.
 */
export type LLMErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'INFERENCE_FAILED'
  | 'CONTEXT_TOO_LARGE'
  | 'EMBEDDING_FAILED'
  | 'INDEXING_FAILED'
  | 'OLLAMA_UNAVAILABLE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNKNOWN';

/**
 * LLM error metadata.
 */
export interface LLMErrorMetadata {
  /** Model name (e.g., 'llama3.2') */
  model?: string;
  
  /** Ollama server URL */
  ollamaUrl?: string;
  
  /** File path being indexed */
  filePath?: string;
  
  /** Token count (for context size errors) */
  tokenCount?: number;
  
  /** Maximum allowed tokens */
  maxTokens?: number;
  
  /** HTTP status code (for API errors) */
  statusCode?: number;
  
  /** Original error message */
  originalError?: string;
  
  [key: string]: unknown;
}

/**
 * Error class for LLM operations.
 * 
 * Used throughout Intelligence Layer for LLM-related errors.
 * Always operational (isOperational=true).
 */
export class LLMError extends BaseError {
  /**
   * Create an LLM error.
   * 
   * @param code - Specific LLM error code
   * @param message - Human-readable error message
   * @param metadata - Additional context
   * 
   * @example
   * throw new LLMError(
   *   'MODEL_NOT_FOUND',
   *   'Requested model is not installed',
   *   { model: 'llama3.2', ollamaUrl: 'http://localhost:11434' }
   * );
   */
  constructor(
    code: LLMErrorCode,
    message: string,
    metadata?: LLMErrorMetadata
  ) {
    super(code, message, true, metadata);
    this.name = 'LLMError';
  }
}
