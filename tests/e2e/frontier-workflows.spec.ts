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

      const ascItems = await getListOrderText();
      const ascAlphaIdx = ascItems.findIndex((t) => t.includes('alpha.txt'));
      const ascZetaIdx = ascItems.findIndex((t) => t.includes('zeta.txt'));
      expect(ascAlphaIdx).toBeGreaterThanOrEqual(0);
      expect(ascZetaIdx).toBeGreaterThan(ascAlphaIdx);

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
      if ((await toastLocator.count()) > 0) {
        const toastText = await toastLocator.first().innerText();
        expect(toastText).toContain('external-signal.txt');
        expect(toastText).not.toContain('\\');
        expect(toastText).not.toContain('/');
      } else {
        const exactToast = page.getByText(/File (create|change): external-signal\.txt/);
        await expect(exactToast.first()).toBeVisible({ timeout: 5000 });
        const toastText = await exactToast.first().innerText();
        expect(toastText).not.toContain('\\');
        expect(toastText).not.toContain('/');
      }

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
});
