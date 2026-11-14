#!/usr/bin/env node
// Companion de WoAI: lee los prompts que deja el addon en SavedVariables,
// los ejecuta con Claude Code / Codex y exporta las conversaciones a Data.lua.
//
//   woai-companion            vigila y ejecuta (logs en la terminal)
//   woai-companion --once     procesa la outbox una vez y sale
//   woai-companion --ipc      modo app: eventos JSON por stdout, comandos por stdin
//   woai-companion --version
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import pkg from '../package.json' with { type: 'json' };
import { loadConfig, savedVariablesFiles, addonSource } from './config.js';
import { parseSavedVariables, toLua } from './lua.js';
import { listClaude, listCodex } from './sessions.js';
import { runJob } from './runner.js';
import { projectOf } from './env.js';
import { publishLive, liveInstalled } from './live.js';
import { scanScreenshots } from './uplink.js';
import { writeAtomic } from './fsx.js';
import { log, emit, setIpc, setLang, t, KeyedError } from './log.js';
import { installAddon, uninstallAddon, addonStatus } from './addon.js';
import { findWowDirs, isWowDir } from './wow.js';
import { probeCli, killAll } from './bins.js';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log(pkg.version);
  process.exit(0);
}
const once = argv.includes('--once');
const ipc = argv.includes('--ipc');
setIpc(ipc);

let cfg = loadConfig();
setLang(cfg.lang);

// ------------------------------------------------------------ estado
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
  } catch {
    return { acks: {}, seq: 0 };
  }
}
const state = loadState();
function saveState() {
  // Conserva solo los 300 acks más recientes.
  const entries = Object.entries(state.acks).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  state.acks = Object.fromEntries(entries.slice(0, 300));
  fs.mkdirSync(path.dirname(cfg.stateFile), { recursive: true });
  writeAtomic(cfg.stateFile, JSON.stringify(state, null, 2));
}

// ------------------------------------------------------------ outbox
const svMtimes = new Map();
const queue = [];

function readOutbox() {
  for (const file of savedVariablesFiles(cfg)) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (svMtimes.get(file) === st.mtimeMs) continue;
    svMtimes.set(file, st.mtimeMs);
    let db;
    try {
      db = parseSavedVariables(fs.readFileSync(file, 'utf8')).WoAI_DB;
    } catch (e) {
      log('warn', 'outbox', 'outbox.parseError', { file, error: e.message });
      continue;
    }
    const outbox = Array.isArray(db?.outbox) ? db.outbox : Object.values(db?.outbox ?? {});
    for (const job of outbox) accept(job, 'outbox');
  }
}

// Prompts enviados por captura de pantalla (sin /reload).
function readScreenshots() {
  let any = false;
  for (const job of scanScreenshots(cfg.screenshotsDir)) any = accept(job, 'captura') || any;
  // Que el addon vea "en cola" sin esperar a que termine el prompt.
  if (any && !working) publish(false);
}

function accept(job, via) {
  if (!job?.id || !job.prompt || state.acks[job.id] || queue.some((q) => q.id === job.id)) return false;
  log('info', via, 'job.accepted', { id: job.id, via, agent: job.agent, session: job.sessionId || t('job.newSession') });
  queue.push(job);
  ack(job.id, { status: 'queued', agent: job.agent });
  return true;
}

function ack(id, data) {
  state.acks[id] = { ...state.acks[id], ...data, updatedAt: Math.floor(Date.now() / 1000) };
  saveState();
  dirty = true;
  const a = state.acks[id];
  emit('job', { id, status: a.status, agent: a.agent, sessionId: a.sessionId, error: a.error, secs: a.secs });
}

let working = null; // id del job en curso
async function work() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      working = job.id;
      ack(job.id, { status: 'running' });
      writeData();
      publish(false);
      emitStatus();
      const t0 = Date.now();
      const res = await runJob(job, cfg);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (res.ok) log('info', 'job', 'job.done', { id: job.id, secs, session: res.sessionId });
      else log('warn', 'job', 'job.failed', { id: job.id, secs, error: res.error });
      ack(job.id, { status: res.ok ? 'done' : 'error', error: res.error, sessionId: res.sessionId, agent: job.agent, secs: Number(secs) });
      // Señal primero: así Data.lua lleva ya la secuencia nueva.
      publish(true);
      writeData(true);
    }
  } finally {
    working = null;
    emitStatus();
  }
}

