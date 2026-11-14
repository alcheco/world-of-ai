#!/usr/bin/env node
// Instala el addon en Interface/AddOns de WoW Forever y crea los slots y
// señales para recibir respuestas sin /reload.
//   npm run install-addon             enlaza addon/WoAI (desarrollo)
//   npm run install-addon -- --copy   lo copia (como la app)
//   npm run install-addon -- --force  reemplaza un enlace por una copia
//   npm run uninstall-addon           lo desinstala
import path from 'node:path';
import { loadConfig, addonSource, REPO_ADDON_DIR } from './config.js';
import { installAddon, uninstallAddon, AddonError } from './addon.js';
import { log, setLang } from './log.js';

const argv = process.argv.slice(2);
const cfg = loadConfig();
setLang(cfg.lang);

if (argv.includes('--uninstall')) {
  const n = uninstallAddon(cfg);
  log('info', 'addon', n ? 'addon.removed' : 'addon.notInstalled', { n, dir: path.dirname(cfg.addonDir) });
  process.exit(0);
}

const source = argv.includes('--copy') ? { dir: process.env.WOAI_ADDON_SRC || REPO_ADDON_DIR, mode: 'copy' } : addonSource();
try {
  const res = installAddon(cfg, source, { force: argv.includes('--force') });
  for (const e of res.events) log('info', 'addon', e.key, e.params);
  if (res.needsRestart) log('warn', 'addon', 'addon.restart');
} catch (e) {
  if (!(e instanceof AddonError)) throw e;
  log('error', 'addon', e.key, e.params);
  process.exit(1);
}
