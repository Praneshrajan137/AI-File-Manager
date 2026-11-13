/**
 * Electron Launcher for Playwright E2E Tests
 * 
 * This module provides utilities to launch and control Electron app
 * for end-to-end testing using Playwright's Electron support.
 */

import { ElectronApplication, Page, _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const appLogs = new WeakMap<ElectronApplication, string[]>();
const appSandboxDirs = new WeakMap<ElectronApplication, string>();
const appExitFailures = new WeakMap<ElectronApplication, string>();
const MAX_LOG_LINES = 80;

function recordAppLog(buffer: string[], stream: 'stdout' | 'stderr', chunk: Buffer | string): void {
  const lines = String(chunk)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    buffer.push(`[${stream}] ${line}`);
    if (buffer.length > MAX_LOG_LINES) {
      buffer.shift();
    }
  }
}

/**
 * Retrieve captured recent stdout/stderr lines from an Electron test instance.
 */
export function getElectronAppLogs(electronApp: ElectronApplication): string[] {
  return [...(appLogs.get(electronApp) ?? [])];
}

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

  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osfm-e2e-home-'));
  const userDataDir = path.join(sandboxDir, 'chromium-user-data');
  const appDataDir = path.join(sandboxDir, 'AppData', 'Roaming');
  const localAppDataDir = path.join(sandboxDir, 'AppData', 'Local');
  const defaultVectorDbDir = path.join(sandboxDir, 'vectordb');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(localAppDataDir, { recursive: true });

  const allowedRoots =
    options.env?.FILE_MANAGER_ALLOWED_ROOTS ||
    process.env.FILE_MANAGER_ALLOWED_ROOTS ||
    [sandboxDir, os.tmpdir()].join(path.delimiter);

  const launchEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      launchEnv[key] = value;
    }
  }

  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [
      mainPath,
      `--user-data-dir=${userDataDir}`,
      // Disable GPU acceleration for CI environments
      '--disable-gpu',
      // Disable sandbox for testing (if needed)
      ...(process.env.CI ? ['--no-sandbox'] : []),
      ...(options.args || []),
    ],
    env: {
      ...launchEnv,
      NODE_ENV: isDev ? 'development' : 'test',
      E2E_TEST: 'true',
      HOME: sandboxDir,
      USERPROFILE: sandboxDir,
      APPDATA: appDataDir,
      LOCALAPPDATA: localAppDataDir,
      FILE_MANAGER_VECTOR_DB_PATH: defaultVectorDbDir,
      FILE_MANAGER_ALLOWED_ROOTS: allowedRoots,
      ...options.env,
    },
    timeout: 60000, // 60 second timeout
  });

  const logBuffer: string[] = [];
  appLogs.set(electronApp, logBuffer);
  appSandboxDirs.set(electronApp, sandboxDir);
  const child = electronApp.process();
  if (child) {
    child.stdout?.on('data', (chunk) => recordAppLog(logBuffer, 'stdout', chunk));
    child.stderr?.on('data', (chunk) => recordAppLog(logBuffer, 'stderr', chunk));
    child.once('exit', (code, signal) => {
      if ((code !== null && code !== 0) || signal !== null) {
        appExitFailures.set(
          electronApp,
          `Electron process exited unexpectedly (code=${String(code)}, signal=${String(signal)})`
        );
      }
    });
  }

  return electronApp;
}

/**
 * Get the first window/page from Electron app
 * 
 * @param electronApp Electron application instance
 * @returns First window page
 */
export async function getFirstWindow(electronApp: ElectronApplication): Promise<Page> {
  let window: Page;
  try {
    // Wait for window to be created (with timeout)
    window = await electronApp.firstWindow({ timeout: 30000 });
  } catch (error) {
    const recentLogs = getElectronAppLogs(electronApp);
    const baseMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${baseMessage}\nRecent Electron process logs:\n${
        recentLogs.length > 0 ? recentLogs.join('\n') : '(no output captured)'
      }`
    );
  }
  
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
  const sandboxDir = appSandboxDirs.get(electronApp);
  const child = electronApp.process();

  try {
    if (!child || child.exitCode === null) {
      await electronApp.close();
    }

    const unexpectedFailure = appExitFailures.get(electronApp);
    if (unexpectedFailure) {
      const recentLogs = getElectronAppLogs(electronApp);
      throw new Error(
        `${unexpectedFailure}\nRecent Electron process logs:\n${
          recentLogs.length > 0 ? recentLogs.join('\n') : '(no output captured)'
        }`
      );
    }
  } finally {
    if (sandboxDir) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  }
}


