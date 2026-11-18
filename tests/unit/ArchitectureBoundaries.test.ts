import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

interface EdgeSpec {
  from: string;
  to: string;
  specifier: string;
  typeOnly: boolean;
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

function toRel(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function layerOf(relPath: string): string {
  const parts = relPath.split('/');
  if (parts[1] === 'main') {
    if (parts[2] === 'handlers') return 'main/handlers';
    if (parts[2] === 'services') return 'main/services';
    if (parts[2] === 'platform') return 'main/platform';
    if (parts[2] === 'kernel') return 'main/kernel';
    if (parts[2] === 'dsa') return 'main/dsa';
    if (parts[2] === 'middleware') return 'main/middleware';
    return 'main/entry';
  }
  return parts[1] || 'other';
}

function resolveInternalModule(fromAbs: string, spec: string): string | null {
  let candidateBase: string | null = null;
  if (spec.startsWith('@shared/')) {
    candidateBase = path.join(SRC_ROOT, 'shared', spec.slice('@shared/'.length));
  } else if (spec === '@shared') {
    candidateBase = path.join(SRC_ROOT, 'shared');
  } else if (spec.startsWith('@main/')) {
    candidateBase = path.join(SRC_ROOT, 'main', spec.slice('@main/'.length));
  } else if (spec.startsWith('@llm/')) {
    candidateBase = path.join(SRC_ROOT, 'llm', spec.slice('@llm/'.length));
  } else if (spec.startsWith('@renderer/')) {
    candidateBase = path.join(SRC_ROOT, 'renderer', spec.slice('@renderer/'.length));
  } else if (spec.startsWith('.')) {
    candidateBase = path.resolve(path.dirname(fromAbs), spec);
  }
  if (!candidateBase) return null;

  const candidates = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    path.join(candidateBase, 'index.ts'),
    path.join(candidateBase, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return toRel(candidate);
    }
  }
  return null;
}

function extractEdgesAst(absPath: string): { internal: EdgeSpec[]; external: string[] } {
  const sourceText = fs.readFileSync(absPath, 'utf-8');
  const scriptKind = absPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(absPath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const fromRel = toRel(absPath);

  const internal: EdgeSpec[] = [];
  const external: string[] = [];

  const recordSpecifier = (spec: string, typeOnly: boolean): void => {
    const resolved = resolveInternalModule(absPath, spec);
    if (resolved) {
      if (resolved !== fromRel) {
        internal.push({ from: fromRel, to: resolved, specifier: spec, typeOnly });
      }
    } else if (!spec.startsWith('.')) {
      external.push(spec);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const isTypeOnly = Boolean(
        clause?.isTypeOnly ||
          (clause?.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((el) => el.isTypeOnly))
      );
      recordSpecifier(node.moduleSpecifier.text, isTypeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      recordSpecifier(node.moduleSpecifier.text, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const firstArg = node.arguments[0];
      if (ts.isStringLiteral(firstArg)) {
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        ) {
          recordSpecifier(firstArg.text, false);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return { internal, external };
}

function findSccs(nodes: string[], edges: EdgeSpec[], includeTypeOnly: boolean): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n, new Set());
  for (const e of edges) {
    if (!includeTypeOnly && e.typeOnly) continue;
    adj.get(e.from)?.add(e.to);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const sccs: string[][] = [];

  const strongconnect = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc: string[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      if (scc.length > 1) {
        sccs.push(scc.sort());
      }
    }
  };

  for (const node of nodes) {
    if (!indices.has(node)) strongconnect(node);
  }
  return sccs;
}

describe('Architecture Boundaries & Acyclicity Gates', () => {
  const files = walkSourceFiles(SRC_ROOT);
  const relFiles = files.map(toRel);
  const allInternalEdges: EdgeSpec[] = [];
  const externalsByFile = new Map<string, string[]>();

  for (const absPath of files) {
    const { internal, external } = extractEdgesAst(absPath);
    allInternalEdges.push(...internal);
    externalsByFile.set(toRel(absPath), external);
  }

  it('maintains zero circular module dependencies across src/ (runtime and type-only)', () => {
    const runtimeCycles = findSccs(relFiles, allInternalEdges, false);
    const allCycles = findSccs(relFiles, allInternalEdges, true);

    expect(runtimeCycles).toEqual([]);
    expect(allCycles).toEqual([]);
  });

  it('prevents renderer from importing Node/Electron/backend modules or Node-coupled shared helpers', () => {
    const forbiddenExternal = new Set([
      'fs',
      'fs/promises',
      'path',
      'os',
      'crypto',
      'child_process',
      'worker_threads',
      'electron',
      'node:fs',
      'node:fs/promises',
      'node:path',
      'node:os',
      'node:sqlite',
    ]);

    const violations: string[] = [];
    for (const relPath of relFiles) {
      if (!relPath.startsWith('src/renderer/')) continue;
      for (const ext of externalsByFile.get(relPath) ?? []) {
        if (forbiddenExternal.has(ext) || ext.startsWith('node:')) {
          violations.push(`${relPath} -> external:${ext}`);
        }
      }
      for (const edge of allInternalEdges.filter((e) => e.from === relPath)) {
        if (!edge.to.startsWith('src/renderer/') && !edge.to.startsWith('src/shared/')) {
          violations.push(`${relPath} -> ${edge.to}`);
        }
        if (
          edge.to.startsWith('src/shared/config/') ||
          edge.to.startsWith('src/shared/logging/') ||
          edge.to === 'src/shared/utils/atomicFs.ts' ||
          edge.to === 'src/shared/utils/processWarnings.ts'
        ) {
          violations.push(`${relPath} -> node-shared:${edge.to}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('ratchets legacy cross-layer seam violations without allowing new regressions', () => {
    const valueSeam = (fromLayer: string, toLayer: string): EdgeSpec[] =>
      allInternalEdges.filter(
        (e) =>
          !e.typeOnly &&
          layerOf(e.from) === fromLayer &&
          layerOf(e.to) === toLayer
      );

    // Step 1 stripped AssetProtocol/Kernel -> securityMiddleware; Step 2 stripped KG -> llm; Step 3 stripped mcp -> OperationJournal/AIOrganizerService
    expect(valueSeam('main/services', 'main/handlers').length).toBeLessThanOrEqual(1);
    expect(valueSeam('llm', 'main/services').length).toBeLessThanOrEqual(5);
    expect(valueSeam('mcp', 'main/services').length).toBeLessThanOrEqual(3);
    expect(valueSeam('main/services', 'llm').length).toBeLessThanOrEqual(17);
  });

  it('keeps fileSystemHandlers free of llmHandlers / LanceDB / ONNX imports', () => {
    const fsEdges = allInternalEdges.filter((e) => e.from === 'src/main/handlers/fileSystemHandlers.ts');
    expect(fsEdges.some((e) => e.to.endsWith('llmHandlers.ts'))).toBe(false);
    expect(fsEdges.some((e) => e.to.endsWith('LlmWorkspaceService.ts'))).toBe(false);
    const fsExternals = externalsByFile.get('src/main/handlers/fileSystemHandlers.ts') ?? [];
    expect(fsExternals).not.toContain('@lancedb/lancedb');
    expect(fsExternals).not.toContain('@huggingface/transformers');
  });

  it('enforces single mutation-sync authority in fileSystemHandlers and bounded PathValidator ownership', () => {
    const fsHandlersSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/main/handlers/fileSystemHandlers.ts'),
      'utf-8'
    );
    expect(fsHandlersSrc).not.toContain('notifyMutation(');

    const newPathValidatorCount = relFiles.reduce((count, relPath) => {
      const content = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
      return count + (content.match(/\bnew PathValidator\(/g)?.length ?? 0);
    }, 0);
    // Ratcheted from 10 down to <= 3 (VaultRootAuthority x1 + FileSystemService x2 pending Step 5 DI)
    expect(newPathValidatorCount).toBeLessThanOrEqual(3);
  });

  it('keeps read-only WorkspaceMcpServer, OrganizerPlanner, and OperationJournal free of Electron runtime coupling', () => {
    const mcpEdges = allInternalEdges.filter((e) => e.from === 'src/mcp/WorkspaceMcpServer.ts');
    expect(mcpEdges.some((e) => e.to.endsWith('OperationJournal.ts'))).toBe(false);
    expect(mcpEdges.some((e) => e.to.endsWith('AIOrganizerService.ts'))).toBe(false);
    expect(mcpEdges.some((e) => e.to.startsWith('src/llm/'))).toBe(false);
    expect(externalsByFile.get('src/mcp/WorkspaceMcpServer.ts') ?? []).not.toContain('electron');

    const plannerEdges = allInternalEdges.filter(
      (e) => e.from === 'src/main/platform/organizer/OrganizerPlanner.ts'
    );
    expect(plannerEdges.some((e) => e.to.endsWith('OperationJournal.ts'))).toBe(false);
    expect(plannerEdges.some((e) => e.to.startsWith('src/llm/'))).toBe(false);

    expect(externalsByFile.get('src/main/services/OperationJournal.ts') ?? []).not.toContain('electron');
  });
});
