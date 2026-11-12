// Lectura de sesiones locales de Claude Code (~/.claude/projects) y Codex (~/.codex/sessions).
import fs from 'node:fs';
import path from 'node:path';

const cache = new Map(); // path -> { key, session }

function cached(file, parse) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.session;
  let session = null;
  try {
    session = parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`[sessions] no se pudo leer ${file}: ${e.message}`);
  }
  if (session) session.updatedAt = Math.floor(st.mtimeMs / 1000);
  cache.set(file, { key, session });
  return session;
}

function jsonLines(src) {
  const out = [];
  for (const line of src.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* línea parcial mientras se escribe */
    }
  }
  return out;
}

function recentFiles(files, limit) {
  return files
    .map((f) => {
      try {
        return { f, m: fs.statSync(f).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.m - a.m)
    .slice(0, limit)
    .map((x) => x.f);
}

const NOISE = [/^<command-/, /^<local-command/, /^Caveat:/, /^\[Request interrupted/, /^<environment_context>/, /^# AGENTS\.md/, /^<user_instructions>/];

function cleanUserText(t) {
  if (typeof t !== 'string') return null;
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!t || NOISE.some((r) => r.test(t))) return null;
  return t;
}

function tsOf(iso) {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? Math.floor(n / 1000) : undefined;
}

/** Agrega texto al último mensaje si es del mismo rol, si no crea uno nuevo. */
function push(messages, role, text, ts) {
  const last = messages[messages.length - 1];
  if (role === 'assistant' && last && last.role === 'assistant') {
    last.text += '\n\n' + text;
    return;
  }
  messages.push({ role, text, ts });
}

// ---------------------------------------------------------------- Claude

export function parseClaude(src, id) {
  const lines = jsonLines(src);
  const messages = [];
  let title;
  let cwd;
  for (const d of lines) {
    if (!cwd && d.cwd) cwd = d.cwd;
    if (d.type === 'custom-title' && d.customTitle) title = d.customTitle;
    if (d.isSidechain || d.isMeta) continue;
    if (d.type === 'user' && d.message) {
      const c = d.message.content;
      let text = null;
      if (typeof c === 'string') text = cleanUserText(c);
      else if (Array.isArray(c) && !c.some((b) => b.type === 'tool_result')) {
        text = cleanUserText(c.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
      }
      if (text) push(messages, 'user', text, tsOf(d.timestamp));
    } else if (d.type === 'assistant' && d.message && Array.isArray(d.message.content)) {
      const text = d.message.content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (text) push(messages, 'assistant', text, tsOf(d.timestamp));
    }
  }
  if (!messages.length) return null;
  return {
    agent: 'claude',
    id,
    cwd,
    title: title || firstLine(messages.find((m) => m.role === 'user')?.text),
    messages,
  };
}

export function listClaude(home, limit) {
  const root = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const p = path.join(root, dir.name);
    for (const f of fs.readdirSync(p)) if (f.endsWith('.jsonl')) files.push(path.join(p, f));
  }
  const out = [];
  for (const f of recentFiles(files, limit * 3)) {
    const s = cached(f, (src) => parseClaude(src, path.basename(f, '.jsonl')));
    if (s) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------- Codex

function codexText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export function parseCodex(src) {
  const lines = jsonLines(src);
  let id;
  let cwd;
  const items = [];
  const legacy = [];
  for (const d of lines) {
    const p = d.payload || {};
    if (d.type === 'session_meta') {
      id = p.id || p.session_id;
      cwd = p.cwd;
    } else if (d.type === 'event_msg' && p.type === 'item_completed' && p.item) {
      if (p.item.type === 'UserMessage') items.push(['user', codexText(p.item.content), d.timestamp]);
      if (p.item.type === 'AgentMessage') items.push(['assistant', codexText(p.item.content), d.timestamp]);
    } else if (d.type === 'event_msg' && p.type === 'user_message') {
      legacy.push(['user', p.message, d.timestamp]);
    } else if (d.type === 'event_msg' && p.type === 'agent_message') {
      legacy.push(['assistant', p.message, d.timestamp]);
    }
  }
  const messages = [];
  for (const [role, raw, ts] of items.length ? items : legacy) {
    const text = role === 'user' ? cleanUserText(raw) : (raw || '').trim();
    if (text) push(messages, role, text, tsOf(ts));
  }
  if (!id || !messages.length) return null;
  return { agent: 'codex', id, cwd, title: null, messages };
}

function codexTitles(home) {
  const titles = new Map();
  const f = path.join(home, '.codex', 'session_index.jsonl');
  if (!fs.existsSync(f)) return titles;
  for (const d of jsonLines(fs.readFileSync(f, 'utf8'))) if (d.id && d.thread_name) titles.set(d.id, d.thread_name);
  return titles;
}

export function listCodex(home, limit) {
  const root = path.join(home, '.codex', 'sessions');
  if (!fs.existsSync(root)) return [];
  const files = fs
    .readdirSync(root, { recursive: true })
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(root, f));
  const titles = codexTitles(home);
  const out = [];
  for (const f of recentFiles(files, limit * 3)) {
    const s = cached(f, parseCodex);
    if (!s) continue;
    s.title = titles.get(s.id) || firstLine(s.messages.find((m) => m.role === 'user')?.text);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function firstLine(t) {
  if (!t) return '(sin título)';
  const l = t.split('\n').find((x) => x.trim()) || t;
  return l.length > 80 ? l.slice(0, 77) + '...' : l;
}
