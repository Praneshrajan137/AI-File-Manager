# Error Handling System

## Overview

The error handling system provides structured, type-safe error management across the entire application. It distinguishes between operational errors (expected) and programmer errors (bugs), enabling appropriate handling for each.

## Architecture

```
BaseError (Abstract)
├── FileSystemError (File operations)
├── LLMError (AI/LLM operations)
├── IPCError (IPC communication)
└── ValidationError (Input validation)
```

## Error Classes

### BaseError

Abstract base class for all application errors.

**Properties:**
- `code`: Machine-readable error code
- `message`: Human-readable description
- `timestamp`: When error occurred (Unix ms)
- `isOperational`: true for expected errors, false for bugs
- `metadata`: Additional context
- `stack`: Call stack trace

**Methods:**
- `toJSON()`: Serialize for logging/IPC
- `toString()`: Human-readable format
- `getContext()`: Extract contextual info

### FileSystemError

Handles file system operation errors.

**Error Codes:**
- `FILE_NOT_FOUND`: File or directory doesn't exist
- `PERMISSION_DENIED`: Insufficient permissions
- `DISK_FULL`: No space left on device
- `INVALID_PATH`: Path format is invalid
- `PATH_TRAVERSAL`: Directory traversal attack attempt
- `UNAUTHORIZED_ACCESS`: Access to forbidden path
- `FILE_TOO_LARGE`: File exceeds size limit
- `DIRECTORY_NOT_EMPTY`: Cannot delete non-empty directory
- `ALREADY_EXISTS`: File or directory already exists

**Example:**
```typescript
import { FileSystemError } from '@shared/errors';

throw new FileSystemError(
  'FILE_NOT_FOUND',
  'Cannot find configuration.json',
  { path: '/etc/app/configuration.json', operation: 'read' }
);
```

### LLMError

Handles LLM and AI operation errors.

**Error Codes:**
- `MODEL_NOT_FOUND`: Ollama model not available
- `INFERENCE_FAILED`: Model inference/generation failed
- `CONTEXT_TOO_LARGE`: Input exceeds context window
- `EMBEDDING_FAILED`: Failed to generate embeddings
- `INDEXING_FAILED`: File indexing operation failed
- `OLLAMA_UNAVAILABLE`: Ollama server not reachable
- `RATE_LIMIT_EXCEEDED`: Too many requests to LLM

**Example:**
```typescript
import { LLMError } from '@shared/errors';

throw new LLMError(
  'MODEL_NOT_FOUND',
  'Model llama3.2 not installed',
  { model: 'llama3.2', ollamaUrl: 'http://localhost:11434' }
);
```

### IPCError

Handles IPC communication errors.

**Error Codes:**
- `INVALID_CHANNEL`: Unknown IPC channel
- `SERIALIZATION_FAILED`: Cannot serialize/deserialize data
- `TIMEOUT`: IPC request timed out
- `UNAUTHORIZED_REQUEST`: Request not allowed by security policy
- `MALFORMED_PAYLOAD`: Request payload is invalid

**Example:**
```typescript
import { IPCError } from '@shared/errors';

throw new IPCError(
  'TIMEOUT',
  'IPC request timed out',
  { channel: 'FS:READ_FILE', timeout: 5000 }
);
```

### ValidationError

Handles input validation errors.

**Error Codes:**
- `INVALID_INPUT`: Input doesn't meet validation rules
- `MISSING_REQUIRED_FIELD`: Required field not provided
- `TYPE_MISMATCH`: Value is wrong type
- `OUT_OF_RANGE`: Numeric value outside allowed range
- `REGEX_MISMATCH`: Value doesn't match required pattern

**Example:**
```typescript
import { ValidationError } from '@shared/errors';

throw new ValidationError(
  'OUT_OF_RANGE',
  'Port must be between 1 and 65535',
  { field: 'port', value: 99999, min: 1, max: 65535 }
);
```

## ErrorFactory

Centralized error creation with consistent metadata enrichment.

