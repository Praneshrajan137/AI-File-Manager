# End-to-End (E2E) Tests

This directory contains end-to-end tests for the Electron file manager application using Playwright.

## Overview

E2E tests validate critical user flows across the entire application stack:
- **Renderer Process** (React UI)
- **IPC Bridge** (Communication layer)
- **Main Process** (Node.js backend)
- **File System** (OS operations)

## Test Structure

### Test Files

- `navigation.spec.ts` - Tests directory navigation, back/forward buttons, history stack
- `security.spec.ts` - Tests path validation, traversal prevention, security boundaries
- `file-operations.spec.ts` - Tests CRUD operations (read, write, delete, rename)
- `ipc-communication.spec.ts` - Tests IPC channels, error handling, file watcher events

### Supporting Files

- `electron-launcher.ts` - Utilities to launch and control Electron app
- `fixtures.ts` - Playwright test fixtures providing Electron app and page instances

## Running Tests

### Prerequisites

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Install Playwright browsers** (if not already installed):
   ```bash
   npx playwright install
   ```

### Run All E2E Tests

```bash
npm run test:e2e
```

### Run Tests in UI Mode

```bash
npm run test:e2e:ui
```

### Run Tests in Headed Mode (See Browser)

```bash
npm run test:e2e:headed
```

### Debug Tests

```bash
npm run test:e2e:debug
```

### Run Specific Test File

```bash
npx playwright test tests/e2e/navigation.spec.ts
```

### Run Tests Matching Pattern

```bash
npx playwright test --grep "security"
```

## Test Coverage

E2E tests focus on **critical paths only** (5% of test pyramid):

1. ✅ **Navigation Flow** - Back/forward, directory browsing
2. ✅ **Security** - Path traversal prevention, unauthorized access blocking
3. ✅ **File Operations** - Read, write, delete, rename
4. ✅ **IPC Communication** - Channel registration, error handling

## Development Mode

To run E2E tests against development server:

```bash
E2E_DEV_MODE=true npm run test:e2e
```

This will connect to `http://localhost:8080` instead of built files.

## CI/CD Integration

E2E tests run **before release** (not on every commit) as per architecture:

```yaml
# Example GitHub Actions
- name: Run E2E Tests
  run: |
    npm run build
    npm run test:e2e
```

## Troubleshooting

### Tests Fail: "Main process not built"

**Solution**: Run `npm run build:main` first

### Tests Fail: "Cannot find Electron executable"

**Solution**: Ensure Electron is installed: `npm install`

### Tests Timeout

**Solution**: Increase timeout in `playwright.config.ts` or check if app is starting correctly

### Flaky Tests

E2E tests can be flaky due to timing. If tests fail intermittently:
1. Check test logs for timing issues
2. Increase wait times in test files
3. Use `page.waitForSelector()` instead of `page.waitForTimeout()`

## Best Practices

1. **Keep tests focused** - Each test should verify one critical path
2. **Use fixtures** - Leverage `electronApp` and `page` fixtures from `fixtures.ts`
3. **Clean up** - Always clean up test files/directories in `afterAll` hooks
4. **Avoid flakiness** - Use proper waits instead of arbitrary timeouts
5. **Test user flows** - Test what users actually do, not implementation details

## Architecture Alignment

These E2E tests align with the project's testing strategy:

- **Unit Tests** (80%) - Individual functions, DSA implementations ✅
- **Integration Tests** (15%) - IPC channels, file operations ✅
- **E2E Tests** (5%) - Critical user journeys ✅ **← This directory**
