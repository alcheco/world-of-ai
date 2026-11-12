// Ejecuta un prompt con el CLI de Claude Code o Codex.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function run(bin, args, { cwd, input, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += `\n[woai] tiempo agotado tras ${Math.round(timeoutMs / 1000)}s`;
      child.kill('SIGTERM');
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

/** Carpeta para conversaciones sin proyecto (se crea si no existe). */
export function noProjectDir(cfg) {
  const dir = cfg.noProjectDir || path.join(os.homedir(), '.woai', 'sin-proyecto');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeCwd(cwd, cfg) {
  return cwd && fs.existsSync(cwd) ? cwd : noProjectDir(cfg);
}

/**
 * @param job {{agent:'claude'|'codex', sessionId?:string, cwd?:string, prompt:string}}
 *   Sin cwd = conversación sin proyecto.
 * @returns {Promise<{ok:boolean, sessionId?:string, error?:string}>}
 */
export async function runJob(job, cfg) {
  const cwd = safeCwd(job.cwd, cfg);
  if (job.agent === 'claude') return runClaude(job, cfg, cwd);
  if (job.agent === 'codex') return runCodex(job, cfg, cwd);
  return { ok: false, error: `agente desconocido: ${job.agent}` };
}

async function runClaude(job, cfg, cwd) {
  const c = cfg.claude;
  const args = ['-p', '--output-format', 'json', '--permission-mode', c.permissionMode, ...c.extraArgs];
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

async function runCodex(job, cfg, cwd) {
  const c = cfg.codex;
  const args = ['exec', '--json', '--skip-git-repo-check', '-c', `sandbox_mode="${c.sandbox}"`, ...c.extraArgs];
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

function errText(msg, r) {
  const t = (msg || r.stderr || r.stdout || `código ${r.code}`).trim();
  return t.length > 600 ? t.slice(-600) : t;
}
