#!/usr/bin/env node
// Genera los iconos de la app a partir del emblema de marca (docs/brand):
//   - icono de la app: emblem.svg → source.png (1024²) → `tauri icon`
//   - barra de menús de macOS: el símbolo "emblem-flat" del design system → tray.png (plantilla)
// Solo en macOS (usa AppKit vía Swift).   npm run icons
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = path.resolve(app, '..', 'docs', 'brand');
const icons = path.join(app, 'src-tauri', 'icons');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'woai-icons-'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: app, stdio: 'inherit' });

const html = fs.readFileSync(path.join(brand, 'design-system.html'), 'utf8');
const m = /<symbol id="emblem-flat" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/.exec(html);
if (!m) throw new Error('No encontré el símbolo emblem-flat en design-system.html');
const flat = path.join(tmp, 'flat.svg');
fs.writeFileSync(
  flat,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${m[1]}" width="200" height="220">${m[2].replaceAll('currentColor', '#000').replaceAll('var(--knock)', '#fff')}</svg>`,
);

const source = path.join(icons, 'source.png');
run('swift', ['scripts/raster.swift', path.join(brand, 'emblem.svg'), source, '1024', '0.06']);
run('swift', ['scripts/raster.swift', flat, path.join(icons, 'tray.png'), '44', '0.02', 'template']);
run('npx', ['tauri', 'icon', source, '-o', icons]);

// tauri icon también genera iconos de iOS/Android/Store que no usamos.
for (const f of fs.readdirSync(icons)) {
  if (['android', 'ios'].includes(f) || /^(Square\d+x\d+Logo|StoreLogo)\.png$/.test(f)) fs.rmSync(path.join(icons, f), { recursive: true });
}
fs.copyFileSync(path.join(icons, '128x128@2x.png'), path.join(app, 'public', 'icon.png'));
fs.rmSync(tmp, { recursive: true });
console.log('Iconos listos.');
