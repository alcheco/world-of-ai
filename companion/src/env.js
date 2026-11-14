// Deduce el proyecto (repo) y el worktree a partir del cwd de una sesión.
// Funciona con rutas de macOS/Linux y de Windows (C:\Users\…).
import os from 'node:os';

// Las comparaciones se hacen con "/" y, en rutas de Windows, sin mayúsculas.
// Reemplazar "\" por "/" no cambia la longitud, así que un índice en la ruta
// normalizada sirve para cortar la original.
const slash = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const isWin = (p) => /^[a-zA-Z]:([\\/]|$)/.test(p) || p.startsWith('\\\\');
const key = (p) => (isWin(p) ? slash(p).toLowerCase() : slash(p));

const TMP = [/^\/private\/tmp(\/|$)/, /^\/tmp(\/|$)/, /^\/var\/folders\//, /^[a-z]:\/windows\/temp(\/|$)/, /\/appdata\/local\/temp(\/|$)/];

/**
 * @returns {{ project: string|null, projectPath: string|null, worktree: string|null }}
 *   project = nombre corto del repo; null si la sesión no tiene proyecto (home, tmp, etc.).
 */
export function projectOf(cwd, home = os.homedir(), tmpdir = os.tmpdir()) {
  const none = { project: null, projectPath: null, worktree: null };
  if (!cwd) return none;
  const orig = cwd.replace(/[\\/]+$/, '') || cwd;
  const k = key(orig);
  const h = key(home);

  // Worktrees de Codex: ~/.codex/worktrees/<id>/<repo>[/...]
  const codexRoot = `${h}/.codex/worktrees/`;
  if (k.startsWith(codexRoot)) {
    const [id, repo] = slash(orig).slice(codexRoot.length).split('/');
    if (id && repo) return { project: repo, projectPath: null, worktree: id };
  }

  // Worktrees de Claude Code: <repo>/.claude/worktrees/<nombre>[/...]
  let rootLen = orig.length;
  let worktree = null;
  const cw = /^(.*?)\/\.claude\/worktrees\/([^/]+)/i.exec(slash(orig));
  if (cw) {
    rootLen = cw[1].length;
    worktree = cw[2];
  }
  const root = orig.slice(0, rootLen);
  const rk = key(root);

  if (!rk || rk === h || rk === '/' || /^[a-z]:$/.test(rk)) return none;
  const tk = key(tmpdir);
  if (TMP.some((r) => r.test(rk.toLowerCase())) || (tk && (rk === tk || rk.startsWith(tk + '/')))) return none;

  const name = slash(root).split('/').pop();
  return { project: name, projectPath: root, worktree };
}
