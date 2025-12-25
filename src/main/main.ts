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

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from '@shared/config';
import { Logger, getLogger } from '@shared/logging';
import { ErrorHandler } from './middleware/ErrorHandler';
import { FileWatcher } from './services/FileWatcher';
import { EventQueue } from './dsa/EventQueue';

/**
 * Reference to main application window.
 * Kept at module level to prevent garbage collection.
 */
let mainWindow: BrowserWindow | null = null;

/**
 * Global FileWatcher instance.
 * Monitors file system changes and emits IPC events to renderer.
 */
let globalFileWatcher: FileWatcher | null = null;

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

  logger.info('Core systems initialized', {
    config: 'ready',
    logging: 'ready',
    errorHandling: 'ready',
  });
}

// Initialize systems before app is ready
initializeSystems();

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
      sandbox: config.get('security').enableSandbox, // Enable OS-level sandboxing (from config)

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

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only allow navigation to localhost in dev or file:// in prod
    const allowedOrigins = isDevelopment
      ? ['http://localhost:8080']
      : [`file://${__dirname}`];

    const urlObj = new URL(url);
    const isAllowed = allowedOrigins.some(origin => url.startsWith(origin));

    if (!isAllowed) {
      logger.warn('Blocked navigation attempt', { url, allowed: allowedOrigins });
      event.preventDefault();
    }
  });

  // Security: Prevent opening new windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    logger.warn('Blocked attempt to open new window');
    return { action: 'deny' };
  });

  logger.info('Main window created successfully');

  // Start file watcher after window is created
  startFileWatcher();
}

/**
 * Current watch path for dynamic file watching.
 * Updated when user navigates to a new directory.
 */
let currentWatchPath: string | null = null;

/**
 * Start global file watcher and connect it to IPC.
 * 
 * IMPORTANT: Does NOT auto-start watching. The watcher is started
 * dynamically when user navigates to a directory via IPC handler.
 * 
 * This prevents the critical bug of watching the entire home directory
 * which causes thousands of events and permission errors.
 */
function startFileWatcher(): void {
  const logger = getLogger();

  if (globalFileWatcher) {
    logger.warn('FileWatcher already initialized');
    return;
  }

  try {
    // Create event queue and file watcher
    const eventQueue = new EventQueue();
    globalFileWatcher = new FileWatcher(eventQueue);

    // Connect file watcher events to IPC
    globalFileWatcher.on('fileCreated', (filePath: string) => {
      logger.debug('File created, broadcasting to renderer', { path: filePath });
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('FILE_CREATED', filePath);
      });
    });

    globalFileWatcher.on('fileChanged', (filePath: string) => {
      logger.debug('File changed, broadcasting to renderer', { path: filePath });
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('FILE_CHANGED', filePath);
      });
    });

    globalFileWatcher.on('fileDeleted', (filePath: string) => {
      logger.debug('File deleted, broadcasting to renderer', { path: filePath });
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('FILE_DELETED', filePath);
      });
    });

    globalFileWatcher.on('error', (error: Error) => {
      // Log errors but don't crash - file watcher errors are non-fatal
      logger.warn('FileWatcher error (non-fatal)', {
        error: error.message,
      });
    });

    globalFileWatcher.on('ready', () => {
      logger.info('FileWatcher ready and monitoring', { path: currentWatchPath });
    });

    // NOTE: Do NOT auto-start watching home directory!
    // The watcher will be started dynamically when user navigates.
    logger.info('FileWatcher initialized (not started - waiting for navigation)');

  } catch (error) {
    logger.error('Failed to initialize FileWatcher', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update the watched directory when user navigates.
 * Called by IPC handlers when FS:READ_DIR is invoked.
 * 
 * @param newPath - The new directory to watch (single directory, not recursive)
 */
export async function updateWatchPath(newPath: string): Promise<void> {
  const logger = getLogger();

  if (!globalFileWatcher) {
    logger.warn('FileWatcher not initialized, cannot update watch path');
    return;
  }

  // Skip if already watching this path
  if (currentWatchPath === newPath) {
    return;
  }

  try {
    // Stop current watcher if running
    if (globalFileWatcher.isWatching()) {
      await globalFileWatcher.stop();
    }

    // Start watching the new path (non-recursive, single directory)
    currentWatchPath = newPath;
    await globalFileWatcher.start(newPath, {
      ignoreInitial: true,
      awaitWriteFinish: true,
      // CRITICAL: Only watch immediate directory, not subdirectories
      // depth: 0 is not directly supported, but we use ignored patterns
    });

    logger.info('FileWatcher updated to watch', { path: newPath });
  } catch (error) {
    logger.error('Failed to update FileWatcher path', {
      error: error instanceof Error ? error.message : String(error),
      path: newPath,
    });
  }
}

/**
 * Application lifecycle: Ready
 * Called when Electron has finished initialization.
 */
app.whenReady().then(() => {
  const logger = getLogger();
  logger.info('Electron app ready, registering IPC handlers and creating window');

  // CRITICAL: Register all IPC handlers BEFORE creating window
  // This ensures handlers are ready when renderer process starts
  try {
    const { registerAllHandlers } = require('./handlers/ipcHandlers');
    registerAllHandlers();
    logger.info('All IPC handlers registered successfully');
  } catch (error) {
    logger.error('Failed to register IPC handlers', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Don't create window if handlers failed to register
    throw error;
  }

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

  // Stop file watcher
  if (globalFileWatcher) {
    globalFileWatcher.stop().then(() => {
      logger.info('FileWatcher stopped');
    }).catch(error => {
      logger.error('Error stopping FileWatcher', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    globalFileWatcher = null;
  }

  // Cleanup LLM services (terminates worker threads)
  try {
    const { cleanupLLMServices } = require('./handlers/llmHandlers');
    cleanupLLMServices().then(() => {
      logger.info('LLM services cleaned up');
    }).catch((error: Error) => {
      logger.error('Error cleaning up LLM services', {
        error: error.message,
      });
    });
  } catch (error) {
    // LLM handlers may not be initialized
    logger.debug('LLM cleanup skipped (not initialized)');
  }

  if (process.platform !== 'darwin') {
    logger.info('Quitting application');
    app.quit();
  }
});

/**
 * Single instance lock: Prevent multiple app instances.
 * If user tries to open second instance, focus existing window instead.
 *
 * TEMPORARILY DISABLED FOR DEBUGGING
 */
// const gotTheLock = app.requestSingleInstanceLock();
// 
// if (!gotTheLock) {
//   const logger = getLogger();
//   logger.warn('Another instance is already running, quitting');
//   app.quit();
// } else {
//   app.on('second-instance', () => {
//     const logger = getLogger();
//     logger.info('Second instance launch attempt, focusing existing window');
//     
//     // Someone tried to run a second instance, focus our window
//     if (mainWindow) {
//       if (mainWindow.isMinimized()) {
//         mainWindow.restore();
//       }
//       mainWindow.focus();
//     }
//   });
// }

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
