/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { SystemPathsProvider } from '@renderer/contexts/SystemPathsContext';
import { OverlayStackProvider, useRegisterOverlay } from '@renderer/hooks/useOverlayStack';
import { CreateEntryDialog } from '@renderer/components/common/CreateEntryDialog';
import { DeleteConfirmDialog } from '@renderer/components/common/DeleteConfirmDialog';
import { IndexingPanel } from '@renderer/components/ChatPanel/IndexingPanel';
import { FileGrid } from '@renderer/components/FileExplorer/FileGrid';
import { QuickAccess } from '@renderer/components/Sidebar/QuickAccess';
import { DirectoryTree } from '@renderer/components/Sidebar/DirectoryTree';
import { Breadcrumb } from '@renderer/components/Toolbar/Breadcrumb';
import { Toolbar } from '@renderer/components/Toolbar/Toolbar';
import { SearchBar } from '@renderer/components/SearchBar/SearchBar';
import { WorkspaceLensBar } from '@renderer/components/Spatial/WorkspaceLensBar';
import { KnowledgeGraphCanvas } from '@renderer/components/Spatial/KnowledgeGraphCanvas';
import { DuplicateReclaimLens } from '@renderer/components/Spatial/DuplicateReclaimLens';
import { SmartCollectionsLens } from '@renderer/components/Spatial/SmartCollectionsLens';
import { ChatInterface } from '@renderer/components/ChatPanel/ChatInterface';
import { useLLM } from '@renderer/hooks/useLLM';
import { computeGraphLayout } from '@renderer/utils/graphLayout';
import type { FileNode, WorkspaceGraphMap } from '@shared/contracts';

expect.extend(toHaveNoViolations);

