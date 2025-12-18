# Logging System

## Overview

Enterprise-grade structured logging using Winston with multiple transports, log levels, and contextual metadata.

## Architecture

```
Logger (Singleton)
├── Winston Core
│   ├── Console Transport (Development)
│   ├── File Transport (Production)
│   └── Rotating File Transport (Daily rotation)
└── Category Loggers
    ├── FileSystemLogger
    ├── IPCLogger
    ├── LLMLogger
    ├── SecurityLogger
    └── PerformanceLogger
```

## Log Levels

Levels in order of severity (highest to lowest):
1. **error**: Error events that might require immediate attention
2. **warn**: Warning events that indicate potential issues
3. **info**: Informational messages highlighting application progress
4. **debug**: Detailed diagnostic information
5. **trace**: Very detailed tracing information

## Logger Service

### Initialization

```typescript
import { Logger } from '@shared/logging';

// Initialize at app startup
Logger.initialize({
  level: 'debug',        // Log level
  console: true,         // Console transport
  file: true,            // File transport
  logDir: '/path/logs',  // Log directory
  maxSize: '10m',        // Max file size
  maxFiles: 30,          // Keep 30 days
  service: 'MyApp',      // Service name
});
```

### Basic Usage

```typescript
import { Logger, getLogger } from '@shared/logging';

const logger = getLogger();

// Log messages with metadata
logger.error('Operation failed', {
  operation: 'readFile',
  path: '/test/file.txt',
  error: err.message,
});

logger.warn('Deprecated API used', {
  api: 'oldMethod',
  caller: 'UserService',
});

logger.info('User logged in', {
  userId: '123',
  timestamp: new Date(),
});

logger.debug('Cache hit', {
  key: 'user:123',
  ttl: 3600,
});
```

## Category Loggers

Category loggers automatically include category metadata.

### FileSystemLogger

For file system operations:

```typescript
import { FileSystemLogger } from '@shared/logging';

FileSystemLogger.info('Reading directory', {
  path: '/home/user/documents',
  fileCount: 150,
});

FileSystemLogger.error('Permission denied', {
  path: '/root/secret',
  operation: 'write',
  user: 'guest',
});
```

### IPCLogger

For IPC communication:

```typescript
import { IPCLogger } from '@shared/logging';

IPCLogger.debug('IPC request received', {
  channel: 'FS:READ_FILE',
  payload: { path: '/test' },
});

IPCLogger.error('IPC timeout', {
  channel: 'FS:READ_FILE',
  timeout: 5000,
});
```

### LLMLogger

For LLM operations:

```typescript
import { LLMLogger } from '@shared/logging';

LLMLogger.info('Starting indexing', {
  path: '/workspace',
  fileCount: 1500,
});

LLMLogger.debug('Embedding generated', {
  filePath: '/test.ts',
  dimensions: 384,
  duration_ms: 120,
});
```

### SecurityLogger

For security events:

```typescript
import { SecurityLogger } from '@shared/logging';

SecurityLogger.warn('Path traversal attempt', {
  path: '../../etc/passwd',
  ip: '192.168.1.1',
  blocked: true,
});

SecurityLogger.info('Access granted', {
  user: 'admin',
  resource: '/admin/panel',
});
```

### PerformanceLogger

For performance monitoring:

```typescript
import { PerformanceLogger } from '@shared/logging';

PerformanceLogger.info('Operation completed', {
  operation: 'databaseQuery',
  duration_ms: 150,
  rows: 100,
});

PerformanceLogger.warn('Slow operation', {
  operation: 'directoryScan',
  duration_ms: 5000,
  threshold_ms: 1000,
});
```

## Advanced Features

### Performance Timing

```typescript
import { getLogger } from '@shared/logging';

const logger = getLogger();

// Start timer
const endTimer = logger.startTimer('database_query');

// Perform operation
await db.query('SELECT * FROM users');

// End timer (automatically logs duration)
endTimer({ success: true, rows: 100 });
// Logs: "[Timer] database_query" with duration_ms metadata
```

### Child Loggers

Create child loggers with default metadata:

```typescript
import { getLogger } from '@shared/logging';

const logger = getLogger();

// Create child logger with request context
const requestLogger = logger.child({
  requestId: 'abc-123',
  userId: 'user-456',
  ip: '192.168.1.1',
});

// All logs include default metadata
requestLogger.info('Request started', { method: 'GET', path: '/api/users' });
// Logs with: { requestId, userId, ip, method, path }

requestLogger.error('Request failed', { error: err.message });
// Logs with: { requestId, userId, ip, error }
```

