import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectWowDir, defaultWowDir } from './wow.js';

// Carpeta del paquete `companion/`. Compilado como binario se usa la carpeta
// del ejecutable, salvo si está en companion/dist (binario de desarrollo).
function companionDir() {
  try {
    if (typeof import.meta?.url === 'string') return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  } catch {
    /* binario empaquetado */
  }
  const exeDir = path.dirname(process.execPath);
  const parent = path.dirname(exeDir);
  if (path.basename(exeDir) === 'dist' && fs.existsSync(path.join(parent, 'package.json'))) return parent;
  return exeDir;
}

export const COMPANION_DIR = companionDir();
export const REPO_ADDON_DIR = path.resolve(COMPANION_DIR, '..', 'addon', 'WoAI');

/**
 * Carpeta de config.json y .state.json. La app la pasa en WOAI_DATA_DIR
 * (Application Support / %APPDATA%); en desarrollo es companion/.
 */
export function dataDir() {
  return process.env.WOAI_DATA_DIR ? path.resolve(process.env.WOAI_DATA_DIR) : COMPANION_DIR;
}

/**
 * De dónde sale el addon a instalar. Con WOAI_ADDON_SRC (la app pasa sus
 * recursos) se copia; desde el repo se enlaza, para ver los cambios al momento.
 */
export function addonSource() {
  if (process.env.WOAI_ADDON_SRC) return { dir: path.resolve(process.env.WOAI_ADDON_SRC), mode: 'copy' };
  return { dir: REPO_ADDON_DIR, mode: 'link' };
}

export const DEFAULTS = {
  // Carpeta de la instalación de WoW Forever. null = detectarla.
  wowDir: null,
  // Idioma de los mensajes: "es" o "en".
  lang: 'es',
  // Cuántas sesiones exportar al juego (las más recientes).
  maxSessions: 40,
  // Mensajes por sesión (los últimos).
  maxMessages: 60,
  // Caracteres máximos por mensaje.
  maxMessageChars: 4000,
  // Cada cuántos ms revisar cambios.
  pollMs: 3000,
  claude: {
    // Nombre o ruta del CLI.
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

export function configFile() {
  return path.join(dataDir(), 'config.json');
}

export function loadConfig() {
  const dir = dataDir();
  const file = configFile();
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = merge(DEFAULTS, user);
  if (process.env.WOAI_WOW_DIR) cfg.wowDir = process.env.WOAI_WOW_DIR;
  if (process.env.WOAI_LANG) cfg.lang = process.env.WOAI_LANG;
  if (!cfg.wowDir) cfg.wowDir = detectWowDir() ?? defaultWowDir();
  cfg.home = os.homedir();
  cfg.dataDir = dir;
  cfg.addonDir = path.join(cfg.wowDir, 'Interface', 'AddOns', 'WoAI');
  cfg.stateFile = path.join(dir, '.state.json');
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
