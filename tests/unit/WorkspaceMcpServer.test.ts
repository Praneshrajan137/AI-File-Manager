import fs from 'fs/promises';
import * as fsSync from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { WorkspaceKnowledgeGraph } from '@main/services/WorkspaceKnowledgeGraph';
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  parseCliArgs,
  WorkspaceMcpServer,
} from '../../src/mcp/WorkspaceMcpServer';

describe('Stage 5 (MCP Server): Read-Only JSON-RPC 2.0 Stdio Server with PathValidator & SecretGuard', () => {
  let sandboxDir: string;
  let workspaceRoot: string;
  let outsideRoot: string;
  let graphDbPath: string;
  let graph: WorkspaceKnowledgeGraph;
  let server: WorkspaceMcpServer;

  beforeEach(async () => {
    const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-mcp-'));
    sandboxDir = await fs.realpath(rawTmp);
    workspaceRoot = path.join(sandboxDir, 'workspace');
    outsideRoot = path.join(sandboxDir, 'outside-secret');
    graphDbPath = path.join(sandboxDir, 'graph.sqlite');

    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });

    const authTs = path.join(workspaceRoot, 'src', 'auth.ts');
    const readmeMd = path.join(workspaceRoot, 'README.md');
    const envFile = path.join(workspaceRoot, '.env');
    const pemFile = path.join(workspaceRoot, 'private.pem');
    const outsideFile = path.join(outsideRoot, 'secret-note.txt');

    await fs.writeFile(
      authTs,
      [
        'export function verifyOAuthToken(token: string): boolean {',
        '  // Test header: Bearer super_secret_bearer_token_123456',
        '  const fallbackKey = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";',
        '  return token.length > 0 && fallbackKey.length > 0;',
        '}',
      ].join('\n'),
      'utf-8'
    );

    await fs.writeFile(
      readmeMd,
      [
        '# Auth Guide',
        'See [auth.ts](./src/auth.ts) for verifyOAuthToken implementation.',
        'Also avoid hardcoding ghp_1234567890abcdefghij1234567890abcd tokens.',
      ].join('\n'),
      'utf-8'
    );

    await fs.writeFile(envFile, 'OPENAI_API_KEY=sk-live-do-not-leak-ever-999999\n', 'utf-8');
    await fs.writeFile(pemFile, '-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----\n', 'utf-8');
    await fs.writeFile(outsideFile, 'OUTSIDE VAULT CONFIDENTIAL\n', 'utf-8');

    graph = new WorkspaceKnowledgeGraph(graphDbPath);
    graph.upsertDocument({
      filePath: authTs,
      fileType: 'ts',
      sha256: 'hash-auth-1',
      size: 200,
      mtimeMs: Date.now(),
      chunks: [
        {
          id: 'chunk-auth-1',
          chunkIndex: 0,
          text: 'verifyOAuthToken validates Bearer super_secret_bearer_token_123456 and sk-proj-abcdefghijklmnopqrstuvwxyz123456',
          startChar: 0,
          endChar: 100,
          startLine: 1,
          endLine: 5,
          heading: 'verifyOAuthToken',
        },
      ],
      symbols: [{ name: 'verifyOAuthToken', kind: 'function', lineNumber: 1 }],
      links: [],
    });
    graph.upsertDocument({
      filePath: readmeMd,
      fileType: 'md',
      sha256: 'hash-readme-1',
      size: 160,
      mtimeMs: Date.now(),
      chunks: [
        {
          id: 'chunk-readme-1',
          chunkIndex: 0,
          text: '# Auth Guide referencing verifyOAuthToken',
          startChar: 0,
          endChar: 45,
          startLine: 1,
          endLine: 3,
          heading: 'Auth Guide',
        },
      ],
      symbols: [{ name: 'Auth Guide', kind: 'heading', lineNumber: 1 }],
      links: [{ targetRef: './src/auth.ts', kind: 'mdlink', lineNumber: 2 }],
    });

    server = new WorkspaceMcpServer({
      allowedRoots: [workspaceRoot],
      knowledgeGraph: graph,
      vaultDir: path.join(sandboxDir, 'trash-vault'),
    });
  });

  afterEach(async () => {
    await server.close();
    graph.close();
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it('handles JSON-RPC initialize, ping, notifications, error codes, and lists only 6 read-only tools', async () => {
    const initResp = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(initResp?.result).toEqual({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: MCP_SERVER_INFO,
    });

    // Notification (no id) must produce null response
    expect(
      await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
    ).toBeNull();

    const pingResp = await server.handleMessage({ jsonrpc: '2.0', id: 'p1', method: 'ping' });
    expect(pingResp?.result).toEqual({});

    const listResp = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (listResp?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'list_directory',
      'search_files',
      'search_content',
      'read_file_range',
      'graph_lookup',
      'organize_dry_run',
    ]);

    const badJson = await server.handleRawLine('{broken-json');
    expect(JSON.parse(badJson!)).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32700 },
    });

    const missingMethod = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'fs/delete_all',
    });
    expect(missingMethod?.error?.code).toBe(-32601);
  });

  it('enforces PathValidator and SecretGuard across list_directory, search_files, search_content, and read_file_range', async () => {
    const authTs = path.join(workspaceRoot, 'src', 'auth.ts');
    const envFile = path.join(workspaceRoot, '.env');
    const outsideFile = path.join(outsideRoot, 'secret-note.txt');

    // list_directory hides .env / private.pem
    const listRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'list_directory', arguments: { path: workspaceRoot } },
    });
    const listData = JSON.parse(
      (listRes?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { entries: Array<{ name: string }> };
    expect(listData.entries.map((e) => e.name)).toContain('README.md');
    expect(listData.entries.map((e) => e.name)).not.toContain('.env');
    expect(listData.entries.map((e) => e.name)).not.toContain('private.pem');

    // list_directory blocks traversal outside allowedRoot
    const escapedList = await server.handleMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'list_directory', arguments: { path: outsideRoot } },
    });
    expect((escapedList?.result as { isError?: boolean }).isError).toBe(true);

    // search_files skips .env & finds auth.ts
    const searchFilesRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'search_files', arguments: { query: 'auth' } },
    });
    const sfData = JSON.parse(
      (searchFilesRes?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { matches: Array<{ path: string }> };
    expect(sfData.matches.some((m) => m.path === authTs)).toBe(true);

    const searchEnvRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'search_files', arguments: { query: '.env' } },
    });
    const envData = JSON.parse(
      (searchEnvRes?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { count: number };
    expect(envData.count).toBe(0);

    // search_content redacts inline credentials in snippets
    const searchContentRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'search_content', arguments: { query: 'verifyOAuthToken' } },
    });
    const scData = JSON.parse(
      (searchContentRes?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { matches: Array<{ snippet: string }> };
    expect(scData.matches.length).toBeGreaterThanOrEqual(1);
    expect(scData.matches[0].snippet).not.toContain('super_secret_bearer_token_123456');
    expect(scData.matches[0].snippet).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(scData.matches[0].snippet).toContain('[REDACTED_');

    // read_file_range redacts credentials inside auth.ts and blocks .env / outsideRoot
    const readRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: {
        name: 'read_file_range',
        arguments: { filePath: authTs, startLine: 1, endLine: 5 },
      },
    });
    const readText = (readRes?.result as { content: Array<{ text: string }> }).content[0].text;
    expect(readText).toContain('verifyOAuthToken');
    expect(readText).toContain('[REDACTED_BEARER_TOKEN]');
    expect(readText).toContain('[REDACTED_API_KEY]');
    expect(readText).not.toContain('super_secret_bearer_token_123456');

    const blockedEnvRead = await server.handleMessage({
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: { name: 'read_file_range', arguments: { filePath: envFile } },
    });
    expect((blockedEnvRead?.result as { isError?: boolean }).isError).toBe(true);

    const blockedOutsideRead = await server.handleMessage({
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: { name: 'read_file_range', arguments: { filePath: outsideFile } },
    });
    expect((blockedOutsideRead?.result as { isError?: boolean }).isError).toBe(true);
  });

  it('serves graph_lookup, read-only organize_dry_run (never mutates disk), CLI flags, and clean JSON-RPC stdio framing', async () => {
    const authTs = path.join(workspaceRoot, 'src', 'auth.ts');

    const symbolRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'graph_lookup', arguments: { kind: 'symbol', query: 'verifyOAuth' } },
    });
    const symData = JSON.parse(
      (symbolRes?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { matches: Array<{ symbolName: string }> };
    expect(symData.matches[0].symbolName).toBe('verifyOAuthToken');

    const backlinkRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'graph_lookup', arguments: { kind: 'backlink', query: 'auth.ts' } },
    });
    const blData = JSON.parse(
      (backlinkRes?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { backlinks: Array<{ sourcePath: string }> };
    expect(blData.backlinks).toHaveLength(1);

    const dryRunRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'organize_dry_run',
        arguments: { targetDir: workspaceRoot, strategy: 'auto' },
      },
    });
    const plan = JSON.parse(
      (dryRunRes?.result as { content: Array<{ text: string }> }).content[0].text
    ) as { operations: unknown[]; summary: string };
    expect(Array.isArray(plan.operations)).toBe(true);
    // Files remain untouched on disk
    expect(fsSync.existsSync(authTs)).toBe(true);
    expect(fsSync.existsSync(path.join(workspaceRoot, 'README.md'))).toBe(true);

    // Verify parseCliArgs & clean stdio PassThrough framing (zero prose on stdout)
    expect(parseCliArgs(['--roots', 'C:\\a,C:\\b', '--root', 'C:\\c', '--db', 'x.sqlite'])).toEqual({
      roots: ['C:\\a', 'C:\\b', 'C:\\c'],
      dbPath: 'x.sqlite',
    });

    const stdinStream = new PassThrough();
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const receivedFrames: string[] = [];

    stdoutStream.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split(/\r?\n/)) {
        if (line.trim()) receivedFrames.push(line);
      }
    });

    const rl = server.startStdio(stdinStream, stdoutStream, stderrStream);
    stdinStream.write('{"jsonrpc":"2.0","id":100,"method":"ping"}\n');
    stdinStream.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    stdinStream.write('{"jsonrpc":"2.0","id":101,"method":"tools/list"}\n');
    stdinStream.end();

    await new Promise<void>((resolve) => rl.once('close', () => resolve()));
    expect(receivedFrames).toHaveLength(2);
    expect(JSON.parse(receivedFrames[0])).toEqual({ jsonrpc: '2.0', id: 100, result: {} });
    expect(JSON.parse(receivedFrames[1]).id).toBe(101);
  });
});
