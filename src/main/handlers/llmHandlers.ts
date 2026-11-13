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

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { withContract, resolveAllowedRoots } from './securityMiddleware';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { IndexingStatus } from '../../shared/contracts';
import { IPCChannel } from '@shared/ipc/contracts';
import { IPCLogger, LLMLogger } from '../../shared/logging';
import { VectorStore } from '../../llm/services/VectorStore';
import { EmbeddingWorkerPool } from '../../llm/workers/EmbeddingWorkerPool';
import { IndexingService } from '../../llm/services/IndexingService';
import { RetrievalService } from '../../llm/services/RetrievalService';
import { LLMInterface } from '../../llm/services/LLMInterface';
import { FileSystemService } from '../services/FileSystemService';
import { DirectoryScanner } from '../services/DirectoryScanner';
import path from 'path';
import os from 'os';

/**
 * Calculate adaptive yield duration based on file type and indexing progress.
 * Heavy files (PDF, DOCX) need longer yields; system fatigue increases yield over time.
 */
function calculateAdaptiveYield(filePath: string, indexedCount: number): number {
  const ext = path.extname(filePath).toLowerCase();

  // Heavier files need longer yields to prevent blocking
  const heavyExtensions = ['.pdf', '.docx', '.xlsx', '.pptx'];
  const baseYield = heavyExtensions.includes(ext) ? 250 : 100;

  // Increase yield every 10 files to let system breathe (fatigue factor)
  const fatigueMultiplier = 1 + Math.floor(indexedCount / 10) * 0.1;

  return Math.min(Math.round(baseYield * fatigueMultiplier), 500);
}

// Service instances (lazy initialization)
let vectorStore: VectorStore | null = null;
let embeddingModel: EmbeddingWorkerPool | null = null;
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

    // Initialize embedding model (runs in worker thread to avoid blocking main process)
    embeddingModel = new EmbeddingWorkerPool();
    await embeddingModel.initialize();
    LLMLogger.info('EmbeddingWorkerPool initialized (worker thread)');

    // Initialize file system service synced with ConfigManager allowed roots
    fileSystemService = new FileSystemService(resolveAllowedRoots());

    // Initialize higher-level services
    // Note: IndexingService no longer needs FileSystemService, uses FileContentExtractor internally
    indexingService = new IndexingService(
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
  input: { query: string; channel: string }
): Promise<{ success: boolean; error?: string }> {
  const { query, channel } = input;
  LLMLogger.info('LLM query received', { query: query.substring(0, 100) });

  const safeSend = (streamChannel: string, payload: unknown): void => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(streamChannel, payload);
    }
  };

  let retrievalMs = 0;
  let generationMs = 0;

  try {
    await ensureServicesInitialized();

    const retrievalStart = Date.now();
    const retrievalResult = await retrievalService!.retrieve(query);
    retrievalMs = Date.now() - retrievalStart;

    LLMLogger.info('Context retrieved', {
      sources: retrievalResult.sources.length,
      tokens: retrievalResult.tokenCount,
    });

    const ollamaAvailable = await llmInterface!.checkConnection();
    if (!ollamaAvailable) {
      const msg = 'Ollama is not running. Please start Ollama with: ollama serve';
      safeSend(channel, msg);
      safeSend(`${channel}:end`, { ok: false, error: 'Ollama not available' });
      RuntimeDiagnostics.getInstance().recordLlmQuery({
        success: false,
        retrievalMs,
        generationMs: 0,
        error: 'Ollama not available',
      });
      return { success: false, error: 'Ollama not available' };
    }

    const genStart = Date.now();
    for await (const chunk of llmInterface!.query(query, retrievalResult)) {
      safeSend(channel, chunk);
    }
    generationMs = Date.now() - genStart;

    safeSend(`${channel}:end`, { ok: true });
    RuntimeDiagnostics.getInstance().recordLlmQuery({
      success: true,
      retrievalMs,
      generationMs,
    });

    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    safeSend(channel, `Error: ${msg}`);
    safeSend(`${channel}:end`, { ok: false, error: msg });
    RuntimeDiagnostics.getInstance().recordLlmQuery({
      success: false,
      retrievalMs,
      generationMs,
      error: msg,
    });
    return { success: false, error: msg };
  }
}

/**
 * Handler: LLM:INDEX_STATUS
 * Get indexing progress.
 */
