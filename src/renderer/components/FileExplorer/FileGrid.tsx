import React, { useMemo, useState, useEffect, useRef } from 'react';
import { FixedSizeList } from 'react-window';
import { FileNode, FileSystemError } from '@shared/contracts';
import { FileListItem } from './FileListItem';
import { EmptyState } from './EmptyState';
import { Spinner } from '@renderer/components/common/Spinner';

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
  loading,
  error
}) => {
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

  // Calculate responsive height with ResizeObserver for accurate measurements
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);

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
  }, []);

  return (
    <div 
      ref={containerRef}
      className="h-full"
      role="listbox" 
      aria-label="File list" 
      aria-multiselectable="true"
    >
      <FixedSizeList
        height={containerHeight}
        itemCount={sortedFiles.length}
        itemSize={50}
        width="100%"
        className="scrollbar-thin"
      >
        {({ index, style }) => (
          <div style={style}>
            <FileListItem
              file={sortedFiles[index]}
              selected={selectedFiles.includes(sortedFiles[index].path)}
              onClick={() => onFileClick(sortedFiles[index])}
              onDoubleClick={() => onFileDoubleClick(sortedFiles[index])}
              onContextMenu={(e) => onFileContextMenu(sortedFiles[index], e)}
            />
          </div>
        )}
      </FixedSizeList>
    </div>
  );
};
