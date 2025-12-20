/**
 * llmHandlers.ts - IPC handlers for LLM operations
 * 
 * Full implementation of Intelligence Layer IPC handlers.
 * Connects UI to IndexingService, RetrievalService, and LLMInterface.
 * 
 * Handlers:
 * - LLM:QUERY - Query LLM with streaming response
 * - LLM:INDEX_STATUS - Get indexing status
 * - LLM:START_INDEXING - Start indexing directory
 * - LLM:STOP_INDEXING - Stop background indexing
 * - LLM:INDEX_FILE - Index single file
 * - LLM:CHECK_OLLAMA - Check if Ollama is running
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import {
  withErrorHandling,
  checkRateLimit,
} from './securityMiddleware';
import { IndexingStatus, IndexStats } from '../../shared/contracts';
import { IPCLogger, LLMLogger } from '../../shared/logging';
import { VectorStore } from '../../llm/services/VectorStore';
import { EmbeddingModel } from '../../llm/models/EmbeddingModel';
import { IndexingService } from '../../llm/services/IndexingService';
import { RetrievalService } from '../../llm/services/RetrievalService';
import { LLMInterface } from '../../llm/services/LLMInterface';
import { FileSystemService } from '../services/FileSystemService';
import { DirectoryScanner } from '../services/DirectoryScanner';
import path from 'path';
import os from 'os';

// Service instances (lazy initialization)
let vectorStore: VectorStore | null = null;
let embeddingModel: EmbeddingModel | null = null;
let indexingService: IndexingService | null = null;
let retrievalService: RetrievalService | null = null;
let llmInterface: LLMInterface | null = null;
let fileSystemService: FileSystemService | null = null;

// Indexing state
let indexingInProgress = false;
let indexedCount = 0;
let totalToIndex = 0;
let currentFile = '';
let abortIndexing = false;

/**
 * Initialize LLM services (lazy).
 */
async function ensureServicesInitialized(): Promise<void> {
  if (vectorStore && embeddingModel) {
    return;
  }

  LLMLogger.info('Initializing LLM services...');

  try {
    // Initialize vector store
    vectorStore = new VectorStore();
    const dbPath = path.join(os.homedir(), '.file-manager', 'vectordb');
    await vectorStore.initialize(dbPath);
    LLMLogger.info('VectorStore initialized', { dbPath });

    // Initialize embedding model
    embeddingModel = new EmbeddingModel();
    await embeddingModel.initialize();
    LLMLogger.info('EmbeddingModel initialized');

    // Initialize file system service with home directory as allowed root
    const allowedRoot = os.homedir();
    fileSystemService = new FileSystemService(allowedRoot);

    // Initialize higher-level services
    indexingService = new IndexingService(
      fileSystemService,
      embeddingModel,
      vectorStore
    );

    retrievalService = new RetrievalService(vectorStore, embeddingModel);
    llmInterface = new LLMInterface();

    LLMLogger.info('All LLM services initialized');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    LLMLogger.error('Failed to initialize LLM services', { error: msg });
    throw error;
  }
}

/**
 * Handler: LLM:QUERY
 * Query LLM with streaming response.
 */
async function handleQuery(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean; error?: string }> {
  checkRateLimit('LLM:QUERY');

  if (!request || typeof request !== 'object') {
    throw new TypeError('Request must be an object');
  }

  const { query, channel } = request as { query: string; channel: string };

  if (typeof query !== 'string') {
    throw new TypeError('Field "query" must be a string');
  }

  if (typeof channel !== 'string') {
    throw new TypeError('Field "channel" must be a string');
  }

  LLMLogger.info('LLM query received', { query: query.substring(0, 100) });

  try {
    await ensureServicesInitialized();

    // 1. Retrieve relevant context
    const retrievalResult = await retrievalService!.retrieve(query);
    LLMLogger.info('Context retrieved', {
      sources: retrievalResult.sources.length,
      tokens: retrievalResult.tokenCount,
    });

    // 2. Check if Ollama is available
    const ollamaAvailable = await llmInterface!.checkConnection();
    if (!ollamaAvailable) {
      event.sender.send(channel, 'Ollama is not running. Please start Ollama with: ollama serve');
      event.sender.send(channel, '[DONE]');
      return { success: false, error: 'Ollama not available' };
    }

    // 3. Query LLM with streaming
    for await (const chunk of llmInterface!.query(query, retrievalResult)) {
      event.sender.send(channel, chunk);
    }

    // 4. Signal completion
    event.sender.send(channel, '[DONE]');

    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    event.sender.send(channel, `Error: ${msg}`);
    event.sender.send(channel, '[DONE]');
    return { success: false, error: msg };
  }
}

/**
 * Handler: LLM:INDEX_STATUS
 * Get indexing progress.
 */
async function handleIndexStatus(
  _event: IpcMainInvokeEvent,
  _request: unknown
): Promise<IndexingStatus & Partial<IndexStats>> {
  try {
    await ensureServicesInitialized();
    const stats = await indexingService!.getStats();

    return {
      indexed: indexedCount,
      total: totalToIndex,
      inProgress: indexingInProgress,
      currentFile: currentFile || undefined,
      ...stats,
    };
  } catch {
    return {
      indexed: 0,
      total: 0,
      inProgress: false,
      currentFile: undefined,
    };
  }
}

