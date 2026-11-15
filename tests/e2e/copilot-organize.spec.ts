import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect } from '@playwright/test';
import { closeElectronApp, getFirstWindow, launchElectronApp } from './electron-launcher';

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
    ).run(filePath, 'seed-sha-stage5', 256, now, 'md', 1, 48, now);

    db.prepare(
      'INSERT OR REPLACE INTO chunks (id, file_path, chunk_index, start_char, end_char, start_line, end_line, heading, chunk_text, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('stage5-chunk-0', filePath, 0, 0, chunkText.length, startLine, endLine, '## Gateway SLA', chunkText, now);

    db.prepare('INSERT INTO chunks_fts (chunk_id, file_path, heading, chunk_text) VALUES (?, ?, ?, ?)')
      .run('stage5-chunk-0', filePath, '## Gateway SLA', chunkText);

    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    db.close();
  }
}

test.describe('Stage 5 Copilot Agent & AI Organizer E2E', () => {
  test('supports @selection + Agent ReAct mode with citation jump and Dry-Run AI Organize + 1-Click Batch Undo', async () => {
    const rawTempBase = path.join(os.tmpdir(), `e2e-stage5-${Date.now()}`);
    await fs.mkdir(rawTempBase, { recursive: true });
    const tempBase = await fs.realpath(rawTempBase);
    const workspaceDir = path.join(tempBase, 'copilot-root');
    const vectorDbDir = path.join(tempBase, 'vectordb');

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(vectorDbDir, { recursive: true });

    const notesFile = path.join(workspaceDir, 'notes.md');
    const invoiceFile = path.join(workspaceDir, 'invoice-2026.pdf');
    const workerFile = path.join(workspaceDir, 'worker.ts');

    const noteLines = [
      '# Architecture Notes',
      'Service Overview',
      'Background queues process metadata async.',
      '## Gateway SLA',
      'Gateway-B latency budget is 18ms p99 under burst load.',
      'Retry circuit closes after 30s health probes.',
      'Failover routes traffic to secondary worker.',
      'End of Gateway SLA.',
      'Additional appendix.',
    ];
    await fs.writeFile(notesFile, noteLines.join('\n'), 'utf-8');
    await fs.writeFile(invoiceFile, '%PDF-1.4\n%Mock invoice payload\n', 'utf-8');
    await fs.writeFile(workerFile, 'export const WORKER_RETRY_MS = 250;\n', 'utf-8');

    seedKnowledgeGraphDatabase(
      vectorDbDir,
      notesFile,
      'Gateway-B latency budget is 18ms p99 under burst load.',
      5,
      8
    );

    const capturedAgentPrompts: string[] = [];
    const mockServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3.2' }] }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/chat') {
        let rawBody = '';
        req.on('data', (chunk) => {
          rawBody += String(chunk);
        });
        req.on('end', () => {
          const parsed = JSON.parse(rawBody) as {
            model?: string;
            messages?: Array<{ role: string; content: string }>;
          };
          const msgs = parsed.messages ?? [];
          capturedAgentPrompts.push(msgs.map((m) => m.content).join('\n'));
          const hasToolObservation = msgs.some((m) => m.role === 'tool');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (!hasToolObservation) {
            res.end(
              JSON.stringify({
                model: parsed.model ?? 'llama3.2',
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      function: {
                        name: 'read_file_range',
                        arguments: {
                          filePath: notesFile,
                          startLine: 5,
                          endLine: 8,
                        },
                      },
                    },
                  ],
                },
              })
            );
            return;
          }

          res.end(
            JSON.stringify({
              model: parsed.model ?? 'llama3.2',
              message: {
                role: 'assistant',
                content: 'Gateway-B latency budget is 18ms p99 under burst load [notes.md#L5-L8].',
              },
            })
          );
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
          FILE_MANAGER_ALLOWED_ROOTS: tempBase,
          FILE_MANAGER_VECTOR_DB_PATH: vectorDbDir,
          OLLAMA_URL: mockOllamaUrl,
        },
      });
      const page = await getFirstWindow(electronApp);
      await page.waitForLoadState('networkidle');

      // Navigate into copilot-root via SearchBar after warming PathTrie
      await page.evaluate(async (dirPath: string) => {
        await window.electronAPI.fs.readDirectory(dirPath);
      }, tempBase);

      const searchInput = page.locator('[data-testid="search-input"]');
      await expect(searchInput).toBeVisible({ timeout: 15000 });
      await searchInput.fill('copilot-root');
      const option = page.locator('[role="listbox"] [role="option"]', { hasText: 'copilot-root' }).first();
      await expect(option).toBeVisible({ timeout: 10000 });
      await option.click();

      const notesRow = page.locator('[data-testid="file-list"] [role="button"]', { hasText: 'notes.md' });
      await expect(notesRow).toBeVisible({ timeout: 10000 });

      // 1. Select notes.md, open ChatPanel, toggle @selection + Agent (ReAct), ask question
      await notesRow.click();
      await page.locator('[data-testid="chat-toggle-button"]').click();
      await expect(page.locator('[data-testid="chat-panel-container"]')).toBeVisible({ timeout: 10000 });

      const selectionChip = page.locator('[data-testid="chip-selection"]');
      await expect(selectionChip).toBeEnabled({ timeout: 5000 });
      await selectionChip.click();
      await expect(selectionChip).toHaveAttribute('aria-pressed', 'true');

      const agentModeChip = page.locator('[data-testid="chip-agent-mode"]');
      await agentModeChip.click();
      await expect(agentModeChip).toHaveAttribute('aria-pressed', 'true');
      await expect(agentModeChip).toContainText('Agent (ReAct)');

      await page.locator('[data-testid="chat-input"]').fill('What is Gateway-B p99 latency?');
      await page.locator('[data-testid="send-button"]').click();

      const chatMessages = page.locator('[data-testid="chat-messages"]');
      await expect(chatMessages).toContainText('18ms p99', { timeout: 15000 });

      // Verify @selection scope reached Ollama ReAct prompt inside untrusted fences
      expect(
        capturedAgentPrompts.some(
          (p) => p.includes('Pinned @selection files (1)') && p.includes('<untrusted_workspace_data')
        )
      ).toBe(true);

      // Verify ReAct trace badge expands to show read_file_range step
      const traceBadge = page.locator('[data-testid="agent-trace-badge"]').first();
      await expect(traceBadge).toBeVisible({ timeout: 10000 });
      await traceBadge.click();
      await expect(page.locator('[data-testid="agent-trace-details"]').first()).toContainText(
        'read_file_range'
      );

      // Click citation pill to verify jump-to-line in FilePreviewDrawer
      const citationPill = page
        .locator('[data-testid="source-citation-pill"]', { hasText: 'notes.md#L5-L8' })
        .first();
      await expect(citationPill).toBeVisible({ timeout: 10000 });
      await citationPill.click();

      const drawer = page.locator('[data-testid="file-preview-drawer"]');
      await expect(drawer).toBeVisible({ timeout: 10000 });
      await expect(drawer).toContainText('Citation L5-L8');
      await page.locator('[data-testid="preview-close"]').click();
      await expect(drawer).toBeHidden();

      // 2. Open AI Organize Dry-Run modal, inspect raw source->destination moves, apply batch, then 1-click Undo
      await page.locator('[data-testid="toolbar-organize-button"]').click();
      const organizeModal = page.locator('[data-testid="dry-run-plan-modal"]');
      await expect(organizeModal).toBeVisible({ timeout: 10000 });

      const opRows = page.locator('[data-testid="plan-op-row"]');
      await expect(opRows).toHaveCount(3, { timeout: 10000 });
      await expect(organizeModal).toContainText('Specs & Notes');
      await expect(organizeModal).toContainText('Finance & Receipts');
      await expect(organizeModal).toContainText('Source Code');
      await expect(organizeModal).toContainText('sha256:');

      await page.locator('[data-testid="plan-apply-button"]').click();
      await expect(organizeModal).toBeHidden({ timeout: 15000 });

      const organizedNotes = path.join(workspaceDir, 'Specs & Notes', 'notes.md');
      const organizedInvoice = path.join(workspaceDir, 'Finance & Receipts', 'invoice-2026.pdf');
      const organizedWorker = path.join(workspaceDir, 'Source Code', 'worker.ts');

      expect(fsSync.existsSync(organizedNotes)).toBe(true);
      expect(fsSync.existsSync(organizedInvoice)).toBe(true);
      expect(fsSync.existsSync(organizedWorker)).toBe(true);
      expect(fsSync.existsSync(notesFile)).toBe(false);

      // 3. Click Undo in toolbar -> restores original top-level files & removes empty created folders
      const undoButton = page.locator('[data-testid="undo-button"]');
      await expect(undoButton).toBeEnabled({ timeout: 10000 });
      await undoButton.click();

      await expect
        .poll(() => fsSync.existsSync(notesFile) && !fsSync.existsSync(path.join(workspaceDir, 'Specs & Notes')), {
          timeout: 10000,
        })
        .toBe(true);
      expect(fsSync.existsSync(invoiceFile)).toBe(true);
      expect(fsSync.existsSync(workerFile)).toBe(true);
      expect(fsSync.existsSync(path.join(workspaceDir, 'Finance & Receipts'))).toBe(false);
      expect(fsSync.existsSync(path.join(workspaceDir, 'Source Code'))).toBe(false);
      await expect(notesRow).toBeVisible({ timeout: 10000 });
    } finally {
      if (electronApp) {
        await closeElectronApp(electronApp);
      }
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
      await fs.rm(rawTempBase, { recursive: true, force: true }).catch(() => {});
    }
  });
});
