#!/usr/bin/env node
// Companion de WoAI: lee los prompts que deja el addon en SavedVariables,
// los ejecuta con Claude Code / Codex y exporta las conversaciones a Data.lua.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, savedVariablesFiles } from './config.js';
import { parseSavedVariables, toLua } from './lua.js';
import { listClaude, listCodex } from './sessions.js';
import { runJob } from './runner.js';
import { projectOf } from './env.js';
import { publishLive, liveInstalled } from './live.js';
import { scanScreenshots } from './uplink.js';

const cfg = loadConfig();
const once = process.argv.includes('--once');

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
  fs.writeFileSync(cfg.stateFile, JSON.stringify(state, null, 2));
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
      console.warn(`[outbox] no se pudo parsear ${file}: ${e.message}`);
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
  console.log(`[${via}] nuevo prompt ${job.id} → ${job.agent} ${job.sessionId || '(nueva sesión)'}`);
  queue.push(job);
  ack(job.id, { status: 'queued' });
  return true;
}

function ack(id, data) {
  state.acks[id] = { ...state.acks[id], ...data, updatedAt: Math.floor(Date.now() / 1000) };
  saveState();
  dirty = true;
}

let working = false;
async function work() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      ack(job.id, { status: 'running' });
      writeData();
      publish(false);
      const t0 = Date.now();
      const res = await runJob(job, cfg);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (res.ok) console.log(`[job] ${job.id} listo en ${secs}s (sesión ${res.sessionId})`);
      else console.warn(`[job] ${job.id} falló en ${secs}s: ${res.error}`);
      ack(job.id, { status: res.ok ? 'done' : 'error', error: res.error, sessionId: res.sessionId, agent: job.agent });
      // Señal primero: así Data.lua lleva ya la secuencia nueva.
      publish(true);
      writeData(true);
    }
  } finally {
    working = false;
  }
}

// ------------------------------------------------------------ Data.lua
let dirty = true;
let lastSignature = '';

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

function writeData(force = false) {
  const sessions = collect();
  const signature = sessions.map((s) => `${s.agent}:${s.id}:${s.updatedAt}`).join('|');
  if (!force && !dirty && signature === lastSignature) return;
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
  const target = path.join(cfg.addonDir, 'Data.lua');
  if (!fs.existsSync(cfg.addonDir)) {
    console.warn(`[data] no existe ${cfg.addonDir}. Ejecuta: npm run install-addon`);
    return;
  }
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, lua);
  fs.renameSync(tmp, target);
  console.log(`[data] Data.lua actualizado: ${sessions.length} sesiones, ${(lua.length / 1024).toFixed(0)} KB`);
}

// ------------------------------------------------------------ slots (sin /reload)
// Solo viajan los acks y las sesiones con prompts recientes, para que los
// slots pesen poco (se escriben todos en cada publicación).
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
  console.log(`[live] slots actualizados${signal ? ` + señal ${state.seq}` : ''}: ${sessions.length} sesión(es), ${(bytes / 1024).toFixed(0)} KB`);
}

// ------------------------------------------------------------ loop
// Jobs que quedaron a medias si el companion se cerró: se reintentan como error.
for (const [id, a] of Object.entries(state.acks)) {
  if (a.status === 'running' || a.status === 'queued') {
    state.acks[id] = { ...a, status: 'error', error: 'El companion se detuvo antes de terminar. Reenvía el prompt.' };
  }
}

function tick() {
  try {
    readOutbox();
    readScreenshots();
    writeData();
    void work();
  } catch (e) {
    console.error('[tick]', e);
  }
}

const liveOk = liveInstalled(cfg);
console.log(`[woai] WoW: ${cfg.wowDir}`);
if (!liveOk) console.warn('[woai] faltan los slots/señales: ejecuta `npm run install-addon` y reinicia WoW. Mientras, las respuestas llegan con /reload.');
console.log(`[woai] SavedVariables vigiladas: ${savedVariablesFiles(cfg).join(', ') || '(ninguna)'}`);
if (once) {
  readOutbox();
  readScreenshots();
  await work();
  writeData(true);
} else {
  tick();
  setInterval(tick, cfg.pollMs);
}
