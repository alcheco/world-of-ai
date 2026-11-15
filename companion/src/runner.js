// Ejecuta un prompt con el CLI de Claude Code o Codex.
import fs from 'node:fs';
import os from 'node:os';
import { spawnCli, killTree } from './bins.js';

function run(bin, args, { cwd, input, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawnCli(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += `\n[woai] tiempo agotado tras ${Math.round(timeoutMs / 1000)}s`;
      killTree(child);
    }, timeoutMs);
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

// cwd que manda el addon para "Solo chat".
export const CHAT_CWD = '@chat';

/**
 * Solo chat: sin carpeta de trabajo ni herramientas. El proceso necesita un
 * directorio, así que usa el home, pero el agente no puede leer ni tocar nada.
 * También se usa si la carpeta de la sesión ya no existe.
 */
export function isChat(job) {
  return !job.cwd || job.cwd === CHAT_CWD || !fs.existsSync(job.cwd);
}

/**
 * @param job {{agent:'claude'|'codex', sessionId?:string, cwd?:string, prompt:string}}
 * @returns {Promise<{ok:boolean, sessionId?:string, error?:string}>}
 */
export async function runJob(job, cfg) {
  const chat = isChat(job);
  const cwd = chat ? os.homedir() : job.cwd;
  if (job.agent === 'claude') return runClaude(job, cfg, cwd, chat);
  if (job.agent === 'codex') return runCodex(job, cfg, cwd, chat);
  return { ok: false, error: `agente desconocido: ${job.agent}` };
}

async function runClaude(job, cfg, cwd, chat) {
  const c = cfg.claude;
  const args = chat
    ? ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config']
    : ['-p', '--output-format', 'json', '--permission-mode', c.permissionMode, ...claudeOptions(c)];
  if (job.sessionId) args.push('--resume', job.sessionId);
  const r = await run(c.bin, args, { cwd, input: job.prompt, timeoutMs: cfg.timeoutMs });
  let res;
  try {
    res = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    /* salida no JSON */
  }
  if (r.code !== 0 || !res || res.is_error) {
    return { ok: false, sessionId: res?.session_id || job.sessionId, error: errText(res?.result, r) };
  }
  return { ok: true, sessionId: res.session_id || job.sessionId };
}

async function runCodex(job, cfg, cwd, chat) {
  const c = cfg.codex;
  // Codex no permite quitar todas las herramientas; en chat va en solo lectura.
  const sandbox = chat ? 'read-only' : c.sandbox;
  const args = ['exec', '--json', '--skip-git-repo-check', '-c', `sandbox_mode="${sandbox}"`, ...(chat ? [] : codexOptions(c))];
  if (job.sessionId) args.push('resume', job.sessionId, '-');
  else args.push('-C', cwd, '-');
  const r = await run(c.bin, args, { cwd, input: job.prompt, timeoutMs: cfg.timeoutMs });
  let sessionId = job.sessionId;
  let failure;
  for (const line of r.stdout.split('\n')) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'thread.started' && ev.thread_id) sessionId = ev.thread_id;
      if (ev.type === 'turn.failed' || ev.type === 'error') failure = ev.error?.message || ev.message;
    } catch {
      /* ignora */
    }
  }
  if (r.code !== 0 || failure) return { ok: false, sessionId, error: errText(failure, r) };
  return { ok: true, sessionId };
}

const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean);

/** Flags de Claude según la configuración (permisos elegidos en la app). */
export function claudeOptions(c) {
  const args = [];
  if (c.model) args.push('--model', c.model);
  const allowed = list(c.allowedTools);
  const denied = list(c.disallowedTools);
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  if (denied.length) args.push('--disallowedTools', denied.join(','));
  if (c.mcp === 'none') args.push('--strict-mcp-config');
  return [...args, ...list(c.extraArgs)];
}

/** Flags de Codex según la configuración. */
export function codexOptions(c) {
  const args = [];
  if (c.model) args.push('-m', c.model);
  if (c.networkAccess && c.sandbox === 'workspace-write') args.push('-c', 'sandbox_workspace_write.network_access=true');
  return [...args, ...list(c.extraArgs)];
}

function errText(msg, r) {
  const t = (msg || r.stderr || r.stdout || `código ${r.code}`).trim();
  return t.length > 600 ? t.slice(-600) : t;
}
