import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  extractBasename,
  extractParentDirectory,
  isPathInsideDirectory,
  normalizeComparablePath,
} from '@renderer/utils/pathHelpers';
import { Breadcrumb } from '@renderer/components/Toolbar/Breadcrumb';
import { wrapBridgeNamespace } from '@renderer/utils/installElectronAPI';
import { wrapIPCError, wrapIPCSuccess } from '@shared/ipc/envelope';
import { FileGrid } from '@renderer/components/FileExplorer/FileGrid';
import { FilePreviewDrawer } from '@renderer/components/Preview/FilePreviewDrawer';
import { FileContextMenu } from '@renderer/components/ContextMenu/FileContextMenu';
import { CreateEntryDialog } from '@renderer/components/common/CreateEntryDialog';
import { Toolbar } from '@renderer/components/Toolbar/Toolbar';
import { DiagnosticsModal } from '@renderer/components/Diagnostics/DiagnosticsModal';
import type { FileNode, FilePreviewResult } from '@shared/contracts';

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
});
