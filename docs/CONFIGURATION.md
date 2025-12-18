# Configuration Management

## Overview

Centralized configuration management with type-safe access, validation, and hot-reload support.

## Architecture

```
ConfigManager (Singleton)
├── Configuration Sources (priority order)
│   1. Command-line arguments (highest)
│   2. Environment variables
│   3. User config file (~/.project2-file-manager/config.json)
│   4. Default values (lowest)
├── Validation (Zod)
└── Hot-reload (optional)
```

## Configuration Schema

Complete configuration structure:

```typescript
interface AppConfig {
  app: {
    name: string;
    version: string;
    environment: 'development' | 'production' | 'test';
  };

  window: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  };

  fileSystem: {
    allowedRoots: string[];
    maxFileSize: number;      // bytes
    cacheSize: number;         // bytes
    chunkSize: number;         // tokens
  };

  llm: {
    ollamaUrl: string;
    model: string;
    maxTokens: number;
    temperature: number;
    embeddingDimensions: number;
  };

  logging: {
    level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
    console: boolean;
    file: boolean;
    maxFiles: number;
    maxSize: string;
  };

  performance: {
    renderBatchSize: number;
    indexingConcurrency: number;
    cacheEvictionStrategy: 'LRU' | 'LFU';
  };

  security: {
    forbiddenPaths: string[];
    maxPathLength: number;
    enableSandbox: boolean;
  };
}
```

## Usage

### Initialization

```typescript
import { ConfigManager } from '@shared/config';

// Initialize at app startup
ConfigManager.initialize({
  configPath: '/custom/path/config.json',  // Optional
  watchConfig: true,                        // Enable hot-reload
  onConfigChange: (newConfig) => {
    console.log('Config changed:', newConfig);
  },
});
```

### Getting Configuration

```typescript
import { ConfigManager } from '@shared/config';

const config = ConfigManager.getInstance();

// Get nested values using dot notation
const model = config.get('llm.model');                    // 'llama3.2'
const width = config.get('window.width');                 // 1200
const cacheSize = config.get('fileSystem.cacheSize');     // 104857600

// Get entire section
const llmConfig = config.get('llm');
// { ollamaUrl: '...', model: '...', maxTokens: 2048, ... }

// Get all configuration
const fullConfig = config.getAll();
```

### Setting Configuration

```typescript
const config = ConfigManager.getInstance();

// Set value in memory only
config.set('llm.model', 'llama3.3');

// Set and save to file
config.set('window.width', 1600, true);
```

### Reloading Configuration

```typescript
const config = ConfigManager.getInstance();

// Force reload from file
config.reload();
```

## Configuration File

Default location: `~/.project2-file-manager/config.json`

Example config file:

```json
{
  "app": {
    "name": "Project-2 File Manager",
    "version": "0.1.0",
    "environment": "development"
  },
  
  "window": {
    "width": 1200,
    "height": 800,
    "minWidth": 800,
    "minHeight": 600
  },
  
  "fileSystem": {
    "allowedRoots": [
      "/home/user/Documents",
      "/home/user/Downloads"
    ],
    "maxFileSize": 10485760,
    "cacheSize": 104857600,
    "chunkSize": 500
  },
  
  "llm": {
    "ollamaUrl": "http://localhost:11434",
    "model": "llama3.2",
    "maxTokens": 2048,
    "temperature": 0.7,
    "embeddingDimensions": 384
  },
  
  "logging": {
    "level": "info",
    "console": false,
    "file": true,
    "maxFiles": 30,
    "maxSize": "10m"
  },
  
  "performance": {
    "renderBatchSize": 50,
    "indexingConcurrency": 4,
    "cacheEvictionStrategy": "LRU"
  },
  
  "security": {
    "forbiddenPaths": [
      "/etc/passwd",
      "/etc/shadow",
      "/root"
    ],
    "maxPathLength": 4096,
    "enableSandbox": true
  }
}
```

## Environment Variables

Override configuration with environment variables:

```bash
# .env file (development)
NODE_ENV=development
APP_LOG_LEVEL=debug

# LLM Settings
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Performance
MAX_CACHE_SIZE=104857600
INDEXING_WORKERS=4
```

**Mapping:**
- `NODE_ENV` → `app.environment`
- `APP_LOG_LEVEL` → `logging.level`
- `OLLAMA_URL` → `llm.ollamaUrl`
- `OLLAMA_MODEL` → `llm.model`
- `MAX_CACHE_SIZE` → `fileSystem.cacheSize`
- `INDEXING_WORKERS` → `performance.indexingConcurrency`

## Default Configuration

If no config file exists, defaults are used:

