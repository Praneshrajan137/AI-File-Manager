# RENDERER PROCESS CONTEXT (Frontend/Visualization Layer)

## 🎯 PURPOSE
This layer is **visualization ONLY**. It NEVER touches the disk directly. All file operations go through IPC requests to the Main Process.

## 🏗️ ARCHITECTURE

### Responsibilities
1. **Render File System State**: Display directories, files, metadata
2. **User Interaction Handling**: Clicks, keyboard shortcuts, drag-and-drop
3. **IPC Communication**: Send requests to Main Process, receive responses
4. **Performance**: Virtualize large lists (10,000+ files)
5. **Accessibility**: Keyboard navigation, screen reader support

### Directory Structure
```
src/renderer/
├── index.tsx               # React entry point
├── App.tsx                 # Root component
├── components/
│   ├── FileExplorer/
│   │   ├── FileGrid.tsx        # Virtualized file display
│   │   ├── FileListItem.tsx    # Individual file component
│   │   └── Breadcrumb.tsx      # Path navigation
│   ├── Sidebar/
│   │   ├── DirectoryTree.tsx   # Collapsible tree view
│   │   └── QuickAccess.tsx     # Favorites, recent files
│   ├── SearchBar/
│   │   ├── SearchInput.tsx     # Autocomplete search
│   │   └── SearchResults.tsx   # Results list
│   ├── ChatPanel/
│   │   ├── ChatInterface.tsx   # LLM conversation UI
│   │   └── MessageBubble.tsx   # Individual message
│   └── ContextMenu/
│       └── FileContextMenu.tsx # Right-click menu
├── hooks/
│   ├── useFileSystem.ts        # IPC wrapper hook
│   ├── useNavigation.ts        # History management
│   └── useLLM.ts               # Chat interface hook
├── utils/
│   ├── fileIcons.ts            # Icon mapping
│   └── formatters.ts           # Date, size formatting
└── CLAUDE.md               # This file
```

## 🔒 SECURITY ISOLATION

**CRITICAL**: This layer runs in an **isolated context**. It CANNOT:
- ❌ Import Node.js `fs` module
- ❌ Access file system directly
- ❌ Execute shell commands
- ❌ Read environment variables (except exposed via Main)

**All file operations MUST use IPC:**
```typescript
// ✅ Correct - IPC request
import { ipcRenderer } from 'electron';

async function readDirectory(path: string): Promise<FileNode[]> {
  return await ipcRenderer.invoke('FS:READ_DIR', path);
}

// ❌ Wrong - Direct fs access (WILL NOT WORK)
import fs from 'fs';  // ERROR: fs not available in renderer
```

## ⚡ PERFORMANCE - VIRTUALIZATION

### Problem: Rendering 10,000+ files causes DOM overload

**Solution**: Use `react-window` for virtualization
```typescript
// components/FileExplorer/FileGrid.tsx
import { FixedSizeList } from 'react-window';

interface FileGridProps {
  files: FileNode[];
  onFileClick: (file: FileNode) => void;
}

export const FileGrid: React.FC<FileGridProps> = ({ files, onFileClick }) => {
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => (
    <div style={style}>
      <FileListItem
        file={files[index]}
        onClick={() => onFileClick(files[index])}
      />
    </div>
  );

  return (
    <FixedSizeList
      height={600}
      itemCount={files.length}
      itemSize={32}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
};
```

## 🎣 CUSTOM HOOKS - IPC ABSTRACTION

### useFileSystem Hook
```typescript
// hooks/useFileSystem.ts
import { useState, useCallback } from 'react';
import { ipcRenderer } from 'electron';

export const useFileSystem = () => {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await ipcRenderer.invoke('FS:READ_DIR', path);
      setFiles(result);
      setCurrentPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteFile = useCallback(async (path: string) => {
    try {
      await ipcRenderer.invoke('FS:DELETE', path);
      // Refresh current directory
      await readDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [currentPath, readDirectory]);

  return {
    currentPath,
    files,
    loading,
    error,
    readDirectory,
    deleteFile,
  };
};
```

### useNavigation Hook (Integrates with Main Process HistoryStack)
```typescript
// hooks/useNavigation.ts
import { useState, useCallback } from 'react';
import { ipcRenderer } from 'electron';

export const useNavigation = () => {
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const goBack = useCallback(async () => {
    const prevPath = await ipcRenderer.invoke('NAV:BACK');
    if (prevPath) {
      // Update UI with new path
      return prevPath;
    }
  }, []);

  const goForward = useCallback(async () => {
    const nextPath = await ipcRenderer.invoke('NAV:FORWARD');
    if (nextPath) {
      return nextPath;
    }
  }, []);

  const navigateTo = useCallback(async (path: string) => {
    await ipcRenderer.invoke('NAV:PUSH', path);
    updateNavigationState();
  }, []);

  const updateNavigationState = async () => {
    const state = await ipcRenderer.invoke('NAV:GET_STATE');
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
  };

  return { canGoBack, canGoForward, goBack, goForward, navigateTo };
};
```

## 🎨 COMPONENT DESIGN PRINCIPLES

### Single Responsibility (SRP)
Each component does ONE thing well.