**Methods:**
- `createFileSystemError(code, path, operation?, metadata?)`: Create FileSystemError
- `fromFsError(fsError, path?, operation?)`: Convert Node.js fs error
- `createLLMError(code, message, metadata?)`: Create LLMError
- `createIPCError(code, channel, message?, metadata?)`: Create IPCError
- `createValidationError(code, field, value, expected?, metadata?)`: Create ValidationError

**Example:**
```typescript
import { ErrorFactory } from '@shared/errors';

// Direct creation
const error = ErrorFactory.createFileSystemError(
  'FILE_NOT_FOUND',
  '/path/to/file.txt',
  'read'
);

// From fs error
try {
  await fs.readFile('/path/to/file');
} catch (err) {
  throw ErrorFactory.fromFsError(err, '/path/to/file', 'read');
}
```

## Global Error Handler

Catches and handles all unhandled errors in Main Process.

**Features:**
- Distinguishes operational vs programmer errors
- Logs all errors with full context
- Prevents app crashes from operational errors
- Gracefully shuts down on programmer errors (production)

**Initialization:**
```typescript
import { ErrorHandler } from './middleware/ErrorHandler';

ErrorHandler.initialize({
  exitOnProgrammerError: true, // Exit on bugs in production
  logger: customLogger.error,
  onOperationalError: (error) => {
    // Handle expected errors gracefully
  },
  onProgrammerError: (error) => {
    // Alert developers about bugs
  },
});
```

## Error Serialization (IPC)

Serializes errors for transmission from Main to Renderer Process.

**Features:**
- Strips sensitive data (passwords, tokens)
- Optionally hides stack traces in production
- Sanitizes file paths

**Usage:**
```typescript
import { ErrorSerializer } from './middleware/ErrorSerializer';

// Serialize error
const serialized = ErrorSerializer.serialize(error, {
  includeStack: false,
  sanitizePaths: true,
});

// Send via IPC
return serialized;

// In renderer, deserialize
const error = ErrorSerializer.deserialize(ipcPayload);
```

## Best Practices

### 1. Use Specific Error Types

```typescript
// ✅ Good
throw new FileSystemError('FILE_NOT_FOUND', 'File missing', { path: '/test' });

// ❌ Bad
throw new Error('File not found');
```

### 2. Include Metadata

```typescript
// ✅ Good
throw new FileSystemError('PERMISSION_DENIED', 'Cannot write', {
  path: '/root/secret',
  operation: 'write',
  userId: 'user123',
});

// ❌ Bad
throw new FileSystemError('PERMISSION_DENIED', 'Cannot write');
```

### 3. Use ErrorFactory

```typescript
// ✅ Good
const error = ErrorFactory.createFileSystemError('FILE_NOT_FOUND', '/test', 'read');

// ❌ Bad (no automatic message generation)
const error = new FileSystemError('FILE_NOT_FOUND', 'Error', { path: '/test' });
```

### 4. Distinguish Operational vs Programmer Errors

```typescript
// Operational error (expected, user-facing)
throw new FileSystemError('FILE_NOT_FOUND', 'File missing', { path: '/test' });

// Programmer error (bug, needs fixing)
throw new Error('Unexpected null pointer in calculateTotal()');
```

### 5. Handle Errors Appropriately

```typescript
try {
  await fileOperation();
} catch (error) {
  if (error instanceof BaseError && error.isOperational) {
    // Show user-friendly message
    showToast(error.message);
  } else {
    // Log bug and show generic error
    logger.error('Unexpected error', { error });
    showToast('An unexpected error occurred');
  }
}
```

## Testing

All error classes have comprehensive unit tests in `tests/unit/`:
- `BaseError.test.ts`: Base error functionality
- `DomainErrors.test.ts`: Domain-specific error classes
- `ErrorFactory.test.ts`: Factory pattern tests

Run tests:
```bash
npm test -- BaseError
npm test -- DomainErrors
npm test -- ErrorFactory
```

## Related Documentation

- [Logging System](./LOGGING.md)
- [Configuration Management](./CONFIGURATION.md)
- [Architecture](./ARCHITECTURE.md)
