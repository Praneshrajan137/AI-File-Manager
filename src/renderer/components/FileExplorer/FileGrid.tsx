import React, { useMemo, useState, useEffect, useRef } from 'react';
import { FixedSizeList } from 'react-window';
import { FileNode, FileSystemError } from '@shared/contracts';
import { FileListItem } from './FileListItem';
import { EmptyState } from './EmptyState';
import { Spinner } from '@renderer/components/common/Spinner';
import { getFileIconWithColor } from '@renderer/utils/fileIcons';
import { formatFileSize } from '@renderer/utils/formatters';

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

export const FileGrid: React.FC<FileGridProps> = ({
  files,
  selectedFiles,
  onFileClick,
  onFileDoubleClick,
  onFileContextMenu,
  sortBy,
  sortDirection,
  viewMode,
  loading,
  error
}) => {
  // All hooks must be called before any conditional returns (React Rules of Hooks)
  // Calculate responsive height with ResizeObserver for accurate measurements
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);

  // Memoize sorted files (prevent re-sort on every render)
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name) * direction;
        case 'size':
          return (a.size - b.size) * direction;
        case 'modified':
          return (a.modified - b.modified) * direction;
        case 'type':
          return a.extension.localeCompare(b.extension) * direction;
        default:
          return 0;
      }
    });
  }, [files, sortBy, sortDirection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use ResizeObserver for accurate layout-aware measurements
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Use borderBoxSize for most accurate measurement
        const height = entry.contentRect.height;
        if (height > 0) {
          setContainerHeight(height);
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [loading, error, sortedFiles.length, viewMode]);

  // Conditional returns AFTER all hooks
  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-error-500">
        <p className="text-lg font-medium">Error loading files</p>
        <p className="text-sm mt-2">{error.message}</p>
      </div>
    );
  }

  if (sortedFiles.length === 0) {
    return <EmptyState />;
  }

  if (viewMode === 'grid') {
    return (
      <div
        ref={containerRef}
        className="h-full overflow-y-auto scrollbar-thin pr-1"
        role="listbox"
        aria-label="File grid"
        aria-multiselectable="true"
        data-testid="file-grid"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {sortedFiles.map((file) => {
            const selected = selectedFiles.includes(file.path);
            const { icon: Icon, colorClass } = getFileIconWithColor(file);
            return (
              <div
                key={file.path}
                role="button"
                tabIndex={0}
                aria-selected={selected}
                onClick={(): void => onFileClick(file)}
                onDoubleClick={(): void => onFileDoubleClick(file)}
                onContextMenu={(e): void => onFileContextMenu(file, e)}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') {
                    onFileDoubleClick(file);
                  }
                }}
                className={`flex flex-col items-center p-3 rounded-xl border cursor-pointer transition-all text-center ${
                  selected
                    ? 'bg-primary-100 border-primary-300 ring-1 ring-primary-300'
                    : 'bg-white border-gray-200 hover:bg-primary-50 hover:border-primary-200'
                } ${file.isHidden === true ? 'opacity-50' : ''}`}
              >
                <Icon className={`w-9 h-9 mb-2 ${colorClass}`} />
                <span className="text-xs font-medium text-gray-800 w-full truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                  {file.isDirectory ? 'Folder' : formatFileSize(file.size)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full"
      role="listbox"
      aria-label="File list"
      aria-multiselectable="true"
      data-testid="file-list"
    >
      <FixedSizeList
        height={containerHeight}
        itemCount={sortedFiles.length}
        itemSize={50}
        width="100%"
        className="scrollbar-thin"
      >
        {({ index, style }): React.ReactElement => (
          <div style={style}>
            <FileListItem
              file={sortedFiles[index]}
              selected={selectedFiles.includes(sortedFiles[index].path)}
              onClick={(): void => onFileClick(sortedFiles[index])}
              onDoubleClick={(): void => onFileDoubleClick(sortedFiles[index])}
              onContextMenu={(e): void => onFileContextMenu(sortedFiles[index], e)}
            />
          </div>
        )}
      </FixedSizeList>
    </div>
  );
};
