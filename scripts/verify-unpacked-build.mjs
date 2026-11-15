import fs from 'node:fs';
import path from 'node:path';

const distPackagesDir = path.resolve(process.cwd(), 'dist-packages');
if (!fs.existsSync(distPackagesDir)) {
  console.error(`ERROR: dist-packages directory not found at ${distPackagesDir}`);
  process.exit(1);
}

const entries = fs.readdirSync(distPackagesDir, { withFileTypes: true });
const unpackedDirs = entries
  .filter((entry) => entry.isDirectory() && entry.name.endsWith('-unpacked'))
  .map((entry) => path.join(distPackagesDir, entry.name));

if (unpackedDirs.length === 0) {
  console.error(`ERROR: No *-unpacked directory found inside ${distPackagesDir}`);
  process.exit(1);
}

const unpackedDir = unpackedDirs[0];
const resourcesDir = path.join(unpackedDir, 'resources');
const appAsar = path.join(resourcesDir, 'app.asar');
const appAsarUnpacked = path.join(resourcesDir, 'app.asar.unpacked');

if (!fs.existsSync(appAsar)) {
  console.error(`ERROR: Missing packaged archive: ${appAsar}`);
  process.exit(1);
}

if (!fs.existsSync(appAsarUnpacked)) {
  console.error(`ERROR: Missing unpacked native directory: ${appAsarUnpacked}`);
  process.exit(1);
}

const topFiles = fs.readdirSync(unpackedDir, { withFileTypes: true });
const hasExecutable =
  process.platform === 'win32'
    ? topFiles.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
    : topFiles.some((e) => {
        if (!e.isFile()) return false;
        const mode = fs.statSync(path.join(unpackedDir, e.name)).mode;
        return (mode & 0o111) !== 0 && !e.name.endsWith('.so');
      });

if (!hasExecutable) {
  console.error(`ERROR: No Electron application binary found in ${unpackedDir}`);
  process.exit(1);
}

const asarSizeBytes = fs.statSync(appAsar).size;
if (asarSizeBytes < 1024) {
  console.error(`ERROR: Packaged app.asar is unexpectedly small (${asarSizeBytes} bytes)`);
  process.exit(1);
}

const unpackedModulesDir = path.join(appAsarUnpacked, 'node_modules');
const unpackedModules = fs.existsSync(unpackedModulesDir)
  ? fs.readdirSync(unpackedModulesDir)
  : [];

console.log(
  `Verified unpacked Electron build at ${path.relative(process.cwd(), unpackedDir)}: ` +
    `app.asar=${asarSizeBytes} bytes, unpacked=[${unpackedModules.join(', ')}]`
);
