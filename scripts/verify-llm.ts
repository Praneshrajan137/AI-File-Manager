/**
 * Manual Verification Script for LLM Integration
 * 
 * Run with: npx ts-node scripts/verify-llm.ts
 */
import { IndexingService } from '../src/llm/services/IndexingService';
import { EmbeddingModel } from '../src/llm/models/EmbeddingModel';
import { VectorStore } from '../src/llm/services/VectorStore';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

async function verify() {
    console.log('Starting verification...');

    // Setup
    const testDir = path.join(os.tmpdir(), `llm-verify-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
        console.log(`Test directory: ${testDir}`);

        // Create test files
        await fs.writeFile(path.join(testDir, 'test.txt'), 'Hello world content.');
        await fs.writeFile(path.join(testDir, 'test.pdf'), 'Mock PDF content'); // Not a real PDF, but file extension matches

        // Initialize services
        // Mock EmbeddingModel (we don't need real embeddings, just checking the pipeline)
        const mockEmbeddingModel = {
            initialize: async () => { },
            embed: async () => new Array(384).fill(0),
            embedBatch: async (texts: string[]) => texts.map(() => new Array(384).fill(0)),
            getDimensions: () => 384
        } as unknown as EmbeddingModel;

        // Mock VectorStore
        const mockVectorStore = {
            initialize: async () => { },
            addChunks: async (_chunks: any[], _embeddings: any[], filePath: string) => {
                console.log(`[VectorStore] Added chunks for ${path.basename(filePath)}`);
            },
            getStats: async () => ({}),
            deleteFile: async () => { }
        } as unknown as VectorStore;

        const indexer = new IndexingService(mockEmbeddingModel, mockVectorStore);

        // 1. Test Text File
        console.log('\nTesting text file indexing...');
        const result1 = await indexer.indexFile(path.join(testDir, 'test.txt'));
        console.log('Result:', result1.success ? 'SUCCESS' : 'FAILED', result1.error || '');

        // 2. Test PDF File (Mock)
        console.log('\nTesting mock PDF indexing...');
        // This should fail to extract "text" from the mock PDF because pdf-parse will reject the invalid buffer
        // So we expect it to fallback to metadata or return error depending on implementation
        // My implementation catches error and fallback to metadata? 
        // Let's see: FileContentExtractor.extractPDF catches error -> returns metadata.
        const result2 = await indexer.indexFile(path.join(testDir, 'test.pdf'));
        console.log('Result:', result2.success ? 'SUCCESS' : 'FAILED', result2.error || '');

        if (result2.success) {
            console.log('PDF fallback worked (indexed metadata for invalid PDF)');
        }

    } catch (e) {
        console.error('Verification failed:', e);
    } finally {
        await fs.rm(testDir, { recursive: true, force: true });
        console.log('\nCleaned up.');
    }
}

verify().catch(console.error);
