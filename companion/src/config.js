import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const COMPANION_DIR = path.resolve(here, '..');
export const REPO_ADDON_DIR = path.resolve(COMPANION_DIR, '..', 'addon', 'WoAI');

const DEFAULTS = {
  // Carpeta de la instalación de WoW Forever.
  wowDir: '/Applications/World of Warcraft/_forever_',
  // Cuántas sesiones exportar al juego (las más recientes).
  maxSessions: 40,
  // Mensajes por sesión (los últimos).
  maxMessages: 60,
  // Caracteres máximos por mensaje.
  maxMessageChars: 4000,
  // Cada cuántos ms revisar cambios.
  pollMs: 3000,
  claude: {
    bin: 'claude',
    // Modo de permisos para `claude -p`. "default" deniega herramientas que piden permiso.
    // Opciones útiles: "acceptEdits", "plan", "bypassPermissions" (cuidado).
    permissionMode: 'default',
    extraArgs: [],
  },
  codex: {
    bin: 'codex',
    // Sandbox para `codex exec`: "read-only" | "workspace-write" | "danger-full-access".
    sandbox: 'workspace-write',
    extraArgs: [],
  },
  // Tiempo máximo por prompt.
  timeoutMs: 15 * 60 * 1000,
  // Respuestas sin /reload (slots LoadOnDemand + señales .wav).
  live: {
    // Slots por sesión de UI: cada carga gasta uno; /reload los libera todos.
    slots: 100,
    // Archivos de señal (sig/NNN.wav), usados en rueda.
    signals: 500,
    // Sesiones con prompts de hace menos de esto viajan en los slots.
    windowSec: 6 * 3600,
  },
};

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  }
  return out;
}

export function loadConfig() {
  const file = path.join(COMPANION_DIR, 'config.json');
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = merge(DEFAULTS, user);
  if (process.env.WOAI_WOW_DIR) cfg.wowDir = process.env.WOAI_WOW_DIR;
  cfg.home = os.homedir();
  cfg.addonDir = path.join(cfg.wowDir, 'Interface', 'AddOns', 'WoAI');
  cfg.stateFile = path.join(COMPANION_DIR, '.state.json');
  cfg.screenshotsDir = path.join(cfg.wowDir, 'Screenshots');
  return cfg;
}

/** Rutas de WoAI.lua (SavedVariables) en todas las cuentas de WTF. */
export function savedVariablesFiles(cfg) {
  const accRoot = path.join(cfg.wowDir, 'WTF', 'Account');
  if (!fs.existsSync(accRoot)) return [];
  return fs
    .readdirSync(accRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'SavedVariables')
    .map((d) => path.join(accRoot, d.name, 'SavedVariables', 'WoAI.lua'));
}
