// Instalación del addon en Interface/AddOns.
//
// Desde el repo se enlaza (symlink) para que los cambios se vean al momento.
// Desde la app se copia (en Windows un symlink pide permisos de administrador).
import fs from 'node:fs';
import path from 'node:path';
import { installLive } from './live.js';
import { KeyedError } from './log.js';

export class AddonError extends KeyedError {}

// Archivos que genera el companion dentro de WoAI/: no se copian ni se borran.
const GENERATED = new Set(['Data.lua', 'Data.lua.tmp', 'sig', 'ctl']);
const IGNORED = new Set(['.DS_Store', 'Thumbs.db']);

const DATA_STUB = '-- Generado por woai-companion.\nWoAI_Data = nil\n';

/** Versión del addon según su .toc. */
export function addonVersion(dir) {
  try {
    return /^## Version:\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, 'WoAI.toc'), 'utf8'))?.[1].trim() ?? null;
  } catch {
    return null;
  }
}

function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/** Lista relativa de archivos del addon (sin los generados). */
function sourceFiles(dir, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (IGNORED.has(d.name) || (!rel && GENERATED.has(d.name))) continue;
    const r = rel ? path.join(rel, d.name) : d.name;
    if (d.isDirectory()) out.push(...sourceFiles(dir, r));
    else out.push(r);
  }
  return out;
}

/**
 * Estado de la instalación: 'none' | 'link' | 'copy' | 'broken-link' | 'foreign'.
 */
export function addonStatus(cfg) {
  const st = lstat(cfg.addonDir);
  if (!st) return { kind: 'none' };
  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(cfg.addonDir);
    if (!fs.existsSync(cfg.addonDir)) return { kind: 'broken-link', target };
    return { kind: 'link', target: fs.realpathSync(cfg.addonDir), version: addonVersion(cfg.addonDir) };
  }
  if (st.isDirectory() && fs.existsSync(path.join(cfg.addonDir, 'WoAI.toc'))) {
    return { kind: 'copy', version: addonVersion(cfg.addonDir) };
  }
  return { kind: 'foreign' };
}

/**
 * @param {{dir:string, mode:'link'|'copy'}} source
 * @param {{force?:boolean}} opts force: reemplaza un symlink de desarrollo por una copia.
 * @returns {{mode:string, created:number, files?:number, version:string|null, needsRestart:boolean}}
 */
export function installAddon(cfg, source, { force = false } = {}) {
  const addonsDir = path.dirname(cfg.addonDir);
  if (!fs.existsSync(addonsDir)) throw new AddonError('addon.noAddonsDir', { dir: addonsDir });

  let status = addonStatus(cfg);
  const events = [];
  if (status.kind === 'broken-link') {
    events.push({ key: 'addon.brokenLink', params: { target: status.target } });
    fs.unlinkSync(cfg.addonDir);
    status = { kind: 'none' };
  }
  if (status.kind === 'foreign') throw new AddonError('addon.foreign', { dir: cfg.addonDir });

  let created = 0;
  let files;
  if (source.mode === 'link') {
    if (status.kind === 'copy') throw new AddonError('addon.foreign', { dir: cfg.addonDir });
    if (status.kind === 'link') {
      if (status.target !== fs.realpathSync(source.dir)) throw new AddonError('addon.foreign', { dir: cfg.addonDir });
      events.push({ key: 'addon.alreadyLinked', params: { dir: cfg.addonDir, source: source.dir } });
    } else {
      fs.symlinkSync(source.dir, cfg.addonDir, 'dir');
      created++;
      events.push({ key: 'addon.linked', params: { dir: cfg.addonDir, source: source.dir } });
    }
    const stub = path.join(source.dir, 'Data.lua');
    if (!fs.existsSync(stub)) fs.writeFileSync(stub, DATA_STUB);
  } else {
    if (status.kind === 'link') {
      if (!force) throw new AddonError('addon.isLink', { dir: cfg.addonDir, target: status.target });
      fs.unlinkSync(cfg.addonDir);
    }
    ({ created, files } = copyAddon(source.dir, cfg.addonDir));
    events.push({ key: 'addon.copied', params: { version: addonVersion(source.dir), dir: cfg.addonDir, files } });
  }

  created += installLive(cfg);
  events.push({ key: 'addon.live', params: { slots: cfg.live.slots, signals: cfg.live.signals, dir: addonsDir } });
  return { mode: source.mode, created, files, version: addonVersion(cfg.addonDir), needsRestart: created > 0, events };
}

function copyAddon(src, dest) {
  const wanted = sourceFiles(src);
  const keep = new Set(wanted);
  let created = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const rel of wanted) {
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.existsSync(to)) created++;
    fs.copyFileSync(path.join(src, rel), to);
  }
  // Borra archivos de versiones anteriores que ya no vienen.
  for (const rel of sourceFiles(dest)) {
    if (!keep.has(rel)) fs.rmSync(path.join(dest, rel), { force: true });
  }
  const data = path.join(dest, 'Data.lua');
  if (!fs.existsSync(data)) {
    fs.writeFileSync(data, DATA_STUB);
    created++;
  }
  return { created, files: wanted.length };
}

/** Borra WoAI y los slots WoAI_S*. Devuelve cuántas carpetas borró. */
export function uninstallAddon(cfg) {
  const addonsDir = path.dirname(cfg.addonDir);
  if (!fs.existsSync(addonsDir)) return 0;
  let n = 0;
  const st = lstat(cfg.addonDir);
  if (st) {
    // Un symlink se quita sin tocar el repo al que apunta.
    if (st.isSymbolicLink()) fs.unlinkSync(cfg.addonDir);
    else fs.rmSync(cfg.addonDir, { recursive: true, force: true });
    n++;
  }
  for (const name of fs.readdirSync(addonsDir)) {
    if (/^WoAI_S\d{3}$/.test(name)) {
      fs.rmSync(path.join(addonsDir, name), { recursive: true, force: true });
      n++;
    }
  }
  return n;
}