// ------------------------------------------------------------ Data.lua
let dirty = true;
let lastSignature = '';
let sessionCount = 0;

function trimMessages(messages) {
  return messages.slice(-cfg.maxMessages).map((m) => ({
    role: m.role,
    ts: m.ts,
    text: m.text.length > cfg.maxMessageChars ? m.text.slice(0, cfg.maxMessageChars) + '\n[…recortado]' : m.text,
  }));
}

function collect() {
  const sessions = [...listClaude(cfg.home, cfg.maxSessions), ...listCodex(cfg.home, cfg.maxSessions)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, cfg.maxSessions);
  return sessions;
}

function sessionView(s) {
  return {
    agent: s.agent,
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    project: s.project,
    worktree: s.worktree,
    updatedAt: s.updatedAt,
    messages: trimMessages(s.messages),
  };
}

function enrich(sessions) {
  return sessions.map((s) => ({ ...s, ...projectOf(s.cwd, cfg.home) }));
}

let warnedNoAddon = false;
function writeData(force = false) {
  const sessions = collect();
  sessionCount = sessions.length;
  const signature = sessions.map((s) => `${s.agent}:${s.id}:${s.updatedAt}`).join('|');
  if (!force && !dirty && signature === lastSignature) return;

  if (!fs.existsSync(cfg.addonDir)) {
    if (!warnedNoAddon) log('warn', 'data', 'data.noAddonDir', { dir: cfg.addonDir });
    warnedNoAddon = true;
    return;
  }
  warnedNoAddon = false;
  lastSignature = signature;
  dirty = false;

  const enriched = enrich(sessions);
  // Carpetas para sesiones nuevas: la raíz de cada proyecto (no los worktrees).
  const workspaces = [...new Set(enriched.map((s) => s.projectPath).filter(Boolean))].sort();
  const data = {
    version: 3,
    generatedAt: Math.floor(Date.now() / 1000),
    // Secuencia de señales ya levantadas y nº de slots: el addon espera la siguiente.
    live: { seq: state.seq || 0, slots: cfg.live.slots, signals: cfg.live.signals },
    acks: state.acks,
    workspaces,
    sessions: enriched.map(sessionView),
  };
  const lua = `-- Generado por woai-companion. No editar a mano.\nWoAI_Data = ${toLua(data)}\n`;
  writeAtomic(path.join(cfg.addonDir, 'Data.lua'), lua);
  log('info', 'data', 'data.updated', { n: sessions.length, kb: (lua.length / 1024).toFixed(0) });
}

// ------------------------------------------------------------ slots (sin /reload)
// Solo viajan los acks y las sesiones con prompts recientes, para que los
// slots pesen poco (se escriben todos en cada publicación).
let liveOk = false;
function publish(signal) {
  if (!liveOk) return;
  const since = Math.floor(Date.now() / 1000) - cfg.live.windowSec;
  const recent = new Set(
    Object.values(state.acks)
      .filter((a) => a.sessionId && (a.updatedAt || 0) >= since)
      .map((a) => a.sessionId),
  );
  const sessions = enrich(collect().filter((s) => recent.has(s.id))).map(sessionView);
  const bytes = publishLive(cfg, state, { generatedAt: Math.floor(Date.now() / 1000), acks: state.acks, sessions }, { signal });
  saveState();
  log('info', 'live', 'live.updated', {
    signal: signal ? t('live.signal', { seq: state.seq }) : '',
    n: sessions.length,
    kb: (bytes / 1024).toFixed(0),
  });
}

// ------------------------------------------------------------ estado para la app
let lastStatus = '';
function statusData() {
  return {
    version: pkg.version,
    wowDir: cfg.wowDir,
    wowOk: isWowDir(cfg.wowDir),
    dataDir: cfg.dataDir,
    addon: addonStatus(cfg),
    liveOk,
    savedVariables: savedVariablesFiles(cfg).filter((f) => fs.existsSync(f)).length,
    sessions: sessionCount,
    queue: queue.length,
    working: typeof working === 'string' ? working : null,
  };
}
function emitStatus(force = false) {
  if (!ipc) return;
  const s = statusData();
  const json = JSON.stringify(s);
  if (!force && json === lastStatus) return;
  lastStatus = json;
  emit('status', s);
}