## Log Format

### Development (Console)

Pretty-printed with colors:
```
2025-12-18 14:30:15.123 [error]: Operation failed { operation: "readFile", path: "/test" }
```

### Production (File)

Structured JSON for machine parsing:
```json
{
  "timestamp": "2025-12-18T14:30:15.123Z",
  "level": "error",
  "message": "Operation failed",
  "service": "project2-file-manager",
  "category": "FileSystem",
  "operation": "readFile",
  "path": "/test",
  "stack": "Error: ENOENT...",
  "metadata": {
    "error": "File not found"
  }
}
```

## Log Rotation

Logs are automatically rotated daily:

```
~/.project2-file-manager/logs/
├── app-2025-12-18.log
├── app-2025-12-17.log
├── app-2025-12-16.log.gz  (compressed after 1 day)
└── ...
```

**Configuration:**
- **Rotation**: Daily (at midnight)
- **Max file size**: 10MB (rotates early if exceeded)
- **Retention**: 30 days (older logs deleted)
- **Compression**: Gzip after 1 day

## Configuration

Logging behavior is controlled by configuration:

```json
{
  "logging": {
    "level": "info",
    "console": false,
    "file": true,
    "maxFiles": 30,
    "maxSize": "10m"
  }
}
```

**Environment variables:**
```bash
APP_LOG_LEVEL=debug  # Override log level
NODE_ENV=development # Affects default console/file settings
```

## Best Practices

### 1. Use Appropriate Log Levels

```typescript
// ✅ Good
logger.error('Database connection failed', { error: err });  // Requires attention
logger.warn('API deprecated', { api: 'v1/users' });          // Potential issue
logger.info('User logged in', { userId: '123' });            // Progress
logger.debug('Cache hit', { key: 'user:123' });              // Diagnostic
```

### 2. Include Rich Metadata

```typescript
// ✅ Good
logger.error('Payment failed', {
  userId: '123',
  amount: 99.99,
  currency: 'USD',
  paymentMethod: 'credit_card',
  error: err.message,
  timestamp: Date.now(),
});

// ❌ Bad (missing context)
logger.error('Payment failed');
```

### 3. Use Category Loggers

```typescript
// ✅ Good (automatic category tagging)
import { FileSystemLogger } from '@shared/logging';
FileSystemLogger.info('File read', { path: '/test' });

// ❌ Bad (manual category)
import { getLogger } from '@shared/logging';
const logger = getLogger();
logger.info('File read', { category: 'FileSystem', path: '/test' });
```

### 4. Don't Log Sensitive Data

```typescript
// ✅ Good
logger.info('User authenticated', {
  userId: '123',
  method: 'password',
});

// ❌ Bad (exposes password)
logger.info('User authenticated', {
  userId: '123',
  password: 'secret123',
});
```

### 5. Use Structured Metadata

```typescript
// ✅ Good (structured)
logger.info('Request processed', {
  method: 'POST',
  path: '/api/users',
  status: 201,
  duration_ms: 150,
});

// ❌ Bad (unstructured string)
logger.info('Request processed: POST /api/users - 201 (150ms)');
```

## Performance Considerations

- **Async logging**: Non-blocking, doesn't slow down app
- **Overhead**: <1ms per log call
- **File I/O**: Batched and buffered
- **Memory**: Minimal (<10MB for logger)

## Searching Logs

Since logs are JSON, you can use standard tools:

```bash
# Search for errors
cat app-2025-12-18.log | jq 'select(.level == "error")'

# Find slow operations
cat app-2025-12-18.log | jq 'select(.duration_ms > 1000)'

# Filter by category
cat app-2025-12-18.log | jq 'select(.category == "Security")'

# Count errors by type
cat app-2025-12-18.log | jq -r 'select(.level == "error") | .message' | sort | uniq -c
```

## Troubleshooting

### Logs Not Appearing

1. Check log level: `config.get('logging.level')`
2. Check transports enabled: `config.get('logging.console')`, `config.get('logging.file')`
3. Check log directory exists and is writable
4. Verify Logger.initialize() was called

### Log Files Too Large

1. Reduce retention: `logging.maxFiles` in config
2. Reduce file size: `logging.maxSize` in config
3. Increase log level (less verbose)
4. Enable compression (automatic after 1 day)

## Related Documentation

- [Error Handling](./ERROR-HANDLING.md)
- [Configuration Management](./CONFIGURATION.md)
- [Architecture](./ARCHITECTURE.md)