**✅ Good Example**:
```typescript
// FileListItem ONLY renders a single file
export const FileListItem: React.FC<FileListItemProps> = ({ file }) => {
  return (
    <div className="file-item">
      <FileIcon type={file.type} />
      {file.name}
      {formatSize(file.size)}
    </div>
  );
};

// FileGrid handles the LIST of files
export const FileGrid: React.FC<FileGridProps> = ({ files }) => {
  return (
    <div className="file-grid">
      {files.map(file => (
        <FileListItem key={file.path} file={file} />
      ))}
    </div>
  );
};
```

**❌ Bad Example (God Component)**:
```typescript
// FileExplorer does EVERYTHING (violates SRP)
export const FileExplorer: React.FC = () => {
  // Fetches data (should be in hook)
  const [files, setFiles] = useState([]);
  useEffect(() => { fetchFiles(); }, []);
  
  // Renders navigation (should be separate component)
  // Renders sidebar (should be separate component)
  // Handles search (should be separate component)
  // Handles context menu (should be separate component)
  
  return /* 500 lines of JSX */;
};
```

### State Management
Use React hooks for local state, NO Redux/Zustand unless absolutely necessary.
```typescript
// ✅ Simple state management
const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

// For complex state, use useReducer
type FileAction =
  | { type: 'SELECT_FILE'; path: string }
  | { type: 'DESELECT_FILE'; path: string }
  | { type: 'SELECT_ALL' }
  | { type: 'DESELECT_ALL' };

function fileSelectionReducer(
  state: string[],
  action: FileAction
): string[] {
  switch (action.type) {
    case 'SELECT_FILE':
      return [...state, action.path];
    case 'DESELECT_FILE':
      return state.filter(p => p !== action.path);
    // ... etc
  }
}

const [selectedFiles, dispatch] = useReducer(fileSelectionReducer, []);
```

## 🎨 STYLING - TAILWIND CSS

Use utility-first approach with Tailwind.
```tsx
// ✅ Good - Utility classes
export const FileListItem: React.FC<FileListItemProps> = ({ file }) => {
  return (
    <div className="flex items-center gap-2 p-2 hover:bg-gray-100 cursor-pointer">
      <FileIcon type={file.type} className="w-5 h-5" />
      <span className="flex-1 truncate">{file.name}</span>
      <span className="text-sm text-gray-500">{formatSize(file.size)}</span>
    </div>
  );
};

// ❌ Bad - Inline styles
<div style={{ display: 'flex', padding: '8px' }}>...</div>
```

## ♿ ACCESSIBILITY

### Keyboard Navigation (MANDATORY)
```tsx
export const FileGrid: React.FC = () => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        selectNextFile();
        e.preventDefault();
        break;
      case 'ArrowUp':
        selectPreviousFile();
        e.preventDefault();
        break;
      case 'Enter':
        openSelectedFile();
        e.preventDefault();
        break;
      case 'Delete':
        deleteSelectedFiles();
        e.preventDefault();
        break;
    }
  };

  return (
    <div
      role="listbox"
      aria-label="File list"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* File items */}
    </div>
  );
};
```

### Screen Reader Support
```tsx
<button
  aria-label={`Delete ${file.name}`}
  onClick={() => deleteFile(file.path)}
>
  <TrashIcon />
</button>
```

## 🚨 CRITICAL: NO BROWSER STORAGE APIS

**NEVER use localStorage, sessionStorage, or IndexedDB in this Electron Renderer context!**
```typescript
// ❌ WRONG - Will cause artifact failure
localStorage.setItem('theme', 'dark');

// ✅ CORRECT - Use React state or request Main Process to save to disk
const [theme, setTheme] = useState<'light' | 'dark'>('light');

// If persistence needed, ask Main Process
await ipcRenderer.invoke('SETTINGS:SAVE', { theme: 'dark' });
```

## 🧪 TESTING RENDERER COMPONENTS

### Component Testing with React Testing Library
```typescript
// components/FileExplorer/FileListItem.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FileListItem } from './FileListItem';

describe('FileListItem', () => {
  it('should display file name and size', () => {
    const file: FileNode = {
      name: 'document.pdf',
      path: '/home/user/document.pdf',
      size: 1024000,
      isDirectory: false,
    };

    render(<FileListItem file={file} />);

    expect(screen.getByText('document.pdf')).toBeInTheDocument();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const handleClick = jest.fn();
    const file: FileNode = {
      name: 'test.txt',
      path: '/test.txt',
      size: 100,
      isDirectory: false,
    };

    render(<FileListItem file={file} onClick={handleClick} />);
    
    fireEvent.click(screen.getByText('test.txt'));
    expect(handleClick).toHaveBeenCalledWith(file);
  });
});
```

## 🚨 ANTI-PATTERNS (Renderer Specific)

1. **❌ Direct File System Access**: Using fs module
2. **❌ Blocking UI Thread**: Long computations without Web Workers
3. **❌ Massive Component Files**: >300 lines (split into smaller components)
4. **❌ Prop Drilling**: Passing props through 5+ levels (use Context or custom hooks)
5. **❌ Missing Loading States**: Not showing spinners during IPC calls

## 📚 REFERENCES

- `src/shared/contracts.ts` - TypeScript interfaces for file system types
- `docs/ARCHITECTURE.md` - IPC channel specifications
- React Hooks API: https://react.dev/reference/react
- react-window: https://react-window.vercel.app/

---

**CONTEXT SCOPE**: Renderer Process development ONLY
**LAST UPDATED**: December 4, 2025
