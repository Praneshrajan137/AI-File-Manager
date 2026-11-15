import { useState, useCallback, useRef } from 'react';
import { FileDeleteMode, FileNode, FileSystemError } from '@shared/contracts';

interface UseFileSystemReturn {
  // State
  files: FileNode[];
  currentPath: string;
  loading: boolean;
  error: FileSystemError | null;
  searchQuery: string | null;

  // Actions
  readDirectory: (path: string) => Promise<boolean>;
  deleteFile: (path: string, recursive?: boolean, skipRefresh?: boolean, mode?: FileDeleteMode) => Promise<void>;
  moveFile: (source: string, destination: string) => Promise<void>;
  setSearchResults: (results: FileNode[], query?: string) => void;
  clearSearch: () => Promise<void>;
  getLatestFiles: () => FileNode[];
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
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const readSeqRef = useRef<number>(0);
  const latestFilesRef = useRef<FileNode[]>([]);
  const { onError, onSuccess } = options;

  const readDirectory = useCallback(async (path: string): Promise<boolean> => {
    const requestSeq = ++readSeqRef.current;
    setLoading(true);
    setError(null);
    setSearchQuery(null);

    try {
      const result = await window.electronAPI.fs.readDirectory(path);
      if (requestSeq !== readSeqRef.current) {
        return false;
      }
      latestFilesRef.current = result;
      setFiles(result);
      setCurrentPath(path);
      return true;
    } catch (err: unknown) {
      if (requestSeq !== readSeqRef.current) {
        return false;
      }
      // Handle both Error objects and serialized error objects from IPC
      const errObj =
        err && typeof err === 'object'
          ? (err as { message?: string; details?: string; code?: string; cause?: { code?: string } })
          : undefined;
      const message = errObj?.message || errObj?.details || (typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err));
      const fsError: FileSystemError = {
        code: toFileSystemErrorCode(errObj?.code ?? errObj?.cause?.code),
        message: message,
        path: path,
      };
      setError(fsError);
      onError?.(`Failed to read directory: ${message}`);
      return false;
    } finally {
      if (requestSeq === readSeqRef.current) {
        setLoading(false);
      }
    }
  }, [onError]);

  const deleteFile = useCallback(async (
    path: string,
    recursive: boolean = true,
    skipRefresh: boolean = false,
    mode?: FileDeleteMode
  ) => {
    try {
      await window.electronAPI.fs.delete(path, recursive, mode);
      onSuccess?.('File deleted successfully');
      if (!skipRefresh && currentPath) {
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

  const setSearchResults = useCallback((results: FileNode[], query?: string) => {
    readSeqRef.current += 1;
    setLoading(false);
    setError(null);
    setSearchQuery(query?.trim() || 'Active search');
    latestFilesRef.current = results;
    setFiles(results);
  }, []);

  const clearSearch = useCallback(async (): Promise<void> => {
    setSearchQuery(null);
    if (currentPath) {
      await readDirectory(currentPath);
    }
  }, [currentPath, readDirectory]);

  const getLatestFiles = useCallback((): FileNode[] => latestFilesRef.current, []);

  return {
    files,
    currentPath,
    loading,
    error,
    searchQuery,
    readDirectory,
    deleteFile,
    moveFile,
    setSearchResults,
    clearSearch,
    getLatestFiles,
  };
}
