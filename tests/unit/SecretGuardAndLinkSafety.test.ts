import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { isSensitiveSecretFile, redactSensitiveText } from '../../src/shared/security/SecretGuard';
import { FileContentExtractor } from '../../src/llm/services/FileContentExtractor';
import { DirectoryScanner } from '../../src/main/services/DirectoryScanner';
import { PathValidator } from '../../src/main/services/PathValidator';
import { FileSystemService } from '../../src/main/services/FileSystemService';
import { OperationJournal } from '../../src/main/services/OperationJournal';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';
import {
  buildMarkdownLinkRepairSteps,
  rewriteMarkdownLinksInContent,
} from '../../src/main/services/MarkdownLinkRepair';

describe('Stage 1: SecretGuard, Multi-Page PDF, Copy & Link-Safe Journal', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let vaultDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-stage1-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    vaultDir = path.join(tmpDir, 'trash-vault');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(vaultDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe('SecretGuard file & inline token protection', () => {
    it('blocks private credentials while preserving safe example templates and public keys', () => {
      expect(isSensitiveSecretFile('/repo/.env').blocked).toBe(true);
      expect(isSensitiveSecretFile('/repo/.env.production').blocked).toBe(true);
      expect(isSensitiveSecretFile('C:\\app\\server.pem').blocked).toBe(true);
      expect(isSensitiveSecretFile('/home/u/.ssh/id_rsa').blocked).toBe(true);
      expect(isSensitiveSecretFile('/home/u/.npmrc').blocked).toBe(true);
      expect(isSensitiveSecretFile('/repo/secrets.yaml').blocked).toBe(true);

      expect(isSensitiveSecretFile('/repo/.env.example').blocked).toBe(false);
      expect(isSensitiveSecretFile('/repo/.env.sample').blocked).toBe(false);
      expect(isSensitiveSecretFile('/home/u/.ssh/id_rsa.pub').blocked).toBe(false);
      expect(isSensitiveSecretFile('/repo/src/auth.ts').blocked).toBe(false);
    });

    it('redacts high-confidence inline tokens while preserving surrounding code semantics', () => {
      const fakeOpenAi = `sk-${'A'.repeat(24)}`;
      const fakeGitHub = `ghp_${'B'.repeat(24)}`;
      const fakeAws = `AKIA${'1234567890ABCDEF'}`;
      const raw = [
        'const serviceName = "auth-gateway";',
        `const openai = "${fakeOpenAi}";`,
        `const github = "${fakeGitHub}";`,
        `const aws = "${fakeAws}";`,
        'const auth = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload";',
        'const dbUrl = "https://admin:superSecretPass@db.internal:5432/app";',
        'API_KEY="my_ultra_secret_value_123"',
      ].join('\n');

      const { sanitizedText, redactionsCount } = redactSensitiveText(raw);
      expect(redactionsCount).toBeGreaterThanOrEqual(5);
      expect(sanitizedText).toContain('const serviceName = "auth-gateway";');
      expect(sanitizedText).not.toContain(fakeOpenAi);
      expect(sanitizedText).not.toContain(fakeGitHub);
      expect(sanitizedText).not.toContain(fakeAws);
      expect(sanitizedText).not.toContain('superSecretPass');
      expect(sanitizedText).not.toContain('my_ultra_secret_value_123');
      expect(sanitizedText).toContain('[REDACTED_API_KEY]');
      expect(sanitizedText).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(sanitizedText).toContain('[REDACTED_AWS_KEY]');
    });

    it('blocks .env extraction and redacts inline tokens inside FileContentExtractor & DirectoryScanner', async () => {
      const envFile = path.join(workspaceDir, '.env');
      const exampleEnv = path.join(workspaceDir, '.env.example');
      const codeFile = path.join(workspaceDir, 'config.ts');

      await fs.writeFile(envFile, 'OPENAI_API_KEY=sk-' + 'Z'.repeat(30));
      await fs.writeFile(exampleEnv, 'OPENAI_API_KEY=your_key_here\n');
      await fs.writeFile(codeFile, `export const token = "ghp_${'Q'.repeat(24)}";\n`);

      const extractor = new FileContentExtractor();
      expect(extractor.isSupported(envFile)).toBe(false);
      expect(extractor.getCapability(envFile)).toBe('none');

      const blockedRes = await extractor.extract(envFile);
      expect(blockedRes.success).toBe(false);
      expect(blockedRes.content).toBeNull();
      expect(blockedRes.metadata?.securityBlocked).toBe(true);

      const safeExample = await extractor.extract(exampleEnv);
      expect(safeExample.success).toBe(true);
      expect(safeExample.content).toContain('OPENAI_API_KEY');

      const redactedCode = await extractor.extract(codeFile);
      expect(redactedCode.success).toBe(true);
      expect(redactedCode.content).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(redactedCode.content).not.toContain('Q'.repeat(20));

      const fsService = new FileSystemService(workspaceDir);
      const scanner = new DirectoryScanner(fsService);
      const scanFiles = await scanner.scan(workspaceDir, {
        recursive: true,
        skipSensitiveFiles: true,
      });
      const paths = scanFiles.map((f) => path.basename(f.path));
      expect(paths).not.toContain('.env');
      expect(paths).toContain('.env.example');
      expect(paths).toContain('config.ts');
    });

    it('streams PDF pages beyond page 100 using partial page batches up to maxCharacters', async () => {
      const fakePdf = path.join(workspaceDir, 'long-manual.pdf');
      await fs.writeFile(fakePdf, Buffer.from('%PDF-1.4\n%long'));

      const getTextMock = jest.fn(async (params?: { first?: number; partial?: number[] }) => {
        if (params?.first === 100) {
          return {
            text: 'First 100 pages',
            total: 120,
            pages: [{ num: 1, text: 'Chapter 1 intro' }],
          };
        }
        return {
          text: 'Tail pages',
          total: 120,
          pages: [{ num: 105, text: 'Chapter 12 appendix findings' }],
        };
      });

      const extractor = new FileContentExtractor() as unknown as {
        pdfParseClass: unknown;
        pdfParserLoaded: boolean;
        extract: (p: string) => Promise<{ success: boolean; content: string | null; metadata?: { pageCount?: number } }>;
      };
      extractor.pdfParseClass = jest.fn(() => ({
        getText: getTextMock,
        destroy: jest.fn().mockResolvedValue(undefined),
      }));
      extractor.pdfParserLoaded = true;

      const result = await extractor.extract(fakePdf);
      expect(result.success).toBe(true);
      expect(result.metadata?.pageCount).toBe(120);
      expect(result.content).toContain('Chapter 1 intro');
      expect(result.content).toContain('Chapter 12 appendix findings');
      expect(getTextMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Canonical backlinks, impact analysis, FS:COPY, and atomic Markdown link repair', () => {
    it('prevents substring backlink false positives and reports inbound reference impact', async () => {
      const kg = new WorkspaceKnowledgeGraph(':memory:');
      const authPath = path.join(workspaceDir, 'auth.ts');
      const oauthPath = path.join(workspaceDir, 'oauth.ts');
      const indexPath = path.join(workspaceDir, 'index.ts');

      kg.upsertDocument({
        filePath: authPath,
        chunks: [{ id: `${authPath}:0`, chunkIndex: 0, text: 'export function login() {}', startChar: 0, endChar: 26 }],
      });
      kg.upsertDocument({
        filePath: oauthPath,
        chunks: [{ id: `${oauthPath}:0`, chunkIndex: 0, text: 'import { login } from "./auth";', startChar: 0, endChar: 31 }],
        links: [{ targetRef: './auth', kind: 'import', lineNumber: 1 }],
      });
      kg.upsertDocument({
        filePath: indexPath,
        chunks: [{ id: `${indexPath}:0`, chunkIndex: 0, text: 'import { x } from "./oauth";', startChar: 0, endChar: 28 }],
        links: [{ targetRef: './oauth', kind: 'import', lineNumber: 1 }],
      });

      const oauthBacklinks = kg.findBacklinks(oauthPath);
      expect(oauthBacklinks.map((b) => path.basename(b.sourcePath))).toEqual(['index.ts']);

      const authBacklinks = kg.findBacklinks(authPath);
      expect(authBacklinks.map((b) => path.basename(b.sourcePath))).toEqual(['oauth.ts']);

      const impact = kg.findImpactForPaths([authPath]);
      expect(impact).toHaveLength(1);
      expect(impact[0].sourcePath).toBe(oauthPath);
      expect(impact[0].isMarkdownLink).toBe(false);

      kg.close();
    });

    it('supports undoable FS:COPY and atomic move + Markdown link repair undo/redo', async () => {
      const notesDir = path.join(workspaceDir, 'notes');
      const archiveDir = path.join(workspaceDir, 'archive');
      await fs.mkdir(notesDir, { recursive: true });
      await fs.mkdir(archiveDir, { recursive: true });

      const targetNote = path.join(notesDir, 'design-doc.md');
      const referencingNote = path.join(workspaceDir, 'README.md');
      await fs.writeFile(targetNote, '# Design Doc\nArchitecture spec.\n', 'utf-8');
      await fs.writeFile(
        referencingNote,
        '# Index\nSee [Design](./notes/design-doc.md#arch) and [[design-doc|the spec]].\n',
        'utf-8'
      );

      const fsService = new FileSystemService(workspaceDir);
      const validator = new PathValidator(workspaceDir);
      const journal = new OperationJournal({
        vaultDir,
        validator,
        fileSystemService: fsService,
      });

      // 1. Copy -> Undo -> Redo
      const copyDest = path.join(archiveDir, 'design-doc-copy.md');
      await journal.copy(targetNote, copyDest);
      expect(await fs.readFile(copyDest, 'utf-8')).toContain('Architecture spec');

      await journal.undo();
      await expect(fs.stat(copyDest)).rejects.toThrow();
      await journal.redo();
      expect(await fs.readFile(copyDest, 'utf-8')).toContain('Architecture spec');

      // 2. Atomic Move + Markdown link repair -> Undo restores both moved file & README.md links!
      const movedNote = path.join(archiveDir, 'architecture-spec.md');
      const linkSteps = await buildMarkdownLinkRepairSteps([referencingNote], targetNote, movedNote);
      expect(linkSteps).toHaveLength(1);
      expect(linkSteps[0].nextContent).toContain('./archive/architecture-spec.md#arch');
      expect(linkSteps[0].nextContent).toContain('[[architecture-spec|the spec]]');

      const directCheck = rewriteMarkdownLinksInContent(
        referencingNote,
        'See [x](notes/design-doc.md)',
        targetNote,
        movedNote
      );
      expect(directCheck).toContain('./archive/architecture-spec.md');

      await journal.executeBatch('Move note + repair links', [
        { type: 'move', source: targetNote, destination: movedNote },
        ...linkSteps,
      ]);

      expect(await fs.readFile(movedNote, 'utf-8')).toContain('Architecture spec');
      expect(await fs.readFile(referencingNote, 'utf-8')).toContain('./archive/architecture-spec.md#arch');

      await journal.undo();
      expect(await fs.readFile(targetNote, 'utf-8')).toContain('Architecture spec');
      expect(await fs.readFile(referencingNote, 'utf-8')).toContain('./notes/design-doc.md#arch');
      expect(await fs.readFile(referencingNote, 'utf-8')).toContain('[[design-doc|the spec]]');
    });
  });
});
