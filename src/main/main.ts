/**
 * @copyright 2025 Praneshrajan
 * @license CC-BY-NC-4.0
 * @author Praneshrajan (https://github.com/Praneshrajan137)
 */

/**
 * main.ts - Electron Main Process Entry Point
 * 
 * This is the ONLY process that has access to Node.js APIs and file system.
 * Security is CRITICAL here - all paths must be validated before fs operations.
 * 
 * Architecture:
 * - Creates BrowserWindow with strict security settings
 * - Loads Renderer process (React app)
 * - Sets up IPC handlers for secure communication
 * - Manages application lifecycle
 * 
 * Initialization order:
 * 1. Configuration (ConfigManager)
 * 2. Logging (Logger)
 * 3. Error handling (ErrorHandler)
 * 4. Window creation
 * 5. IPC handlers
 */

import { app, BrowserWindow, protocol, session } from 'electron';
import * as fsSync from 'fs';
import * as path from 'path';
import {
  ConfigManager,
  resolveDefaultModelCacheDir,
  resolvePackagedMcpEntryPath,
} from '@shared/config';
import { Logger, getLogger } from '@shared/logging';
import { suppressSqliteExperimentalWarning } from '@shared/utils/processWarnings';
import { ErrorHandler } from './middleware/ErrorHandler';
import { isAllowedAppRendererUrl } from './handlers/securityMiddleware';
import {
  getPrivilegedSchemeConfig,
  registerVaultAssetProtocol,
} from './services/AssetProtocol';
import {
  configureKernelHooks,
  getReactiveWorkspaceKernel,
  resetReactiveWorkspaceKernel,
} from './services/ReactiveWorkspaceKernel';

if (typeof protocol?.registerSchemesAsPrivileged === 'function') {
  protocol.registerSchemesAsPrivileged([getPrivilegedSchemeConfig()]);
}

const isSmokePackagedBoot = process.argv.includes('--smoke-packaged-boot');
const smokeTraceArg = process.argv.find((arg) => arg.startsWith('--smoke-trace-file='));
const smokeTraceFile = smokeTraceArg ? smokeTraceArg.slice('--smoke-trace-file='.length) : null;

function recordSmokeTrace(step: string, extra?: string): void {
  if (!isSmokePackagedBoot || !smokeTraceFile) {
    return;
  }
  try {
    const line = extra ? `${step}: ${extra}\n` : `${step}\n`;
    fsSync.appendFileSync(smokeTraceFile, line, 'utf-8');
  } catch {
    // Ignore trace write errors
  }
}

recordSmokeTrace('01:module-loaded', `packaged=${String(app?.isPackaged)} pid=${process.pid}`);

/**
 * Reference to main application window.
 * Kept at module level to prevent garbage collection.
 */
let mainWindow: BrowserWindow | null = null;

/**
 * Determine if running in development mode.
 */
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Initialize core systems.
 * 
 * Must be called before app.whenReady().
 */
