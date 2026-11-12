// Deduce el proyecto (repo) y el worktree a partir del cwd de una sesión.
import path from 'node:path';
import os from 'node:os';

const TMP = [/^\/private\/tmp\//, /^\/tmp\//, /^\/var\/folders\//];

/**
 * @returns {{ project: string|null, projectPath: string|null, worktree: string|null }}
 *   project = nombre corto del repo; null si la sesión no tiene proyecto (home, tmp, etc.).
 */
export function projectOf(cwd, home = os.homedir()) {
  if (!cwd) return { project: null, projectPath: null, worktree: null };
  let root = cwd;
  let worktree = null;

  // Worktrees de Claude Code: <repo>/.claude/worktrees/<nombre>[/...]
  const cw = /^(.*?)\/\.claude\/worktrees\/([^/]+)/.exec(cwd);
  if (cw) {
    root = cw[1];
    worktree = cw[2];
  }
  // Worktrees de Codex: ~/.codex/worktrees/<id>/<repo>[/...]
  const xw = new RegExp(`^${escape(path.join(home, '.codex', 'worktrees'))}/([^/]+)/([^/]+)`).exec(cwd);
  if (xw) {
    root = null;
    worktree = xw[1];
    return { project: xw[2], projectPath: null, worktree };
  }

  if (root === home || root === '/' || TMP.some((r) => r.test(root))) {
    return { project: null, projectPath: null, worktree: null };
  }
  return { project: path.basename(root), projectPath: root, worktree };
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
