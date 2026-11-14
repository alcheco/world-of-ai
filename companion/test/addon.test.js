import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installAddon, uninstallAddon, addonStatus, addonVersion, AddonError } from '../src/addon.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'woai-addon-'));
  const src = path.join(root, 'src', 'WoAI');
  fs.mkdirSync(path.join(src, 'media'), { recursive: true });
  fs.writeFileSync(path.join(src, 'WoAI.toc'), '## Interface: 16001\n## Version: 1.2.3\nCore.lua\n');
  fs.writeFileSync(path.join(src, 'Core.lua'), '-- core\n');
  fs.writeFileSync(path.join(src, 'media', 'icon.tga'), 'x');
  // Generados en el repo: no deben copiarse.
  fs.writeFileSync(path.join(src, 'Data.lua'), 'WoAI_Data = {repo=true}\n');
  fs.mkdirSync(path.join(src, 'sig'));
  fs.writeFileSync(path.join(src, 'sig', '001.wav'), '');
  const addons = path.join(root, 'wow', 'Interface', 'AddOns');
  fs.mkdirSync(addons, { recursive: true });
  const cfg = { addonDir: path.join(addons, 'WoAI'), live: { slots: 3, signals: 4 } };
  return { root, src, addons, cfg };
}

test('copia el addon, crea slots y pide reiniciar WoW', () => {
  const { src, cfg } = setup();
  const res = installAddon(cfg, { dir: src, mode: 'copy' });
  assert.equal(res.mode, 'copy');
  assert.equal(res.version, '1.2.3');
  assert.equal(res.files, 3);
  assert.ok(res.needsRestart);
  assert.equal(fs.readFileSync(path.join(cfg.addonDir, 'media', 'icon.tga'), 'utf8'), 'x');
  assert.match(fs.readFileSync(path.join(cfg.addonDir, 'Data.lua'), 'utf8'), /WoAI_Data = nil/);
  assert.ok(fs.existsSync(path.join(path.dirname(cfg.addonDir), 'WoAI_S003', 'Inbox.lua')));
  assert.deepEqual(addonStatus(cfg), { kind: 'copy', version: '1.2.3' });
});

test('actualizar sin archivos nuevos no pide reiniciar, borra los viejos y conserva Data.lua', () => {
  const { src, cfg } = setup();
  installAddon(cfg, { dir: src, mode: 'copy' });
  fs.writeFileSync(path.join(cfg.addonDir, 'Data.lua'), 'WoAI_Data = {mio=true}\n');
  fs.writeFileSync(path.join(cfg.addonDir, 'Viejo.lua'), '-- ya no viene\n');
  fs.writeFileSync(path.join(src, 'Core.lua'), '-- core v2\n');
  const res = installAddon(cfg, { dir: src, mode: 'copy' });
  assert.equal(res.created, 0);
  assert.equal(res.needsRestart, false);
  assert.equal(fs.readFileSync(path.join(cfg.addonDir, 'Core.lua'), 'utf8'), '-- core v2\n');
  assert.ok(!fs.existsSync(path.join(cfg.addonDir, 'Viejo.lua')));
  assert.match(fs.readFileSync(path.join(cfg.addonDir, 'Data.lua'), 'utf8'), /mio/);
  assert.ok(fs.existsSync(path.join(cfg.addonDir, 'sig', '001.wav')));
});

test('un archivo nuevo en el addon pide reiniciar', () => {
  const { src, cfg } = setup();
  installAddon(cfg, { dir: src, mode: 'copy' });
  fs.writeFileSync(path.join(src, 'Nuevo.lua'), '-- nuevo\n');
  assert.ok(installAddon(cfg, { dir: src, mode: 'copy' }).needsRestart);
});

test('enlace de desarrollo: se respeta salvo con force', { skip: process.platform === 'win32' }, () => {
  const { src, cfg } = setup();
  const linked = installAddon(cfg, { dir: src, mode: 'link' });
  assert.equal(linked.mode, 'link');
  assert.equal(addonStatus(cfg).kind, 'link');
  assert.throws(() => installAddon(cfg, { dir: src, mode: 'copy' }), (e) => e instanceof AddonError && e.key === 'addon.isLink');
  installAddon(cfg, { dir: src, mode: 'copy' }, { force: true });
  assert.equal(addonStatus(cfg).kind, 'copy');
  // El repo no se tocó.
  assert.match(fs.readFileSync(path.join(src, 'Data.lua'), 'utf8'), /repo=true/);
});

test('enlace roto: se reemplaza', { skip: process.platform === 'win32' }, () => {
  const { root, src, cfg } = setup();
  fs.symlinkSync(path.join(root, 'no-existe'), cfg.addonDir, 'dir');
  assert.equal(addonStatus(cfg).kind, 'broken-link');
  installAddon(cfg, { dir: src, mode: 'copy' });
  assert.equal(addonStatus(cfg).kind, 'copy');
});

test('no pisa una carpeta WoAI ajena', () => {
  const { src, cfg } = setup();
  fs.mkdirSync(cfg.addonDir);
  fs.writeFileSync(path.join(cfg.addonDir, 'otra.txt'), '');
  assert.throws(() => installAddon(cfg, { dir: src, mode: 'copy' }), (e) => e.key === 'addon.foreign');
});

test('sin carpeta AddOns da error con clave', () => {
  const { src } = setup();
  const cfg = { addonDir: '/no/existe/Interface/AddOns/WoAI', live: { slots: 1, signals: 1 } };
  assert.throws(() => installAddon(cfg, { dir: src, mode: 'copy' }), (e) => e.key === 'addon.noAddonsDir');
});

test('desinstalar borra WoAI y los slots, sin tocar otros addons', () => {
  const { src, addons, cfg } = setup();
  installAddon(cfg, { dir: src, mode: 'copy' });
  fs.mkdirSync(path.join(addons, 'OtroAddon'));
  assert.equal(uninstallAddon(cfg), 4);
  assert.deepEqual(fs.readdirSync(addons), ['OtroAddon']);
  assert.equal(addonStatus(cfg).kind, 'none');
});

test('addonVersion lee el .toc', () => {
  const { src } = setup();
  assert.equal(addonVersion(src), '1.2.3');
  assert.equal(addonVersion('/no/existe'), null);
});
