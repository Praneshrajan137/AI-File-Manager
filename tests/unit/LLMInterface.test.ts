/**
 * LLMInterface Unit Tests
 * 
 * Tests for Ollama client streaming and connection.
 * Uses mocked fetch for isolated testing.
 */

// Mock fetch globally
const mockFetch = jest.fn();

// Mock Electron's net module before importing LLMInterface
jest.mock('electron', () => ({
    net: {
        fetch: mockFetch,
    },
}));

import { LLMInterface } from '../../src/llm/services/LLMInterface';
import { RetrievalResult } from '../../src/shared/contracts';

describe('LLMInterface', () => {
    let llmInterface: LLMInterface;

    beforeEach(() => {
        jest.clearAllMocks();
        llmInterface = new LLMInterface('http://localhost:11434');
    });

    describe('checkConnection()', () => {
        it('should return true if Ollama is running', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ models: [] }),
            });

            const result = await llmInterface.checkConnection();

            expect(result).toBe(true);
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/tags',
                expect.objectContaining({ method: 'GET' })
            );
        });

        it('should return false if Ollama is not running', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

            const result = await llmInterface.checkConnection();

            expect(result).toBe(false);
        });
    });

    describe('getAvailableModels()', () => {
        it('should return list of models', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2' },
                        { name: 'codellama' },
                    ],
                }),
            });

            const models = await llmInterface.getAvailableModels();

            expect(models).toEqual(['llama3.2', 'codellama']);
        });

        it('should return empty array on error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const models = await llmInterface.getAvailableModels();

            expect(models).toEqual([]);
        });
    });

    describe('hasModel()', () => {
        it('should return true if model exists', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [{ name: 'llama3.2' }],
                }),
            });

            const result = await llmInterface.hasModel('llama3.2');

            expect(result).toBe(true);
        });

        it('should return false if model not found', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [{ name: 'llama3.2' }],
                }),
            });

            const result = await llmInterface.hasModel('gpt4');

            expect(result).toBe(false);
        });
    });

    describe('query()', () => {
        it('should stream response chunks', async () => {
            // Create a mock ReadableStream
            const chunks = [
                JSON.stringify({ message: { content: 'Hello' }, done: false }) + '\n',
                JSON.stringify({ message: { content: ' World' }, done: false }) + '\n',
                JSON.stringify({ message: { content: '!' }, done: true }) + '\n',
            ];

            const encoder = new TextEncoder();
            let chunkIndex = 0;

            const mockReader = {
                read: jest.fn().mockImplementation(() => {
                    if (chunkIndex < chunks.length) {
                        return Promise.resolve({
                            done: false,
                            value: encoder.encode(chunks[chunkIndex++]),
                        });
                    }
                    return Promise.resolve({ done: true, value: undefined });
                }),
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => mockReader,
                },
            });

            const retrievalResult: RetrievalResult = {
                context: 'Test context',
                sources: ['/test/file.txt'],
                tokenCount: 10,
            };

            const result: string[] = [];
            for await (const chunk of llmInterface.query('test query', retrievalResult)) {
                result.push(chunk);
            }

            expect(result).toEqual(['Hello', ' World', '!']);
        });

        it('should throw error if Ollama returns error', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            });

            const retrievalResult: RetrievalResult = {
                context: '',
                sources: [],
                tokenCount: 0,
            };

            await expect(async () => {
                for await (const _ of llmInterface.query('test', retrievalResult)) {
                    // consume
                }
            }).rejects.toThrow('Ollama error');
        });
    });

    describe('queryFull()', () => {
        it('should return complete response', async () => {
            const chunks = [
                JSON.stringify({ message: { content: 'Complete' }, done: false }) + '\n',
                JSON.stringify({ message: { content: ' response' }, done: true }) + '\n',
            ];

            const encoder = new TextEncoder();
            let chunkIndex = 0;

            const mockReader = {
                read: jest.fn().mockImplementation(() => {
                    if (chunkIndex < chunks.length) {
                        return Promise.resolve({
                            done: false,
                            value: encoder.encode(chunks[chunkIndex++]),
                        });
                    }
                    return Promise.resolve({ done: true, value: undefined });
                }),
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => mockReader,
                },
            });

            const retrievalResult: RetrievalResult = {
                context: 'Test context',
                sources: [],
                tokenCount: 10,
            };

            const result = await llmInterface.queryFull('test query', retrievalResult);

            expect(result).toBe('Complete response');
        });
    });
});
