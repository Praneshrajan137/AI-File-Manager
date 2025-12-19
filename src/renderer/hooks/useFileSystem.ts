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
  setSearchResults: (results: FileNode[]) => void;
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
      // Handle both Error objects and serialized error objects from IPC
      const message = err?.message || err?.details || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      const fsError: FileSystemError = {
        code: err?.code || 'UNKNOWN_ERROR',
        message: message,
        path: path,
      };
      setError(fsError);
      onError?.(`Failed to read directory: ${message}`);
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

  const setSearchResults = useCallback((results: FileNode[]) => {
    setFiles(results);
  }, []);

  return {
    files,
    currentPath,
    loading,
    error,
    readDirectory,
    deleteFile,
    moveFile,
    setSearchResults,
  };
}
