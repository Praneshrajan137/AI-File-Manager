import React from 'react';
import type { ListChildComponentProps } from 'react-window';
import { FileListItem } from './FileListItem';
import type { SharedVirtualItemData } from './FileGridCell';
import { extractDraggedPaths } from '@renderer/utils/explorerHelpers';

/** Stable module-level row renderer for react-window FixedSizeList. */
export const FileListRow: React.FC<ListChildComponentProps<SharedVirtualItemData>> = React.memo(({
  index,
  style,
  data,
}) => {
  const item = data.sortedFiles[index];
  if (!item) return null;
  const selected = data.selectedFiles.includes(item.path);
  const isActive = data.activePath === item.path;

  return (
    <div style={style}>
      <FileListItem
        file={item}
        selected={selected}
        isDropTarget={item.isDirectory && data.dropTargetPath === item.path}
        draggablePaths={selected ? data.selectedFiles : [item.path]}
        tabIndex={isActive ? 0 : -1}
        setSize={data.sortedFiles.length}
        posInSet={index + 1}
        onClick={(e): void => {
          data.onFocusPath(item.path);
          data.onFileClick(item, e);
        }}
        onDoubleClick={(): void => data.onFileDoubleClick(item)}
        onContextMenu={(e): void => data.onFileContextMenu(item, e)}
        onKeyDown={(e): void => data.onItemKeyDown(item, index, e)}
        onDragOverFolder={(e): void => {
          if (!item.isDirectory || !data.onDropMove) return;
          if (e.dataTransfer.types.includes('application/x-fm-paths')) {
            e.preventDefault();
            e.stopPropagation();
            data.setDropTargetPath(item.path);
          }
        }}
        onDragLeaveFolder={(): void => {
          if (data.dropTargetPath === item.path) data.setDropTargetPath(null);
        }}
        onDropOnFolder={(e): void => {
          if (!item.isDirectory || !data.onDropMove) return;
          e.preventDefault();
          e.stopPropagation();
          const dragged = extractDraggedPaths(e.dataTransfer);
          data.setDropTargetPath(null);
          if (dragged.length > 0) {
            data.onDropMove(dragged, item.path);
          }
        }}
      />
    </div>
  );
});

FileListRow.displayName = 'FileListRow';
