import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync, createWriteStream, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const target = path.join(root, 'apps/desktop/src-tauri/runtime');
const platform = process.platform;
const arch = process.arch;
const NODE_VERSION = process.env.AGENTDECK_NODE_VERSION || '24.22.3';

function distName() {
  if (platform === 'win32' && arch === 'x64') return `node-v${NODE_VERSION}-win-x64`;
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `node-v${NODE_VERSION}-darwin-${arch}`;
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) return `node-v${NODE_VERSION}-linux-${arch}`;
  throw new Error(`Unsupported runtime platform ${platform} ${arch}`);
}

function nodeBinaryName() {
  return platform === 'win32' ? 'node.exe' : 'node';
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function officialNodeDir() {
  const name = distName();
  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${name}.${ext}`;
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'agentdeck-node-'));
  const archive = path.join(tmp, `${name}.${ext}`);
  console.log(`Downloading ${url}`);
  await download(url, archive);
  if (platform === 'win32') {
    execFileSync('tar', ['-xf', archive, '-C', tmp], { stdio: 'inherit' });
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', tmp], { stdio: 'inherit' });
  }
  const extracted = path.join(tmp, name);
  if (!existsSync(extracted)) throw new Error(`extracted Node tree missing: ${extracted}`);
  return extracted;
}

function resolveProvidedNodeDir() {
  const provided = process.env.AGENTDECK_NODE_DIR;
  if (!provided) return null;
  const exe = path.join(provided, nodeBinaryName());
  if (!existsSync(exe)) throw new Error(`AGENTDECK_NODE_DIR has no ${nodeBinaryName()}: ${provided}`);
  return provided;
}

function extractBinDir(nodeDir) {
  // Official unix tarballs put the binary in bin/; Windows zip puts node.exe at the root.
  if (existsSync(path.join(nodeDir, nodeBinaryName()))) return nodeDir;
  if (existsSync(path.join(nodeDir, 'bin', nodeBinaryName()))) return path.join(nodeDir, 'bin');
  throw new Error(`cannot find ${nodeBinaryName()} under ${nodeDir}`);
}

const provided = resolveProvidedNodeDir();
const nodeDir = provided || await officialNodeDir();
const binDir = extractBinDir(nodeDir);
const node = path.join(binDir, nodeBinaryName());
const version = execFileSync(node, ['-p', 'process.version+" "+process.platform+" "+process.arch'], { encoding: 'utf8' }).trim();
if (!version.startsWith('v24.')) throw new Error(`Node 24 required, got ${version}`);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(node, path.join(target, nodeBinaryName()));
if (platform !== 'win32') chmodSync(path.join(target, nodeBinaryName()), 0o755);
for (const name of ['LICENSE', 'LICENSE.txt']) {
  const src = path.join(nodeDir, name);
  if (existsSync(src)) cpSync(src, path.join(target, `NODE-${name}`));
}

const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
delete manifest.bin;
delete manifest.scripts;
writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2));
cpSync(path.join(root, 'package-lock.json'), path.join(target, 'package-lock.json'));
for (const name of ['daemon', 'protocol', 'adapters', 'relay']) {
  const dest = path.join(target, 'packages', name);
  mkdirSync(dest, { recursive: true });
  cpSync(path.join(root, 'packages', name, 'package.json'), path.join(dest, 'package.json'));
  cpSync(path.join(root, 'packages', name, 'dist'), path.join(dest, 'dist'), { recursive: true });
}

function npmCli(dir) {
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(binDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('cannot locate npm-cli.js in the Node distribution');
}
const bundledNode = path.join(target, nodeBinaryName());
execFileSync(bundledNode, [npmCli(nodeDir), 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: target,
  stdio: 'inherit',
});

// Materialize workspace links so the installer contains ordinary files.
for (const name of ['daemon', 'protocol', 'adapters', 'relay']) {
  const dest = path.join(target, 'node_modules', '@agentdeck', name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(path.join(target, 'packages', name), dest, { recursive: true });
}

execFileSync(
  bundledNode,
  ['--input-type=module', '-e', 'await Promise.all(["@agentdeck/daemon","@agentdeck/protocol","@agentdeck/adapters","@agentdeck/relay"].map(x=>import(x)))'],
  { cwd: target, stdio: 'inherit' },
);
console.log(`Prepared self-contained runtime: ${version}`);
