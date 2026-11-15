import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { DatabaseSync } from 'node:sqlite';
import { test, expect } from '@playwright/test';
import { closeElectronApp, getFirstWindow, launchElectronApp } from './electron-launcher';

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

function createValid1x1Png(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Scanline filter byte 0 + 1 RGBA pixel (#4F46E5FF)
  const rawScanline = Buffer.from([0x00, 0x4f, 0x46, 0xe5, 0xff]);
  const idat = zlib.deflateSync(rawScanline);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function seedKnowledgeGraphDatabase(
  vectorDbDir: string,
  filePath: string,
  chunkText: string,
  startLine: number,
  endLine: number
): void {
  const dbPath = path.join(vectorDbDir, 'knowledge-graph.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        file_type TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_char INTEGER NOT NULL,
        end_char INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        heading TEXT NOT NULL,
        chunk_text TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED,
        file_path,
        heading,
        chunk_text,
        tokenize = 'unicode61 tokenchars ''_'''
      );
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_number INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_path TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_number INTEGER NOT NULL
      );
    `);

    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO files (path, sha256, size, mtime_ms, file_type, chunk_count, token_estimate, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(filePath, 'seed-sha-spatial', 256, now, 'md', 1, 64, now);

    db.prepare(
      'INSERT OR REPLACE INTO chunks (id, file_path, chunk_index, start_char, end_char, start_line, end_line, heading, chunk_text, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('seed-chunk-0', filePath, 0, 0, chunkText.length, startLine, endLine, '## Architecture Notes', chunkText, now);

    db.prepare('INSERT INTO chunks_fts (chunk_id, file_path, heading, chunk_text) VALUES (?, ?, ?, ?)')
      .run('seed-chunk-0', filePath, '## Architecture Notes', chunkText);

    db.prepare('INSERT INTO symbols (file_path, symbol_name, kind, line_number) VALUES (?, ?, ?, ?)')
      .run(filePath, 'SpatialVectorProtocolToken', 'symbol', startLine);

    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    db.close();
  }
}

test.describe('Stage 4 Spatial UI & Security E2E', () => {
  test('supports Dark Slate theme, virtualized grid, multi-select, Spacebar QuickLook, vault-asset:// security, F6 Split-Pane, and Ctrl+K FTS5 citation jump', async () => {
    const rawTempBase = path.join(os.tmpdir(), `e2e-spatial-${Date.now()}`);
    await fs.mkdir(rawTempBase, { recursive: true });
    const tempBase = await fs.realpath(rawTempBase);
    const workspaceDir = path.join(tempBase, 'spatial-root');
    const destFolder = path.join(workspaceDir, 'dest-folder');
    const vectorDbDir = path.join(tempBase, 'vectordb');

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(destFolder, { recursive: true });
    await fs.mkdir(vectorDbDir, { recursive: true });

    const pngFile = path.join(workspaceDir, 'sample.png');
    const svgFile = path.join(workspaceDir, 'diagram.svg');
    const xssSvgFile = path.join(workspaceDir, 'xss-probe.svg');
    const notesFile = path.join(workspaceDir, 'notes.md');
    const binFile = path.join(workspaceDir, 'blob.bin');
    const alphaFile = path.join(workspaceDir, 'alpha.txt');
    const betaFile = path.join(workspaceDir, 'beta.txt');

    await fs.writeFile(pngFile, createValid1x1Png());
    await fs.writeFile(
      svgFile,
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#4f46e5"/></svg>',
      'utf-8'
    );
    await fs.writeFile(
      xssSvgFile,
      '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__xss=1;</script></svg>',
      'utf-8'
    );
    const noteLines = Array.from({ length: 24 }, (_, idx) => {
      const ln = idx + 1;
      if (ln === 17) return '## Architecture Notes';
      if (ln === 18) return 'Token: SpatialVectorProtocolToken line-18 verified sentinel.';
      return `Documentation line ${ln} for spatial explorer.`;
    });
    await fs.writeFile(notesFile, noteLines.join('\n'), 'utf-8');
    await fs.writeFile(binFile, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x42, 0x49, 0x4e]));
    await fs.writeFile(alphaFile, 'alpha', 'utf-8');
    await fs.writeFile(betaFile, 'beta', 'utf-8');

    seedKnowledgeGraphDatabase(
      vectorDbDir,
      notesFile,
      '## Architecture Notes\nToken: SpatialVectorProtocolToken line-18 verified sentinel.',
      17,
      20
    );

    const electronApp = await launchElectronApp({
      env: {
        FILE_MANAGER_VECTOR_DB_PATH: vectorDbDir,
      },
    });

    try {
      const page = await getFirstWindow(electronApp);
      await page.waitForLoadState('networkidle');

      // 1. Toggle Obsidian Dark Slate theme
      const themeBtn = page.locator('[data-testid="theme-toggle-button"]');
      await expect(themeBtn).toBeVisible({ timeout: 15000 });
      await themeBtn.click();
      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
      await themeBtn.click();
      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);

      // 2. Navigate to seeded spatial-root workspace
      await page.evaluate(async (dirPath: string) => {
        await window.electronAPI.fs.readDirectory(dirPath);
      }, tempBase);

      const searchInput = page.locator('[data-testid="search-input"]');
      await expect
        .poll(
          async () => (await page.evaluate(() => window.electronAPI.diagnostics.getSnapshot())).pathTrie.entryCount,
          { timeout: 10000 }
        )
        .toBeGreaterThan(0);

      await searchInput.fill('spatial-root');
      const option = page.locator('[role="listbox"] [role="option"]', { hasText: 'spatial-root' }).first();
      await expect(option).toBeVisible({ timeout: 10000 });
      await option.click();

      await expect(page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'sample.png' })).toBeVisible({
        timeout: 10000,
      });

      // 3. Switch to virtualized FixedSizeGrid and test Ctrl+Click multi-select
      await page.locator('button[aria-label="Grid view"]').click();
      const fileGrid = page.locator('[data-testid="file-grid"]');
      await expect(fileGrid).toBeVisible({ timeout: 10000 });

      const alphaCard = fileGrid.locator('[role="button"]', { hasText: 'alpha.txt' });
      const betaCard = fileGrid.locator('[role="button"]', { hasText: 'beta.txt' });
      await alphaCard.click();
      const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
      await betaCard.click({ modifiers: [modKey] });
      await expect(alphaCard).toHaveAttribute('aria-selected', 'true');
      await expect(betaCard).toHaveAttribute('aria-selected', 'true');

      // 4. Spacebar QuickLook on PNG via vault-asset:// & SVG & binary fallback
      const pngCard = fileGrid.locator('[role="button"]', { hasText: 'sample.png' });
      await pngCard.click();
      await page.keyboard.press('Space');

      const previewDrawer = page.locator('[data-testid="file-preview-drawer"]');
      await expect(previewDrawer).toBeVisible({ timeout: 10000 });
      const previewImg = page.locator('[data-testid="preview-asset-image"]');
      await expect(previewImg).toBeVisible({ timeout: 10000 });
      await expect
        .poll(
          async () =>
            previewImg.evaluate((el) => {
              const img = el as HTMLImageElement;
              return img.complete && img.naturalWidth > 0 && img.src.startsWith('vault-asset://local/file?path=');
            }),
          { timeout: 10000 }
        )
        .toBe(true);

      // Toggle off with Spacebar
      await page.keyboard.press('Space');
      await expect(previewDrawer).toBeHidden();

      // SVG preview renders
      await fileGrid.locator('[role="button"]', { hasText: 'diagram.svg' }).click();
      await page.keyboard.press('Space');
      await expect(previewImg).toBeVisible({ timeout: 10000 });
      await page.locator('[data-testid="preview-close"]').click();
      await expect(previewDrawer).toBeHidden();

      // Binary preview preserves binary notice rather than media error
      await fileGrid.locator('[role="button"]', { hasText: 'blob.bin' }).click();
      await page.keyboard.press('Space');
      await expect(page.locator('[data-testid="preview-binary-notice"]')).toBeVisible({ timeout: 10000 });
      await page.locator('[data-testid="preview-close"]').click();

      // Protocol security verification inside real Electron main session
      const outsideUrl = `vault-asset://local/file?path=${encodeURIComponent(
        process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/hosts'
      )}`;
      const xssUrl = `vault-asset://local/file?path=${encodeURIComponent(xssSvgFile.replace(/\\/g, '/'))}`;
      const protocolChecks = await electronApp.evaluate(
        async ({ net }, urls: { outsideUrl: string; xssUrl: string }) => {
          const blockedRes = await net.fetch(urls.outsideUrl);
          const svgRes = await net.fetch(urls.xssUrl);
          return {
            blockedStatus: blockedRes.status,
            svgStatus: svgRes.status,
            svgCsp: svgRes.headers.get('content-security-policy'),
            svgNosniff: svgRes.headers.get('x-content-type-options'),
          };
        },
        { outsideUrl, xssUrl }
      );
      expect(protocolChecks.blockedStatus).toBe(403);
      expect(protocolChecks.svgStatus).toBe(200);
      expect(protocolChecks.svgCsp).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
      expect(protocolChecks.svgNosniff).toBe('nosniff');

      // 5. F6 Split-Pane Dual Explorer navigation
      await page.keyboard.press('F6');
      const rightPane = page.locator('[data-testid="split-pane-right"]');
      await expect(rightPane).toBeVisible({ timeout: 5000 });
      const rightDestFolder = rightPane.locator('[role="button"]', { hasText: 'dest-folder' });
      await expect(rightDestFolder).toBeVisible({ timeout: 5000 });
      await rightDestFolder.dblclick();
      await expect(page.locator('[data-testid="split-pane-path"]')).toContainText('dest-folder', {
        timeout: 10000,
      });
      await page.locator('[data-testid="split-pane-close"]').click();
      await expect(rightPane).toBeHidden();

      // 6. Ctrl+K CommandOmnibar -> Content tab -> FTS5 search -> #Lx-Ly Citation Inspector jump
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      const omnibar = page.locator('[data-testid="command-omnibar"]');
      await expect(omnibar).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="omnibar-graph-stats"]')).toContainText('1 files / 1 chunks');

      await page.locator('[data-testid="omnibar-tab-content"]').click();
      await page.locator('[data-testid="omnibar-input"]').fill('SpatialVectorProtocolToken');

      const contentHit = page.locator('[data-testid="omnibar-content-result"]', { hasText: 'notes.md' }).first();
      await expect(contentHit).toBeVisible({ timeout: 10000 });
      await contentHit.click();

      await expect(omnibar).toBeHidden();
      await expect(previewDrawer).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="preview-citation-badge"]')).toContainText('Citation L17-L20');
      const lineRangePane = page.locator('[data-testid="preview-line-range"]');
      await expect(lineRangePane).toBeVisible();
      await expect(lineRangePane.locator('[data-highlighted="true"]', { hasText: 'SpatialVectorProtocolToken' })).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await fs.rm(tempBase, { recursive: true, force: true }).catch(() => {});
    }
  });
});