// ------------------------------------------------------------ loop
function startup() {
  liveOk = liveInstalled(cfg);
  log('info', 'woai', 'woai.wowDir', { dir: cfg.wowDir });
  log('info', 'woai', 'woai.dataDir', { dir: cfg.dataDir });
  if (!liveOk) log('warn', 'woai', 'woai.liveMissing');
  log('info', 'woai', 'woai.savedVariables', { files: savedVariablesFiles(cfg).join(', ') || '(—)' });
}

// Jobs que quedaron a medias si el companion se cerró: se marcan como error.
for (const [id, a] of Object.entries(state.acks)) {
  if (a.status === 'running' || a.status === 'queued') {
    state.acks[id] = { ...a, status: 'error', error: t('job.interrupted') };
  }
}

function tick() {
  try {
    readOutbox();
    readScreenshots();
    writeData();
    void work();
  } catch (e) {
    log('error', 'tick', 'tick.error', { error: e.stack || e.message });
  }
  emitStatus();
}

let timer = null;
function schedule() {
  clearInterval(timer);
  timer = setInterval(tick, cfg.pollMs);
}

function shutdown(code = 0) {
  log('info', 'woai', 'woai.shutdown');
  clearInterval(timer);
  killAll();
  try {
    saveState();
  } catch {
    /* sin carpeta de datos */
  }
  process.exit(code);
}

// ------------------------------------------------------------ comandos (--ipc)
const commands = {
  status: () => statusData(),

  'reload-config': () => {
    let next;
    try {
      next = loadConfig();
    } catch (e) {
      throw new KeyedError('woai.configError', { error: e.message });
    }
    const wowChanged = next.wowDir !== cfg.wowDir;
    cfg = next;
    setLang(cfg.lang);
    if (wowChanged) {
      svMtimes.clear();
      startup();
    }
    liveOk = liveInstalled(cfg);
    dirty = true;
    schedule();
    log('info', 'woai', 'woai.configReloaded');
    tick();
    return statusData();
  },

  'install-addon': ({ force } = {}) => {
    const res = installAddon(cfg, addonSource(), { force });
    for (const e of res.events) log('info', 'addon', e.key, e.params);
    if (res.needsRestart) log('warn', 'addon', 'addon.restart');
    liveOk = liveInstalled(cfg);
    dirty = true;
    tick();
    const { events, ...rest } = res;
    return rest;
  },

  'uninstall-addon': () => {
    const n = uninstallAddon(cfg);
    log('info', 'addon', n ? 'addon.removed' : 'addon.notInstalled', { n, dir: path.dirname(cfg.addonDir) });
    liveOk = false;
    return { removed: n };
  },

  detect: async () => {
    const [claude, codex] = await Promise.all([probeCli(cfg.claude.bin), probeCli(cfg.codex.bin)]);
    return { wowDirs: findWowDirs(), wowDir: cfg.wowDir, wowOk: isWowDir(cfg.wowDir), claude, codex };
  },

  'process-now': () => {
    svMtimes.clear();
    tick();
    return statusData();
  },

  shutdown: () => {
    setImmediate(() => shutdown(0));
    return null;
  },
};

async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { cmd, id, ...args } = msg ?? {};
  const fn = commands[cmd];
  if (!fn) {
    log('warn', 'woai', 'woai.badCommand', { cmd });
    emit('reply', { re: id, cmd, ok: false, error: { key: 'woai.badCommand', params: { cmd }, msg: t('woai.badCommand', { cmd }) } });
    return;
  }
  try {
    const result = await fn(args);
    emit('reply', { re: id, cmd, ok: true, result });
  } catch (e) {
    const key = e instanceof KeyedError ? e.key : null;
    const error = key ? { key, params: e.params, msg: t(key, e.params) } : { msg: e.message };
    if (key) log('error', cmd, key, e.params);
    emit('reply', { re: id, cmd, ok: false, error });
  }
  emitStatus();
}

// ------------------------------------------------------------ arranque
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

startup();
if (once) {
  readOutbox();
  readScreenshots();
  work().then(() => {
    writeData(true);
    process.exit(0);
  });
} else {
  main();
}

function main() {
  if (ipc) {
    emit('ready', { version: pkg.version, pid: process.pid, ...statusData() });
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => void handle(line));
    // Si la app se cierra (o muere), stdin se cierra: el companion también.
    rl.on('close', () => shutdown(0));
  }
  tick();
  schedule();
}
