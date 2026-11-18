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
import { SelectionActionBar } from '@renderer/components/FileExplorer/SelectionActionBar';
import { WorkspaceStatusBar } from '@renderer/components/Toolbar/WorkspaceStatusBar';
import { FilePreviewDrawer } from '@renderer/components/Preview/FilePreviewDrawer';
import { WorkspaceSettingsModal } from '@renderer/components/Settings/WorkspaceSettingsModal';
import { TrashVaultModal } from '@renderer/components/Vault/TrashVaultModal';
import { OnboardingModal } from '@renderer/components/Onboarding/OnboardingModal';
import { ChatInterface } from '@renderer/components/ChatPanel/ChatInterface';
import { useLLM } from '@renderer/hooks/useLLM';
import { useSpatialLens } from '@renderer/hooks/useSpatialLens';
import { useWorkspaceShortcuts } from '@renderer/hooks/useWorkspaceShortcuts';
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

  it('audits SelectionActionBar & WorkspaceStatusBar with jest-axe in Light and Dark mode and wires clipboard controls', async () => {
    const onCopy = jest.fn();
    const onCut = jest.fn();
    const onDuplicate = jest.fn();
    const onPaste = jest.fn();
    const onOpenOmnibar = jest.fn();

    const { container } = render(
      <div>
        <SelectionActionBar
          selectedCount={2}
          totalBytes={768}
          canPreviewSingle={false}
          canRenameSingle={false}
          canCopyToSplitPane={true}
          onPreview={jest.fn()}
          onRename={jest.fn()}
          onCopy={onCopy}
          onCut={onCut}
          onDuplicate={onDuplicate}
          onCopyToSplitPane={jest.fn()}
          onAskAi={jest.fn()}
          onDelete={jest.fn()}
          onClearSelection={jest.fn()}
        />
        <WorkspaceStatusBar
          files={SAMPLE_NODES}
          currentPath="/vault"
          searchQuery={null}
          clipboard={{ mode: 'copy', paths: ['/vault/alpha.ts'] }}
          indexingStatus={{ indexed: 2, total: 3, inProgress: true }}
          onPaste={onPaste}
          onClearClipboard={jest.fn()}
          onOpenChat={jest.fn()}
          onOpenOmnibar={onOpenOmnibar}
        />
      </div>
    );

    expect(screen.getByTestId('selection-summary-badge')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('status-clipboard-badge')).toHaveTextContent('Copied 1 item');

    fireEvent.click(screen.getByTestId('selection-copy-button'));
    fireEvent.click(screen.getByTestId('selection-cut-button'));
    fireEvent.click(screen.getByTestId('selection-duplicate-button'));
    fireEvent.click(screen.getByTestId('status-paste-button'));
    fireEvent.click(screen.getByTestId('status-omnibar-hint'));

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCut).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onOpenOmnibar).toHaveBeenCalledTimes(1);

    expect(await axe(container)).toHaveNoViolations();
    try {
      document.documentElement.classList.add('dark');
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('implements DirectoryTree APG roving tabIndex with Home, End, ArrowDown, and ArrowLeft parent focus', async () => {
    const readDirectory = jest.fn().mockResolvedValue([
      {
        path: '/vault/docs',
        name: 'docs',
        isDirectory: true,
        size: 0,
        modified: 1000,
        extension: '',
        mimeType: '',
      },
      {
        path: '/vault/src',
        name: 'src',
        isDirectory: true,
        size: 0,
        modified: 1000,
        extension: '',
        mimeType: '',
      },
    ]);
    (window as unknown as Record<string, unknown>).electronAPI = {
      fs: {
        getStats: jest.fn().mockResolvedValue({ size: 0, modified: 1000, isDirectory: true }),
        readDirectory,
        getSystemPaths: jest.fn().mockResolvedValue({
          home: '/vault',
          desktop: '/vault/desktop',
          documents: '/vault/docs',
          downloads: '/vault/downloads',
          pictures: '/vault/pics',
        }),
      },
    };

    render(
      <SystemPathsProvider>
        <DirectoryTree rootPath="/vault" onNavigate={jest.fn()} />
      </SystemPathsProvider>
    );

    const homeItem = await screen.findByRole('treeitem', { name: 'Home' });
    expect(homeItem).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(homeItem, { key: 'ArrowRight' });
    const docsItem = await screen.findByRole('treeitem', { name: 'docs' });
    const srcItem = await screen.findByRole('treeitem', { name: 'src' });

    fireEvent.keyDown(homeItem, { key: 'End' });
    expect(srcItem).toHaveFocus();
    expect(srcItem).toHaveAttribute('tabindex', '0');
    expect(homeItem).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(srcItem, { key: 'Home' });
    expect(homeItem).toHaveFocus();
    expect(homeItem).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(homeItem, { key: 'ArrowDown' });
    expect(docsItem).toHaveFocus();
    fireEvent.keyDown(docsItem, { key: 'ArrowLeft' });
    expect(homeItem).toHaveFocus();
  });

  it('filters KnowledgeGraphCanvas nodes, jumps to clickable neighbor chips, and sorts table columns', () => {
    const graphMap: WorkspaceGraphMap = {
      rootPrefix: '/v',
      nodes: [
        { path: '/v/alpha.ts', name: 'alpha.ts', folder: '/v', fileType: 'ts', inDegree: 1, outDegree: 2, chunkCount: 3, topSymbols: ['boot'] },
        { path: '/v/beta.md', name: 'beta.md', folder: '/v', fileType: 'md', inDegree: 2, outDegree: 0, chunkCount: 2, topSymbols: ['guide'] },
        { path: '/v/zeta.py', name: 'zeta.py', folder: '/v', fileType: 'py', inDegree: 0, outDegree: 1, chunkCount: 1, topSymbols: ['trainModel'] },
      ],
      edges: [
        { source: '/v/alpha.ts', target: '/v/beta.md', targetRef: './beta.md', kind: 'markdown_link', lineNumber: 2 },
        { source: '/v/zeta.py', target: '/v/alpha.ts', targetRef: './alpha.ts', kind: 'import', lineNumber: 1 },
      ],
      totalFilesIndexed: 3,
    };

    const GraphHarness: React.FC = () => {
      const [selected, setSelected] = useState<string | null>('/v/alpha.ts');
      return (
        <KnowledgeGraphCanvas
          graphMap={graphMap}
          selectedNodePath={selected}
          scopeToFolder={false}
          onToggleScopeToFolder={jest.fn()}
          onSelectNode={(n): void => setSelected(n.path)}
          onOpenPreview={jest.fn()}
        />
      );
    };

    render(<GraphHarness />);
    expect(screen.getByTestId('graph-neighbor-jumps')).toBeInTheDocument();
    const betaChip = within(screen.getByTestId('graph-neighbor-jumps')).getByRole('button', { name: /beta\.md/i });
    fireEvent.click(betaChip);
    expect(screen.getByTestId('graph-node-inspector')).toHaveTextContent('beta.md');

    const searchInput = screen.getByTestId('graph-node-search');
    fireEvent.change(searchInput, { target: { value: 'trainModel' } });
    expect(screen.getByTestId('knowledge-graph-canvas')).toHaveTextContent('1 nodes / 0 links');

    fireEvent.change(searchInput, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('graph-view-toggle'));
    const table = screen.getByTestId('knowledge-graph-table');
    const fileSortBtn = within(table).getByRole('button', { name: /^File/i });
    fireEvent.click(fileSortBtn);
    let rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('alpha.ts');

    fireEvent.click(fileSortBtn);
    rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('zeta.py');
  });

  it('wires FilePreviewDrawer sibling Prev/Next cycling and Copy Content clipboard button', () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).electronAPI = {
      clipboard: { writeText },
    };
    const onPrev = jest.fn();
    const onNext = jest.fn();
    const onCopyContentSuccess = jest.fn();

    render(
      <OverlayStackProvider>
        <FilePreviewDrawer
          isOpen={true}
          file={SAMPLE_NODES[0]}
          preview={{
            path: SAMPLE_NODES[0].path,
            name: SAMPLE_NODES[0].name,
            extension: 'ts',
            size: 512,
            modified: 1000,
            lines: ['export const answer = 42;'],
            totalLinesBuffered: 1,
            truncated: false,
            binary: false,
            fromCache: false,
          }}
          loading={false}
          error={null}
          hasPrev={true}
          hasNext={true}
          onPrevFile={onPrev}
          onNextFile={onNext}
          onCopyContentSuccess={onCopyContentSuccess}
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          onOpenExternal={jest.fn()}
          onCopyPath={jest.fn()}
        />
      </OverlayStackProvider>
    );

    fireEvent.click(screen.getByTestId('preview-copy-content'));
    expect(writeText).toHaveBeenCalledWith('export const answer = 42;');
    expect(onCopyContentSuccess).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('preview-prev-button'));
    fireEvent.click(screen.getByTestId('preview-next-button'));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('executes layered non-modal Escape (Overlay -> Search -> Selection) and protects native text copy vs file Ctrl+C/V', async () => {
    const onClearSearch = jest.fn().mockResolvedValue(undefined);
    const onClearSelection = jest.fn();
    const onCopySelection = jest.fn();
    const onPasteSelection = jest.fn().mockResolvedValue(undefined);

    const ShortcutHarness: React.FC = () => {
      const [overlayOpen, setOverlayOpen] = useState(true);
      const [hasActiveSearch, setHasActiveSearch] = useState(true);
      const [selected, setSelected] = useState<string[]>(['/vault/alpha.ts']);

      useRegisterOverlay('non-modal-preview', overlayOpen, () => setOverlayOpen(false), { blocking: false });
      useWorkspaceShortcuts({
        hasModalOpen: false,
        currentPath: '/vault',
        files: SAMPLE_NODES,
        selectedFiles: selected,
        hasActiveSearch,
        canPaste: true,
        onToggleOmnibar: jest.fn(),
        onToggleChat: jest.fn(),
        onBack: jest.fn().mockResolvedValue(undefined),
        onForward: jest.fn().mockResolvedValue(undefined),
        onToggleQuickLook: jest.fn(),
        onToggleSplitPane: jest.fn(),
        onRefresh: jest.fn(),
        onRequestRename: jest.fn(),
        onRequestDelete: jest.fn(),
        onSelectAll: jest.fn(),
        onClearSearch: async (): Promise<void> => {
          await onClearSearch();
          setHasActiveSearch(false);
        },
        onClearSelection: (): void => {
          onClearSelection();
          setSelected([]);
        },
        onCopySelection,
        onCutSelection: jest.fn(),
        onPasteSelection,
        onDuplicateSelection: jest.fn().mockResolvedValue(undefined),
        onCreateFile: jest.fn(),
        onCreateDirectory: jest.fn(),
        onUndo: jest.fn().mockResolvedValue(undefined),
        onRedo: jest.fn().mockResolvedValue(undefined),
      });

      return (
        <div
          data-testid="shortcut-state"
          data-overlay={String(overlayOpen)}
          data-search={String(hasActiveSearch)}
          data-selected={String(selected.length)}
        />
      );
    };

    render(
      <OverlayStackProvider>
        <ShortcutHarness />
      </OverlayStackProvider>
    );

    const stateEl = screen.getByTestId('shortcut-state');
    // 1st Escape dismisses non-modal overlay only
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(stateEl).toHaveAttribute('data-overlay', 'false');
    expect(onClearSearch).not.toHaveBeenCalled();

    // 2nd Escape clears active search filter
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(stateEl).toHaveAttribute('data-search', 'false'));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
    expect(onClearSelection).not.toHaveBeenCalled();

    // Native text selection protects highlighted prose on Ctrl+C
    const originalGetSelection = window.getSelection;
    window.getSelection = jest.fn(() => ({ toString: () => 'selected prose' }) as unknown as Selection);
    try {
      fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
      expect(onCopySelection).not.toHaveBeenCalled();

      window.getSelection = jest.fn(() => ({ toString: () => '' }) as unknown as Selection);
      fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
      expect(onCopySelection).toHaveBeenCalledWith(['/vault/alpha.ts']);

      fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
      await waitFor(() => expect(onPasteSelection).toHaveBeenCalledWith('/vault'));
    } finally {
      window.getSelection = originalGetSelection;
    }

    // 3rd Escape clears file selection
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(stateEl).toHaveAttribute('data-selected', '0');
  });

  it('keeps useLLM idle until activated and skips queryInsights while in files explorer lens', async () => {
    const getIndexingStatus = jest.fn().mockResolvedValue({ indexed: 7, total: 7, inProgress: false });
    const listModels = jest.fn().mockResolvedValue({ available: true, models: ['llama3.2'], activeModel: 'llama3.2', embeddingModel: 'bge', rerankerModel: 'ms', temperature: 0.7, maxTokens: 2048 });
    const queryInsights = jest.fn().mockResolvedValue({
      stats: { totalFiles: 0, totalChunks: 0, totalTokens: 0, lastIndexed: 0, duplicateClusters: [], totalWastedBytes: 0, topHubs: [], recentFiles: [] },
      symbolMatches: [],
      backlinks: [],
    });
    const getWorkspaceMap = jest.fn().mockResolvedValue({ rootPrefix: '/v', nodes: [], edges: [], totalFilesIndexed: 0 });

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      llm: { getIndexingStatus, listModels },
      graph: { queryInsights, getWorkspaceMap },
    };

    const LazyHarness: React.FC = () => {
      const [active, setActive] = useState(false);
      const [lens, setLens] = useState<'files' | 'graph'>('files');
      useLLM({ isActive: active });
      useSpatialLens(lens, '/vault/sub');
      return (
        <div>
          <button type="button" onClick={(): void => setActive(true)}>
            Activate AI
          </button>
          <button type="button" onClick={(): void => setLens('graph')}>
            Show Graph
          </button>
        </div>
      );
    };

    render(<LazyHarness />);
    await new Promise((r) => setTimeout(r, 20));
    expect(getIndexingStatus).not.toHaveBeenCalled();
    expect(listModels).not.toHaveBeenCalled();
    expect(queryInsights).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Activate AI'));
    await waitFor(() => expect(getIndexingStatus).toHaveBeenCalledTimes(1));
    expect(listModels).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Show Graph'));
    await waitFor(() => expect(queryInsights).toHaveBeenCalledTimes(1));
    expect(getWorkspaceMap).toHaveBeenCalledTimes(1);
  });

  it('keeps Stage 3 Settings, TrashVault, Onboarding modals and Preview Edit mode WCAG accessible and interactive', async () => {
    const listModels = jest.fn().mockResolvedValue({
      available: true,
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      models: ['llama3.2'],
      activeModel: 'llama3.2',
      embeddingModel: 'Xenova/bge-small-en-v1.5',
      rerankerModel: 'Xenova/ms-marco-MiniLM-L-6-v2',
      modelCacheDir: '/vault/.privatevault/models',
      embeddingCached: true,
      embeddingCacheBytes: 1024,
      rerankerCached: false,
      rerankerCacheBytes: 0,
      supportedEmbeddingDevices: ['cpu'],
      temperature: 0.5,
      maxTokens: 2048,
      embeddingDevice: 'auto',
      allowRemoteModels: true,
    });
    const listTrashVault = jest.fn().mockResolvedValue([
      {
        id: 'vault-entry-1',
        name: 'deleted-note.md',
        originalPath: '/vault/deleted-note.md',
        deletedAt: Date.now(),
        size: 512,
        isDirectory: false,
        isSymlink: false,
        description: 'Move to Trash Vault: deleted-note.md',
      },
    ]);
    const restoreTrashItem = jest.fn().mockResolvedValue({
      success: true,
      restoredPath: '/vault/deleted-note.md',
      state: { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0, vaultItemCount: 0, vaultTotalBytes: 0 },
    });

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      llm: { listModels },
      fs: { listTrashVault, restoreTrashItem },
    };

    const onToggleDevBadges = jest.fn();
    const { container: settingsContainer, unmount: unmountSettings } = render(
      <OverlayStackProvider>
        <WorkspaceSettingsModal
          isOpen={true}
          onClose={jest.fn()}
          vaultConfig={{
            allowedRoots: ['/vault'],
            indexedRoots: ['/vault'],
            excludedDirs: ['.git'],
            favorites: [],
            defaultDeleteMode: 'vault',
          }}
          onToggleDeveloperBadges={onToggleDevBadges}
        />
      </OverlayStackProvider>
    );
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('settings-dev-badges-checkbox'));
    expect(onToggleDevBadges).toHaveBeenCalledWith(true);
    expect(await axe(settingsContainer)).toHaveNoViolations();
    unmountSettings();

    const onRestoredOrPurged = jest.fn().mockResolvedValue(undefined);
    const { container: trashContainer, unmount: unmountTrash } = render(
      <OverlayStackProvider>
        <TrashVaultModal
          isOpen={true}
          onClose={jest.fn()}
          onRestoredOrPurged={onRestoredOrPurged}
          onEmptyAll={jest.fn().mockResolvedValue(undefined)}
          showToast={jest.fn()}
        />
      </OverlayStackProvider>
    );
    await waitFor(() => expect(screen.getByTestId('trash-vault-row-deleted-note.md')).toBeInTheDocument());
    expect(await axe(trashContainer)).toHaveNoViolations();
    fireEvent.click(screen.getByTestId('trash-restore-deleted-note.md'));
    await waitFor(() => expect(restoreTrashItem).toHaveBeenCalledWith('vault-entry-1'));
    expect(onRestoredOrPurged).toHaveBeenCalledTimes(1);
    unmountTrash();

    const onComplete = jest.fn();
    const { container: onboardingContainer, unmount: unmountOnboarding } = render(
      <OverlayStackProvider>
        <OnboardingModal
          isOpen={true}
          onComplete={onComplete}
          vaultConfig={{
            allowedRoots: ['/vault'],
            indexedRoots: [],
            excludedDirs: ['.git'],
            favorites: [],
            defaultDeleteMode: 'vault',
          }}
          modelsSnapshot={null}
          onAddVaultRoot={jest.fn().mockResolvedValue(undefined)}
          onIndexRoot={jest.fn().mockResolvedValue(undefined)}
          onOpenSettings={jest.fn()}
        />
      </OverlayStackProvider>
    );
    expect(await axe(onboardingContainer)).toHaveNoViolations();
    fireEvent.click(screen.getByTestId('onboarding-complete-button'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    unmountOnboarding();

    const onChangeEdit = jest.fn();
    const onSaveEdit = jest.fn();
    const { container: previewContainer } = render(
      <OverlayStackProvider>
        <FilePreviewDrawer
          isOpen={true}
          file={SAMPLE_NODES[0]}
          preview={{
            path: SAMPLE_NODES[0].path,
            name: SAMPLE_NODES[0].name,
            extension: 'ts',
            size: 120,
            modified: 1000,
            lines: ['const a = 1;'],
            totalLinesBuffered: 1,
            truncated: false,
            binary: false,
            fromCache: false,
          }}
          loading={false}
          error={null}
          isEditing={true}
          editContent="const a = 2;"
          editDirty={true}
          onStartEdit={jest.fn()}
          onCancelEdit={jest.fn()}
          onChangeEditContent={onChangeEdit}
          onSaveEdit={onSaveEdit}
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          onOpenExternal={jest.fn()}
          onCopyPath={jest.fn()}
        />
      </OverlayStackProvider>
    );
    const textarea = screen.getByTestId('preview-editor-textarea');
    fireEvent.change(textarea, { target: { value: 'const a = 3;' } });
    expect(onChangeEdit).toHaveBeenCalledWith('const a = 3;');
    fireEvent.keyDown(textarea, { key: 's', ctrlKey: true });
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(await axe(previewContainer)).toHaveNoViolations();
  });
});
