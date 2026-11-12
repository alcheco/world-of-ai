#!/usr/bin/env node
// Enlaza addon/WoAI dentro de Interface/AddOns de WoW Forever y crea los
// slots y señales para recibir respuestas sin /reload.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, REPO_ADDON_DIR } from './config.js';
import { installLive } from './live.js';

const cfg = loadConfig();
const addonsDir = path.dirname(cfg.addonDir);
if (!fs.existsSync(addonsDir)) {
  console.error(`No existe ${addonsDir}. Ajusta wowDir en companion/config.json o WOAI_WOW_DIR.`);
  process.exit(1);
}

const stub = path.join(REPO_ADDON_DIR, 'Data.lua');
if (!fs.existsSync(stub)) fs.writeFileSync(stub, '-- Generado por woai-companion.\nWoAI_Data = nil\n');

let existing;
try {
  existing = fs.lstatSync(cfg.addonDir);
} catch {
  /* no existe */
}
// Enlace roto (por ejemplo, porque se movió o renombró el repo): se reemplaza.
if (existing?.isSymbolicLink() && !fs.existsSync(cfg.addonDir)) {
  console.log(`Enlace roto (${fs.readlinkSync(cfg.addonDir)}). Lo reemplazo.`);
  fs.unlinkSync(cfg.addonDir);
  existing = undefined;
}
if (existing) {
  if (!(existing.isSymbolicLink() && fs.realpathSync(cfg.addonDir) === fs.realpathSync(REPO_ADDON_DIR))) {
    console.error(`${cfg.addonDir} ya existe y no apunta a este repo. Bórralo o renómbralo y vuelve a ejecutar.`);
    process.exit(1);
  }
  console.log(`Ya enlazado: ${cfg.addonDir} → ${REPO_ADDON_DIR}`);
} else {
  fs.symlinkSync(REPO_ADDON_DIR, cfg.addonDir, 'dir');
  console.log(`Enlazado: ${cfg.addonDir} → ${REPO_ADDON_DIR}`);
}

const created = installLive(cfg);
console.log(`Slots (${cfg.live.slots}) y señales (${cfg.live.signals}) listos en ${addonsDir}.`);
if (created > 0) {
  console.log('Hay archivos nuevos: cierra WoW del todo y vuelve a abrirlo (el juego solo los descubre al arrancar).');
}
