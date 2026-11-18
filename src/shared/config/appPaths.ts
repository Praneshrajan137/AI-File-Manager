import fs from 'fs';
import os from 'os';
import path from 'path';
import { atomicWriteFileSync } from '../utils/atomicFs';

export const APP_BRAND_NAME = 'PrivateVault AI';
export const APP_SERVICE_SLUG = 'privatevault';
export const CANONICAL_DOT_DIR = '.privatevault';
export const LEGACY_CONFIG_DOT_DIR = '.project2-file-manager';
export const LEGACY_DATA_DOT_DIR = '.file-manager';

function resolveOsAppDataBaseDir(): string {
  return (
    process.env.APPDATA ||
    process.env.XDG_CONFIG_HOME ||
    path.join(
      os.homedir(),
      process.platform === 'darwin' ? 'Library/Application Support' : '.config'
    )
  );
}

/**
 * Resolve Electron's writable `userData` directory when running in Electron Main.
 * Returns null cleanly inside standalone Node, Worker threads, or mocked Jest tests.
 */
export function resolveElectronUserDataDir(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronMod = require('electron') as {
      app?: { getPath?: (name: string) => string };
    };
    const resolved = electronMod?.app?.getPath?.('userData');
    if (typeof resolved === 'string' && resolved.trim().length > 0) {
      return path.resolve(resolved);
    }
  } catch {
    // Running outside Electron Main process
  }
  return null;
}

export function resolveCanonicalConfigPath(): string {
  return path.join(os.homedir(), CANONICAL_DOT_DIR, 'config.json');
}

/**
 * Safely copy legacy `~/.project2-file-manager/config.json` to `~/.privatevault/config.json`
 * once on upgrade when the canonical config does not yet exist.
 */
