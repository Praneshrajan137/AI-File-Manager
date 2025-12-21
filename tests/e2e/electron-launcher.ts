/**
 * Electron Launcher for Playwright E2E Tests
 * 
 * This module provides utilities to launch and control Electron app
 * for end-to-end testing using Playwright's Electron support.
 */

import { ElectronApplication, Page, _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Launch Electron application for testing
 * 
 * @param options Launch options
 * @returns ElectronApplication instance
 */
export async function launchElectronApp(options: {
  args?: string[];
  env?: Record<string, string>;
} = {}): Promise<ElectronApplication> {
  const electronPath = getElectronPath();
  const mainPath = path.join(__dirname, '../../dist/main/main.js');
  
  // Ensure main process is built
  if (!fs.existsSync(mainPath)) {
    throw new Error(
      `Main process not built. Run 'npm run build:main' first.\n` +
      `Expected path: ${mainPath}\n` +
      `Current working directory: ${process.cwd()}`
    );
  }

  // Check if renderer is built (for production) or dev server is running
  const isDev = process.env.NODE_ENV === 'development' || 
                process.env.E2E_DEV_MODE === 'true';

  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [
      mainPath,
      // Disable GPU acceleration for CI environments
      '--disable-gpu',
      // Enable remote debugging for Playwright
      '--remote-debugging-port=9222',
      // Disable sandbox for testing (if needed)
      ...(process.env.CI ? ['--no-sandbox'] : []),
      ...(options.args || []),
    ],
    env: {
      NODE_ENV: isDev ? 'development' : 'test',
      E2E_TEST: 'true',
      ...options.env,
    },
    timeout: 60000, // 60 second timeout
  });

  return electronApp;
}

/**
 * Get the first window/page from Electron app
 * 
 * @param electronApp Electron application instance
 * @returns First window page
 */
export async function getFirstWindow(electronApp: ElectronApplication): Promise<Page> {
  // Wait for window to be created (with timeout)
  const window = await electronApp.firstWindow({ timeout: 30000 });
  
  // Wait for window to be ready
  await window.waitForLoadState('domcontentloaded');
  
  // Additional wait for React to mount
  await window.waitForTimeout(1000);
  
  return window;
}

/**
 * Get Electron executable path
 * 
 * @returns Path to Electron executable
 */
function getElectronPath(): string {
  // Try to find Electron in node_modules
  const possiblePaths = [
    path.join(__dirname, '../../node_modules/electron/dist/electron.exe'), // Windows
    path.join(__dirname, '../../node_modules/electron/dist/electron'), // Linux/macOS
    path.join(__dirname, '../../node_modules/.bin/electron'), // npm bin
  ];

  for (const electronPath of possiblePaths) {
    if (fs.existsSync(electronPath)) {
      return electronPath;
    }
  }

  // Fallback: try to use system electron
  return 'electron';
}

/**
 * Close Electron app and cleanup
 * 
 * @param electronApp Electron application instance
 */
export async function closeElectronApp(electronApp: ElectronApplication): Promise<void> {
  await electronApp.close();
}

