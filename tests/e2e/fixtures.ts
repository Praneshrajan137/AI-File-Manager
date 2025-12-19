/**
 * Playwright Test Fixtures for Electron
 * 
 * Custom fixtures that provide Electron app and page instances
 * to all tests automatically.
 */

import { test as base } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, getFirstWindow, closeElectronApp } from './electron-launcher';

/**
 * Extended test type with Electron fixtures
 */
type ElectronTestFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

/**
 * Extend base test with Electron fixtures
 */
export const test = base.extend<ElectronTestFixtures>({
  // Launch Electron app before each test
  electronApp: async ({}, use) => {
    const electronApp = await launchElectronApp();
    await use(electronApp);
    await closeElectronApp(electronApp);
  },

  // Get first window/page from Electron app
  page: async ({ electronApp }, use) => {
    const page = await getFirstWindow(electronApp);
    await use(page);
  },
});

export { expect } from '@playwright/test';
