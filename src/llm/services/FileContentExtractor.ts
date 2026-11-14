/**
 * FileContentExtractor - Extract text from various file types
 * 
 * Provides unified text extraction from different file formats to enable
 * semantic indexing and AI-powered search across diverse file types.
 * 
 * Supported Formats:
 * - Text files (txt, md, json, yaml, etc.) - UTF-8 decoding
 * - Code files (js, ts, py, java, etc.) - UTF-8 decoding
 * - PDF documents - pdf-parse extraction
 * - Future: DOCX (mammoth), images (OCR via tesseract)
 * 
 * Design Principles:
 * - Graceful degradation: Returns metadata if extraction fails
 * - Non-blocking: Async operations with proper yielding
 * - Memory efficient: Stream processing for large files
 * - Extensible: Easy to add new format handlers
 */

import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Result of content extraction
 */
export interface ExtractionResult {
    /** Whether extraction succeeded */
    success: boolean;

    /** Extracted text content (null if failed) */
    content: string | null;

    /** Content type: 'full' for actual content, 'metadata' for fallback */
    contentType: 'full' | 'metadata';

    /** File type that was processed */
    fileType: string;

    /** Error message if extraction failed */
    error?: string;

    /** Extraction metadata */
    metadata?: {
        pageCount?: number;
        wordCount?: number;
        charCount?: number;
    };
}

/**
 * Configuration for extraction
 */
export interface ExtractionConfig {
    /** Maximum file size to process (bytes). Default: 50MB */
    maxFileSize?: number;

    /** Maximum characters to extract. Default: 500000 (~125 pages) */
    maxCharacters?: number;

    /** Include file metadata in output. Default: true */
    includeMetadata?: boolean;
}

// Text-based file extensions (can be read as UTF-8)
const TEXT_EXTENSIONS = new Set([
    // Documents
    'txt', 'md', 'markdown', 'rst', 'rtf',
    // Code
    'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
    'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'r',
    // Config/Data
    'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'conf',
    // Web
    'html', 'htm', 'css', 'scss', 'sass', 'less', 'svg',
    // Scripts
    'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
    // Other
    'sql', 'graphql', 'proto', 'env', 'gitignore', 'dockerfile',
    'log', 'csv', 'tsv',
]);

// Binary document formats that require special handling
const DOCUMENT_EXTENSIONS = new Set([
    'pdf',
    // Future support:
    // 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp'
]);

// Default configuration
const DEFAULT_CONFIG: Required<ExtractionConfig> = {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    maxCharacters: 500000,          // ~125 pages
    includeMetadata: true,
};

type PdfParseV2Instance = {
    getText: (params?: { first?: number }) => Promise<{
        text: string;
        total: number;
        pages?: Array<{ num: number; text: string }>;
    }>;
    destroy: () => Promise<void>;
};

type PdfParseV2Class = new (options: { data: Buffer | Uint8Array; verbosity?: number }) => PdfParseV2Instance;
type LegacyPdfParseFn = (buffer: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number }>;

export class FileContentExtractor {
    private config: Required<ExtractionConfig>;
    private pdfParseClass: PdfParseV2Class | null = null;
    private legacyPdfParser: LegacyPdfParseFn | null = null;
    private pdfParserLoaded = false;