/**
 * Handler: LLM:START_INDEXING
 * Start indexing directory.
 */
async function handleStartIndexing(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean; message?: string; total?: number }> {
  checkRateLimit('LLM:START_INDEXING');

  if (!request || typeof request !== 'object' || !('path' in request)) {
    throw new TypeError('Request missing required field: path');
  }

  const { path: dirPath } = request as { path: string };

  if (indexingInProgress) {
    return { success: false, message: 'Indexing already in progress' };
  }

  LLMLogger.info('Starting indexing', { path: dirPath });

  try {
    await ensureServicesInitialized();

    indexingInProgress = true;
    indexedCount = 0;
    abortIndexing = false;

    // Scan directory for files
    const scanner = new DirectoryScanner(fileSystemService!);
    const files = await scanner.scan(dirPath, {
      recursive: true,
      extensions: ['txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'json', 'yaml', 'yml', 'xml', 'html', 'css'],
      maxSize: 10 * 1024 * 1024, // 10MB limit
    });

    totalToIndex = files.length;
    LLMLogger.info('Files to index', { count: totalToIndex });

    // Start background indexing
    indexFilesBackground(
      files.map((f) => f.path),
      event
    );

    return { success: true, total: totalToIndex };
  } catch (error: unknown) {
    indexingInProgress = false;
    const msg = error instanceof Error ? error.message : String(error);
    LLMLogger.error('Failed to start indexing', { error: msg });
    return { success: false, message: msg };
  }
}

/**
 * Index files in background with progress updates.
 */
async function indexFilesBackground(
  filePaths: string[],
  event: IpcMainInvokeEvent
): Promise<void> {
  for (const filePath of filePaths) {
    if (abortIndexing) {
      LLMLogger.info('Indexing aborted by user');
      break;
    }

    try {
      currentFile = filePath;
      await indexingService!.indexFile(filePath);
      indexedCount++;

      // Send progress update
      event.sender.send('LLM:INDEXING_PROGRESS', {
        indexed: indexedCount,
        total: totalToIndex,
        currentFile: filePath,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      LLMLogger.warn('Failed to index file', { filePath, error: msg });
    }
  }

  indexingInProgress = false;
  currentFile = '';

  // Send completion event
  event.sender.send('LLM:INDEXING_COMPLETE', {
    indexed: indexedCount,
    total: totalToIndex,
  });

  LLMLogger.info('Indexing complete', { indexed: indexedCount, total: totalToIndex });
}

/**
 * Handler: LLM:STOP_INDEXING
 * Stop background indexing.
 */
async function handleStopIndexing(
  _event: IpcMainInvokeEvent,
  _request: unknown
): Promise<{ success: boolean }> {
  checkRateLimit('LLM:STOP_INDEXING');

  if (!indexingInProgress) {
    return { success: true };
  }

  LLMLogger.info('Stopping indexing');
  abortIndexing = true;

  return { success: true };
}

/**
 * Handler: LLM:INDEX_FILE
 * Index a single file.
 */
async function handleIndexFile(
  _event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean; chunksCreated?: number; error?: string }> {
  checkRateLimit('LLM:INDEX_FILE');

  if (!request || typeof request !== 'object' || !('filePath' in request)) {
    throw new TypeError('Request missing required field: filePath');
  }

  const { filePath } = request as { filePath: string };

  try {
    await ensureServicesInitialized();
    const result = await indexingService!.indexFile(filePath);

    return {
      success: result.success,
      chunksCreated: result.chunksCreated,
      error: result.error,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

/**
 * Handler: LLM:CHECK_OLLAMA
 * Check if Ollama is running.
 */
async function handleCheckOllama(
  _event: IpcMainInvokeEvent,
  _request: unknown
): Promise<{ available: boolean; models: string[] }> {
  try {
    await ensureServicesInitialized();
    const available = await llmInterface!.checkConnection();
    const models = available ? await llmInterface!.getAvailableModels() : [];

    return { available, models };
  } catch {
    return { available: false, models: [] };
  }
}

/**
 * Register all LLM IPC handlers.
 */
export function registerLLMHandlers(): void {
  IPCLogger.info('Registering LLM IPC handlers');

  ipcMain.handle(
    'LLM:QUERY',
    withErrorHandling(handleQuery, 'LLM:QUERY')
  );

  ipcMain.handle(
    'LLM:INDEX_STATUS',
    withErrorHandling(handleIndexStatus, 'LLM:INDEX_STATUS')
  );

  ipcMain.handle(
    'LLM:START_INDEXING',
    withErrorHandling(handleStartIndexing, 'LLM:START_INDEXING')
  );

  ipcMain.handle(
    'LLM:STOP_INDEXING',
    withErrorHandling(handleStopIndexing, 'LLM:STOP_INDEXING')
  );

  ipcMain.handle(
    'LLM:INDEX_FILE',
    withErrorHandling(handleIndexFile, 'LLM:INDEX_FILE')
  );

  ipcMain.handle(
    'LLM:CHECK_OLLAMA',
    withErrorHandling(handleCheckOllama, 'LLM:CHECK_OLLAMA')
  );

  IPCLogger.info('LLM IPC handlers registered (6 handlers)');
}