```typescript
import { defaultConfig } from '@shared/config';

console.log(defaultConfig.llm.model);  // 'llama3.2'
```

**Defaults:**
- Window: 1200x800 (min 800x600)
- Max file size: 10MB
- Cache size: 100MB
- Log level: debug (dev) / info (prod)
- LLM: llama3.2 on localhost:11434
- Indexing: 4 concurrent workers

## Validation

All configuration is validated using Zod schemas.

```typescript
import { validateConfig, validateConfigOrThrow } from '@shared/config';

// Validate and get result
const result = validateConfig(userConfig);
if (!result.valid) {
  console.error('Invalid config:', result.errors);
}

// Validate and throw on error
try {
  const config = validateConfigOrThrow(userConfig);
  // Use config...
} catch (err) {
  console.error('Configuration error:', err.message);
}
```

**Validation Rules:**
- `window.width`: integer, min 800
- `fileSystem.maxFileSize`: positive integer
- `llm.temperature`: float, 0-1
- `logging.level`: enum (error, warn, info, debug, trace)
- `security.forbiddenPaths`: array of strings

## Hot-Reload

Enable config file watching:

```typescript
ConfigManager.initialize({
  watchConfig: true,
  onConfigChange: (newConfig) => {
    // Handle config change
    logger.info('Config changed', newConfig);
    
    // Update dependent systems
    logger.setLevel(newConfig.logging.level);
  },
});
```

**Note**: Hot-reload is automatic. Changes to config file are detected and applied immediately.

## Priority Order

Configuration values are merged in this order (later overrides earlier):

1. **Default values** (lowest priority)
2. **User config file** (`~/.project2-file-manager/config.json`)
3. **Environment variables**
4. **Command-line arguments** (highest priority)

Example:
```
Default: llm.model = 'llama3.2'
Config file: llm.model = 'llama3.3'
Environment: OLLAMA_MODEL = 'llama2'
Result: llm.model = 'llama2' (env wins)
```

## Best Practices

### 1. Use Type-Safe Access

```typescript
// ✅ Good (type-safe)
const model = config.get('llm.model');  // string

// ❌ Bad (no type checking)
const model = config.getAll()['llm']['model'];
```

### 2. Don't Hardcode Values

```typescript
// ✅ Good
const maxSize = config.get('fileSystem.maxFileSize');

// ❌ Bad
const maxSize = 10 * 1024 * 1024;
```

### 3. Use Environment Variables for Deployment

```bash
# Production deployment
export NODE_ENV=production
export APP_LOG_LEVEL=warn
export OLLAMA_URL=https://llm.company.com
```

### 4. Validate External Config

```typescript
// ✅ Good (validate before using)
import { validateConfigOrThrow } from '@shared/config';

try {
  const userConfig = JSON.parse(fs.readFileSync('config.json'));
  const validated = validateConfigOrThrow(userConfig);
  // Use validated config...
} catch (err) {
  console.error('Invalid configuration:', err.message);
}
```

### 5. Document Custom Settings

```json
{
  "performance": {
    "renderBatchSize": 50,
    "_comment": "Number of files to render per batch. Increase for better performance on high-end systems."
  }
}
```

## Configuration Recipes

### Development Setup

```json
{
  "app": { "environment": "development" },
  "window": { "width": 1600, "height": 900 },
  "logging": { "level": "debug", "console": true, "file": false },
  "llm": { "model": "llama3.2" }
}
```

### Production Setup

```json
{
  "app": { "environment": "production" },
  "window": { "width": 1200, "height": 800 },
  "logging": { "level": "info", "console": false, "file": true },
  "llm": { "model": "llama3.3", "ollamaUrl": "http://llm-server:11434" },
  "security": { "enableSandbox": true }
}
```

### Testing Setup

```json
{
  "app": { "environment": "test" },
  "logging": { "level": "error", "console": false, "file": false },
  "llm": { "model": "llama3.2" },
  "fileSystem": { "allowedRoots": ["/tmp/test"] }
}
```

## Troubleshooting

### Config Not Loading

1. Check file exists: `~/.project2-file-manager/config.json`
2. Verify JSON syntax: `cat config.json | jq`
3. Check file permissions
4. Look for validation errors in logs

### Config Changes Not Applied

1. Verify hot-reload enabled: `watchConfig: true`
2. Check file watcher permissions
3. Force reload: `config.reload()`
4. Restart application

### Invalid Configuration

```bash
# Validate config file
cat ~/.project2-file-manager/config.json | jq
```

Check validation errors in application logs.

## Related Documentation

- [Error Handling](./ERROR-HANDLING.md)
- [Logging System](./LOGGING.md)
- [Architecture](./ARCHITECTURE.md)
