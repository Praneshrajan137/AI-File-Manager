import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractBasename, extractParentDirectory, isPathInsideDirectory, normalizeComparablePath } from '@renderer/utils/pathHelpers';
import { resolveCopyCollisionName } from '@renderer/utils/explorerHelpers';
import { Breadcrumb } from '@renderer/components/Toolbar/Breadcrumb';
import { wrapBridgeNamespace } from '@renderer/utils/installElectronAPI';
import { wrapIPCError, wrapIPCSuccess } from '@shared/ipc/envelope';
import { FileGrid } from '@renderer/components/FileExplorer/FileGrid';
import { FilePreviewDrawer } from '@renderer/components/Preview/FilePreviewDrawer';
import { FileContextMenu } from '@renderer/components/ContextMenu/FileContextMenu';
import { CreateEntryDialog } from '@renderer/components/common/CreateEntryDialog';
import { DeleteConfirmDialog } from '@renderer/components/common/DeleteConfirmDialog';
import { Toast } from '@renderer/components/common/Toast';
import { VaultSection } from '@renderer/components/Sidebar/VaultSection';
import { FavoritesList } from '@renderer/components/Sidebar/FavoritesList';
import { Toolbar } from '@renderer/components/Toolbar/Toolbar';
import { DiagnosticsModal } from '@renderer/components/Diagnostics/DiagnosticsModal';
import { WorkspaceLensBar } from '@renderer/components/Spatial/WorkspaceLensBar';
import { KnowledgeGraphCanvas } from '@renderer/components/Spatial/KnowledgeGraphCanvas';
import { SmartCollectionsLens } from '@renderer/components/Spatial/SmartCollectionsLens';
import { DuplicateReclaimLens } from '@renderer/components/Spatial/DuplicateReclaimLens';
import { SplitPaneExplorer } from '@renderer/components/FileExplorer/SplitPaneExplorer';
import { ChatInput } from '@renderer/components/ChatPanel/ChatInput';
import { MessageBubble } from '@renderer/components/ChatPanel/MessageBubble';
import { DryRunPlanModal } from '@renderer/components/Organizer/DryRunPlanModal';
import { resolveQuickLookAction, PREVIEW_LINE_LIMIT } from '@renderer/hooks/usePreviewDrawer';
import { IPC_SCHEMAS } from '@shared/ipc/contracts';
import type { FileNode, FilePreviewResult, OrganizePlanResult } from '@shared/contracts';

const SAMPLE_FILES: FileNode[] = [
  {
    path: 'C:\\Users\\alice\\alpha.txt',
    name: 'alpha.txt',
    isDirectory: false,
    size: 120,
    modified: 1000,
    extension: 'txt',
    mimeType: 'text/plain',
  },
  {
    path: 'C:\\Users\\alice\\zeta.log',
    name: 'zeta.log',
    isDirectory: false,
    size: 2048,
    modified: 2000,
    extension: 'log',
    mimeType: 'text/plain',
  },
  {
    path: 'C:\\Users\\alice\\docs',
    name: 'docs',
    isDirectory: true,
    size: 0,
    modified: 3000,
    extension: '',
    mimeType: 'inode/directory',
  },
];