async function handleIndexStatus(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<IndexingStatus> {
  try {
    await ensureServicesInitialized();
    await indexingService!.getStats();

    return {
      indexed: indexedCount,
      total: totalToIndex,
      inProgress: indexingInProgress,
      currentFile: currentFile || undefined,
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
  input: { path: string }
): Promise<{ success: boolean; message?: string; total?: number; error?: string }> {
  const dirPath = input.path;

  if (indexingInProgress) {
    return { success: false, message: 'Indexing already in progress' };
  }

  LLMLogger.info('Starting indexing', { path: dirPath });

  try {
    await ensureServicesInitialized();

    indexingInProgress = true;
    indexedCount = 0;
    abortIndexing = false;

    const scanner = new DirectoryScanner(fileSystemService!);
    const files = await scanner.scan(dirPath, {
      recursive: true,
      extensions: [
        'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'json', 'yaml', 'yml', 'xml', 'html', 'css',
        'pdf', 'docx', 'png', 'jpg', 'jpeg', 'gif', 'svg',
      ],
      maxSize: 10 * 1024 * 1024,
    });

    totalToIndex = files.length;
    LLMLogger.info('Files to index', { count: totalToIndex });

    indexFilesBackground(
      files.map((f) => f.path),
      event
    );

    return { success: true, total: totalToIndex };
  } catch (error: unknown) {
    indexingInProgress = false;
    const msg = error instanceof Error ? error.message : String(error);
    LLMLogger.error('Failed to start indexing', { error: msg });
    return { success: false, message: msg, error: msg };
  }
}

/**
 * Index files in background with progress updates.
 * 
 * Optimized for responsiveness:
 * - Longer yields between files
 * - Batch pauses every 5 files
 * - Proper error handling per file
 */
async function indexFilesBackground(
  filePaths: string[],
  event: IpcMainInvokeEvent
): Promise<void> {
  const BATCH_SIZE = 5; // Pause every 5 files for UI responsiveness

  for (const filePath of filePaths) {
    if (abortIndexing) {
      LLMLogger.info('Indexing aborted by user');
      break;
    }

    try {
      currentFile = filePath;

      // Adaptive yield based on file type and progress
      const yieldDuration = calculateAdaptiveYield(filePath, indexedCount);
      await new Promise(resolve => setTimeout(resolve, yieldDuration));

      await indexingService!.indexFile(filePath);
      indexedCount++;

      if (!event.sender.isDestroyed()) {
        event.sender.send('LLM:INDEXING_PROGRESS', {
          indexed: indexedCount,
          total: totalToIndex,
          currentFile: filePath,
        });
      }

      // Batch pause every N files with adaptive duration
      if (indexedCount % BATCH_SIZE === 0) {
        const batchYield = Math.min(300 + indexedCount * 2, 600);
        await new Promise(resolve => setTimeout(resolve, batchYield));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      LLMLogger.warn('Failed to index file', { filePath, error: msg });
      // Continue with next file, don't break on error
    }
  }

  // Flush any remaining pending records in VectorStore
  try {
    await vectorStore!.flushPendingRecords();
  } catch (flushError) {
    LLMLogger.warn('Failed to flush pending records', {
      error: flushError instanceof Error ? flushError.message : String(flushError)
    });
  }

  indexingInProgress = false;
  currentFile = '';

  // Send completion event
  if (!event.sender.isDestroyed()) {
    event.sender.send('LLM:INDEXING_COMPLETE', {
      indexed: indexedCount,
      total: totalToIndex,
    });
  }

  LLMLogger.info('Indexing complete', { indexed: indexedCount, total: totalToIndex });
}

/**
 * Handler: LLM:STOP_INDEXING
 * Stop background indexing.
 */
async function handleStopIndexing(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<{ success: boolean }> {
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
  input: { filePath: string }
): Promise<{ success: boolean; chunksCreated?: number; error?: string }> {
  try {
    await ensureServicesInitialized();
    const result = await indexingService!.indexFile(input.filePath);

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
  _input: Record<string, never>
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
 * Handler: LLM:CLEAR_INDEX
 * Clear the vector database and reset indexing state.
 */
async function handleClearIndex(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureServicesInitialized();

    const result = await vectorStore!.clear();

    indexedCount = 0;
    totalToIndex = 0;
    currentFile = '';

    LLMLogger.info('Vector index cleared');

    return { success: result.success };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    LLMLogger.error('Failed to clear index', { error: msg });
    return { success: false, error: msg };
  }
}

const LLM_CHANNELS: IPCChannel[] = [
  'LLM:QUERY',
  'LLM:INDEX_STATUS',
  'LLM:START_INDEXING',
  'LLM:STOP_INDEXING',
  'LLM:INDEX_FILE',
  'LLM:CHECK_OLLAMA',
  'LLM:CLEAR_INDEX',
];

/**
 * Register all LLM IPC handlers.
 */
export function registerLLMHandlers(): IPCChannel[] {
  IPCLogger.info('Registering LLM IPC handlers');

  ipcMain.handle('LLM:QUERY', withContract('LLM:QUERY', handleQuery));
  ipcMain.handle('LLM:INDEX_STATUS', withContract('LLM:INDEX_STATUS', handleIndexStatus));
  ipcMain.handle('LLM:START_INDEXING', withContract('LLM:START_INDEXING', handleStartIndexing));
  ipcMain.handle('LLM:STOP_INDEXING', withContract('LLM:STOP_INDEXING', handleStopIndexing));
  ipcMain.handle('LLM:INDEX_FILE', withContract('LLM:INDEX_FILE', handleIndexFile));
  ipcMain.handle('LLM:CHECK_OLLAMA', withContract('LLM:CHECK_OLLAMA', handleCheckOllama));
  ipcMain.handle('LLM:CLEAR_INDEX', withContract('LLM:CLEAR_INDEX', handleClearIndex));

  IPCLogger.info('LLM IPC handlers registered (7 handlers)');
  return [...LLM_CHANNELS];
}

/**
 * Cleanup LLM services on app shutdown.
 * Call this before app.quit() to properly terminate worker threads.
 */
export async function cleanupLLMServices(): Promise<void> {
  LLMLogger.info('Cleaning up LLM services...');

  // Terminate embedding worker if active
  if (embeddingModel) {
    try {
      await embeddingModel.terminate();
      LLMLogger.info('EmbeddingWorkerPool terminated');
    } catch (error) {
      LLMLogger.warn('Error terminating embedding worker', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    embeddingModel = null;
  }

  // Close vector store
  if (vectorStore) {
    vectorStore = null;
    LLMLogger.info('VectorStore closed');
  }

  indexingService = null;
  retrievalService = null;
  llmInterface = null;
  fileSystemService = null;

  LLMLogger.info('LLM services cleanup complete');
}