function initializeSystems(): void {
  suppressSqliteExperimentalWarning();
  // 1. Initialize Configuration
  ConfigManager.initialize({
    watchConfig: isDevelopment, // Hot-reload in development
    onConfigChange: (newConfig) => {
      const logger = getLogger();
      logger.info('Configuration changed', {
        environment: newConfig.app.environment,
      });
    },
  });

  const config = ConfigManager.getInstance();

  // 2. Initialize Logger
  Logger.initialize({
    level: config.get('logging').level,
    console: config.get('logging').console,
    file: config.get('logging').file,
    service: config.get('app').name,
  });

  const logger = getLogger();
  logger.info('Application starting', {
    name: config.get('app').name,
    version: config.get('app').version,
    environment: config.get('app').environment,
    nodeVersion: process.version,
    platform: process.platform,
  });

  // 3. Initialize Error Handler
  ErrorHandler.initialize({
    exitOnProgrammerError: !isDevelopment,
    logger: (message, context) => {
      logger.error(message, context);
    },
    onOperationalError: (error) => {
      logger.error('Operational error occurred', {
        code: error.code,
        message: error.message,
        metadata: error.metadata,
      });
    },
    onProgrammerError: (error) => {
      logger.error('Programmer error (bug) occurred', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    },
  });

  ErrorHandler.registerShutdownHook(async () => {
    await Promise.allSettled([
      resetReactiveWorkspaceKernel(),
      import('./handlers/llmHandlers').then(({ cleanupLLMServices }) => cleanupLLMServices()),
    ]);
  });

  logger.info('Core systems initialized', {
    config: 'ready',
    logging: 'ready',
    errorHandling: 'ready',
  });
}

// Initialize systems before app is ready
try {
  initializeSystems();
  recordSmokeTrace('02:systems-initialized');
} catch (err) {
  recordSmokeTrace(
    '02-err:systems-failed',
    err instanceof Error ? err.stack || err.message : String(err)
  );
  throw err;
}

/**
 * Create the main application window with security-hardened settings.
 * 
 * SECURITY CRITICAL:
 * - contextIsolation: true - Prevents renderer from accessing Node.js
 * - nodeIntegration: false - Disables Node.js in renderer
 * - sandbox: true - Runs renderer in OS-level sandbox
 * - preload script - Only way to expose controlled APIs to renderer
 */
function createWindow(): void {
  const logger = getLogger();
  const config = ConfigManager.getInstance();
  const windowConfig = config.get('window');

  logger.info('Creating main window', {
    width: windowConfig.width,
    height: windowConfig.height,
  });

  mainWindow = new BrowserWindow({
    width: windowConfig.width,
    height: windowConfig.height,
    minWidth: windowConfig.minWidth,
    minHeight: windowConfig.minHeight,
    webPreferences: {
      // CRITICAL SECURITY SETTINGS - DO NOT MODIFY
      contextIsolation: true,    // Isolate renderer from Node.js context
      nodeIntegration: false,     // Disable Node.js in renderer
      sandbox: true,              // Always enforce OS-level sandboxing regardless of disk config

      // Preload script - bridge between Main and Renderer
      preload: path.join(__dirname, 'preload.js'),

      // Additional security
      webSecurity: true,          // Enable web security
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableBlinkFeatures: '',    // No experimental features
    },

    // Window appearance
    backgroundColor: '#ffffff',
    show: false, // Don't show until ready-to-show event
    title: config.get('app').name,
  });

  // Load application content
  if (isDevelopment) {
    // Development: Load from webpack dev server
    const devUrl = 'http://localhost:8080';
    logger.info('Loading development URL', { url: devUrl });
    mainWindow.loadURL(devUrl);

    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // Production: Load from built files
    const indexPath = path.join(__dirname, '../renderer/index.html');
    logger.info('Loading production file', { path: indexPath });
    mainWindow.loadFile(indexPath);
  }

  // Show window when ready (prevents flash of white)
  mainWindow.once('ready-to-show', () => {
    logger.info('Window ready to show');
    mainWindow?.show();
  });

  // Handle window close
  mainWindow.on('closed', () => {
    logger.info('Main window closed');
    mainWindow = null;
  });

  // Security: Enforce navigation & window-open restrictions via shared URL policy
  const guardWebContentsNavigation = (contents: Electron.WebContents): void => {
    const rendererDir = path.resolve(__dirname, '../renderer');
    const blockIfDisallowed = (event: Electron.Event, url: string, kind: 'navigate' | 'redirect'): void => {
      if (!isAllowedAppRendererUrl(url, { isDevelopment, rendererDir })) {
        logger.warn(`Blocked ${kind} attempt`, { url });
        event.preventDefault();
      }
    };

    contents.on('will-navigate', (event, url) => blockIfDisallowed(event, url, 'navigate'));
    contents.on('will-redirect', (event, url) => blockIfDisallowed(event, url, 'redirect'));
    contents.setWindowOpenHandler(() => {
      logger.warn('Blocked attempt to open new window');
      return { action: 'deny' };
    });
  };

  guardWebContentsNavigation(mainWindow.webContents);

  logger.info('Main window created successfully');

  // Wire kernel broadcasts to active renderer windows
  startFileWatcher();
}

function configureSessionSecurity(): void {
  const logger = getLogger();
  const defaultSession = session?.defaultSession;
  if (!defaultSession) {
    return;
  }

  if (typeof defaultSession.setPermissionRequestHandler === 'function') {
    defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      logger.warn('Denied Chromium permission request', { permission });
      callback(false);
    });
  }
  if (typeof defaultSession.setPermissionCheckHandler === 'function') {
    defaultSession.setPermissionCheckHandler(() => false);
  }

  const rendererCsp = isDevelopment
    ? "default-src 'self' http://localhost:8080; script-src 'self' 'unsafe-eval' http://localhost:8080; style-src 'self' 'unsafe-inline' http://localhost:8080; img-src 'self' data: vault-asset: http://localhost:8080; media-src 'self' vault-asset:; frame-src 'self' vault-asset:; object-src 'self' vault-asset:; connect-src 'self' vault-asset: http://localhost:8080 ws://localhost:8080; base-uri 'self'; form-action 'none'; frame-ancestors 'none';"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: vault-asset:; media-src 'self' vault-asset:; frame-src 'self' vault-asset:; object-src 'self' vault-asset:; connect-src 'self' vault-asset:; base-uri 'self'; form-action 'none'; frame-ancestors 'none';";

  if (typeof defaultSession.webRequest?.onHeadersReceived === 'function') {
    defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const url = details.url || '';
      if (url.startsWith('vault-asset://')) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [rendererCsp],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    });
  }
}

