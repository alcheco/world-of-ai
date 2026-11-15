#!/usr/bin/env node
// Compila el companion a un ejecutable único con Node SEA (Single Executable
// Application), para empaquetarlo como sidecar de la app Tauri.
//
//   npm run build:bin
//
// Resultado: dist/woai-companion-<target-triple>[.exe], con el nombre que
// espera `bundle.externalBin` de Tauri. SEA usa el binario de Node que ejecuta
// este script, así que cada plataforma se compila en su propia máquina (o
// runner de CI).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const run = (file, args) => execFileSync(file, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && file.endsWith('.cmd') });

const TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};
const triple = TRIPLES[`${process.platform}-${process.arch}`];
if (!triple) throw new Error(`Plataforma sin soporte: ${process.platform}-${process.arch}`);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) throw new Error(`Node ${process.versions.node}: SEA necesita Node 22.12 o superior.`);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// 1. Un solo archivo CommonJS (SEA no carga módulos ES con imports).
const bundle = path.join(dist, 'companion.cjs');
run(bin('esbuild'), [
  'src/index.js',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--target=node${major}`,
  `--outfile=${bundle}`,
  '--log-level=warning',
  // import.meta.url no existe en CJS: config.js cae a la carpeta del ejecutable.
  '--log-override:empty-import-meta=silent',
]);

// 2. Blob de SEA.
const blob = path.join(dist, 'sea-prep.blob');
const seaConfig = path.join(dist, 'sea-config.json');
fs.writeFileSync(
  seaConfig,
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }),
);
run(process.execPath, ['--experimental-sea-config', seaConfig]);

// 3. Copia del binario de Node con el blob inyectado.
const out = path.join(dist, `woai-companion-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
fs.copyFileSync(process.execPath, out);
fs.chmodSync(out, 0o755);
if (process.platform === 'darwin') run('codesign', ['--remove-signature', out]);
const postjectArgs = [out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
run(bin('postject'), postjectArgs);
// Firma ad hoc para que macOS lo ejecute; la firma Developer ID la pone Tauri al empaquetar.
if (process.platform === 'darwin') run('codesign', ['--sign', '-', '--force', out]);

for (const f of [bundle, blob, seaConfig]) fs.rmSync(f);
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(0);
console.log(`\nListo: ${path.relative(root, out)} (${mb} MB)`);