export function migrateLegacyConfigIfNeeded(targetConfigPath: string): boolean {
  const canonicalPath = resolveCanonicalConfigPath();
  if (path.resolve(targetConfigPath) !== path.resolve(canonicalPath)) {
    return false;
  }
  if (fs.existsSync(canonicalPath)) {
    return false;
  }

  const legacyPath = path.join(os.homedir(), LEGACY_CONFIG_DOT_DIR, 'config.json');
  if (!fs.existsSync(legacyPath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(legacyPath, 'utf-8');
    JSON.parse(raw);
    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
    atomicWriteFileSync(canonicalPath, raw, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function resolveCanonicalVectorDbDir(): string {
  const allowTestOverrides =
    process.env.NODE_ENV === 'test' || process.env.E2E_TEST === 'true';
  const overrideDbPath = allowTestOverrides ? process.env.FILE_MANAGER_VECTOR_DB_PATH : undefined;
  if (overrideDbPath && overrideDbPath.trim().length > 0) {
    return path.resolve(overrideDbPath.trim());
  }

  const canonicalDir = path.join(os.homedir(), CANONICAL_DOT_DIR, 'vectordb');
  if (
    fs.existsSync(path.join(canonicalDir, 'knowledge-graph.sqlite')) ||
    fs.existsSync(path.join(canonicalDir, 'file_chunks.lance'))
  ) {
    return canonicalDir;
  }

  // Preserve pre-existing legacy indexes without duplicating gigabytes of LanceDB files
  const legacyDir = path.join(os.homedir(), LEGACY_DATA_DOT_DIR, 'vectordb');
  if (
    fs.existsSync(path.join(legacyDir, 'knowledge-graph.sqlite')) ||
    fs.existsSync(path.join(legacyDir, 'file_chunks.lance'))
  ) {
    return legacyDir;
  }

  return canonicalDir;
}

export function resolveCanonicalGraphDbPath(): string {
  const allowTestOverrides =
    process.env.NODE_ENV === 'test' || process.env.E2E_TEST === 'true';
  const envDbOverride = allowTestOverrides ? process.env.FILE_MANAGER_VECTOR_DB_PATH?.trim() : undefined;
  const canonicalGraph = path.join(
    os.homedir(),
    CANONICAL_DOT_DIR,
    'vectordb',
    'knowledge-graph.sqlite'
  );
  if (envDbOverride) {
    return path.join(path.resolve(envDbOverride), 'knowledge-graph.sqlite');
  }
  if (fs.existsSync(canonicalGraph)) {
    return canonicalGraph;
  }

  const baseDir = resolveOsAppDataBaseDir();
  const legacyCandidates = [
    path.join(os.homedir(), LEGACY_DATA_DOT_DIR, 'vectordb', 'knowledge-graph.sqlite'),
    path.join(baseDir, APP_BRAND_NAME, 'workspace-graph.sqlite'),
    path.join(baseDir, 'project-2-file-manager', 'workspace-graph.sqlite'),
    path.join(baseDir, 'ai-file-manager', 'workspace-graph.sqlite'),
  ];
  for (const candidate of legacyCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return canonicalGraph;
}

export function resolveDefaultTrashVaultDir(): string {
  const userDataDir = resolveElectronUserDataDir();
  if (userDataDir) {
    return path.join(userDataDir, 'trash-vault');
  }

  const baseDir = process.env.APPDATA || process.env.XDG_CONFIG_HOME;
  if (baseDir && baseDir.trim().length > 0) {
    const canonicalVault = path.join(baseDir, APP_SERVICE_SLUG, 'trash-vault');
    if (fs.existsSync(path.join(canonicalVault, 'journal.json'))) {
      return canonicalVault;
    }
    const legacyAiFm = path.join(baseDir, 'ai-file-manager', 'trash-vault');
    if (fs.existsSync(path.join(legacyAiFm, 'journal.json'))) {
      return legacyAiFm;
    }
    return canonicalVault;
  }

  const canonicalHomeVault = path.join(os.homedir(), CANONICAL_DOT_DIR, 'trash-vault');
  if (fs.existsSync(path.join(canonicalHomeVault, 'journal.json'))) {
    return canonicalHomeVault;
  }
  const legacyHomeVault = path.join(os.homedir(), LEGACY_DATA_DOT_DIR, 'trash-vault');
  if (fs.existsSync(path.join(legacyHomeVault, 'journal.json'))) {
    return legacyHomeVault;
  }
  return canonicalHomeVault;
}

export function resolveDefaultLogDir(): string {
  return path.join(os.homedir(), CANONICAL_DOT_DIR, 'logs');
}

/**
 * Resolve writable ONNX / Transformers model cache directory.
 * Ensures packaged desktop installs NEVER attempt writing models inside read-only `app.asar`
 * or `Program Files/.../node_modules`.
 */
export function resolveDefaultModelCacheDir(): string {
  const explicitOverride =
    process.env.FILE_MANAGER_MODEL_CACHE_DIR?.trim() ||
    process.env.TRANSFORMERS_CACHE?.trim();
  const hfHome = process.env.HF_HOME?.trim();
  const userDataDir = resolveElectronUserDataDir();

  const resolved = explicitOverride
    ? path.resolve(explicitOverride)
    : hfHome
      ? path.join(path.resolve(hfHome), 'hub')
      : userDataDir
        ? path.join(userDataDir, 'models')
        : path.join(os.homedir(), CANONICAL_DOT_DIR, 'models');

  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch {
    // Caller surfaces permission/read-only issues if model download is attempted
  }
  return resolved;
}

/**
 * Resolve runnable standalone stdio MCP entrypoint (`mcpServer.js`), handling both
 * packaged `resources/app.asar.unpacked/dist/main/mcpServer.js` and unpacked dev builds.
 */
export function resolvePackagedMcpEntryPath(currentModuleDir: string = __dirname): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const unpackedFromResources = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'dist',
      'main',
      'mcpServer.js'
    );
    if (fs.existsSync(unpackedFromResources)) {
      return unpackedFromResources;
    }
  }

  if (currentModuleDir.includes('app.asar')) {
    const unpackedFromDir = path.join(
      currentModuleDir.replace(/app\.asar(?![.])/g, 'app.asar.unpacked'),
      'mcpServer.js'
    );
    return unpackedFromDir;
  }

  const directSibling = path.join(currentModuleDir, 'mcpServer.js');
  if (fs.existsSync(directSibling)) {
    return directSibling;
  }

  const cwdBuilt = path.resolve(process.cwd(), 'dist', 'main', 'mcpServer.js');
  if (fs.existsSync(cwdBuilt)) {
    return cwdBuilt;
  }

  return 'dist/main/mcpServer.js';
}
