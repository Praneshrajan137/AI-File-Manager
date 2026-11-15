/**
 * WorkspaceMcpServer.ts - Opt-in Read-Only Stdio MCP Server (JSON-RPC 2.0)
 *
 * Exposes sandboxed, SecretGuard-redacted workspace tools to external local agents
 * (e.g. Claude Desktop, Cursor) strictly on explicit opt-in invocation.
 *
 * Transport Invariant: `stdout` carries ONLY newline-delimited JSON-RPC 2.0 responses.
 * All diagnostics/warnings route strictly to `stderr`.
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { PathValidator } from '../main/services/PathValidator';
import { FileSystemService } from '../main/services/FileSystemService';
import { OperationJournal } from '../main/services/OperationJournal';
import { AIOrganizerService } from '../main/services/AIOrganizerService';
import { WorkspaceKnowledgeGraph } from '../main/services/WorkspaceKnowledgeGraph';
import { isSensitiveSecretFile, redactSensitiveText } from '../shared/security/SecretGuard';
import { OrganizeStrategy } from '../shared/contracts';
import { ConfigManager } from '../shared/config';
import { Logger } from '../shared/logging';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_INFO = {
  name: 'privatevault-workspace-mcp',
  version: '0.1.0',
} as const;

const SKIPPED_WALK_DIRS = new Set([
  '.git',
  'node_modules',
  '.file-manager',
  'dist',
  'build',
  '.next',
]);

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface WorkspaceMcpServerOptions {
  allowedRoots: string[];
  graphDbPath?: string;
  knowledgeGraph?: WorkspaceKnowledgeGraph;
  vaultDir?: string;
}

const VALID_ORGANIZE_STRATEGIES = new Set<OrganizeStrategy>([
  'auto',
  'smart_category',
  'by_type',
  'by_date',
  'ai_suggested',
  'deduplicate',
  'semantic_cluster',
]);

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'list_directory',
    description:
      'List files and subdirectories inside an allowed workspace folder (sensitive secret files redacted/omitted).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or canonical path inside an allowed root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Find matching filenames/paths across allowed workspace roots (respects PathValidator and SecretGuard).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive filename or path substring' },
        rootPath: { type: 'string', description: 'Optional directory root filter inside workspace' },
        limit: { type: 'integer', description: 'Maximum file results (default 40, max 100)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_content',
    description:
      'Search indexed code & document chunks via SQLite FTS5 BM25 with SecretGuard inline redaction.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords, function names, or phrase tokens' },
        topK: { type: 'integer', description: 'Maximum matches (default 10, max 30)' },
        rootPath: { type: 'string', description: 'Optional folder scope filter' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file_range',
    description:
      'Read 1-based line range from an allowed file with PathValidator containment and SecretGuard credential redaction.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Canonical file path inside workspace' },
        startLine: { type: 'integer', description: '1-based starting line (default 1)' },
        endLine: { type: 'integer', description: 'Optional 1-based inclusive end line' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'graph_lookup',
    description:
      'Query WorkspaceKnowledgeGraph stats, code/markdown symbol definitions, backlinks, topic collections, or node/edge topology.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['stats', 'symbol', 'backlink', 'collections', 'map'],
          description: 'Knowledge graph query mode',
        },
        query: { type: 'string', description: 'Symbol name or link target (required for symbol/backlink)' },
        rootPrefix: { type: 'string', description: 'Optional folder prefix scope' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'organize_dry_run',
    description:
      'Preview a read-only file organization, semantic clustering, or SHA-256 deduplication plan without mutating disk.',
    inputSchema: {
      type: 'object',
      properties: {
        targetDir: { type: 'string', description: 'Canonical target directory inside workspace' },
        strategy: {
          type: 'string',
          enum: ['auto', 'smart_category', 'by_type', 'by_date', 'deduplicate', 'semantic_cluster'],
          description: 'Dry-run classification strategy (default: auto)',
        },
        recursive: { type: 'boolean', description: 'Include subdirectories (default false)' },
      },
      required: ['targetDir'],
    },
  },
];

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid or missing string argument "${field}"`);
  }
  return value.trim();
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asClampedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export class WorkspaceMcpServer {
  private readonly validator: PathValidator;
  private readonly fsService: FileSystemService;
  private readonly organizer: AIOrganizerService;
  private readonly graph: WorkspaceKnowledgeGraph | null;
  private readonly ownsGraph: boolean;
  private readonly allowedRoots: string[];

  constructor(options: WorkspaceMcpServerOptions) {
    const roots = options.allowedRoots
      .map((r) => path.resolve(r.trim()))
      .filter((r) => r.length > 0);
    if (roots.length === 0) {
      throw new Error('WorkspaceMcpServer requires at least one allowedRoot');
    }

    this.allowedRoots = roots;
    this.validator = new PathValidator(roots);
    this.fsService = new FileSystemService(roots);

    const journal = new OperationJournal({
      vaultDir: options.vaultDir ?? path.join(os.tmpdir(), 'privatevault-mcp-readonly-vault'),
      validator: this.validator,
      fileSystemService: this.fsService,
    });

    if (options.knowledgeGraph) {
      this.graph = options.knowledgeGraph;
      this.ownsGraph = false;
    } else if (options.graphDbPath && fsSync.existsSync(options.graphDbPath)) {
      this.graph = new WorkspaceKnowledgeGraph(options.graphDbPath);
      this.ownsGraph = true;
    } else {
      this.graph = null;
      this.ownsGraph = false;
    }

    this.organizer = new AIOrganizerService({
      validator: this.validator,
      operationJournal: journal,
      findImpactForPaths: this.graph
        ? (paths): ReturnType<WorkspaceKnowledgeGraph['findImpactForPaths']> =>
            this.graph!.findImpactForPaths(paths)
        : undefined,
    });
  }

  async close(): Promise<void> {
    if (this.ownsGraph && this.graph) {
      this.graph.close();
    }
  }

  async handleRawLine(line: string): Promise<string | null> {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      const errorResp: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      };
      return JSON.stringify(errorResp);
    }

    const response = await this.handleMessage(parsed);
    return response ? JSON.stringify(response) : null;
  }

  async handleMessage(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: req?.id ?? null,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }

    // JSON-RPC notifications have no id and must not produce a response frame
    if (req.id === undefined) {
      return null;
    }

    const id = req.id;

    try {
      switch (req.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: MCP_SERVER_INFO,
            },
          };

        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { tools: MCP_TOOLS },
          };

        case 'tools/call': {
          const params = req.params ?? {};
          const toolName = asString(params.name, 'name');
          const toolArgs =
            params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
              ? (params.arguments as Record<string, unknown>)
              : {};

          const output = await this.executeTool(toolName, toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: output,
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message },
      };
    }
  }

  private async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      let data: unknown;
      switch (toolName) {
        case 'list_directory':
          data = await this.toolListDirectory(args);
          break;
        case 'search_files':
          data = await this.toolSearchFiles(args);
          break;
        case 'search_content':
          data = await this.toolSearchContent(args);
          break;
        case 'read_file_range':
          data = await this.toolReadFileRange(args);
          break;
        case 'graph_lookup':
          data = await this.toolGraphLookup(args);
          break;
        case 'organize_dry_run':
          data = await this.toolOrganizeDryRun(args);
          break;
        default:
          return {
            content: [{ type: 'text', text: `Unknown or disabled tool "${toolName}"` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  }

  private async assertValidatedPath(candidatePath: string): Promise<string> {
    const res = await this.validator.validateCanonical(candidatePath);
    if (!res.valid || !res.canonicalPath) {
      throw new Error(res.details || res.error || `Access denied for path: ${candidatePath}`);
    }
    return res.canonicalPath;
  }

  private isPathAllowedFast(filePath: string): boolean {
    if (isSensitiveSecretFile(filePath).blocked) {
      return false;
    }
    return this.validator.validate(filePath).valid;
  }

  private async toolListDirectory(args: Record<string, unknown>): Promise<unknown> {
    const dirPath = await this.assertValidatedPath(asString(args.path, 'path'));
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const filtered: Array<{ name: string; path: string; isDirectory: boolean }> = [];
    for (const entry of entries) {
      if (SKIPPED_WALK_DIRS.has(entry.name)) {
        continue;
      }
      const childPath = path.join(dirPath, entry.name);
      if (isSensitiveSecretFile(childPath).blocked) {
        continue;
      }
      filtered.push({
        name: entry.name,
        path: childPath,
        isDirectory: entry.isDirectory(),
      });
      if (filtered.length >= 200) {
        break;
      }
    }
    filtered.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

    return { directory: dirPath, count: filtered.length, entries: filtered };
  }

  private async toolSearchFiles(args: Record<string, unknown>): Promise<unknown> {
    const query = asString(args.query, 'query').toLowerCase();
    const limit = asClampedInt(args.limit, 40, 1, 100);
    const rootArg = asOptionalString(args.rootPath);
    const scanRoots = rootArg ? [await this.assertValidatedPath(rootArg)] : this.allowedRoots;

    const matches: Array<{ path: string; name: string; isDirectory: boolean }> = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6 || matches.length >= limit) {
        return;
      }
      let entries: fsSync.Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= limit) break;
        if (SKIPPED_WALK_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (isSensitiveSecretFile(fullPath).blocked) continue;
        if (!(await this.validator.validateCanonical(fullPath)).valid) continue;

        if (entry.name.toLowerCase().includes(query) || fullPath.toLowerCase().includes(query)) {
          matches.push({ path: fullPath, name: entry.name, isDirectory: entry.isDirectory() });
        }
        if (entry.isDirectory() && depth < 6) {
          await walk(fullPath, depth + 1);
        }
      }
    };

    for (const root of scanRoots) {
      await walk(root, 0);
      if (matches.length >= limit) break;
    }

    return { query, count: matches.length, matches };
  }

  private async toolSearchContent(args: Record<string, unknown>): Promise<unknown> {
    const query = asString(args.query, 'query');
    const topK = asClampedInt(args.topK, 10, 1, 30);
    const rootArg = asOptionalString(args.rootPath);
    const folderPath = rootArg ? await this.assertValidatedPath(rootArg) : undefined;

    if (!this.graph) {
      return {
        query,
        indexed: false,
        matches: [],
        note: 'Knowledge graph SQLite database is not initialized yet; index a folder in PrivateVault first.',
      };
    }

    const rawMatches = this.graph.searchLexical(query, topK * 2, folderPath ? { folderPath } : undefined);
    const sanitizedMatches = rawMatches
      .filter((m) => this.isPathAllowedFast(m.filePath))
      .slice(0, topK)
      .map((m) => ({
        filePath: m.filePath,
        fileName: path.basename(m.filePath),
        startLine: m.startLine,
        endLine: m.endLine,
        heading: redactSensitiveText(m.heading).sanitizedText,
        snippet: redactSensitiveText(m.chunkText).sanitizedText,
        score: m.bm25Score,
      }));

    return { query, indexed: true, count: sanitizedMatches.length, matches: sanitizedMatches };
  }

  private async toolReadFileRange(args: Record<string, unknown>): Promise<unknown> {
    const canonicalPath = await this.assertValidatedPath(asString(args.filePath, 'filePath'));
    const secretCheck = isSensitiveSecretFile(canonicalPath);
    if (secretCheck.blocked) {
      throw new Error(secretCheck.reason || 'Access denied: file blocked by SecretGuard');
    }

    const startLine = asClampedInt(args.startLine, 1, 1, 1_000_000);
    const endLine =
      args.endLine !== undefined
        ? asClampedInt(args.endLine, startLine + 199, startLine, startLine + 399)
        : undefined;

    const range = await this.fsService.readFileRange(canonicalPath, startLine, endLine);
    let totalRedactions = 0;
    const redactedLines = range.lines.map((line) => {
      const res = redactSensitiveText(line.text);
      totalRedactions += res.redactionsCount;
      return { lineNumber: line.lineNumber, text: res.sanitizedText };
    });

    return {
      path: range.path,
      name: range.name,
      startLine: range.startLine,
      endLine: range.endLine,
      totalLines: range.totalLines,
      truncated: range.truncated,
      redactionsApplied: totalRedactions,
      lines: redactedLines,
    };
  }

  private async toolGraphLookup(args: Record<string, unknown>): Promise<unknown> {
    const kind = asString(args.kind, 'kind');
    const rootPrefix = asOptionalString(args.rootPrefix);
    const scopedRoot = rootPrefix ? await this.assertValidatedPath(rootPrefix) : undefined;

    if (!this.graph) {
      return { indexed: false, kind, note: 'Knowledge graph SQLite database not present yet.' };
    }

    switch (kind) {
      case 'stats': {
        const insights = this.graph.getInsights();
        return {
          totalFiles: insights.totalFiles,
          totalChunks: insights.totalChunks,
          totalTokens: insights.totalTokens,
          lastIndexed: insights.lastIndexed,
          totalWastedBytes: insights.totalWastedBytes,
          duplicateClusters: insights.duplicateClusters.map((c) => ({
            ...c,
            files: c.files.filter((fp) => this.isPathAllowedFast(fp)),
          })),
          topHubs: insights.topHubs,
          recentFiles: insights.recentFiles.filter((f) => this.isPathAllowedFast(f.path)),
        };
      }
      case 'symbol': {
        const query = asString(args.query, 'query');
        return {
          query,
          matches: this.graph
            .findBySymbol(query, 30)
            .filter((m) => this.isPathAllowedFast(m.filePath)),
        };
      }
      case 'backlink': {
        const query = asString(args.query, 'query');
        return {
          query,
          backlinks: this.graph
            .findBacklinks(query, 50)
            .filter((b) => this.isPathAllowedFast(b.sourcePath)),
        };
      }
      case 'collections': {
        const groups = this.graph.getSemanticCollections(scopedRoot);
        return {
          collections: groups
            .map((g) => ({
              ...g,
              files: g.files.filter((f) => this.isPathAllowedFast(f.path)),
            }))
            .filter((g) => g.files.length > 0),
        };
      }
      case 'map': {
        const map = this.graph.getWorkspaceGraphMap(scopedRoot, 100);
        const safeNodes = map.nodes.filter((n) => this.isPathAllowedFast(n.path));
        const safeSet = new Set(safeNodes.map((n) => n.path));
        return {
          rootPrefix: map.rootPrefix,
          totalFilesIndexed: safeNodes.length,
          nodes: safeNodes,
          edges: map.edges.filter((e) => safeSet.has(e.source) && safeSet.has(e.target)),
        };
      }
      default:
        throw new Error(`Unsupported graph_lookup kind "${kind}"`);
    }
  }

  private async toolOrganizeDryRun(args: Record<string, unknown>): Promise<unknown> {
    const targetDir = await this.assertValidatedPath(asString(args.targetDir, 'targetDir'));
    const rawStrategy = asOptionalString(args.strategy) ?? 'auto';
    if (!VALID_ORGANIZE_STRATEGIES.has(rawStrategy as OrganizeStrategy)) {
      throw new Error(`Unsupported organize strategy "${rawStrategy}"`);
    }
    const recursive = typeof args.recursive === 'boolean' ? args.recursive : false;

    // Strictly dry-run proposal; WorkspaceMcpServer never exposes apply/mutating calls
    return this.organizer.proposeOrganizationPlan({
      targetDir,
      strategy: rawStrategy as OrganizeStrategy,
      useLLM: false,
      recursive,
    });
  }

  startStdio(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout,
    errOutput: NodeJS.WritableStream = process.stderr
  ): readline.Interface {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    let pendingChain = Promise.resolve();

    rl.on('line', (line) => {
      pendingChain = pendingChain
        .then(async () => {
          const responseLine = await this.handleRawLine(line);
          if (responseLine !== null) {
            output.write(`${responseLine}\n`);
          }
        })
        .catch((err: unknown) => {
          errOutput.write(
            `[WorkspaceMcpServer] Unexpected frame error: ${
              err instanceof Error ? err.message : String(err)
            }\n`
          );
        });
    });

    rl.once('close', () => {
      void pendingChain.finally(() => {
        void this.close();
      });
    });

    return rl;
  }
}

export function resolveDefaultGraphDbPath(): string {
  const baseDir =
    process.env.APPDATA ||
    process.env.XDG_CONFIG_HOME ||
    path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.config');
  const candidates = [
    path.join(baseDir, 'project-2-file-manager', 'workspace-graph.sqlite'),
    path.join(baseDir, 'ai-file-manager', 'workspace-graph.sqlite'),
  ];
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

export function parseCliArgs(argv: string[]): { roots: string[]; dbPath?: string } {
  const roots: string[] = [];
  let dbPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--root' || arg === '-r') && argv[i + 1]) {
      roots.push(argv[++i]);
    } else if (arg === '--roots' && argv[i + 1]) {
      for (const part of argv[++i].split(',')) {
        if (part.trim()) roots.push(part.trim());
      }
    } else if (arg === '--db' && argv[i + 1]) {
      dbPath = argv[++i];
    }
  }

  return { roots, dbPath };
}

export function runStdioCli(argv: string[] = process.argv.slice(2)): void {
  // Guarantee zero console/logger output reaches stdout in stdio MCP mode
  Logger.initialize({ console: false, file: false });
  const writeStderr = (...args: unknown[]): void => {
    process.stderr.write(`${args.map((a) => String(a)).join(' ')}\n`);
  };
  Object.assign(globalThis.console, {
    log: writeStderr,
    info: writeStderr,
    warn: writeStderr,
  });

  const { roots, dbPath } = parseCliArgs(argv);
  let resolvedRoots = roots;
  if (resolvedRoots.length === 0) {
    try {
      ConfigManager.initialize();
      const configuredRoots = ConfigManager.getInstance().getAll().fileSystem?.allowedRoots ?? [];
      if (configuredRoots.length > 0) {
        resolvedRoots = configuredRoots;
      }
    } catch {
      // Fall back safely
    }
  }
  if (resolvedRoots.length === 0) {
    resolvedRoots = [os.homedir()];
  }

  const resolvedDbPath = dbPath ?? resolveDefaultGraphDbPath();
  const server = new WorkspaceMcpServer({
    allowedRoots: resolvedRoots,
    graphDbPath: resolvedDbPath,
  });

  process.stderr.write(
    `[WorkspaceMcpServer] Ready (roots=${resolvedRoots.join(';')}, db=${resolvedDbPath})\n`
  );
  server.startStdio(process.stdin, process.stdout, process.stderr);
}

const isInvokedDirectly =
  typeof process !== 'undefined' &&
  !process.env.JEST_WORKER_ID &&
  ((typeof require !== 'undefined' && require.main === module) ||
    path.basename(process.argv[1] || '').startsWith('mcpServer'));

if (isInvokedDirectly) {
  runStdioCli();
}
