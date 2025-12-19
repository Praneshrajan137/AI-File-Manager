import { useState, useCallback } from 'react';
import { FileNode, FileSystemError } from '@shared/contracts';

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

interface UseFileSystemOptions {
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export function useFileSystem(options: UseFileSystemOptions = {}): UseFileSystemReturn {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<FileSystemError | null>(null);
  const { onError, onSuccess } = options;

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
      onError?.(`Failed to read directory: ${fsError.message}`);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const deleteFile = useCallback(async (path: string, recursive: boolean = true) => {
    try {
      await window.electronAPI.fs.delete(path, recursive);
      onSuccess?.('File deleted successfully');
      // Refresh current directory
      if (currentPath) {
        await readDirectory(currentPath);
      }
    } catch (err: any) {
      onError?.(`Failed to delete: ${err.message}`);
      throw err;
    }
  }, [currentPath, readDirectory, onSuccess, onError]);

  const moveFile = useCallback(async (source: string, destination: string) => {
    try {
      await window.electronAPI.fs.move(source, destination);
      onSuccess?.('File moved successfully');
      // Refresh current directory
      if (currentPath) {
        await readDirectory(currentPath);
      }
    } catch (err: any) {
      onError?.(`Failed to move file: ${err.message}`);
      throw err;
    }
  }, [currentPath, readDirectory, onSuccess, onError]);

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
