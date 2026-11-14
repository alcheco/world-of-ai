#!/usr/bin/env node
// Prepara lo que la app empaqueta:
//   - src-tauri/binaries/woai-companion-<target>  (sidecar, compilado con Node SEA)
//   - src-tauri/resources/addon/WoAI               (copia limpia del addon)
// Se ejecuta antes de `tauri dev` y `tauri build` (beforeDevCommand / beforeBuildCommand).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(app, '..');
const companion = path.join(repo, 'companion');
const win = process.platform === 'win32';

// ---------------------------------------------------------------- sidecar
function newestMtime(dir) {
  let max = 0;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    max = Math.max(max, d.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return max;
}

const dist = path.join(companion, 'dist');
const built = () => (fs.existsSync(dist) ? fs.readdirSync(dist).find((f) => f.startsWith('woai-companion-')) : null);
let bin = built();
const srcTime = Math.max(newestMtime(path.join(companion, 'src')), fs.statSync(path.join(companion, 'package.json')).mtimeMs);
if (!bin || fs.statSync(path.join(dist, bin)).mtimeMs < srcTime || process.argv.includes('--rebuild')) {
  console.log('[prepare] compilando el companion…');
  const npm = win ? 'npm.cmd' : 'npm';
  if (!fs.existsSync(path.join(companion, 'node_modules'))) execFileSync(npm, ['ci'], { cwd: companion, stdio: 'inherit', shell: win });
  execFileSync(npm, ['run', 'build:bin'], { cwd: companion, stdio: 'inherit', shell: win });
  bin = built();
}
const binaries = path.join(app, 'src-tauri', 'binaries');
fs.rmSync(binaries, { recursive: true, force: true });
fs.mkdirSync(binaries, { recursive: true });
fs.copyFileSync(path.join(dist, bin), path.join(binaries, bin));
fs.chmodSync(path.join(binaries, bin), 0o755);
console.log(`[prepare] sidecar: binaries/${bin}`);

// ---------------------------------------------------------------- addon
const GENERATED = new Set(['Data.lua', 'sig', 'ctl', '.DS_Store']);
const addonSrc = path.join(repo, 'addon', 'WoAI');
const addonDest = path.join(app, 'src-tauri', 'resources', 'addon', 'WoAI');
fs.rmSync(path.dirname(addonDest), { recursive: true, force: true });
fs.cpSync(addonSrc, addonDest, { recursive: true, filter: (src) => !GENERATED.has(path.basename(src)) });
console.log(`[prepare] addon: ${fs.readdirSync(addonDest).length} archivos en resources/addon/WoAI`);
