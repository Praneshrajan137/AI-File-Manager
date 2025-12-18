# UI Components Documentation

## Overview

This document provides comprehensive documentation for all UI components in the Project-2 File Manager application.

---

## Architecture

### Component Hierarchy

```
App.tsx (Root Orchestration)
├── Sidebar
│   ├── QuickAccess
│   ├── DirectoryTree
│   │   └── DirectoryTreeNode (recursive)
│   └── FavoritesList
├── Toolbar
│   ├── NavigationButtons
│   ├── Breadcrumb
│   ├── SearchBar
│   │   ├── SearchInput
│   │   └── SearchSuggestions
│   ├── ViewToggle
│   └── SortDropdown
├── FileGrid (virtualized)
│   ├── FileListItem
│   └── EmptyState
├── ChatPanel (collapsible)
│   └── ChatInterface
│       ├── MessageBubble
│       ├── ChatInput
│       └── IndexingStatus
├── FileContextMenu
└── Toast Container
```

---

## Atomic Components

### Button
**Location**: `src/renderer/components/common/Button.tsx`

**Props**:
```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
}
```

**Examples**:
```tsx
// Primary action button
<Button variant="primary" onClick={handleSave}>Save</Button>

// Icon-only button
<Button variant="ghost" icon={<Trash />} aria-label="Delete" />

// Loading state
<Button variant="primary" loading>Saving...</Button>
```

---

### Input
**Location**: `src/renderer/components/common/Input.tsx`

**Props**:
```typescript
interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'search' | 'number' | 'password' | 'email';
  disabled?: boolean;
  error?: string;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}
```

**Examples**:
```tsx
// Search input
<Input 
  value={query} 
  onChange={setQuery} 
  icon={<Search />}
  placeholder="Search files..."
/>

// Input with error
<Input 
  value={name} 
  onChange={setName} 
  error="Name is required"
/>
```

---

### Spinner
**Location**: `src/renderer/components/common/Spinner.tsx`

**Props**:
```typescript
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'primary' | 'white' | 'gray';
}
```

**Examples**:
```tsx
<Spinner size="lg" />
<Spinner size="sm" color="white" />
```

---

### Tooltip
**Location**: `src/renderer/components/common/Tooltip.tsx`

**Props**:
```typescript
interface TooltipProps {
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  children: React.ReactNode;
}
```

**Examples**:
```tsx
<Tooltip content="Delete file" position="top">
  <Button icon={<Trash />} />
</Tooltip>
```

---

### Toast
**Location**: `src/renderer/components/common/Toast.tsx`

**Usage via useToast hook**:
```tsx
const { showToast } = useToast();

showToast({
  type: 'success',
  message: 'File saved successfully',
  duration: 3000
});
```

---

## Composite Components

### FileGrid
**Location**: `src/renderer/components/FileExplorer/FileGrid.tsx`

**Features**:
- Virtualized rendering with react-window
- Handles 10,000+ files smoothly
- Memoized sorting
- Loading/error/empty states

**Props**:
```typescript
interface FileGridProps {
  files: FileNode[];
  selectedFiles: string[];
  onFileClick: (file: FileNode) => void;
  onFileDoubleClick: (file: FileNode) => void;
  onFileContextMenu: (file: FileNode, e: React.MouseEvent) => void;
  sortBy: 'name' | 'size' | 'modified' | 'type';
  sortDirection: 'asc' | 'desc';
  viewMode: 'list' | 'grid';
  loading?: boolean;
  error?: FileSystemError | null;
}
```

---

### SearchBar
**Location**: `src/renderer/components/SearchBar/SearchBar.tsx`

**Features**:
- Debounced search (300ms)
- Autocomplete suggestions via PathTrie
- Keyboard navigation
- Click-outside to close

**Usage**:
```tsx
<SearchBar 
  onSearch={handleSearch} 
  onSelect={handleNavigate} 
/>
```

---

### ChatInterface
**Location**: `src/renderer/components/ChatPanel/ChatInterface.tsx`

**Features**:
- Streaming LLM responses
- Auto-scroll to bottom
- Indexing status display
- Message history

**Usage**:
```tsx
<ChatInterface />
```

---

### DirectoryTree
**Location**: `src/renderer/components/Sidebar/DirectoryTree.tsx`

**Features**:
- Recursive tree rendering
- Lazy loading (children loaded on expand)
- Collapsible nodes
- Smooth animations

---

## Layout Components