    constructor(config?: ExtractionConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if file type is supported for content extraction.
     * 
     * @param filePath - Path to file
     * @returns True if content can be extracted
     */
    isSupported(filePath: string): boolean {
        const ext = this.getExtension(filePath);
        return TEXT_EXTENSIONS.has(ext) || DOCUMENT_EXTENSIONS.has(ext);
    }

    /**
     * Get extraction capability for file type.
     * 
     * @param filePath - Path to file
     * @returns 'full' | 'metadata' | 'none'
     */
    getCapability(filePath: string): 'full' | 'metadata' | 'none' {
        const ext = this.getExtension(filePath);

        if (TEXT_EXTENSIONS.has(ext)) return 'full';
        if (DOCUMENT_EXTENSIONS.has(ext)) return 'full';

        // Binary files get metadata only
        return 'metadata';
    }

    /**
     * Extract text content from file.
     * 
     * Main entry point for content extraction. Automatically detects file type
     * and uses appropriate extraction method.
     * 
     * @param filePath - Absolute path to file
     * @returns Extraction result with content and metadata
     */
    async extract(filePath: string): Promise<ExtractionResult> {
        const ext = this.getExtension(filePath);

        try {
            // Check file size first
            const stats = await fs.stat(filePath);
            if (stats.size > this.config.maxFileSize) {
                return this.createMetadataResult(filePath, `File too large (${this.formatSize(stats.size)})`);
            }

            // Read file as buffer
            const buffer = await fs.readFile(filePath);

            // Route to appropriate extractor
            if (TEXT_EXTENSIONS.has(ext)) {
                return await this.extractText(filePath, buffer);
            }

            if (ext === 'pdf') {
                return await this.extractPDF(filePath, buffer);
            }

            // Unsupported: return metadata only
            return this.createMetadataResult(filePath, 'Unsupported file type');

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                content: null,
                contentType: 'metadata',
                fileType: ext,
                error: `Extraction failed: ${msg}`,
            };
        }
    }

