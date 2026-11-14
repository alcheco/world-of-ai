// Encontrar y lanzar los CLIs (claude, codex) en macOS y Windows.
//
// - macOS: una app abierta desde Finder o al iniciar sesión no hereda el PATH
//   de la terminal (Homebrew, npm global, ~/.local/bin), así que se completa
//   con el de la shell de login y con carpetas habituales.
// - Windows: npm instala los CLIs como `claude.cmd`; Node no lanza .cmd/.bat
//   sin pasar por cmd.exe, y cmd.exe necesita sus propias comillas.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN = process.platform === 'win32';

let loginPathCache;
/** PATH de la shell de login del usuario (macOS/Linux). '' si no se pudo. */
export function loginShellPath() {
  if (loginPathCache !== undefined) return loginPathCache;
  loginPathCache = '';
  if (WIN) return loginPathCache;
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  try {
    // Los rc pueden imprimir cosas: el PATH va tras una marca.
    const out = execFileSync(shell, ['-ilc', 'printf "\\n__WOAI_PATH__%s\\n" "$PATH"'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    loginPathCache = /__WOAI_PATH__(.*)/.exec(out)?.[1].trim() ?? '';
  } catch {
    /* sin shell de login */
  }
  return loginPathCache;
}

/** Carpetas donde suelen quedar los CLIs aunque no estén en el PATH. */
export function extraBinDirs(home = os.homedir(), env = process.env) {
  if (WIN) {
    return [
      env.APPDATA && path.join(env.APPDATA, 'npm'),
      path.join(home, '.local', 'bin'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'claude'),
      path.join(home, '.bun', 'bin'),
    ].filter(Boolean);
  }
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
  ];
}

/**
 * PATH completo para los procesos hijos: el actual + el de la shell de login
 * + carpetas habituales, sin duplicados.
 */
export function augmentedPath(env = process.env) {
  const sep = path.delimiter;
  const parts = [env.PATH || env.Path || '', loginShellPath(), extraBinDirs(os.homedir(), env).join(sep)];
  const seen = new Set();
  return parts
    .join(sep)
    .split(sep)
    .filter((p) => p && !seen.has(WIN ? p.toLowerCase() : p) && seen.add(WIN ? p.toLowerCase() : p))
    .join(sep);
}

let childEnv;
/** Entorno para los CLIs, con el PATH completo. */
export function cliEnv() {
  if (!childEnv) {
    childEnv = { ...process.env };
    // En Windows la variable puede llamarse "Path".
    for (const k of Object.keys(childEnv)) if (k.toUpperCase() === 'PATH') delete childEnv[k];
    childEnv.PATH = augmentedPath();
  }
  return childEnv;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Ruta absoluta de un ejecutable, o null.
 * @param {string} bin nombre ("claude") o ruta
 */
export function resolveBin(bin, { PATH = cliEnv().PATH, platform = process.platform, pathext = process.env.PATHEXT } = {}) {
  if (!bin) return null;
  const win = platform === 'win32';
  const exts = win ? ['', ...(pathext || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())] : [''];
  const tryAll = (base) => {
    // En Windows, "claude" sin extensión suele ser el script de npm para sh: se prefiere .exe/.cmd.
    const order = win && !path.extname(base) ? [...exts.slice(1), ''] : exts;
    for (const e of order) if (isFile(base + e)) return base + e;
    return null;
  };
  if (bin.includes('/') || bin.includes('\\')) return tryAll(path.resolve(bin));
  for (const dir of PATH.split(win ? ';' : path.delimiter)) {
    if (!dir) continue;
    const hit = tryAll(path.join(dir.replace(/^"|"$/g, ''), bin));
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------ comillas de cmd.exe
// Mismo criterio que cross-spawn: comillas al estilo de CommandLineToArgvW y
// luego escapar los metacaracteres de cmd.exe con ^ (dos veces para los .cmd
// de npm, que vuelven a pasar los argumentos por cmd).
const META = /([()\][%!^"`<>&|;, *?])/g;

export function quoteCmdArg(arg, doubleEscape = false) {
  let a = `${arg}`;
  a = a.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  a = a.replace(/(?=(\\+?)?)\1$/, '$1$1');
  a = `"${a}"`;
  a = a.replace(META, '^$1');
  if (doubleEscape) a = a.replace(META, '^$1');
  return a;
}

/** Línea de comando para `cmd.exe /d /s /c "…"`. */
export function cmdLine(file, args) {
  const cmd = path.normalize(file).replace(META, '^$1');
  return [cmd, ...args.map((a) => quoteCmdArg(a, true))].join(' ');
}

// ------------------------------------------------------------ lanzar y matar
const running = new Set();

/**
 * Lanza un CLI. Resuelve la ruta, usa el PATH completo y, en Windows, pasa por
 * cmd.exe si es un .cmd/.bat. Sin ventanas de consola.
 */
export function spawnCli(bin, args, opts = {}) {
  const env = opts.env ?? cliEnv();
  const file = resolveBin(bin, { PATH: env.PATH }) ?? bin;
  let child;
  if (WIN && /\.(cmd|bat)$/i.test(file)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    child = spawn(comspec, ['/d', '/s', '/c', `"${cmdLine(file, args)}"`], {
      ...opts,
      env,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  } else {
    // En macOS/Linux, grupo propio para poder matar también a los hijos (herramientas del agente).
    child = spawn(file, args, { ...opts, env, windowsHide: true, detached: !WIN });
  }
  running.add(child);
  child.on('close', () => running.delete(child));
  child.on('error', () => running.delete(child));
  return child;
}

/** Mata el proceso y sus hijos. */
export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (WIN) {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ya terminó */
    }
  }
}

/** Mata todos los CLIs en curso (al cerrar el companion). */
export function killAll() {
  for (const c of running) killTree(c);
}

/**
 * Ruta y versión de un CLI, para mostrarlas en la app.
 * @returns {Promise<{bin:string, path:string|null, version:string|null, error?:string}>}
 */
export function probeCli(bin, timeoutMs = 15000) {
  const resolved = resolveBin(bin);
  if (!resolved) return Promise.resolve({ bin, path: null, version: null, error: 'not-found' });
  return new Promise((resolve) => {
    const child = spawnCli(resolved, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => killTree(child), timeoutMs);
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (out += b));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ bin, path: resolved, version: null, error: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const version = /\d+\.\d+\.\d+[\w.-]*/.exec(out)?.[0] ?? null;
      resolve({ bin, path: resolved, version, ...(code === 0 ? {} : { error: out.trim().slice(-300) || `exit ${code}` }) });
    });
  });
}
