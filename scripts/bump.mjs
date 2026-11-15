#!/usr/bin/env node
// Cambia la versión de todo WoAI a la vez: app, companion, addon y crate de Rust.
//   node scripts/bump.mjs 0.2.0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error('Uso: node scripts/bump.mjs X.Y.Z');
  process.exit(1);
}

function edit(rel, fn) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`No cambió ${rel}`);
  fs.writeFileSync(file, after);
  console.log(`  ${rel}`);
}
const json = (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);

console.log(`Versión ${version}:`);
edit('app/package.json', json);
edit('companion/package.json', json);
edit('app/src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`));
edit('addon/WoAI/WoAI.toc', (s) => s.replace(/^## Version: .+$/m, `## Version: ${version}`));
console.log('\nAhora: git commit -am "v' + version + '" && git tag v' + version + ' && git push --follow-tags');