### Sidebar
**Location**: `src/renderer/components/Sidebar/Sidebar.tsx`

**Features**:
- Resizable (200px - 400px)
- Drag handle for resize
- Integrates QuickAccess, DirectoryTree, Favorites

---

### Toolbar
**Location**: `src/renderer/components/Toolbar/Toolbar.tsx`

**Features**:
- Navigation buttons (back/forward)
- Breadcrumb navigation
- Search bar
- View toggle (list/grid)
- Sort dropdown
- Chat toggle

---

## Custom Hooks

### useFileSystem
**Location**: `src/renderer/hooks/useFileSystem.ts`

**Purpose**: IPC wrapper for file system operations

**API**:
```typescript
const { 
  files, 
  loading, 
  error, 
  readDirectory, 
  deleteFile, 
  moveFile 
} = useFileSystem();
```

---

### useNavigation
**Location**: `src/renderer/hooks/useNavigation.ts`

**Purpose**: Browser-style navigation with history

**API**:
```typescript
const { 
  canGoBack, 
  canGoForward, 
  goBack, 
  goForward, 
  navigateTo 
} = useNavigation();
```

---

### useLLM
**Location**: `src/renderer/hooks/useLLM.ts`

**Purpose**: LLM chat with streaming responses

**API**:
```typescript
const { 
  messages, 
  loading, 
  indexingStatus, 
  sendQuery 
} = useLLM();
```

---

### useToast
**Location**: `src/renderer/hooks/useToast.ts`

**Purpose**: Global toast notification management

**API**:
```typescript
const { toasts, showToast, removeToast } = useToast();
```

---

### useKeyboardShortcuts
**Location**: `src/renderer/hooks/useKeyboardShortcuts.ts`

**Purpose**: Global keyboard shortcut registration

**API**:
```typescript
useKeyboardShortcuts({
  'Ctrl+F': handleSearch,
  'Delete': handleDelete,
  'Alt+Left': goBack,
});
```

---

### useFileWatcher
**Location**: `src/renderer/hooks/useFileWatcher.ts`

**Purpose**: Real-time file system updates

**API**:
```typescript
useFileWatcher((event) => {
  if (event.path.startsWith(currentPath)) {
    refreshDirectory();
  }
});
```

---

## Integration Guide

### Adding a New Component

1. **Create component file** in appropriate directory
2. **Define TypeScript interface** for props
3. **Implement component** using design system tokens
4. **Add accessibility attributes** (ARIA, keyboard support)
5. **Optimize performance** (React.memo, useCallback, useMemo)
6. **Export component** from index file

### Example:
```tsx
import React from 'react';
import { MyIcon } from 'lucide-react';

interface MyComponentProps {
  value: string;
  onChange: (value: string) => void;
}

export const MyComponent: React.FC<MyComponentProps> = React.memo(({ 
  value, 
  onChange 
}) => {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <MyIcon className="w-5 h-5" />
      <span>{value}</span>
    </div>
  );
});
```

---

## Performance Best Practices

### 1. Use React.memo for List Items
```tsx
export const FileListItem = React.memo(({ file, onClick }) => {
  // Component logic
});
```

### 2. Memoize Expensive Computations
```tsx
const sortedFiles = useMemo(() => {
  return [...files].sort((a, b) => a.name.localeCompare(b.name));
}, [files]);
```

### 3. Use useCallback for Event Handlers
```tsx
const handleClick = useCallback(() => {
  onClick(file);
}, [file, onClick]);
```

### 4. Virtualize Large Lists
```tsx
<FixedSizeList
  height={600}
  itemCount={files.length}
  itemSize={50}
>
  {({ index, style }) => <FileListItem file={files[index]} />}
</FixedSizeList>
```

---

## Testing Strategy

### Visual Testing
- Render all variants of each component
- Verify hover/focus/active states
- Check responsive behavior
- Validate design system compliance

### Functional Testing
- Test all user interactions
- Verify IPC communication
- Check error handling
- Validate edge cases

### Accessibility Testing
- Keyboard-only navigation
- Screen reader compatibility
- Focus management
- ARIA attribute correctness

---

## Maintenance

### Modifying Components
1. Check existing usage before changes
2. Maintain backward compatibility
3. Update documentation
4. Test all dependent components

### Adding Features
1. Follow design system strictly
2. Maintain performance benchmarks
3. Add accessibility from the start
4. Document new patterns

---

**Last Updated**: December 18, 2025  
**Version**: Phase 5 Complete