describe('Renderer UI & M5 Control Upgrades', () => {
  describe('pathHelpers (Windows & POSIX safe)', () => {
    it('extracts basename cleanly across Windows backslashes and POSIX forward slashes', () => {
      expect(extractBasename('C:\\Users\\alice\\docs\\notes.txt')).toBe('notes.txt');
      expect(extractBasename('/tmp/workspace/report.md')).toBe('report.md');
      expect(extractBasename('C:\\Users\\alice\\docs\\')).toBe('docs');
      expect(normalizeComparablePath('C:\\Users\\Alice\\Docs\\')).toBe('c:/users/alice/docs');
    });

    it('matches children inside directory while rejecting sibling prefixes', () => {
      expect(
        isPathInsideDirectory('C:\\Users\\Alice\\docs\\file.txt', 'c:\\users\\alice\\docs')
      ).toBe(true);
      expect(
        isPathInsideDirectory('/tmp/work/file.txt', '/tmp/work/')
      ).toBe(true);
      expect(
        isPathInsideDirectory('/tmp/work-other/file.txt', '/tmp/work')
      ).toBe(false);
    });

    it('preserves root "/" comparison, drive roots, extractParentDirectory, and UNC breadcrumbs', () => {
      expect(normalizeComparablePath('/')).toBe('/');
      expect(isPathInsideDirectory('/home/alice/doc.txt', '/')).toBe(true);
      expect(isPathInsideDirectory('C:\\Users\\doc.txt', 'c:\\')).toBe(true);

      expect(extractParentDirectory('C:\\Users\\alice\\docs\\notes.txt')).toBe('C:\\Users\\alice\\docs');
      expect(extractParentDirectory('/tmp/workspace/report.md')).toBe('/tmp/workspace');
      expect(extractParentDirectory('C:\\notes.txt')).toBe('C:\\');
      expect(extractParentDirectory('/notes.txt')).toBe('/');

      const uncHtml = renderToStaticMarkup(
        React.createElement(Breadcrumb, {
          path: '\\\\fileserver\\shared\\projects',
          onNavigate: () => undefined,
        })
      );
      expect(uncHtml).toContain('fileserver');
      expect(uncHtml).toContain('shared');
      expect(uncHtml).toContain('projects');
    });
  });

  describe('FileGrid viewMode & sortDirection', () => {
    it('renders interactive grid layout when viewMode is "grid" and respects sortDirection', () => {
      const htmlDesc = renderToStaticMarkup(
        React.createElement(FileGrid, {
          files: SAMPLE_FILES,
          selectedFiles: [SAMPLE_FILES[0].path],
          onFileClick: () => undefined,
          onFileDoubleClick: () => undefined,
          onFileContextMenu: () => undefined,
          sortBy: 'name',
          sortDirection: 'desc',
          viewMode: 'grid',
        })
      );

      expect(htmlDesc).toContain('data-testid="file-grid"');
      expect(htmlDesc).not.toContain('data-testid="file-list"');
      expect(htmlDesc.indexOf('zeta.log')).toBeLessThan(htmlDesc.indexOf('docs'));
      expect(htmlDesc.indexOf('docs')).toBeLessThan(htmlDesc.indexOf('alpha.txt'));
    });

    it('renders virtualized list layout when viewMode is "list"', () => {
      const htmlList = renderToStaticMarkup(
        React.createElement(FileGrid, {
          files: SAMPLE_FILES,
          selectedFiles: [],
          onFileClick: () => undefined,
          onFileDoubleClick: () => undefined,
          onFileContextMenu: () => undefined,
          sortBy: 'name',
          sortDirection: 'asc',
          viewMode: 'list',
        })
      );

      expect(htmlList).toContain('data-testid="file-list"');
      expect(htmlList).not.toContain('data-testid="file-grid"');
      expect(htmlList.indexOf('alpha.txt')).toBeLessThan(htmlList.indexOf('zeta.log'));
    });
  });

  describe('FilePreviewDrawer (RingBuffer + LRUCache)', () => {
    it('renders buffered lines, line numbers, cache HIT and Truncated badges', () => {
      const preview: FilePreviewResult = {
        path: SAMPLE_FILES[0].path,
        name: 'alpha.txt',
        extension: 'txt',
        size: 120,
        modified: 1000,
        lines: ['First log line', 'Second line TOKEN_99'],
        totalLinesBuffered: 2,
        truncated: true,
        binary: false,
        fromCache: true,
      };

      const html = renderToStaticMarkup(
        React.createElement(FilePreviewDrawer, {
          isOpen: true,
          file: SAMPLE_FILES[0],
          preview,
          loading: false,
          error: null,
          onClose: () => undefined,
          onRefresh: () => undefined,
          onOpenExternal: () => undefined,
          onCopyPath: () => undefined,
        })
      );

      expect(html).toContain('data-testid="file-preview-drawer"');
      expect(html).toContain('LRUCache HIT');
      expect(html).toContain('Capped');
      expect(html).toContain('Second line TOKEN_99');
    });

    it('renders binary notice for binary previews', () => {
      const preview: FilePreviewResult = {
        path: 'C:\\Users\\alice\\image.png',
        name: 'image.png',
        extension: 'png',
        size: 4096,
        modified: 1000,
        lines: [],
        totalLinesBuffered: 0,
        truncated: false,
        binary: true,
        fromCache: false,
      };

      const html = renderToStaticMarkup(
        React.createElement(FilePreviewDrawer, {
          isOpen: true,
          file: SAMPLE_FILES[0],
          preview,
          loading: false,
          error: null,
          onClose: () => undefined,
          onRefresh: () => undefined,
          onOpenExternal: () => undefined,
          onCopyPath: () => undefined,
        })
      );

      expect(html).toContain('data-testid="preview-binary-notice"');
      expect(html).toContain('Binary File Detected');
    });
  });

  describe('ContextMenu, CreateEntryDialog, Toolbar & DiagnosticsModal', () => {
    it('shows Quick Preview in FileContextMenu only for non-directory files', () => {
      const fileMenu = renderToStaticMarkup(
        React.createElement(FileContextMenu, {
          file: SAMPLE_FILES[0],
          position: { x: 10, y: 20 },
          onClose: () => undefined,
          onOpen: () => undefined,
          onPreview: () => undefined,
          onRename: () => undefined,
          onDelete: () => undefined,
          onCopyPath: () => undefined,
        })
      );
      const dirMenu = renderToStaticMarkup(
        React.createElement(FileContextMenu, {
          file: SAMPLE_FILES[2],
          position: { x: 10, y: 20 },
          onClose: () => undefined,
          onOpen: () => undefined,
          onPreview: () => undefined,
          onRename: () => undefined,
          onDelete: () => undefined,
          onCopyPath: () => undefined,
        })
      );

      expect(fileMenu).toContain('Quick Preview');
      expect(dirMenu).not.toContain('Quick Preview');
    });

    it('renders CreateEntryDialog, DiagnosticsModal, and all Toolbar controls', () => {
      const createHtml = renderToStaticMarkup(
        React.createElement(CreateEntryDialog, {
          isOpen: true,
          mode: 'file',
          onConfirm: () => undefined,
          onCancel: () => undefined,
        })
      );
      const toolbarHtml = renderToStaticMarkup(
        React.createElement(Toolbar, {
          canGoBack: true,
          canGoForward: false,
          onBack: () => undefined,
          onForward: () => undefined,
          currentPath: 'C:\\Users\\alice',
          onNavigate: () => undefined,
          onSearch: () => undefined,
          viewMode: 'list',
          onViewModeChange: () => undefined,
          sortBy: 'name',
          onSortChange: () => undefined,
          sortDirection: 'desc',
          onSortDirectionToggle: () => undefined,
          onNewFile: () => undefined,
          onNewFolder: () => undefined,
          canPreviewSelected: true,
          onPreviewSelected: () => undefined,
          onOpenDiagnostics: () => undefined,
          chatOpen: false,
          onToggleChat: () => undefined,
        })
      );
      const modalHtml = renderToStaticMarkup(
        React.createElement(DiagnosticsModal, {
          isOpen: true,
          onClose: () => undefined,
          initialSnapshot: {
            capturedAt: Date.now(),
            uptimeMs: 1200,
            allowedRoots: ['C:\\vault'],
            watcher: { status: 'watching', watchedPath: 'C:\\vault', eventsReceived: 2, lastEventAt: null, lastError: null },
            eventQueue: { pending: 0, processed: 4, coalesced: 1, dropped: 0, lastFlushAt: null, lastFlushDurationMs: 2 },
            pathTrie: { entryCount: 10, indexedRoots: ['C:\\vault'], lastIndexDurationMs: 3 },
            cache: { entries: 2, capacity: 100, currentBytes: 120, maxBytes: 1024, hits: 5, misses: 1, hitRate: 0.83, invalidations: 0 },
            preview: { capacityPerFile: 50, previewsServed: 2, cacheHits: 1 },
            vectorStore: { initialized: true, totalChunks: 20, indexedFiles: 4, lexicalDocs: 4, pendingBuffer: 0, activeExecutionProvider: 'dml', supportedDevices: ['cpu', 'dml'] },
            llm: { queriesExecuted: 1, successfulQueries: 1, failedQueries: 0, avgRetrievalMs: 12, avgGenerationMs: 150, lastError: null, activeProvider: 'openai_compatible', activeModel: 'qwen2.5-7b' },
            ipc: { registeredChannels: 30, totalCalls: 5, totalErrors: 0, channels: [] },
          },
        })
      );

      expect(createHtml).toContain('New File');
      expect(createHtml).toContain('data-testid="create-entry-input"');
      expect(toolbarHtml).toContain('data-testid="new-file-button"');
      expect(toolbarHtml).toContain('data-testid="new-folder-button"');
      expect(toolbarHtml).toContain('data-testid="preview-button"');
      expect(toolbarHtml).toContain('data-testid="sort-direction-toggle"');
      expect(toolbarHtml).toContain('data-testid="diagnostics-button"');
      expect(modalHtml).toContain('Kernel Runtime Diagnostics');
      expect(modalHtml).toContain('data-testid="diagnostics-modal"');
      expect(modalHtml).toContain('data-testid="diagnostics-onnx-ep"');
      expect(modalHtml).toContain('dml (cpu, dml)');
      expect(modalHtml).toContain('data-testid="diagnostics-llm-provider"');
      expect(modalHtml).toContain('openai_compatible');
      expect(modalHtml).toContain('data-testid="diagnostics-mcp-section"');
      expect(modalHtml).toContain('dist/main/mcpServer.js');
      expect(modalHtml).toContain('data-testid="copy-mcp-config-button"');

      const commaModalHtml = renderToStaticMarkup(
        React.createElement(DiagnosticsModal, {
          isOpen: true,
          onClose: () => undefined,
          initialSnapshot: {
            capturedAt: Date.now(),
            uptimeMs: 1200,
            allowedRoots: ['C:\\vault,team', 'D:\\notes'],
            watcher: { status: 'watching', watchedPath: 'C:\\vault,team', eventsReceived: 0, lastEventAt: null, lastError: null },
            eventQueue: { pending: 0, processed: 0, coalesced: 0, dropped: 0, lastFlushAt: null, lastFlushDurationMs: 0 },
            pathTrie: { entryCount: 0, indexedRoots: ['C:\\vault,team'], lastIndexDurationMs: 0 },
            cache: { entries: 0, capacity: 100, currentBytes: 0, maxBytes: 1024, hits: 0, misses: 0, hitRate: 0, invalidations: 0 },
            preview: { capacityPerFile: 50, previewsServed: 0, cacheHits: 0 },
            vectorStore: { initialized: false, totalChunks: 0, indexedFiles: 0, lexicalDocs: 0, pendingBuffer: 0, activeExecutionProvider: 'cpu', supportedDevices: ['cpu'] },
            llm: { queriesExecuted: 0, successfulQueries: 0, failedQueries: 0, avgRetrievalMs: 0, avgGenerationMs: 0, lastError: null, activeProvider: 'ollama', activeModel: 'qwen2.5' },
            ipc: { registeredChannels: 1, totalCalls: 0, totalErrors: 0, channels: [] },
          },
        })
      ).replace(/&quot;/g, '"');
      expect(commaModalHtml).toContain('"--root"');
      expect(commaModalHtml).toContain('"C:\\\\vault,team"');
      expect(commaModalHtml).not.toContain('"--roots"');
    });

    it('renders M7 Stage 1 DeleteConfirmDialog, VaultSection, FavoritesList, Toast Undo action, and Toolbar Undo/Redo', () => {
      const deleteHtml = renderToStaticMarkup(
        React.createElement(DeleteConfirmDialog, {
          isOpen: true,
          targetPaths: ['C:\\Users\\alice\\alpha.txt'],
          onConfirm: () => undefined,
          onCancel: () => undefined,
        })
      );
      const vaultHtml = renderToStaticMarkup(
        React.createElement(VaultSection, {
          vaultConfig: {
            allowedRoots: ['C:\\Users\\alice\\docs', 'C:\\Users\\alice\\notes'],
            indexedRoots: ['C:\\Users\\alice\\docs'],
            excludedDirs: ['.git', 'node_modules'],
            favorites: ['C:\\Users\\alice\\docs'],
            defaultDeleteMode: 'vault',
          },
          journalState: {
            canUndo: true,
            canRedo: false,
            undoCount: 1,
            redoCount: 0,
            lastUndoDescription: 'Move to Trash Vault: alpha.txt',
            vaultItemCount: 1,
            vaultTotalBytes: 2048,
          },
          onNavigate: () => undefined,
          onAddRoot: async () => undefined,
          onRemoveRoot: async () => undefined,
          onToggleIndexed: async () => undefined,
          onEmptyTrashVault: async () => undefined,
        })
      );
      const favHtml = renderToStaticMarkup(
        React.createElement(FavoritesList, {
          favorites: ['C:\\Users\\alice\\docs'],
          onNavigate: () => undefined,
          onUnpin: () => undefined,
        })
      );
      const favEmptyHtml = renderToStaticMarkup(
        React.createElement(FavoritesList, {
          favorites: [],
          onNavigate: () => undefined,
        })
      );
      const toastHtml = renderToStaticMarkup(
        React.createElement(Toast, {
          id: 1,
          type: 'success',
          message: 'Moved alpha.txt to Trash Vault',
          actionLabel: 'Undo',
          onAction: () => undefined,
          onClose: () => undefined,
        })
      );
      const toolbarUndoHtml = renderToStaticMarkup(
        React.createElement(Toolbar, {
          canGoBack: true,
          canGoForward: false,
          onBack: () => undefined,
          onForward: () => undefined,
          currentPath: 'C:\\Users\\alice',
          onNavigate: () => undefined,
          onSearch: () => undefined,
          viewMode: 'list',
          onViewModeChange: () => undefined,
          sortBy: 'name',
          onSortChange: () => undefined,
          sortDirection: 'asc',
          onSortDirectionToggle: () => undefined,
          canUndo: true,
          canRedo: true,
          undoDescription: 'Move alpha.txt',
          redoDescription: 'Rename alpha.txt',
          onUndo: () => undefined,
          onRedo: () => undefined,
          chatOpen: false,
          onToggleChat: () => undefined,
        })
      );

      expect(deleteHtml).toContain('data-testid="delete-confirm-dialog"');
      expect(deleteHtml).toContain('data-testid="delete-mode-vault"');
      expect(deleteHtml).toContain('data-testid="delete-mode-trash"');
      expect(deleteHtml).toContain('data-testid="delete-mode-permanent"');
      expect(deleteHtml).toContain('Move to Trash Vault (Undoable)');
      expect(vaultHtml).toContain('data-testid="vault-section"');
      expect(vaultHtml).toContain('data-testid="vault-add-root-button"');
      expect(vaultHtml).toContain('data-testid="vault-index-toggle-docs"');
      expect(vaultHtml).toContain('AI On');
      expect(vaultHtml).toContain('data-testid="vault-index-toggle-notes"');
      expect(vaultHtml).toContain('AI Off');
      expect(vaultHtml).toContain('data-testid="trash-vault-summary"');
      expect(vaultHtml).toContain('data-testid="empty-trash-vault-button"');
      expect(favHtml).toContain('data-testid="favorites-list"');
      expect(favHtml).toContain('docs');
      expect(favEmptyHtml).toContain('data-testid="favorites-empty"');
      expect(toastHtml).toContain('data-testid="toast-action-button"');
      expect(toastHtml).toContain('Undo');
      expect(toolbarUndoHtml).toContain('data-testid="undo-button"');
      expect(toolbarUndoHtml).toContain('data-testid="redo-button"');
    });
  });

  describe('installElectronAPI / wrapBridgeNamespace', () => {
    it('rehydrates structured Error.code and details from IPC error envelopes while passing sync and success calls', async () => {
      const bridge = {
        fs: {
          readDirectory: async () => wrapIPCSuccess(['ok']),
          failAccess: async () =>
            wrapIPCError({
              name: 'PathValidationError',
              code: 'UNAUTHORIZED_ACCESS',
              message: 'Raw internal path refused',
              userMessage: 'Access denied outside workspace',
              isOperational: true,
              details: { rootCount: 1 },
            }),
        },
        fileWatcher: {
          subscribe: () => () => 'unsubscribed',
        },
      };

      const wrapped = wrapBridgeNamespace(bridge);
      await expect(wrapped.fs.readDirectory()).resolves.toEqual(['ok']);
      expect(wrapped.fileWatcher.subscribe()()).toBe('unsubscribed');

      let caught: (Error & { code?: string; userMessage?: string; details?: Record<string, unknown> }) | null = null;
      try {
        await wrapped.fs.failAccess();
      } catch (err) {
        caught = err as Error & { code?: string; userMessage?: string; details?: Record<string, unknown> };
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught?.name).toBe('PathValidationError');
      expect(caught?.code).toBe('UNAUTHORIZED_ACCESS');
      expect(caught?.message).toBe('Access denied outside workspace');
      expect(caught?.details).toEqual({ rootCount: 1 });
    });
  });

  describe('Stage 4 Spatial Lenses & Copilot Controls UI rendering', () => {
    it('renders WorkspaceLensBar, KnowledgeGraphCanvas, SmartCollectionsLens, DuplicateReclaimLens, SplitPaneExplorer, ChatInput Cancel, MessageBubble badges, Connections tab, and DryRunPlanModal Stage 4 options', () => {
      const lensBarHtml = renderToStaticMarkup(
        React.createElement(WorkspaceLensBar, {
          activeLens: 'graph',
          onChangeLens: () => undefined,
          totalFiles: 12,
          duplicateClustersCount: 3,
          onRefresh: () => undefined,
        })
      );

      const graphHtml = renderToStaticMarkup(
        React.createElement(KnowledgeGraphCanvas, {
          graphMap: {
            rootPrefix: 'C:\\vault',
            totalFilesIndexed: 2,
            nodes: [
              {
                path: 'C:\\vault\\index.md',
                name: 'index.md',
                fileType: 'md',
                chunkCount: 2,
                inDegree: 1,
                outDegree: 2,
                topSymbols: ['setupVault'],
                folder: 'C:\\vault',
              },
              {
                path: 'C:\\vault\\auth.ts',
                name: 'auth.ts',
                fileType: 'ts',
                chunkCount: 3,
                inDegree: 2,
                outDegree: 0,
                topSymbols: ['verifyToken'],
                folder: 'C:\\vault',
              },
            ],
            edges: [
              {
                source: 'C:\\vault\\index.md',
                target: 'C:\\vault\\auth.ts',
                targetRef: './auth.ts',
                kind: 'markdown_link',
                lineNumber: 3,
              },
            ],
          },
          loading: false,
          selectedNodePath: 'C:\\vault\\index.md',
          scopeToFolder: false,
          onToggleScopeToFolder: () => undefined,
          onSelectNode: () => undefined,
          onOpenPreview: () => undefined,
        })
      );

      const collectionsHtml = renderToStaticMarkup(
        React.createElement(SmartCollectionsLens, {
          collections: [
            {
              id: 'topic:security',
              label: 'Security & Auth',
              reason: 'Shared security tokens',
              dominantSymbols: ['jwt', 'oauth'],
              files: [
                {
                  path: 'C:\\vault\\auth.ts',
                  name: 'auth.ts',
                  fileType: 'ts',
                  chunkCount: 3,
                  topSymbol: 'jwt',
                },
                {
                  path: 'C:\\vault\\index.md',
                  name: 'index.md',
                  fileType: 'md',
                  chunkCount: 1,
                },
              ],
            },
          ],
          loading: false,
          onSelectFile: () => undefined,
          onOpenSemanticOrganize: () => undefined,
        })
      );

      const duplicatesHtml = renderToStaticMarkup(
        React.createElement(DuplicateReclaimLens, {
          duplicateClusters: [
            {
              sha256: 'abc123def4567890abc123def4567890',
              fileSize: 2048,
              wastedBytes: 2048,
              files: ['C:\\vault\\orig.bin', 'C:\\vault\\orig-copy.bin'],
            },
          ],
          totalWastedBytes: 2048,
          loading: false,
          onPreviewFile: () => undefined,
          onQuarantineDuplicates: () => undefined,
        })
      );

      const splitHtml = renderToStaticMarkup(
        React.createElement(SplitPaneExplorer, {
          secondaryPath: 'C:\\vault\\dest',
          files: SAMPLE_FILES,
          selectedFiles: [],
          loading: false,
          sortBy: 'name',
          sortDirection: 'asc',
          viewMode: 'list',
          primarySelectedCount: 2,
          onNavigate: () => undefined,
          onRefresh: () => undefined,
          onClose: () => undefined,
          onCopyFromPrimary: () => undefined,
          onFileClick: () => undefined,
          onFileDoubleClick: () => undefined,
          onFileContextMenu: () => undefined,
          onDropMove: () => undefined,
        })
      );

      const cancelInputHtml = renderToStaticMarkup(
        React.createElement(ChatInput, {
          value: 'searching...',
          onChange: () => undefined,
          onSend: () => undefined,
          onCancel: () => undefined,
          disabled: true,
        })
      );

      const samplePlan: OrganizePlanResult = {
        planId: 'plan-1',
        targetDir: 'C:\\vault',
        strategy: 'semantic_cluster',
        createdAt: Date.now(),
        summary: '1 move ready for dry-run review',
        skippedFiles: 0,
        usedLLM: false,
        linkImpact: {
          totalAffectedFiles: 1,
          markdownRepairableCount: 1,
          references: [
            {
              sourcePath: 'C:\\vault\\index.md',
              targetPath: 'C:\\vault\\auth.ts',
              targetRef: './auth.ts',
              kind: 'markdown_link',
              lineNumber: 3,
              isMarkdownLink: true,
            },
          ],
        },
        operations: [
          {
            id: 'op-1',
            action: 'move',
            sourcePath: 'C:\\vault\\auth.ts',
            destinationPath: 'C:\\vault\\Security & Auth\\auth.ts',
            category: 'Security & Auth',
            reason: 'Matched security tokens',
            size: 120,
            sourceSha256: 'deadbeef',
          },
        ],
      };

      const assistantHtml = renderToStaticMarkup(
        React.createElement(MessageBubble, {
          message: {
            id: 42,
            role: 'assistant',
            content: 'Auth logic lives in [auth.ts#L1-L10].',
            sources: ['C:\\vault\\auth.ts'],
            offlineSynthesis: true,
            proposedPlan: samplePlan,
            timestamp: Date.now(),
          },
          onPreviewOrganizePlan: () => undefined,
        })
      );

      const drawerHtml = renderToStaticMarkup(
        React.createElement(FilePreviewDrawer, {
          isOpen: true,
          file: SAMPLE_FILES[0],
          preview: {
            path: SAMPLE_FILES[0].path,
            name: SAMPLE_FILES[0].name,
            extension: 'txt',
            size: 120,
            modified: 1000,
            lines: ['Hello'],
            totalLinesBuffered: 1,
            truncated: false,
            binary: false,
            fromCache: false,
          },
          fileConnections: {
            filePath: SAMPLE_FILES[0].path,
            symbols: [{ name: 'greet', kind: 'function', lineNumber: 1 }],
            backlinks: [],
            outgoingLinks: [],
            associativeNeighbors: [],
          },
          loading: false,
          error: null,
          onClose: () => undefined,
          onRefresh: () => undefined,
          onOpenExternal: () => undefined,
          onCopyPath: () => undefined,
        })
      );

      const planModalHtml = renderToStaticMarkup(
        React.createElement(DryRunPlanModal, {
          isOpen: true,
          targetDir: 'C:\\vault',
          initialStrategy: 'deduplicate',
          initialPlan: samplePlan,
          onClose: () => undefined,
          onApplied: () => undefined,
        })
      );

      expect(lensBarHtml).toContain('data-testid="lens-tab-files"');
      expect(lensBarHtml).toContain('data-testid="lens-tab-graph"');
      expect(lensBarHtml).toContain('data-testid="lens-tab-collections"');
      expect(lensBarHtml).toContain('data-testid="lens-tab-duplicates"');
      expect(lensBarHtml).toContain('data-testid="lens-duplicates-badge"');

      expect(graphHtml).toContain('data-testid="knowledge-graph-canvas"');
      expect(graphHtml).toContain('data-testid="knowledge-graph-svg"');
      expect(graphHtml).toContain('index.md');
      expect(graphHtml).toContain('auth.ts');

      expect(collectionsHtml).toContain('data-testid="smart-collections-lens"');
      expect(collectionsHtml).toContain('Security &amp; Auth');
      expect(collectionsHtml).toContain('data-testid="collections-organize-button"');

      expect(duplicatesHtml).toContain('data-testid="duplicate-reclaim-lens"');
      expect(duplicatesHtml).toContain('data-testid="duplicate-cluster-card"');
      expect(duplicatesHtml).toContain('data-testid="quarantine-duplicates-button"');

      expect(splitHtml).toContain('data-testid="split-pane-right"');
      expect(splitHtml).toContain('data-testid="split-pane-copy-button"');

      expect(cancelInputHtml).toContain('data-testid="cancel-query-button"');

      expect(assistantHtml).toContain('data-testid="offline-synthesis-badge"');
      expect(assistantHtml).toContain('data-testid="message-proposed-plan-card"');
      expect(assistantHtml).toContain('data-testid="review-proposed-plan-button"');

      expect(drawerHtml).toContain('data-testid="preview-tab-connections"');

      expect(planModalHtml).toContain('data-testid="plan-repair-links-checkbox"');
      expect(planModalHtml).toContain('data-testid="plan-recursive-checkbox"');
      expect(planModalHtml).toContain('data-testid="plan-link-impact-banner"');
      expect(planModalHtml).toContain('value="deduplicate"');
      expect(planModalHtml).toContain('value="semantic_cluster"');

      expect(
        IPC_SCHEMAS['FS:PREVIEW_FILE'].safeParse({
          path: SAMPLE_FILES[0].path,
          maxLines: PREVIEW_LINE_LIMIT,
        }).success
      ).toBe(true);
      expect(resolveQuickLookAction(null, [SAMPLE_FILES[0].path], SAMPLE_FILES)).toEqual({
        kind: 'load',
        file: SAMPLE_FILES[0],
      });
      expect(
        resolveQuickLookAction(SAMPLE_FILES[0], [SAMPLE_FILES[1].path], SAMPLE_FILES)
      ).toEqual({
        kind: 'load',
        file: SAMPLE_FILES[1],
      });
      expect(
        resolveQuickLookAction(SAMPLE_FILES[0], [SAMPLE_FILES[0].path], SAMPLE_FILES)
      ).toEqual({ kind: 'close' });
      expect(resolveQuickLookAction(null, [SAMPLE_FILES[2].path], SAMPLE_FILES)).toEqual({
        kind: 'noop',
      });

      const existing = new Set(['notes.md', 'notes (copy).md', '.gitignore']);
      expect(resolveCopyCollisionName('notes.md', existing, false)).toBe('notes (copy 2).md');
      expect(resolveCopyCollisionName('fresh.md', existing, true)).toBe('fresh.md');
      expect(resolveCopyCollisionName('.gitignore', existing, false)).toBe('.gitignore (copy)');
    });
  });
});
