// Detección de la carpeta de WoW Forever (`_forever_`) en macOS y Windows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FLAVOR = '_forever_';
const MAC_DEFAULT = '/Applications/World of Warcraft/_forever_';
const WIN_DEFAULT = 'C:\\Program Files (x86)\\World of Warcraft\\_forever_';

export function defaultWowDir(platform = process.platform) {
  return platform === 'win32' ? WIN_DEFAULT : MAC_DEFAULT;
}

/**
 * ¿Parece una carpeta de WoW? Tiene el ejecutable, o las carpetas que el juego
 * crea al arrancar (Interface, WTF).
 */
export function isWowDir(dir) {
  if (!dir) return false;
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    const names = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase()));
    const exe = [...names].some((n) => /^(world of warcraft.*\.app|wow.*\.exe)$/.test(n));
    return exe || names.has('interface') || names.has('wtf');
  } catch {
    return false;
  }
}

/** Carpetas de instalación registradas por Battle.net en Windows. */
function windowsRegistryDirs() {
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft',
    'HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft',
  ];
  const out = [];
  for (const key of keys) {
    try {
      const txt = execFileSync('reg', ['query', key, '/v', 'InstallPath'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 3000,
      });
      const m = /InstallPath\s+REG_\w+\s+(.+)/.exec(txt);
      // InstallPath apunta a una variante (p. ej. _retail_): subimos un nivel.
      if (m) out.push(path.win32.join(path.win32.dirname(m[1].trim().replace(/\\+$/, '')), FLAVOR));
    } catch {
      /* no está */
    }
  }
  return out;
}

/** Lugares donde buscar, en orden de preferencia. */
export function candidateWowDirs(platform = process.platform, home = os.homedir()) {
  if (platform === 'win32') {
    const roots = [];
    for (const drive of ['C', 'D', 'E', 'F', 'G']) {
      roots.push(`${drive}:\\Program Files (x86)`, `${drive}:\\Program Files`, `${drive}:\\Games`, `${drive}:\\Juegos`, `${drive}:`);
    }
    const dirs = [
      ...(platform === process.platform ? windowsRegistryDirs() : []),
      ...roots.map((r) => path.win32.join(r, 'World of Warcraft', FLAVOR)),
    ];
    return [...new Set(dirs)];
  }
  return [MAC_DEFAULT, path.posix.join(home, 'Applications', 'World of Warcraft', FLAVOR), path.posix.join('/Users/Shared/World of Warcraft', FLAVOR)];
}

/** Todas las carpetas de WoW encontradas. */
export function findWowDirs() {
  return candidateWowDirs().filter(isWowDir);
}

/** La primera carpeta de WoW encontrada, o null. */
export function detectWowDir() {
  return findWowDirs()[0] ?? null;
}
