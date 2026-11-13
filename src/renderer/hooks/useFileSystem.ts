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

function toFileSystemErrorCode(code?: string): FileSystemError['code'] {
  switch (code) {
    case 'PATH_TRAVERSAL':
    case 'UNAUTHORIZED_ACCESS':
    case 'FILE_NOT_FOUND':
    case 'PERMISSION_DENIED':
    case 'DISK_FULL':
    case 'UNKNOWN':
      return code;
    default:
      return 'UNKNOWN';
  }
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
    } catch (err: unknown) {
      // Handle both Error objects and serialized error objects from IPC
      const errObj = err && typeof err === 'object' ? (err as { message?: string; details?: string; code?: string }) : undefined;
      const message = errObj?.message || errObj?.details || (typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err));
      const fsError: FileSystemError = {
        code: toFileSystemErrorCode(errObj?.code),
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(`Failed to delete: ${msg}`);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(`Failed to move file: ${msg}`);
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
