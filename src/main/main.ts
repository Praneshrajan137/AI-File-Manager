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
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

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
 * Create the main application window with security-hardened settings.
 * 
 * SECURITY CRITICAL:
 * - contextIsolation: true - Prevents renderer from accessing Node.js
 * - nodeIntegration: false - Disables Node.js in renderer
 * - sandbox: true - Runs renderer in OS-level sandbox
 * - preload script - Only way to expose controlled APIs to renderer
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      // CRITICAL SECURITY SETTINGS - DO NOT MODIFY
      contextIsolation: true,    // Isolate renderer from Node.js context
      nodeIntegration: false,     // Disable Node.js in renderer
      sandbox: true,              // Enable OS-level sandboxing
      
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
    title: 'Project-2 File Manager',
  });

  // Load application content
  if (isDevelopment) {
    // Development: Load from webpack dev server
    mainWindow.loadURL('http://localhost:8080');
    
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // Production: Load from built files
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready (prevents flash of white)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window close
  mainWindow.on('closed', () => {
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
      console.warn(`Blocked navigation to: ${url}`);
      event.preventDefault();
    }
  });

  // Security: Prevent opening new windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
}

/**
 * Application lifecycle: Ready
 * Called when Electron has finished initialization.
 */
app.whenReady().then(() => {
  createWindow();

  // macOS: Re-create window when dock icon clicked
  app.on('activate', () => {
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Single instance lock: Prevent multiple app instances.
 * If user tries to open second instance, focus existing window instead.
 */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

/**
 * Error Handling: Unhandled Promise Rejections
 * Log errors and prevent silent failures.
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
  // In production, you might want to log to file or error reporting service
});

/**
 * Error Handling: Uncaught Exceptions
 * Last resort error handler.
 */
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // In production, log to file and potentially restart app
});

/**
 * IPC Handlers will be registered here.
 * 
 * TODO: Import and register IPC handlers from src/main/handlers/ipcHandlers.ts
 * Example:
 * import { registerFileSystemHandlers } from './handlers/ipcHandlers';
 * registerFileSystemHandlers();
 */

// Placeholder IPC handler for testing
ipcMain.handle('ping', async () => {
  return 'pong';
});