/**
 * Configure ReactiveWorkspaceKernel broadcaster so external FS changes
 * and kernel events reach live renderer windows cleanly.
 */
function startFileWatcher(): void {
  const logger = getLogger();

  configureKernelHooks({
    broadcaster: (channel, payload) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(channel, payload);
        }
      });
    },
  });

  // Ensure kernel is instantiated
  getReactiveWorkspaceKernel();
  logger.info('ReactiveWorkspaceKernel initialized (watcher starts on navigation)');
}

/**
 * Update the watched directory when user navigates.
 */
export async function updateWatchPath(newPath: string): Promise<void> {
  await getReactiveWorkspaceKernel().activateDirectory(newPath);
}

/**
 * Application lifecycle: Ready
 * Called when Electron has finished initialization.
 */
app.whenReady().then(async () => {
  recordSmokeTrace('03:app-ready');
  const logger = getLogger();
  logger.info('Electron app ready, registering IPC handlers and creating window');

  // CRITICAL: Register all IPC handlers BEFORE creating window
  // This ensures handlers are ready when renderer process starts
  let registeredChannelsCount = 0;
  try {
    const { getRegisteredChannels, registerAllHandlers } = await import('./handlers/ipcHandlers');
    registerAllHandlers();
    registeredChannelsCount = getRegisteredChannels().length;
    recordSmokeTrace('04:handlers-registered', `channels=${registeredChannelsCount}`);
    logger.info('All IPC handlers registered successfully');
  } catch (error) {
    recordSmokeTrace(
      '04-err:handlers-failed',
      error instanceof Error ? error.stack || error.message : String(error)
    );
    logger.error('Failed to register IPC handlers', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Don't create window if handlers failed to register
    throw error;
  }

  registerVaultAssetProtocol();
  configureSessionSecurity();
  recordSmokeTrace('05:security-configured');

  if (process.argv.includes('--smoke-packaged-boot')) {
    const reportArg = process.argv.find((arg) => arg.startsWith('--smoke-report-file='));
    const reportFile = reportArg ? reportArg.slice('--smoke-report-file='.length) : null;
    try {
      recordSmokeTrace('06:smoke-sqlite-start');
      // Verify built-in node:sqlite and LanceDB bind cleanly inside packaged ASAR/unpacked bundle
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const memDb = new DatabaseSync(':memory:');
      memDb.exec('CREATE VIRTUAL TABLE t USING fts5(body); INSERT INTO t VALUES (\'ok\');');
      memDb.close();
      recordSmokeTrace('07:smoke-lancedb-start');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const lancedb = require('@lancedb/lancedb') as typeof import('@lancedb/lancedb');
      const smokeVecDir = fsSync.mkdtempSync(path.join(app.getPath('temp'), 'pv-lancedb-smoke-'));
      try {
        const db = await lancedb.connect(smokeVecDir);
        const table = await db.createTable('smoke_vectors', [{ id: '1', vector: [0.25, 0.75] }]);
        const rowCount = await table.countRows();
        if (rowCount !== 1) {
          throw new Error(`Unexpected LanceDB smoke row count: ${rowCount}`);
        }
        table.close();
        db.close();
      } finally {
        try {
          fsSync.rmSync(smokeVecDir, { recursive: true, force: true });
        } catch {
          // Ignore delayed Windows file handle cleanup in temp dir
        }
      }
      recordSmokeTrace('08:smoke-lancedb-ok');
      const modelCacheDir = resolveDefaultModelCacheDir();
      const mcpEntryPath = resolvePackagedMcpEntryPath(__dirname);
      const smokePayload = {
        ok: true,
        packaged: app.isPackaged,
        registeredChannels: registeredChannelsCount,
        modelCacheDir,
        mcpEntryPath,
        mcpExists: fsSync.existsSync(mcpEntryPath),
      };
      if (reportFile) {
        fsSync.writeFileSync(reportFile, JSON.stringify(smokePayload, null, 2), 'utf-8');
      }
      recordSmokeTrace('09:smoke-complete');
      process.stdout.write(`[SMOKE_PACKAGED_OK] ${JSON.stringify(smokePayload)}\n`);
      await Promise.allSettled([
        resetReactiveWorkspaceKernel(),
        import('./handlers/llmHandlers').then(({ cleanupLLMServices }) => cleanupLLMServices()),
      ]);
      app.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      recordSmokeTrace('09-err:smoke-catch', msg);
      if (reportFile) {
        fsSync.writeFileSync(reportFile, JSON.stringify({ ok: false, error: msg }), 'utf-8');
      }
      process.stderr.write(`[SMOKE_PACKAGED_FAIL] ${msg}\n`);
      app.exit(1);
    }
    return;
  }

  app.on('web-contents-created', (_event, contents) => {
    const rendererDir = path.resolve(__dirname, '../renderer');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (navEvent, url) => {
      if (!isAllowedAppRendererUrl(url, { isDevelopment, rendererDir })) {
        logger.warn('Blocked secondary webContents navigation', { url });
        navEvent.preventDefault();
      }
    });
    contents.on('will-redirect', (navEvent, url) => {
      if (!isAllowedAppRendererUrl(url, { isDevelopment, rendererDir })) {
        logger.warn('Blocked secondary webContents redirect', { url });
        navEvent.preventDefault();
      }
    });
  });

  createWindow();

  // macOS: Re-create window when dock icon clicked
  app.on('activate', () => {
    logger.info('App activated (macOS)');
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * Application lifecycle: All windows closed
 * Quit app except on macOS (where apps stay active until Cmd+Q).
 */
app.on('window-all-closed', () => {
  const logger = getLogger();
  logger.info('All windows closed');

  void (async (): Promise<void> => {
    let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
    const shutdownGrace = new Promise<void>((resolve) => {
      shutdownTimer = setTimeout(resolve, 1500);
      if (typeof shutdownTimer.unref === 'function') {
        shutdownTimer.unref();
      }
    });

    const cleanupResults = await Promise.race([
      Promise.allSettled([
        resetReactiveWorkspaceKernel(),
        import('./handlers/llmHandlers').then(({ cleanupLLMServices }) => cleanupLLMServices()),
      ]),
      shutdownGrace.then(() => null),
    ]);
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
    }

    if (cleanupResults === null) {
      logger.warn('Bounded shutdown grace elapsed; continuing app quit');
    } else {
      const [kernelResult, llmResult] = cleanupResults;
      if (kernelResult.status === 'fulfilled') {
        logger.info('ReactiveWorkspaceKernel stopped');
      } else {
        logger.error('Error stopping ReactiveWorkspaceKernel', {
          error:
            kernelResult.reason instanceof Error
              ? kernelResult.reason.message
              : String(kernelResult.reason),
        });
      }

      if (llmResult.status === 'fulfilled') {
        logger.info('LLM services cleaned up');
      } else {
        logger.debug('LLM cleanup skipped (not initialized)');
      }
    }

    if (process.platform !== 'darwin') {
      logger.info('Quitting application');
      app.quit();
    }
  })();
});

if (
  process.env.E2E_TEST !== 'true' &&
  process.env.NODE_ENV !== 'test' &&
  !process.argv.includes('--smoke-packaged-boot')
) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    const logger = getLogger();
    logger.warn('Another instance is already running, quitting');
    app.quit();
  } else {
    app.on('second-instance', () => {
      const logger = getLogger();
      logger.info('Second instance launch attempt, focusing existing window');
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
    });
  }
}

/**
 * Note: Error handling is now managed by ErrorHandler.
 * Unhandled rejections and uncaught exceptions are caught by ErrorHandler.initialize()
 */

/**
 * Note: IPC Handlers are registered in app.whenReady() callback above.
 * All handlers are imported from ./handlers/ipcHandlers.ts and registered
 * before the main window is created to ensure they're ready when the
 * renderer process starts making IPC calls.
 * 
 * Registered channels:
 * - FS:* (8 handlers) - File system operations
 * - NAV:* (4 handlers) - Navigation history
 * - SEARCH:* (2 handlers) - PathTrie autocomplete
 * - LLM:* (4 handlers) - Intelligence layer (stub)
 * 
 * Total: 18 IPC handlers
 */
