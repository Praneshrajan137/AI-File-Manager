import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function findPackagedExecutable(unpackedDir) {
  const entries = fs.readdirSync(unpackedDir, { withFileTypes: true });
  if (process.platform === 'win32') {
    const exe = entries.find(
      (e) =>
        e.isFile() &&
        e.name.toLowerCase().endsWith('.exe') &&
        !e.name.toLowerCase().includes('unins') &&
        !e.name.toLowerCase().includes('squirrel')
    );
    return exe ? path.join(unpackedDir, exe.name) : null;
  }

  const excludedLinux = new Set([
    'chrome-sandbox',
    'chrome_crashpad_handler',
    'xdg-open',
  ]);
  const binaries = entries.filter((e) => {
    if (!e.isFile() || excludedLinux.has(e.name) || e.name.endsWith('.so')) {
      return false;
    }
    const mode = fs.statSync(path.join(unpackedDir, e.name)).mode;
    return (mode & 0o111) !== 0;
  });
  const preferred = binaries.find((e) => e.name.toLowerCase().includes('privatevault'));
  return preferred
    ? path.join(unpackedDir, preferred.name)
    : binaries[0]
      ? path.join(unpackedDir, binaries[0].name)
      : null;
}

async function verifyPackagedMcpServer(unpackedMcpPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-mcp-smoke-'));
  const workspaceDir = path.join(tmpDir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, 'hello.md'), '# Packaged MCP Check\nOK\n', 'utf-8');
  const dbPath = path.join(tmpDir, 'knowledge-graph.sqlite');

  try {
    const requests = [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'verify-unpacked-build', version: '1.0.0' },
        },
      }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_directory', arguments: { path: workspaceDir } },
      }),
    ].join('\n') + '\n';

    const result = spawnSync(
      process.execPath,
      [unpackedMcpPath, '--root', workspaceDir, '--db', dbPath],
      {
        input: requests,
        encoding: 'utf-8',
        timeout: 20_000,
        env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
      }
    );

    if (result.status !== 0) {
      throw new Error(
        `Unpacked MCP server exited with ${result.status}: ${(result.stderr || '').slice(0, 600)}`
      );
    }

    const lines = (result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = lines.map((line) => JSON.parse(line));
    const initResp = parsed.find((msg) => msg.id === 1);
    const listResp = parsed.find((msg) => msg.id === 2);
    const dirResp = parsed.find((msg) => msg.id === 3);

    if (!initResp?.result?.protocolVersion) {
      throw new Error(`MCP initialize failed: ${result.stdout}`);
    }
    const toolNames = (listResp?.result?.tools || []).map((t) => t.name);
    const expectedTools = [
      'list_directory',
      'search_files',
      'search_content',
      'read_file_range',
      'graph_lookup',
      'organize_dry_run',
    ];
    const missingTools = expectedTools.filter((name) => !toolNames.includes(name));
    if (missingTools.length > 0) {
      throw new Error(
        `Unexpected MCP tools list (missing ${missingTools.join(', ')}): ${JSON.stringify(toolNames)}`
      );
    }
    const dirText = dirResp?.result?.content?.[0]?.text || '';
    if (!dirText.includes('hello.md')) {
      throw new Error(`MCP list_directory missing hello.md: ${dirText}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function verifyPackagedElectronBoot(executablePath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-boot-smoke-'));
  const userDataDir = path.join(tmpDir, 'user-data');
  const appDataDir = path.join(tmpDir, 'AppData', 'Roaming');
  const localAppDataDir = path.join(tmpDir, 'AppData', 'Local');
  const reportFile = path.join(tmpDir, 'smoke-report.json');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(localAppDataDir, { recursive: true });

  const args = [
    '--smoke-packaged-boot',
    `--user-data-dir=${userDataDir}`,
    `--smoke-report-file=${reportFile}`,
    '--disable-gpu',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ];

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executablePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
          HOME: tmpDir,
          USERPROFILE: tmpDir,
          APPDATA: appDataDir,
          LOCALAPPDATA: localAppDataDir,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += String(d);
      });
      child.stderr.on('data', (d) => {
        stderr += String(d);
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Packaged binary smoke boot timed out after 30s\nstderr: ${stderr}`));
      }, 30_000);
      child.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `Packaged binary exited code=${code} signal=${signal}\nstdout=${stdout}\nstderr=${stderr}`
            )
          );
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    if (!fs.existsSync(reportFile)) {
      throw new Error('Packaged smoke boot did not produce smoke-report.json');
    }
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
    if (!report.ok || !report.packaged || !report.mcpExists || Number(report.registeredChannels) < 50) {
      throw new Error(`Invalid packaged smoke report: ${JSON.stringify(report)}`);
    }
    if (!report.modelCacheDir || report.modelCacheDir.includes('node_modules')) {
      throw new Error(`Invalid modelCacheDir in packaged build: ${report.modelCacheDir}`);
    }
    return report;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const distPackagesDir = path.resolve(process.cwd(), 'dist-packages');
  if (!fs.existsSync(distPackagesDir)) {
    throw new Error(`dist-packages directory not found at ${distPackagesDir}`);
  }

  const entries = fs.readdirSync(distPackagesDir, { withFileTypes: true });
  const unpackedDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('-unpacked'))
    .map((entry) => path.join(distPackagesDir, entry.name));

  if (unpackedDirs.length === 0) {
    throw new Error(`No *-unpacked directory found inside ${distPackagesDir}`);
  }

  const unpackedDir = unpackedDirs[0];
  const resourcesDir = path.join(unpackedDir, 'resources');
  const appAsar = path.join(resourcesDir, 'app.asar');
  const appAsarUnpacked = path.join(resourcesDir, 'app.asar.unpacked');

  if (!fs.existsSync(appAsar)) {
    throw new Error(`Missing packaged archive: ${appAsar}`);
  }
  if (!fs.existsSync(appAsarUnpacked)) {
    throw new Error(`Missing unpacked native directory: ${appAsarUnpacked}`);
  }

  const executablePath = findPackagedExecutable(unpackedDir);
  if (!executablePath) {
    throw new Error(`No Electron application binary found in ${unpackedDir}`);
  }

  const asarSizeBytes = fs.statSync(appAsar).size;
  if (asarSizeBytes < 1024) {
    throw new Error(`Packaged app.asar is unexpectedly small (${asarSizeBytes} bytes)`);
  }

  const unpackedMcpPath = path.join(appAsarUnpacked, 'dist', 'main', 'mcpServer.js');
  const unpackedWorkerPath = path.join(appAsarUnpacked, 'dist', 'main', 'embeddingWorker.js');
  if (!fs.existsSync(unpackedMcpPath)) {
    throw new Error(`Missing unpacked MCP CLI script: ${unpackedMcpPath}`);
  }
  if (!fs.existsSync(unpackedWorkerPath)) {
    throw new Error(`Missing unpacked embedding worker script: ${unpackedWorkerPath}`);
  }

  const unpackedModulesDir = path.join(appAsarUnpacked, 'node_modules');
  const unpackedModules = fs.existsSync(unpackedModulesDir)
    ? fs.readdirSync(unpackedModulesDir)
    : [];

  await verifyPackagedMcpServer(unpackedMcpPath);
  const bootReport = await verifyPackagedElectronBoot(executablePath);

  console.log(
    `Verified unpacked Electron build & live runtime at ${path.relative(process.cwd(), unpackedDir)}: ` +
      `app.asar=${asarSizeBytes} bytes, exe=${path.basename(executablePath)}, ` +
      `channels=${bootReport.registeredChannels}, modelCacheDir=${bootReport.modelCacheDir}, ` +
      `unpacked=[${unpackedModules.join(', ')}]`
  );
}

main().catch((err) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
