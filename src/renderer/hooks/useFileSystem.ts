import { useState, useCallback } from 'react';
import { FileNode, FileSystemError } from '@shared/contracts';
import { useToast } from './useToast';

interface UseFileSystemReturn {
  // State
  files: FileNode[];
  currentPath: string;
  loading: boolean;
  error: FileSystemError | null;

  // Actions
  readDirectory: (path: string) => Promise<void>;
  deleteFile: (path: string, recursive?: boolean) => Promise<void>;
  moveFile: (source: string, destination: string) => Promise<void>;
}

export function useFileSystem(): UseFileSystemReturn {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<FileSystemError | null>(null);
  const { showToast } = useToast();

  const readDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.fs.readDirectory(path);
      setFiles(result);
      setCurrentPath(path);
    } catch (err: any) {
      const fsError: FileSystemError = err;
      setError(fsError);
      showToast({
        type: 'error',
        message: `Failed to read directory: ${fsError.message}`,
      });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const deleteFile = useCallback(async (path: string, recursive: boolean = true) => {
    try {
      await window.electronAPI.fs.delete(path, recursive);
      showToast({
        type: 'success',
        message: 'File deleted successfully',
      });
      // Refresh current directory
      if (currentPath) {
        await readDirectory(currentPath);
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        message: `Failed to delete: ${err.message}`,
      });
      throw err;
    }
  }, [currentPath, readDirectory, showToast]);

  const moveFile = useCallback(async (source: string, destination: string) => {
    try {
      await window.electronAPI.fs.move(source, destination);
      showToast({
        type: 'success',
        message: 'File moved successfully',
      });
      // Refresh current directory
      if (currentPath) {
        await readDirectory(currentPath);
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        message: `Failed to move file: ${err.message}`,
      });
      throw err;
    }
  }, [currentPath, readDirectory, showToast]);

  return {
    files,
    currentPath,
    loading,
    error,
    readDirectory,
    deleteFile,
    moveFile,
  };
}