    /**
     * Extract from text-based files (code, markdown, config, etc.)
     */
    private async extractText(filePath: string, buffer: Buffer): Promise<ExtractionResult> {
        const ext = this.getExtension(filePath);

        try {
            // Detect encoding and decode
            let content = buffer.toString('utf-8');

            // Check for binary content (null bytes indicate binary)
            if (this.hasBinaryContent(content)) {
                return this.createMetadataResult(filePath, 'Binary content detected');
            }

            // Truncate if too long
            if (content.length > this.config.maxCharacters) {
                content = content.substring(0, this.config.maxCharacters) +
                    '\n\n[Content truncated - file exceeds maximum extraction size]';
            }

            // Clean up content
            content = this.cleanText(content);

            return {
                success: true,
                content,
                contentType: 'full',
                fileType: ext,
                metadata: {
                    charCount: content.length,
                    wordCount: this.countWords(content),
                },
            };
        } catch (error) {
            return this.createMetadataResult(filePath,
                `Text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Extract text from PDF documents using pdf-parse.
     * 
     * Handles:
     * - Multi-page PDFs
     * - Structured text extraction
     * - Graceful fallback on corrupt PDFs
     */
    private async extractPDF(filePath: string, buffer: Buffer): Promise<ExtractionResult> {
        const ext = 'pdf';

        try {
            // Lazy load pdf-parse (v2 exports { PDFParse }; keep callable fallback for legacy/mocks)
            if (!this.pdfParserLoaded) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const pdfParseMod = require('pdf-parse');
                    if (pdfParseMod && typeof pdfParseMod.PDFParse === 'function') {
                        this.pdfParseClass = pdfParseMod.PDFParse as PdfParseV2Class;
                    } else if (typeof pdfParseMod === 'function') {
                        this.legacyPdfParser = pdfParseMod as LegacyPdfParseFn;
                    } else if (pdfParseMod && typeof pdfParseMod.default === 'function') {
                        this.legacyPdfParser = pdfParseMod.default as LegacyPdfParseFn;
                    }
                    this.pdfParserLoaded = true;
                } catch (e) {
                    return this.createMetadataResult(filePath,
                        'PDF parsing not available (pdf-parse not installed)');
                }
            }

            // Parse PDF
            if (!this.pdfParseClass && !this.legacyPdfParser) {
                return this.createMetadataResult(
                    filePath,
                    'PDF parsing not available (pdf-parse not installed)'
                );
            }

            let content = '';
            let pageCount = 0;

            if (this.pdfParseClass) {
                const parser = new this.pdfParseClass({ data: buffer, verbosity: 0 });
                try {
                    const data = await parser.getText({ first: 100 });
                    pageCount = typeof data.total === 'number'
                        ? data.total
                        : (Array.isArray(data.pages) ? data.pages.length : 0);
                    if (Array.isArray(data.pages) && data.pages.length > 0) {
                        content = data.pages
                            .filter((p) => p && typeof p.text === 'string' && p.text.trim().length > 0)
                            .map((p) => `[Page ${p.num}]\n${p.text.trim()}`)
                            .join('\n\n');
                    } else {
                        content = data.text || '';
                    }
                } finally {
                    await parser.destroy().catch(() => undefined);
                }
            } else if (this.legacyPdfParser) {
                const data = await this.legacyPdfParser(buffer, {
                    // Limit pages for performance
                    max: 100,
                });
                content = data.text || '';
                pageCount = data.numpages || 0;
            }

            // Handle empty PDFs (might be image-based/scanned)
            if (!content.trim()) {
                return {
                    success: true,
                    content: this.createMetadataContent(filePath,
                        'PDF contains no extractable text (may be image-based/scanned)'),
                    contentType: 'metadata',
                    fileType: ext,
                    metadata: {
                        pageCount,
                    },
                };
            }

            // Clean up PDF text (often has weird spacing)
            content = this.cleanPDFText(content);

            // Truncate if necessary
            if (content.length > this.config.maxCharacters) {
                content = content.substring(0, this.config.maxCharacters) +
                    '\n\n[Content truncated - PDF exceeds maximum extraction size]';
            }

            return {
                success: true,
                content,
                contentType: 'full',
                fileType: ext,
                metadata: {
                    pageCount,
                    charCount: content.length,
                    wordCount: this.countWords(content),
                },
            };

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const errName = error instanceof Error ? error.name : '';
            const lowerMsg = msg.toLowerCase();

            // Common PDF errors
            if (lowerMsg.includes('password') || lowerMsg.includes('encrypted') || errName === 'PasswordException') {
                return this.createMetadataResult(filePath, 'PDF is password protected');
            }

            if (msg.includes('Invalid') || lowerMsg.includes('corrupt') || errName === 'InvalidPDFException') {
                return this.createMetadataResult(filePath, 'PDF appears to be corrupted');
            }

            return this.createMetadataResult(filePath, `PDF extraction failed: ${msg}`);
        }
    }

    /**
     * Create metadata-only result for unsupported/failed files.
     */
    private createMetadataResult(filePath: string, reason: string): ExtractionResult {
        return {
            success: true, // Metadata is still valid
            content: this.createMetadataContent(filePath, reason),
            contentType: 'metadata',
            fileType: this.getExtension(filePath),
            error: reason,
        };
    }

    /**
     * Generate metadata content string for indexing.
     */
    private createMetadataContent(filePath: string, note?: string): string {
        const fileName = path.basename(filePath);
        const ext = this.getExtension(filePath);
        const dirPath = path.dirname(filePath);

        let content = `File: ${fileName}\n`;
        content += `Type: ${ext.toUpperCase()} file\n`;
        content += `Location: ${dirPath}\n`;
        content += `Full Path: ${filePath}\n`;

        if (note) {
            content += `\nNote: ${note}`;
        }

        return content;
    }

    /**
     * Clean extracted text content.
     */
    private cleanText(text: string): string {
        return text
            // Normalize line endings
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Remove excessive blank lines
            .replace(/\n{4,}/g, '\n\n\n')
            // Trim
            .trim();
    }

    /**
     * Clean PDF-specific text artifacts.
     */
    private cleanPDFText(text: string): string {
        return text
            // Fix common PDF spacing issues
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            // Remove form feed characters
            .replace(/\f/g, '\n\n')
            // Normalize whitespace
            .replace(/[ \t]+/g, ' ')
            // Clean up line endings
            .replace(/\n /g, '\n')
            .replace(/ \n/g, '\n')
            // Remove excessive blank lines
            .replace(/\n{4,}/g, '\n\n\n')
            .trim();
    }

    /**
     * Check if content has binary data.
     */
    private hasBinaryContent(content: string): boolean {
        // Check first 1KB for null bytes or high concentration of non-printable
        const sample = content.substring(0, 1000);
        let nonPrintable = 0;

        for (let i = 0; i < sample.length; i++) {
            const code = sample.charCodeAt(i);
            if (code === 0) return true; // Null byte = definitely binary
            if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
                nonPrintable++;
            }
        }

        return nonPrintable / sample.length > 0.1; // >10% non-printable
    }

    /**
     * Get file extension (lowercase, without dot).
     */
    private getExtension(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        return ext.startsWith('.') ? ext.substring(1) : ext;
    }

    /**
     * Count words in text.
     */
    private countWords(text: string): number {
        return text.split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Format file size for display.
     */
    private formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
}