const SAMPLE_NODES: FileNode[] = [
  {
    path: '/vault/alpha.ts',
    name: 'alpha.ts',
    isDirectory: false,
    size: 512,
    modified: 1700000000000,
    extension: 'ts',
    mimeType: 'text/typescript',
  },
  {
    path: '/vault/beta.md',
    name: 'beta.md',
    isDirectory: false,
    size: 256,
    modified: 1700000010000,
    extension: 'md',
    mimeType: 'text/markdown',
  },
  {
    path: '/vault/zeta.log',
    name: 'zeta.log',
    isDirectory: false,
    size: 1024,
    modified: 1700000020000,
    extension: 'log',
    mimeType: 'text/plain',
  },
];

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class MockResizeObserver {
      public observe(): void {}
      public unobserve(): void {}
      public disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }

  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({
      width: 800,
      height: 500,
      top: 0,
      left: 0,
      right: 800,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Interactive Accessibility, Resilience, and Keyboard Tests (JSDOM + jest-axe)', () => {
  it('manages modal focus, wraps Tab inside dialog, restores focus on LIFO Escape stack', async () => {
    const LayeredHost: React.FC = () => {
      const [drawerOpen, setDrawerOpen] = useState(true);
      const [dialogOpen, setDialogOpen] = useState(false);

      useRegisterOverlay('lower-drawer', drawerOpen, () => setDrawerOpen(false));

      return (
        <div>
          <button
            type="button"
            data-testid="launch-dialog-trigger"
            onClick={() => setDialogOpen(true)}
          >
            Open New Entry
          </button>
          {drawerOpen && <div data-testid="lower-overlay">Drawer Open</div>}
          <CreateEntryDialog
            isOpen={dialogOpen}
            mode="file"
            onConfirm={jest.fn()}
            onCancel={() => setDialogOpen(false)}
          />
        </div>
      );
    };

    const { container } = render(
      <OverlayStackProvider>
        <LayeredHost />
      </OverlayStackProvider>
    );

    const trigger = screen.getByTestId('launch-dialog-trigger');
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByTestId('create-entry-dialog');
    const input = screen.getByTestId('create-entry-input');
    expect(document.activeElement).toBe(input);

    // Tabbing from last button wraps back into dialog rather than escaping to trigger
    const confirmBtn = screen.getByTestId('create-entry-confirm');
    confirmBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    expect(await axe(container)).toHaveNoViolations();

    // First Escape closes top dialog ONLY and restores trigger focus
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('create-entry-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lower-overlay')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    // Second Escape closes lower overlay
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('lower-overlay')).not.toBeInTheDocument();
  });

  it('prevents accidental Enter confirmation on DeleteConfirmDialog options and supports Arrow radio selection', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    render(
      <OverlayStackProvider>
        <DeleteConfirmDialog
          isOpen={true}
          targetPaths={['/vault/secret.txt']}
          defaultMode="vault"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </OverlayStackProvider>
    );

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');

    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');

    // Pressing Enter inside radiogroup or document does NOT trigger destructive confirm
    fireEvent.keyDown(radios[1], { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('delete-confirm-button'));
    expect(onConfirm).toHaveBeenCalledWith('trash');
  });

  it('uses non-blocking ConfirmDialog instead of window.confirm in IndexingPanel', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('window.confirm must never be called');
    });
    const clearIndexMock = jest.fn().mockResolvedValue(undefined);

    render(
      <OverlayStackProvider>
        <IndexingPanel
          indexingStatus={{ indexed: 5, total: 5, inProgress: false }}
          currentPath="/vault"
          onStartIndexing={jest.fn()}
          onStopIndexing={jest.fn()}
          onClearIndex={clearIndexMock}
        />
      </OverlayStackProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /File Indexing/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Clear index/i }));
    expect(confirmSpy).not.toHaveBeenCalled();

    const alertDialog = await screen.findByTestId('clear-index-confirm-dialog');
    expect(alertDialog).toBeInTheDocument();
    fireEvent.click(within(alertDialog).getByRole('button', { name: /Clear Index/i }));

    await waitFor(() => expect(clearIndexMock).toHaveBeenCalledTimes(1));
  });

  it('renders FileGrid as WAI-ARIA listbox options with roving keyboard nav, zero useLayoutEffect errors, and retry recovery', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFileClick = jest.fn();
    const onFileDoubleClick = jest.fn();
    const onRetry = jest.fn();

    const { rerender, container } = render(
      <FileGrid
        files={SAMPLE_NODES}
        selectedFiles={[]}
        onFileClick={onFileClick}
        onFileDoubleClick={onFileDoubleClick}
        onFileContextMenu={jest.fn()}
        sortBy="name"
        sortDirection="asc"
        viewMode="list"
      />
    );

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('useLayoutEffect does nothing on the server')
    );

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('tabindex', '0');
    expect(options[1]).toHaveAttribute('tabindex', '-1');
    expect(options[0]).toHaveAttribute('aria-posinset', '1');
    expect(options[0]).toHaveAttribute('aria-setsize', '3');

    options[0].focus();
    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(onFileClick).toHaveBeenCalledWith(SAMPLE_NODES[1]);

    fireEvent.keyDown(options[1], { key: 'Enter' });
    expect(onFileDoubleClick).toHaveBeenCalledWith(SAMPLE_NODES[1]);

    fireEvent.keyDown(options[0], { key: 'z' });
    expect(onFileClick).toHaveBeenCalledWith(SAMPLE_NODES[2]);

    expect(await axe(container)).toHaveNoViolations();

    // Error state exposes actionable Retry button
    rerender(
      <FileGrid
        files={[]}
        selectedFiles={[]}
        onFileClick={onFileClick}
        onFileDoubleClick={onFileDoubleClick}
        onFileContextMenu={jest.fn()}
        sortBy="name"
        sortDirection="asc"
        viewMode="list"
        error={{ code: 'PERMISSION_DENIED', message: 'Permission denied' }}
        onRetry={onRetry}
      />
    );

    fireEvent.click(screen.getByTestId('file-grid-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('deduplicates getSystemPaths via SystemPathsProvider and recovers on transient failure', async () => {
    const getSystemPaths = jest
      .fn()
      .mockRejectedValueOnce(new Error('IPC timeout'))
      .mockResolvedValue({
        home: '/home/user',
        documents: '/home/user/Documents',
        downloads: '/home/user/Downloads',
        pictures: '/home/user/Pictures',
      });

    (window as unknown as Record<string, unknown>).electronAPI = {
      fs: {
        getSystemPaths,
        getStats: jest.fn().mockResolvedValue({ size: 0, modified: 1000 }),
        readDirectory: jest.fn().mockResolvedValue([]),
      },
    };

    render(
      <SystemPathsProvider>
        <div>
          <Breadcrumb path="/home/user/docs" onNavigate={jest.fn()} />
          <QuickAccess onNavigate={jest.fn()} />
          <DirectoryTree onNavigate={jest.fn()} />
        </div>
      </SystemPathsProvider>
    );

    const retryBtn = await screen.findByTestId('quick-access-retry');
    expect(getSystemPaths).toHaveBeenCalledTimes(1);

    fireEvent.click(retryBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Downloads' })).toBeInTheDocument());
    expect(getSystemPaths).toHaveBeenCalledTimes(2);
  });

  it('supports keyboard combobox navigation in SearchBar and arrow tab switching in WorkspaceLensBar', async () => {
    const onSelect = jest.fn();
    (window as unknown as Record<string, unknown>).electronAPI = {
      search: {
        autocomplete: jest.fn().mockResolvedValue(['/vault/alpha.ts', '/vault/alpha-two.ts']),
      },
    };

    render(
      <OverlayStackProvider>
        <SearchBar onSearch={jest.fn()} onSelect={onSelect} />
      </OverlayStackProvider>
    );

    const input = screen.getByTestId('search-input');
    fireEvent.change(input, { target: { value: 'alpha' } });

    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument(), { timeout: 1500 });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('/vault/alpha.ts');

    const onChangeLens = jest.fn();
    const { container } = render(
      <div>
        <WorkspaceLensBar
          activeLens="files"
          onChangeLens={onChangeLens}
          totalFiles={12}
          duplicateClustersCount={2}
        />
        <div id="workspace-lens-tabpanel" role="tabpanel" aria-labelledby="lens-tab-files">
          Explorer panel
        </div>
      </div>
    );
    const filesTab = screen.getByTestId('lens-tab-files');
    expect(filesTab).not.toHaveAttribute('aria-pressed');
    fireEvent.keyDown(filesTab, { key: 'ArrowRight' });
    expect(onChangeLens).toHaveBeenCalledWith('graph');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('computes collision-free KnowledgeGraph coordinates, synchronizes topology table, and guards cancelled LLM queries', async () => {
    const graphMap: WorkspaceGraphMap = {
      rootPrefix: '/v',
      nodes: [
        { path: '/v/a.ts', name: 'a.ts', folder: '/v', fileType: 'ts', inDegree: 2, outDegree: 1, chunkCount: 2, topSymbols: ['Foo'] },
        { path: '/v/b.ts', name: 'b.ts', folder: '/v', fileType: 'ts', inDegree: 1, outDegree: 1, chunkCount: 1, topSymbols: ['Bar'] },
        { path: '/v/c.md', name: 'c.md', folder: '/v', fileType: 'md', inDegree: 0, outDegree: 1, chunkCount: 1, topSymbols: [] },
      ],
      edges: [
        { source: '/v/a.ts', target: '/v/b.ts', targetRef: './b', kind: 'import', lineNumber: 1 },
        { source: '/v/c.md', target: '/v/a.ts', targetRef: 'a.ts', kind: 'markdown_link', lineNumber: 3 },
      ],
      totalFilesIndexed: 3,
    };

    const positioned = computeGraphLayout(graphMap.nodes, graphMap.edges);
    expect(positioned).toHaveLength(3);
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const dist = Math.hypot(positioned[i].x - positioned[j].x, positioned[i].y - positioned[j].y);
        expect(dist).toBeGreaterThanOrEqual(45);
      }
    }

    const { container: graphContainer } = render(
      <KnowledgeGraphCanvas
        graphMap={graphMap}
        selectedNodePath="/v/a.ts"
        scopeToFolder={false}
        onToggleScopeToFolder={jest.fn()}
        onSelectNode={jest.fn()}
        onOpenPreview={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('graph-view-toggle'));
    expect(screen.getByTestId('knowledge-graph-table')).toBeInTheDocument();
    expect(await axe(graphContainer)).toHaveNoViolations();

    // Monotonic query cancellation guard ignores late resolved IPC results and chunks
    let resolveLateQuery!: (val: unknown) => void;
    let capturedOnChunk: ((chunk: string) => void) | undefined;
    const latePromise = new Promise((resolve) => {
      resolveLateQuery = resolve;
    });
    const abortQuery = jest.fn().mockResolvedValue({ aborted: true });
    (window as unknown as Record<string, unknown>).electronAPI = {
      llm: {
        getModels: jest.fn().mockResolvedValue({
          status: 'ready',
          selectedModel: 'llama3.2',
          activeEmbeddingModel: 'nomic-embed-text',
          installedModels: ['llama3.2'],
        }),
        getIndexStats: jest.fn().mockResolvedValue({ vectorCount: 0, chunkCount: 0, totalFiles: 0 }),
        query: jest.fn().mockImplementation(
          (
            _prompt: string,
            onChunk: (chunk: string) => void,
            callbacks?: { onChannelCreated?: (channel: string) => void }
          ) => {
            capturedOnChunk = onChunk;
            callbacks?.onChannelCreated?.('llm-stream-1');
            return latePromise;
          }
        ),
        abortQuery,
      },
    };

    const ChatHarness: React.FC = () => {
      const llm = useLLM({ isActive: true });
      return <ChatInterface currentPath="/v" selectedPaths={[]} llm={llm} />;
    };

    render(<ChatHarness />);
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello world' } });
    fireEvent.click(screen.getByTestId('send-button'));

    const stopBtn = await screen.findByTestId('cancel-query-button');
    fireEvent.click(stopBtn);
    await waitFor(() => expect(abortQuery).toHaveBeenCalledWith('llm-stream-1'));

    capturedOnChunk?.('Stale late response');
    resolveLateQuery({ success: true, answer: 'Stale late response', sources: [] });
    await waitFor(() => {
      expect(screen.queryByText('Stale late response')).not.toBeInTheDocument();
    });

    // Ensure Toolbar + Spatial lenses pass axe cleanly
    const { container: uiAuditContainer } = render(
      <SystemPathsProvider>
        <div>
          <Toolbar
            canGoBack={true}
            canGoForward={false}
            onBack={jest.fn()}
            onForward={jest.fn()}
            currentPath="/v"
            onNavigate={jest.fn()}
            onSearch={jest.fn()}
            viewMode="list"
            onViewModeChange={jest.fn()}
            sortBy="name"
            onSortChange={jest.fn()}
            chatOpen={false}
            onToggleChat={jest.fn()}
          />
          <DuplicateReclaimLens
            duplicateClusters={[]}
            totalWastedBytes={0}
            onPreviewFile={jest.fn()}
            onQuarantineDuplicates={jest.fn()}
          />
          <SmartCollectionsLens
            collections={[]}
            onSelectFile={jest.fn()}
          />
        </div>
      </SystemPathsProvider>
    );
    expect(await axe(uiAuditContainer)).toHaveNoViolations();
  });
});
