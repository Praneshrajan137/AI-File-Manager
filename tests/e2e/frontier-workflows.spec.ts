import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from './fixtures';
import { closeElectronApp, getFirstWindow, launchElectronApp } from './electron-launcher';

test.describe('Frontier Workflows E2E', () => {
  test('complete UI file lifecycle, bounded preview cache, live OS watcher refresh, and kernel diagnostics', async ({
    page,
  }) => {
    const rawTempBase = path.join(os.tmpdir(), `e2e-frontier-${Date.now()}`);
    await fs.mkdir(rawTempBase, { recursive: true });
    const tempBase = await fs.realpath(rawTempBase);
    const frontierRoot = path.join(tempBase, 'frontier-root');
    const logFile = path.join(frontierRoot, 'service.log');
    const binaryFile = path.join(frontierRoot, 'blob.bin');
    const alphaFile = path.join(frontierRoot, 'alpha.txt');
    const zetaFile = path.join(frontierRoot, 'zeta.txt');

    await fs.mkdir(frontierRoot, { recursive: true });
    await fs.writeFile(
      logFile,
      Array.from({ length: 130 }, (_, idx) => `line-${String(idx + 1).padStart(3, '0')} diagnostic entry`).join('\n'),
      'utf-8'
    );
    await fs.writeFile(binaryFile, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x42, 0x49, 0x4e]));
    await fs.writeFile(alphaFile, 'alpha payload', 'utf-8');
    await fs.writeFile(zetaFile, 'zeta payload', 'utf-8');

    try {
      await page.waitForLoadState('networkidle');
      const searchInput = page.locator('[data-testid="search-input"]');
      await expect(searchInput).toBeVisible({ timeout: 15000 });

      // 1. Warm PathTrie with tempBase and navigate into frontier-root through the UI SearchBar
      await page.evaluate(async (dirPath: string) => {
        await window.electronAPI.fs.readDirectory(dirPath);
      }, tempBase);

      await expect
        .poll(
          async () => {
            const snap = await page.evaluate(() => window.electronAPI.diagnostics.getSnapshot());
            return snap.pathTrie.entryCount;
          },
          { timeout: 10000 }
        )
        .toBeGreaterThan(0);

      await searchInput.fill('frontier-root');
      const option = page.locator('[role="listbox"] [role="option"]', { hasText: 'frontier-root' }).first();
      await expect(option).toBeVisible({ timeout: 10000 });
      await option.click();

      const fileList = page.locator('[data-testid="file-list"]');
      await expect(fileList).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'service.log' })
      ).toBeVisible({ timeout: 10000 });

      // Ensure kernel FileWatcher is actively watching frontierRoot
      await expect
        .poll(
          async () => {
            const snap = await page.evaluate(() => window.electronAPI.diagnostics.getSnapshot());
            return (
              snap.watcher.status === 'watching' &&
              (snap.watcher.watchedPath ?? '').toLowerCase() === path.resolve(frontierRoot).toLowerCase()
            );
          },
          { timeout: 10000, intervals: [100, 200, 300] }
        )
        .toBe(true);

      // 2. Create directory & file via real toolbar dialogs
      await page.locator('[data-testid="new-folder-button"]').click();
      await expect(page.locator('[data-testid="create-entry-dialog"]')).toBeVisible();
      await page.locator('[data-testid="create-entry-input"]').fill('sub-workspace');
      await page.locator('[data-testid="create-entry-confirm"]').click();

      await expect(
        page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'sub-workspace' })
      ).toBeVisible({ timeout: 10000 });
      expect((await fs.stat(path.join(frontierRoot, 'sub-workspace'))).isDirectory()).toBe(true);

      await page.locator('[data-testid="new-file-button"]').click();
      await expect(page.locator('[data-testid="create-entry-dialog"]')).toBeVisible();
      await page.locator('[data-testid="create-entry-input"]').fill('created-ui.txt');
      await page.locator('[data-testid="create-entry-confirm"]').click();

      await expect(
        page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'created-ui.txt' })
      ).toBeVisible({ timeout: 10000 });
      expect((await fs.stat(path.join(frontierRoot, 'created-ui.txt'))).isFile()).toBe(true);

      // 3. ViewMode toggle (List <-> Grid)
      await page.locator('[aria-label="Grid view"]').click();
      await expect(page.locator('[data-testid="file-grid"]')).toBeVisible({ timeout: 5000 });
      await expect(
        page.locator('[data-testid="file-grid"] [role="button"]', { hasText: 'created-ui.txt' })
      ).toBeVisible();

      await page.locator('[aria-label="List view"]').click();
      await expect(page.locator('[data-testid="file-list"]')).toBeVisible({ timeout: 5000 });

      // 4. Sort direction toggle (asc vs desc)
      const getListOrderText = async (): Promise<string[]> =>
        page.locator('[data-testid="file-list"] [role="button"]').allInnerTexts();

      await expect
        .poll(async () => {
          const items = await getListOrderText();
          const a = items.findIndex((t) => t.includes('alpha.txt'));
          const z = items.findIndex((t) => t.includes('zeta.txt'));
          return a >= 0 && z > a;
        })
        .toBe(true);

      await page.locator('[data-testid="sort-direction-toggle"]').click();
      await expect
        .poll(async () => {
          const items = await getListOrderText();
          const a = items.findIndex((t) => t.includes('alpha.txt'));
          const z = items.findIndex((t) => t.includes('zeta.txt'));
          return z >= 0 && a > z;
        })
        .toBe(true);

      // Restore ascending sort order
      await page.locator('[data-testid="sort-direction-toggle"]').click();

      // 5. FilePreviewDrawer: RingBuffer(100), Capped, LRUCache HIT on reopen, and Binary notice
      await page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'service.log' }).click();
      const previewButton = page.locator('[data-testid="preview-button"]');
      await expect(previewButton).toBeEnabled();
      await previewButton.click();

      const previewDrawer = page.locator('[data-testid="file-preview-drawer"]');
      await expect(previewDrawer).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="preview-cache-badge"]')).toContainText('RingBuffer(100)');
      await expect(previewDrawer).toContainText('Capped');

      const previewLines = page.locator('[data-testid="preview-lines"]');
      await expect(previewLines).toContainText('line-130 diagnostic entry');
      await expect(previewLines).not.toContainText('line-001 diagnostic entry');

      await page.locator('[data-testid="preview-close"]').click();
      await expect(previewDrawer).toBeHidden();

      // Reopen via Alt+P shortcut and verify LRUCache HIT
      await page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'service.log' }).click();
      await page.keyboard.press('Alt+p');
      await expect(previewDrawer).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="preview-cache-badge"]')).toContainText('LRUCache HIT');

      // Open binary file in drawer and verify binary guard notice
      await page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'blob.bin' }).click();
      await page.locator('[data-testid="preview-button"]').click();
      await expect(page.locator('[data-testid="preview-binary-notice"]')).toBeVisible({ timeout: 5000 });
      await page.locator('[data-testid="preview-close"]').click();
      await expect(previewDrawer).toBeHidden();

      // 5b. Editable target shortcut guard + PathTrie file suggestion preview flow
      await page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'alpha.txt' }).click();
      await searchInput.click();
      await page.keyboard.press('Delete');
      expect((await fs.stat(alphaFile)).isFile()).toBe(true);

      await searchInput.fill('alpha.txt');
      const alphaSuggestion = page
        .locator('[role="listbox"][aria-label="Search suggestions"] [role="option"]', {
          hasText: 'alpha.txt',
        })
        .first();
      await expect(alphaSuggestion).toBeVisible({ timeout: 5000 });
      await alphaSuggestion.click();

      await expect(previewDrawer).toBeVisible({ timeout: 5000 });
      await expect(previewLines).toContainText('alpha payload');
      await page.locator('[data-testid="preview-close"]').click();
      await expect(previewDrawer).toBeHidden();
      await searchInput.fill('');
      await searchInput.press('Enter');

      // 6. Live external FS creation -> auto UI refresh & Windows-safe basename toast
      await page.waitForTimeout(250);
      await fs.writeFile(path.join(frontierRoot, 'external-signal.txt'), 'watcher signal', 'utf-8');

      await expect(
        page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'external-signal.txt' })
      ).toBeVisible({ timeout: 10000 });

      const toastLocator = page.locator('[role="alert"], .toast, [data-testid="toast"]', {
        hasText: 'external-signal.txt',
      });
      await expect(toastLocator.first()).toBeVisible({ timeout: 5000 });
      const toastText = await toastLocator.first().innerText();
      expect(toastText).toMatch(/File (create|change): external-signal\.txt/);
      expect(toastText).not.toContain('\\');
      expect(toastText).not.toContain('/');

      // 7. DiagnosticsModal live telemetry check
      await page.locator('[data-testid="diagnostics-button"]').click();
      const diagnosticsModal = page.locator('[data-testid="diagnostics-modal"]');
      await expect(diagnosticsModal).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="diagnostics-watcher-status"]')).toHaveText('watching');
      await expect(page.locator('[data-testid="diagnostics-trie-entries"]')).toHaveText(/^[1-9]\d*\s+\(/);
      await expect(page.locator('[data-testid="diagnostics-preview-count"]')).toHaveText(
        /^[1-9]\d*\s+served\s+\([1-9]\d*\s+hits\)/
      );
      await expect(page.locator('[data-testid="diagnostics-ipc-totals"]')).toHaveText(/^[1-9]\d*\s+calls/);

      await page.locator('[data-testid="diagnostics-refresh"]').click();
      await expect(page.locator('[data-testid="diagnostics-watcher-status"]')).toHaveText('watching');

      await page.keyboard.press('Escape');
      await expect(diagnosticsModal).toBeHidden();
    } finally {
      await fs.rm(tempBase, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('rejects canonical symlink/junction escape outside allowed roots across fs and shell IPC', async ({
    page,
  }) => {
    const escapeRoot = path.join(os.tmpdir(), `e2e-junction-escape-${Date.now()}`);
    const linkDir = path.join(escapeRoot, 'escape-link');
    const outsideDir = process.platform === 'win32' ? process.env.SystemRoot || 'C:\\Windows' : '/etc';
    const outsideFileName = process.platform === 'win32' ? 'win.ini' : 'hosts';
    const hostTargetFile = path.join(outsideDir, outsideFileName);

    const hostStats = await fs.stat(hostTargetFile);
    expect(hostStats.isFile()).toBe(true);

    await fs.mkdir(escapeRoot, { recursive: true });
    await fs.symlink(outsideDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');

    try {
      await page.waitForLoadState('networkidle');
      const escapedFilePath = path.join(linkDir, outsideFileName);

      const results = await page.evaluate(
        async ({ targetFile, targetDir }: { targetFile: string; targetDir: string }) => {
          const readFileAttempt = await window.electronAPI.fs
            .readFile(targetFile)
            .then(() => ({ allowed: true, error: null }))
            .catch((err: unknown) => ({
              allowed: false,
              error: err instanceof Error ? err.message : String(err),
            }));

          const readDirAttempt = await window.electronAPI.fs
            .readDirectory(targetDir)
            .then(() => ({ allowed: true, error: null }))
            .catch((err: unknown) => ({
              allowed: false,
              error: err instanceof Error ? err.message : String(err),
            }));

          const openPathAttempt = await window.electronAPI.shell
            .openPath(targetFile)
            .then((res) => ({
              allowed: Boolean(res && res.success),
              error: res?.error ?? null,
            }))
            .catch((err: unknown) => ({
              allowed: false,
              error: err instanceof Error ? err.message : String(err),
            }));

          return { readFileAttempt, readDirAttempt, openPathAttempt };
        },
        { targetFile: escapedFilePath, targetDir: linkDir }
      );

      expect(results.readFileAttempt.allowed).toBe(false);
      expect(results.readFileAttempt.error).toBeTruthy();

      expect(results.readDirAttempt.allowed).toBe(false);
      expect(results.readDirAttempt.error).toBeTruthy();

      expect(results.openPathAttempt.allowed).toBe(false);
    } finally {
      await fs.unlink(linkDir).catch(() => {});
      await fs.rm(escapeRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('indexes files, retrieves via hybrid RAG into ephemeral mock Ollama, streams UI chat reply, and persists chat across close/reopen', async () => {
    const aiRoot = path.join(os.tmpdir(), `e2e-frontier-ai-${Date.now()}`);
    const docsDir = path.join(aiRoot, 'docs');
    const vectorDbDir = path.join(aiRoot, 'lancedb');
    const alphaFile = path.join(docsDir, 'alpha-protocol.txt');
    const generalFile = path.join(docsDir, 'general.txt');

    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(vectorDbDir, { recursive: true });
    await fs.writeFile(
      alphaFile,
      'Project telemetry authorization code: ALPHA_PROTOCOL_771. Lookup latency ceiling is 12ms.',
      'utf-8'
    );
    await fs.writeFile(
      generalFile,
      'Weekly workspace layout notes covering font weights and padding tokens.',
      'utf-8'
    );

    const capturedChatPrompts: string[] = [];
    const mockServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3.2' }] }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/chat') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          const parsed = JSON.parse(body) as {
            model?: string;
            messages?: Array<{ role: string; content: string }>;
          };
          const combinedMessages = (parsed.messages ?? []).map((m) => m.content).join('\n');
          capturedChatPrompts.push(combinedMessages);

          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          res.write(
            JSON.stringify({
              model: parsed.model ?? 'llama3.2',
              message: { role: 'assistant', content: 'ALPHA_PROTOCOL_771 ' },
              done: false,
            }) + '\n'
          );
          res.write(
            JSON.stringify({
              model: parsed.model ?? 'llama3.2',
              message: { role: 'assistant', content: 'verified locally.' },
              done: true,
            }) + '\n'
          );
          res.end();
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
    const address = mockServer.address();
    if (!address || typeof address === 'string') {
      mockServer.close();
      throw new Error('Failed to bind ephemeral localhost mock Ollama server');
    }
    const mockOllamaUrl = `http://127.0.0.1:${address.port}`;

    let electronApp: Awaited<ReturnType<typeof launchElectronApp>> | null = null;
    try {
      electronApp = await launchElectronApp({
        env: {
          OLLAMA_URL: mockOllamaUrl,
          FILE_MANAGER_VECTOR_DB_PATH: vectorDbDir,
          FILE_MANAGER_ALLOWED_ROOTS: aiRoot,
        },
      });
      const page = await getFirstWindow(electronApp);
      await page.waitForLoadState('networkidle');

      // 1. Verify Ollama connectivity via IPC -> LLMInterface
      const ollamaStatus = await page.evaluate(() => window.electronAPI.llm.checkOllama());
      expect(ollamaStatus.available).toBe(true);
      expect(ollamaStatus.models).toContain('llama3.2');

      // 2. Index files into isolated LanceDB + HybridLexicalIndex
      const alphaRes = await page.evaluate((p: string) => window.electronAPI.llm.indexFile(p), alphaFile);
      const generalRes = await page.evaluate((p: string) => window.electronAPI.llm.indexFile(p), generalFile);
      expect(alphaRes.success).toBe(true);
      expect(generalRes.success).toBe(true);


      // 3. Open Chat Panel, send RAG query, verify streaming reply renders
      const chatToggle = page.locator('[data-testid="chat-toggle-button"]');
      await expect(chatToggle).toBeVisible({ timeout: 10000 });
      await chatToggle.click();

      const chatInput = page.locator('[data-testid="chat-input"]');
      await expect(chatInput).toBeVisible({ timeout: 5000 });
      await chatInput.fill('What is ALPHA_PROTOCOL_771?');
      await page.locator('[data-testid="send-button"]').click();

      const chatMessages = page.locator('[data-testid="chat-messages"]');
      await expect(chatMessages).toContainText('What is ALPHA_PROTOCOL_771?', { timeout: 15000 });
      await expect(chatMessages).toContainText('ALPHA_PROTOCOL_771 verified locally.', { timeout: 15000 });

      // 4. Confirm RAG context actually flowed into mock Ollama prompt
      expect(capturedChatPrompts.some((p) => p.includes('ALPHA_PROTOCOL_771') && p.includes('12ms'))).toBe(true);

      // 5. Close and reopen Chat Panel -> messages remain persisted via lifted useLLM state
      await chatToggle.click();
      await expect(page.locator('[data-testid="chat-panel-container"]')).toBeHidden();
      await chatToggle.click();
      await expect(page.locator('[data-testid="chat-panel-container"]')).toBeVisible();
      await expect(chatMessages).toContainText('ALPHA_PROTOCOL_771 verified locally.');

      // 6. Verify diagnostics snapshot reflects indexed files & successful LLM execution
      const finalSnapshot = await page.evaluate(() => window.electronAPI.diagnostics.getSnapshot());
      expect(finalSnapshot.vectorStore.initialized).toBe(true);
      expect(finalSnapshot.vectorStore.indexedFiles).toBeGreaterThanOrEqual(2);
      expect(finalSnapshot.llm.successfulQueries).toBeGreaterThanOrEqual(1);
    } finally {
      if (electronApp) {
        await closeElectronApp(electronApp);
      }
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
      await fs.rm(aiRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('spatial workspace lenses, split-pane copy, deduplicate + undo, offline synthesis fallback, and diagnostics MCP snippet', async () => {
    test.setTimeout(120000);

    // Bind and immediately close an ephemeral TCP port so Ollama fails fast (ECONNREFUSED)
    const closedServer = http.createServer((_req, res) => {
      res.writeHead(503);
      res.end();
    });
    await new Promise<void>((resolve) => closedServer.listen(0, '127.0.0.1', () => resolve()));
    const closedAddress = closedServer.address();
    const unreachablePort = typeof closedAddress === 'object' && closedAddress ? closedAddress.port : 19998;
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));

    const rawTempBase = path.join(os.tmpdir(), `e2e-spatial-${Date.now()}`);
    await fs.mkdir(rawTempBase, { recursive: true });
    const tempBase = await fs.realpath(rawTempBase);
    const spatialRootName = 'spatial-vault';
    const spatialRoot = path.join(tempBase, spatialRootName);
    const destFolder = path.join(spatialRoot, 'dest-folder');
    const authGuide = path.join(spatialRoot, 'auth-guide.md');
    const policyDoc = path.join(spatialRoot, 'notes-policy.md');
    const dupA = path.join(spatialRoot, 'dup-a.txt');
    const dupB = path.join(spatialRoot, 'dup-b.txt');
    const vectorDbDir = path.join(tempBase, 'vectordb');

    await fs.mkdir(destFolder, { recursive: true });
    await fs.writeFile(
      authGuide,
      [
        '# Authentication Architecture',
        '',
        'Session handling calls `verifyAccessToken` with strict signature checks.',
        'See [Security Policy](./notes-policy.md) for key rotation.',
      ].join('\n'),
      'utf-8'
    );
    await fs.writeFile(
      policyDoc,
      [
        '# Security Policy',
        '',
        'Rotate signing keys quarterly before calling `verifyAccessToken`.',
      ].join('\n'),
      'utf-8'
    );
    const dupPayload = 'Identical archive content for SHA-256 deduplicate reclaim check.\n'.repeat(3);
    await fs.writeFile(dupA, dupPayload, 'utf-8');
    await fs.writeFile(dupB, dupPayload, 'utf-8');

    let electronApp;
    try {
      electronApp = await launchElectronApp({
        env: {
          OLLAMA_URL: `http://127.0.0.1:${unreachablePort}`,
          FILE_MANAGER_VECTOR_DB_PATH: vectorDbDir,
          FILE_MANAGER_ALLOWED_ROOTS: [tempBase, spatialRoot].join(path.delimiter),
        },
      });
      const page = await getFirstWindow(electronApp);
      await page.waitForLoadState('networkidle');

      // 1. Navigate to spatialRoot via PathTrie-warmed SearchBar
      const searchInput = page.locator('[data-testid="search-input"]');
      await expect(searchInput).toBeVisible({ timeout: 15000 });
      await page.evaluate(async (parentDir: string) => {
        await window.electronAPI.fs.readDirectory(parentDir);
      }, tempBase);

      await expect
        .poll(
          async () => {
            const snap = await page.evaluate(() => window.electronAPI.diagnostics.getSnapshot());
            return snap.pathTrie.entryCount;
          },
          { timeout: 10000 }
        )
        .toBeGreaterThan(0);

      await searchInput.fill(spatialRootName);
      const option = page.locator('[role="listbox"] [role="option"]', { hasText: spatialRootName }).first();
      await expect(option).toBeVisible({ timeout: 10000 });
      await option.click();
      await expect(
        page.locator('[data-testid="file-explorer"] [role="button"]', { hasText: 'auth-guide.md' })
      ).toBeVisible({ timeout: 10000 });

      // 2. Index docs + identical duplicates into VectorStore & Knowledge Graph
      for (const filePath of [authGuide, policyDoc, dupA, dupB]) {
        const res = await page.evaluate((p: string) => window.electronAPI.llm.indexFile(p), filePath);
        expect(res.success).toBe(true);
      }

      // 3. Spatial Lenses: Graph -> Collections -> Duplicates -> Files
      await page.locator('[data-testid="lens-tab-graph"]').click();
      await expect(page.locator('[data-testid="knowledge-graph-canvas"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="knowledge-graph-svg"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="graph-node-auth-guide.md"]')).toBeVisible({ timeout: 10000 });

      await page.locator('[data-testid="lens-tab-collections"]').click();
      await expect(page.locator('[data-testid="smart-collections-lens"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid^="collection-card-"]').first()).toBeVisible({ timeout: 10000 });

      await page.locator('[data-testid="lens-tab-duplicates"]').click();
      await expect(page.locator('[data-testid="duplicate-reclaim-lens"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="duplicate-cluster-card"]').first()).toBeVisible({ timeout: 10000 });

      await page.locator('[data-testid="lens-tab-files"]').click();
      await expect(page.locator('[data-testid="file-explorer"]')).toBeVisible({ timeout: 10000 });

      // 4. Split-Pane Dual Explorer: open, navigate right pane into dest-folder, copy selected file
      await page.locator('[data-testid="split-pane-button"]').click();
      const rightPane = page.locator('[data-testid="split-pane-right"]');
      await expect(rightPane).toBeVisible({ timeout: 10000 });
      await rightPane.locator('[role="button"]', { hasText: 'dest-folder' }).first().dblclick();
      await expect(page.locator('[data-testid="split-pane-path"]')).toContainText('dest-folder', { timeout: 10000 });

      await page.locator('[data-testid="file-explorer"] [role="button"]', { hasText: 'auth-guide.md' }).first().click();
      await page.locator('[data-testid="split-pane-copy-button"]').click();
      await expect
        .poll(
          async () =>
            fs
              .stat(path.join(destFolder, 'auth-guide.md'))
              .then((s) => s.isFile())
              .catch(() => false),
          { timeout: 10000 }
        )
        .toBe(true);
      expect((await fs.stat(authGuide)).isFile()).toBe(true);
      await page.locator('[data-testid="split-pane-close"]').click();
      await expect(rightPane).toHaveCount(0);

      // 5. Dry-Run Deduplicate Organizer with Markdown link repair toggle + Undo restore
      await page.locator('[data-testid="toolbar-organize-button"]').click();
      await expect(page.locator('[data-testid="dry-run-plan-modal"]')).toBeVisible({ timeout: 10000 });
      await page.locator('[data-testid="plan-strategy-select"]').selectOption('deduplicate');
      await expect(page.locator('[data-testid="plan-summary"]')).toContainText('Duplicates Archive', {
        timeout: 10000,
      });
      const repairCheckbox = page.locator('[data-testid="plan-repair-links-checkbox"]');
      if (!(await repairCheckbox.isChecked())) {
        await repairCheckbox.check();
      }
      const applyBtn = page.locator('[data-testid="plan-apply-button"]');
      await expect(applyBtn).toBeEnabled({ timeout: 10000 });
      await applyBtn.click();

      await expect
        .poll(
          async () => {
            const existsA = await fs.stat(dupA).then(() => true).catch(() => false);
            const existsB = await fs.stat(dupB).then(() => true).catch(() => false);
            return Number(existsA) + Number(existsB);
          },
          { timeout: 10000 }
        )
        .toBe(1);

      const undoBtn = page.locator('[data-testid="undo-button"]');
      await expect(undoBtn).toBeEnabled({ timeout: 10000 });
      await undoBtn.click();
      await expect
        .poll(
          async () => {
            const existsA = await fs.stat(dupA).then(() => true).catch(() => false);
            const existsB = await fs.stat(dupB).then(() => true).catch(() => false);
            return existsA && existsB;
          },
          { timeout: 10000 }
        )
        .toBe(true);

      // 6. Offline Synthesis fallback when local Ollama endpoint refuses connection
      await page.locator('[data-testid="chat-toggle-button"]').click();
      const chatInput = page.locator('[data-testid="chat-input"]');
      await expect(chatInput).toBeVisible({ timeout: 10000 });
      await chatInput.fill('What does verifyAccessToken do?');
      await page.locator('[data-testid="send-button"]').click();

      const chatMessages = page.locator('[data-testid="chat-messages"]');
      await expect(chatMessages.locator('[data-testid="offline-synthesis-badge"]')).toBeVisible({
        timeout: 20000,
      });
      await expect(chatMessages).toContainText('verifyAccessToken', { timeout: 10000 });

      // 7. Diagnostics Modal: ONNX EP, LLM Provider, and Read-Only MCP Config Snippet
      await page.locator('[data-testid="diagnostics-button"]').click();
      await expect(page.locator('[data-testid="diagnostics-onnx-ep"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="diagnostics-llm-provider"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="diagnostics-mcp-section"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="diagnostics-mcp-snippet"]')).toContainText('mcpServer.js');
      await expect(page.locator('[data-testid="copy-mcp-config-button"]')).toBeVisible();
      await page.locator('[data-testid="copy-mcp-config-button"]').click();
    } finally {
      if (electronApp) {
        await closeElectronApp(electronApp);
      }
      await fs.rm(rawTempBase, { recursive: true, force: true }).catch(() => {});
    }
  });
});
