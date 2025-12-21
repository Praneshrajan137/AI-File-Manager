/**
 * Playwright Configuration for Electron E2E Tests
 * 
 * This configuration sets up Playwright to test the Electron application
 * by launching Electron and connecting to it via Chrome DevTools Protocol.
 */

import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

/**
 * Path to the built Electron main process
 */
const electronMainPath = path.join(__dirname, 'dist/main/main.js');

/**
 * Path to the built Electron app (for production builds)
 */
const electronAppPath = path.join(__dirname, 'node_modules/.bin/electron');

/**
 * Determine if we should use development mode
 */
const isDevelopment = process.env.NODE_ENV === 'development';

export default defineConfig({
  testDir: './tests/e2e',
  
  // Timeout for each test
  timeout: 30 * 1000,
  
  // Expect timeout
  expect: {
    timeout: 5000,
  },
  
  // Run tests in parallel (but only 1 worker for Electron to avoid conflicts)
  fullyParallel: false,
  workers: 1,
  
  // Retry on failure
  retries: process.env.CI ? 2 : 0,
  
  // Reporter configuration
  reporter: [
    ['html'],
    ['list'],
  ],
  
  // Shared test options
  use: {
    // Base URL for navigation (not used for Electron, but required)
    baseURL: 'http://localhost:8080',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
    
    // Trace on failure
    trace: 'retain-on-failure',
  },

  // Projects configuration
  projects: [
    {
      name: 'electron',
      use: {
        // Custom launcher for Electron
        // We'll use a custom test setup to launch Electron via fixtures
      },
    },
  ],

  // Web server configuration (for development mode)
  webServer: isDevelopment ? {
    command: 'npm run dev:renderer',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  } : undefined,
});

