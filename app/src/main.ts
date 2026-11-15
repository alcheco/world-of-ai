import { t, setLang, getLang } from './i18n';
import * as api from './api';
import type { Json, CompanionState } from './api';
import { open as openDialog, ask } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as autostartEnabled } from '@tauri-apps/plugin-autostart';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type View = 'status' | 'agents' | 'game' | 'general' | 'log';
type Note = { kind: 'ok' | 'warn' | 'error'; text: string } | null;

const INSTALL_URLS: Record<string, string> = {
  claude: 'https://docs.claude.com/en/docs/claude-code/setup',
  codex: 'https://github.com/openai/codex#installing-and-running-codex-cli',
};
const WIZ_STEPS = ['welcome', 'game', 'agents', 'permissions', 'behavior', 'install'] as const;
const UPDATE_EVERY_MS = 6 * 3600 * 1000;

const S = {
  cfg: {} as Json,
  info: {} as Json,
  state: { running: false, status: {}, logs: [] } as CompanionState,
  view: 'status' as View,
  wizard: false,
  wizStep: 0,
  detect: null as Json,
  detecting: false,
  autostart: false,
  update: null as Update | null,
  updateMsg: '',
  addonNote: null as Note,
  gameNote: null as Note,
  logFilter: 'all',
  toast: '',
};

// ------------------------------------------------------------------ utilidades
const $app = document.getElementById('app')!;
const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function getPath(obj: Json, path: string) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj: Json, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {});
  o[keys[keys.length - 1]] = value;
}
const linesOf = (v: unknown) => (Array.isArray(v) ? v.join('\n') : String(v ?? ''));

let toastTimer = 0;
function toast(text: string) {
  S.toast = text;
  renderToast();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    S.toast = '';
    renderToast();
  }, 2600);
}

async function save(): Promise<Json> {
  try {
    const reply = await api.saveConfig(S.cfg);
    if (reply && reply.ok === false) toast(reply.error?.msg ?? t('common.error'));
    return reply?.result;
  } catch (e) {
    toast(`${t('common.error')}: ${e}`);
  }
}

const status = () => S.state.status ?? {};

// ------------------------------------------------------------------ piezas
function companionLabel() {
  const st = status();
  if (!S.state.running) return { cls: 'off', text: t('c.stopped') };
  if (!st.version) return { cls: 'wait', text: t('c.starting') };
  if (st.working) return { cls: 'busy', text: t('c.working') };
  return { cls: 'on', text: t('c.running') };
}

function radioCards(name: string, path: string, options: { value: string; title: string; desc: string; rec?: boolean; danger?: boolean }[]) {
  const cur = getPath(S.cfg, path);
  return `<div class="cards">${options
    .map(
      (o) => `<label class="card-opt ${cur === o.value ? 'sel' : ''} ${o.danger ? 'danger' : ''}">
        <input type="radio" name="${name}" value="${esc(o.value)}" data-radio="${path}" ${cur === o.value ? 'checked' : ''} />
        <span class="t">${esc(o.title)}${o.rec ? ` <em class="pill">${t('common.recommended')}</em>` : ''}</span>
        <span class="d">${esc(o.desc)}</span>
      </label>`,
    )
    .join('')}</div>`;
}

function toggle(path: string, label: string, hint = '', disabled = false) {
  const on = !!getPath(S.cfg, path);
  return `<label class="toggle ${disabled ? 'disabled' : ''}">
    <input type="checkbox" data-bind="${path}" data-type="bool" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
    <span class="sw"></span><span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
  </label>`;
}

function textField(path: string, label: string, hint = '', placeholder = '') {
  return `<label class="field"><span>${esc(label)}</span>
    <input type="text" data-bind="${path}" value="${esc(getPath(S.cfg, path) ?? '')}" placeholder="${esc(placeholder)}" spellcheck="false" />
    ${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

function numberField(path: string, label: string, min: number, max: number, scale = 1) {
  const v = Math.round((getPath(S.cfg, path) ?? 0) / scale);
  return `<label class="field small"><span>${esc(label)}</span>
    <input type="number" min="${min}" max="${max}" data-bind="${path}" data-type="number" data-scale="${scale}" value="${v}" /></label>`;
}

function linesField(path: string, label: string, hint = '', placeholder = '') {
  return `<label class="field"><span>${esc(label)}</span>
    <textarea rows="3" data-bind="${path}" data-type="lines" placeholder="${esc(placeholder)}" spellcheck="false">${esc(linesOf(getPath(S.cfg, path)))}</textarea>
    ${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

function note(n: Note) {
  return n ? `<div class="note ${n.kind}">${esc(n.text)}</div>` : '';
}

function agentCard(agent: 'claude' | 'codex') {
  const d = S.detect?.[agent];
  let state = `<span class="muted">…</span>`;
  if (S.detect) {
    state = d?.path
      ? `<span class="ok">● ${d.version ? t('agents.found', { version: esc(d.version) }) : ''}</span> <code title="${esc(d.path)}">${esc(d.path)}</code>`
      : `<span class="bad">● ${t('common.notFound')}</span> <a href="#" data-action="url" data-url="${INSTALL_URLS[agent]}">${t('agents.install')}</a>`;
  }
  return `<div class="agent-head"><b>${agent === 'claude' ? 'Claude Code' : 'Codex'}</b><span class="agent-state">${state}</span></div>`;
}

function addonBlock() {
  const st = status();
  const a = st.addon ?? { kind: 'none' };
  const bundled = st.bundledAddon;
  const label = t(`addon.${a.kind}`, { version: a.version ?? '?', target: a.target ?? '' });
  const outdated = a.kind === 'copy' && bundled && a.version !== bundled;
  const buttons: string[] = [];
  if (a.kind === 'none' || a.kind === 'broken-link') buttons.push(`<button class="primary" data-action="install-addon">${t('addon.install')}</button>`);
  if (a.kind === 'copy')
    buttons.push(
      `<button class="${outdated ? 'primary' : ''}" data-action="install-addon">${t(outdated ? 'addon.update' : 'addon.reinstall')}</button>`,
    );
  if (a.kind === 'link') buttons.push(`<button data-action="install-addon">${t('addon.reinstall')}</button>`);
  if (a.kind === 'copy' || a.kind === 'link') buttons.push(`<button class="ghost danger" data-action="uninstall-addon">${t('addon.uninstall')}</button>`);
  return `<div class="row between"><div><b>${esc(label)}</b>${
    outdated ? `<div class="muted">${t('status.addonUpdate', { version: esc(bundled) })}</div>` : ''
  }</div><div class="row">${buttons.join('')}</div></div>${note(S.addonNote)}`;
}

function wowFolderBlock() {
  const st = status();
  const found: string[] = S.detect?.wowDirs ?? [];
  const others = found.filter((d) => d !== st.wowDir);
  return `<div class="field"><span>${t('game.folder')}</span>
      <div class="row"><input type="text" readonly value="${esc(st.wowDir ?? S.cfg.wowDir ?? '')}" class="grow mono" />
      <button data-action="pick-wow">${t('common.choose')}</button></div>
      <small>${t('game.folderHint')}</small></div>
    ${st.version && !st.wowOk ? `<div class="note warn">${t('game.invalid')}</div>` : ''}
    ${S.detect && !found.length ? `<div class="note warn">${t('game.noneDetected')}</div>` : ''}
    ${others.length ? `<div class="chips"><span class="muted">${t('game.detected')}</span>${others.map((d) => `<button class="chip" data-action="set-wow" data-dir="${esc(d)}">${esc(d)}</button>`).join('')}</div>` : ''}
    ${note(S.gameNote)}`;
}

function claudePermissions() {
  return radioCards('claude-mode', 'claude.permissionMode', [
    { value: 'default', title: t('claude.mode.default'), desc: t('claude.mode.default.d') },
    { value: 'acceptEdits', title: t('claude.mode.acceptEdits'), desc: t('claude.mode.acceptEdits.d'), rec: true },
    { value: 'plan', title: t('claude.mode.plan'), desc: t('claude.mode.plan.d') },
    { value: 'bypassPermissions', title: t('claude.mode.bypassPermissions'), desc: t('claude.mode.bypassPermissions.d'), danger: true },
  ]);
}

function codexPermissions() {
  const ww = S.cfg.codex?.sandbox === 'workspace-write';
  return (
    radioCards('codex-sandbox', 'codex.sandbox', [
      { value: 'read-only', title: t('codex.sandbox.read-only'), desc: t('codex.sandbox.read-only.d') },
      { value: 'workspace-write', title: t('codex.sandbox.workspace-write'), desc: t('codex.sandbox.workspace-write.d'), rec: true },
      { value: 'danger-full-access', title: t('codex.sandbox.danger-full-access'), desc: t('codex.sandbox.danger-full-access.d'), danger: true },
    ]) + toggle('codex.networkAccess', t('codex.network'), t('codex.networkHint'), !ww)
  );
}

function appearanceCards() {
  return radioCards('appearance', 'app.appearance', [
    { value: 'window', title: t('general.appearance.window'), desc: t('general.appearance.window.d') },
    { value: 'tray', title: t('general.appearance.tray'), desc: t('general.appearance.tray.d') },
  ]);
}

function autostartToggle() {
  return `<label class="toggle"><input type="checkbox" data-action="autostart" ${S.autostart ? 'checked' : ''} />
    <span class="sw"></span><span><b>${t('general.autostart')}</b><small>${t('general.autostartHint')}</small></span></label>`;
}

function langButtons() {
  return `<div class="row">${[
    ['es', 'Español'],
    ['en', 'English'],
  ]
    .map(([v, l]) => `<button class="${getLang() === v ? 'primary' : ''}" data-action="lang" data-lang="${v}">${l}</button>`)
    .join('')}</div>`;
}

// ------------------------------------------------------------------ vistas
function viewStatus() {
  const st = status();
  const c = companionLabel();
  const a = st.addon ?? { kind: 'none' };
  const jobs = new Map<string, Json>();
  for (const l of S.state.logs) if (l.ev === 'job') jobs.set(l.id, { ...jobs.get(l.id), ...l });
  const recent = [...jobs.values()].sort((x, y) => (y.ts ?? 0) - (x.ts ?? 0)).slice(0, 8);
  const outdated = a.kind === 'copy' && st.bundledAddon && a.version !== st.bundledAddon;
  const row = (label: string, value: string, ok: boolean | null) =>
    `<div class="stat"><span>${esc(label)}</span><b class="${ok === null ? '' : ok ? 'ok' : 'bad'}">${value}</b></div>`;
  return `<h1>${t('status.title')}</h1>
    ${outdated ? `<div class="banner"><span>${t('status.addonUpdate', { version: esc(st.bundledAddon) })}</span><button class="primary" data-action="install-addon">${t('status.addonUpdateBtn')}</button></div>` : ''}
    ${note(S.addonNote)}
    <section class="panel">
      ${row(t('status.companion'), esc(c.text), c.cls === 'on' || c.cls === 'busy')}
      ${row(t('status.wow'), st.wowOk ? `<span class="mono">${esc(st.wowDir)}</span>` : t('status.wowMissing'), !!st.wowOk)}
      ${row(t('status.addon'), esc(t(`addon.${a.kind}`, { version: a.version ?? '?' })), a.kind === 'copy' || a.kind === 'link')}
      ${row(t('status.live'), st.liveOk ? t('status.liveOk') : t('status.liveMissing'), !!st.liveOk)}
      ${row(t('status.sessions'), String(st.sessions ?? '—'), null)}
      ${row(t('status.queue'), String(st.queue ?? '—'), null)}
      <div class="row actions">
        <button data-action="restart">${t('status.restart')}</button>
        <button data-action="process-now">${t('status.processNow')}</button>
        <button data-action="open-wow" ${st.wowOk ? '' : 'disabled'}>${t('status.openWow')}</button>
      </div>
    </section>
    <h2>${t('status.recent')}</h2>
    <section class="panel">${
      recent.length
        ? recent
            .map(
              (j) => `<div class="job"><span class="tag ${j.agent}">${esc(j.agent ?? '')}</span>
              <span class="jid mono">${esc(j.id)}</span>
              <span class="jst ${j.status}">${t(`job.${j.status}`)}${j.secs ? ` · ${j.secs}s` : ''}</span>
              ${j.error ? `<div class="jerr">${esc(j.error)}</div>` : ''}</div>`,
            )
            .join('')
        : `<p class="muted">${t('status.noJobs')}</p>`
    }</section>`;
}

function viewAgents() {
  return `<div class="row between"><h1>${t('agents.title')}</h1><button data-action="detect" ${S.detecting ? 'disabled' : ''}>${t('agents.detect')}</button></div>
    <section class="panel">
      ${agentCard('claude')}
      <h3>${t('claude.permissions')}</h3><p class="muted">${t('claude.permHint')}</p>
      ${claudePermissions()}
      <div class="grid2">
        ${linesField('claude.allowedTools', t('claude.allowed'), t('claude.allowedHint'), 'Bash(git *)\nBash(npm test)')}
        ${linesField('claude.disallowedTools', t('claude.denied'), '', 'Bash(rm *)')}
      </div>
      <details><summary>${t('common.advanced')}</summary>
        <div class="grid2">
          ${textField('claude.model', t('agents.model'), t('agents.modelHint'), 'sonnet')}
          <label class="field"><span>${t('claude.mcp')}</span><select data-bind="claude.mcp">
            ${['default', 'none'].map((v) => `<option value="${v}" ${(S.cfg.claude?.mcp ?? 'default') === v ? 'selected' : ''}>${t(`claude.mcp.${v}`)}</option>`).join('')}
          </select></label>
          ${textField('claude.bin', t('agents.path'), t('agents.pathHint'), 'claude')}
          ${linesField('claude.extraArgs', t('agents.extraArgs'))}
        </div>
      </details>
    </section>
    <section class="panel">
      ${agentCard('codex')}
      <h3>${t('codex.permissions')}</h3>
      ${codexPermissions()}
      <details><summary>${t('common.advanced')}</summary>
        <div class="grid2">
          ${textField('codex.model', t('agents.model'), t('agents.modelHint'))}
          ${textField('codex.bin', t('agents.path'), t('agents.pathHint'), 'codex')}
          ${linesField('codex.extraArgs', t('agents.extraArgs'))}
        </div>
      </details>
    </section>`;
}

function viewGame() {
  return `<h1>${t('game.title')}</h1>
    <section class="panel">${wowFolderBlock()}</section>
    <h2>${t('game.addon')}</h2>
    <section class="panel">${addonBlock()}<p class="muted small">${t('addon.enableHint')}</p></section>
    <h2>${t('game.limits')}</h2>
    <section class="panel"><div class="grid3">
      ${numberField('maxSessions', t('game.maxSessions'), 5, 200)}
      ${numberField('maxMessages', t('game.maxMessages'), 10, 400)}
      ${numberField('timeoutMs', t('game.timeout'), 1, 240, 60000)}
    </div></section>`;
}

function viewGeneral() {
  return `<h1>${t('general.title')}</h1>
    <section class="panel"><div class="field"><span>${t('general.language')}</span>${langButtons()}</div></section>
    <h2>${t('general.appearance')}</h2>
    <section class="panel">${appearanceCards()}<p class="muted small">${t('general.closeHint')}</p>${autostartToggle()}</section>
    <h2>${t('general.updates')}</h2>
    <section class="panel">
      ${toggle('app.autoUpdate', t('general.autoUpdate'))}
      <div class="row between"><span class="muted">${t('general.version', { version: esc(S.info.version) })}</span>
      <button data-action="check-updates">${t('general.checkNow')}</button></div>
      ${S.updateMsg ? `<div class="note">${esc(S.updateMsg)}</div>` : ''}
    </section>
    <section class="panel">
      <div class="row between"><div><b>${t('general.dataDir')}</b><div class="mono muted small">${esc(S.info.dataDir)}</div></div>
      <button data-action="open-data">${t('common.open')}</button></div>
    </section>
    <div class="row"><button class="danger" data-action="quit">${t('general.quit')}</button></div>`;
}

function viewLog() {
  const problems = S.logFilter === 'problems';
  const logs = S.state.logs.filter((l) => l.ev === 'log' && (!problems || l.level !== 'info')).slice(-300).reverse();
  return `<div class="row between"><h1>${t('log.title')}</h1><div class="row">
      <select data-action="log-filter"><option value="all" ${!problems ? 'selected' : ''}>${t('log.all')}</option>
      <option value="problems" ${problems ? 'selected' : ''}>${t('log.problems')}</option></select>
      <button data-action="copy-log">${t('common.copy')}</button></div></div>
    <section class="panel log">${
      logs.length
        ? logs
            .map(
              (l) => `<div class="logline ${l.level}"><span class="ts">${new Date(l.ts).toLocaleTimeString()}</span>
              <span class="scope">${esc(l.scope)}</span><span class="msg">${esc(l.msg)}</span></div>`,
            )
            .join('')
        : `<p class="muted">${t('log.empty')}</p>`
    }</section>`;
}

const VIEWS: Record<View, () => string> = { status: viewStatus, agents: viewAgents, game: viewGame, general: viewGeneral, log: viewLog };

// ------------------------------------------------------------------ asistente
function viewWizard() {
  const step = WIZ_STEPS[S.wizStep];
  const total = WIZ_STEPS.length;
  let body = '';
  let canNext = true;
  switch (step) {
    case 'welcome':
      body = `<img class="hero" src="/icon.png" alt="" /><h1>${t('wiz.welcome')}</h1><p>${t('wiz.welcomeText')}</p>
        <h3>${t('wiz.chooseLang')}</h3>${langButtons()}`;
      break;
    case 'game':
      body = `<h1>${t('wiz.game')}</h1>${wowFolderBlock()}`;
      canNext = !!status().wowOk;
      break;
    case 'agents': {
      const none = S.detect && !S.detect.claude?.path && !S.detect.codex?.path;
      body = `<h1>${t('wiz.agents')}</h1><p>${t('wiz.agentsText')}</p>
        <section class="panel">${agentCard('claude')}${agentCard('codex')}</section>
        ${none ? `<div class="note warn">${t('wiz.agentsNone')}</div>` : ''}
        <button data-action="detect" ${S.detecting ? 'disabled' : ''}>${t('agents.detect')}</button>`;
      break;
    }
    case 'permissions':
      body = `<h1>${t('wiz.permissions')}</h1><p class="muted">${t('wiz.permissionsText')}</p>
        ${S.detect?.claude?.path || !S.detect?.codex?.path ? `<h3>Claude Code</h3>${claudePermissions()}` : ''}
        ${S.detect?.codex?.path ? `<h3>Codex</h3>${codexPermissions()}` : ''}`;
      break;
    case 'behavior':
      body = `<h1>${t('wiz.behavior')}</h1>${appearanceCards()}${autostartToggle()}`;
      break;
    case 'install': {
      const kind = status().addon?.kind;
      canNext = kind === 'copy' || kind === 'link';
      body = `<h1>${t('wiz.install')}</h1><p>${t('wiz.installText')}</p>
        <section class="panel">${addonBlock()}</section>
        ${canNext ? `<div class="note">${t('addon.enableHint')}</div>` : ''}`;
      break;
    }
  }
  const last = S.wizStep === total - 1;
  return `<div class="wizard"><div class="wiz-card">
    <div class="wiz-step">${t('wiz.step', { n: S.wizStep + 1, total })}</div>
    <div class="dots">${WIZ_STEPS.map((_, i) => `<i class="${i <= S.wizStep ? 'on' : ''}"></i>`).join('')}</div>
    <div class="wiz-body">${body}</div>
    <div class="row between wiz-nav">
      ${S.wizStep > 0 ? `<button class="ghost" data-action="wiz-back">${t('common.back')}</button>` : '<span></span>'}
      <div class="row">
        ${!canNext ? `<button class="ghost" data-action="wiz-next">${t('common.skip')}</button>` : ''}
        <button class="primary" data-action="wiz-next" ${canNext ? '' : 'disabled'}>${t(last ? 'common.finish' : 'common.next')}</button>
      </div>
    </div></div></div>`;
}

// ------------------------------------------------------------------ render
function renderToast() {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = S.toast;
  el.className = S.toast ? 'show' : '';
}

function updateBanner() {
  if (!S.update) return '';
  return `<div class="update-bar"><span>${t('update.available', { version: esc(S.update.version) })}</span>
    ${S.updateMsg ? `<span class="muted">${esc(S.updateMsg)}</span>` : `<button class="primary" data-action="install-update">${t('update.install')}</button><button class="ghost" data-action="dismiss-update">${t('update.later')}</button>`}</div>`;
}

function render() {
  if (S.wizard) {
    $app.innerHTML = viewWizard();
    return;
  }
  const c = companionLabel();
  const nav = (['status', 'agents', 'game', 'general', 'log'] as View[])
    .map((v) => `<button class="nav ${S.view === v ? 'active' : ''}" data-action="nav" data-view="${v}">${t(`nav.${v}`)}</button>`)
    .join('');
  $app.innerHTML = `<aside>
      <div class="brand"><img src="/icon.png" alt="" /><div><b>WoAI</b><small>${t('app.tagline')}</small></div></div>
      <nav>${nav}</nav>
      <div class="cstat ${c.cls}" id="cstat"><i></i>${esc(c.text)}</div>
      <div class="ver">v${esc(S.info.version ?? '')}</div>
    </aside>
    <main>${updateBanner()}<div id="view">${VIEWS[S.view]()}</div></main>`;
}

/** Al cambiar el estado: solo lo que depende de él (sin pisar lo que se está editando). */
function refreshState() {
  if (S.wizard) {
    const step = WIZ_STEPS[S.wizStep];
    if (step === 'game' || step === 'install') render();
    return;
  }
  const c = companionLabel();
  const el = document.getElementById('cstat');
  if (el) {
    el.className = `cstat ${c.cls}`;
    el.innerHTML = `<i></i>${esc(c.text)}`;
  }
  if (S.view === 'status' || S.view === 'log' || S.view === 'game') {
    const v = document.getElementById('view');
    const active = document.activeElement;
    // No re-renderiza si se está escribiendo en un campo de esta vista.
    if (v && !(active && v.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName))) v.innerHTML = VIEWS[S.view]();
  }
}

// ------------------------------------------------------------------ acciones
async function detect() {
  S.detecting = true;
  render();
  try {
    const r = await api.request('detect');
    if (r.ok) S.detect = r.result;
  } catch (e) {
    toast(String(e));
  }
  S.detecting = false;
  render();
}

async function setWowDir(dir: string) {
  S.cfg.wowDir = dir;
  S.gameNote = null;
  const st = await save();
  if (st && !st.wowOk) S.gameNote = { kind: 'warn', text: t('game.invalid') };
  render();
}

async function installAddon(force = false) {
  S.addonNote = null;
  try {
    const r = await api.request('install-addon', { force });
    if (!r.ok && r.error?.key === 'addon.isLink') {
      if (await ask(t('addon.replaceLink', { target: r.error.params?.target ?? '' }), { title: 'WoAI', kind: 'warning' })) return installAddon(true);
      return;
    }
    if (!r.ok) S.addonNote = { kind: 'error', text: r.error?.msg ?? t('common.error') };
    else S.addonNote = { kind: r.result.needsRestart ? 'warn' : 'ok', text: t(r.result.needsRestart ? 'addon.restartWow' : 'addon.reloadWow') };
  } catch (e) {
    S.addonNote = { kind: 'error', text: String(e) };
  }
  render();
}

async function uninstallAddon() {
  if (!(await ask(t('addon.confirmUninstall'), { title: 'WoAI', kind: 'warning' }))) return;
  S.addonNote = null;
  await api.request('uninstall-addon').catch((e) => toast(String(e)));
  render();
}

async function checkUpdates(manual: boolean) {
  S.updateMsg = '';
  try {
    const u = await check();
    S.update = u ?? null;
    if (!u && manual) S.updateMsg = t('update.upToDate');
  } catch (e) {
    if (manual) S.updateMsg = t('update.error', { error: e });
  }
  render();
}

async function installUpdate() {
  const u = S.update;
  if (!u) return;
  let total = 0;
  let got = 0;
  S.updateMsg = t('update.downloading', { pct: '' });
  render();
  try {
    await u.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
      if (ev.event === 'Progress') {
        got += ev.data.chunkLength;
        S.updateMsg = t('update.downloading', { pct: total ? `${Math.round((got / total) * 100)} %` : '' });
        render();
      }
    });
    await relaunch();
  } catch (e) {
    S.updateMsg = t('update.error', { error: e });
    render();
  }
}

async function finishWizard() {
  S.cfg.app.onboarded = true;
  await save();
  S.wizard = false;
  S.view = 'status';
  render();
}

async function onAction(el: HTMLElement) {
  const a = el.dataset.action!;
  switch (a) {
    case 'nav':
      S.view = el.dataset.view as View;
      if (S.view === 'agents' && !S.detect) void detect();
      render();
      break;
    case 'restart':
      await api.restartCompanion();
      break;
    case 'process-now':
      await api.request('process-now').catch((e) => toast(String(e)));
      toast('✓');
      break;
    case 'open-wow':
      await api.openPath(status().wowDir).catch((e) => toast(String(e)));
      break;
    case 'open-data':
      await api.openPath(S.info.dataDir).catch((e) => toast(String(e)));
      break;
    case 'detect':
      await detect();
      break;
    case 'pick-wow': {
      const dir = await openDialog({ directory: true, defaultPath: status().wowDir || undefined });
      if (typeof dir === 'string') await setWowDir(dir);
      break;
    }
    case 'set-wow':
      await setWowDir(el.dataset.dir!);
      break;
    case 'install-addon':
      await installAddon();
      break;
    case 'uninstall-addon':
      await uninstallAddon();
      break;
    case 'lang':
      S.cfg.lang = el.dataset.lang;
      setLang(S.cfg.lang);
      render();
      await save();
      break;
    case 'check-updates':
      await checkUpdates(true);
      break;
    case 'install-update':
      await installUpdate();
      break;
    case 'dismiss-update':
      S.update = null;
      render();
      break;
    case 'copy-log': {
      const text = S.state.logs
        .filter((l) => l.ev === 'log')
        .map((l) => `${new Date(l.ts).toISOString()} [${l.level}] [${l.scope}] ${l.msg}`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      toast(t('common.copied'));
      break;
    }
    case 'quit':
      await api.quitApp();
      break;
    case 'url':
      await openUrl(el.dataset.url!);
      break;
    case 'wiz-back':
      S.wizStep = Math.max(0, S.wizStep - 1);
      render();
      break;
    case 'wiz-next':
      if (S.wizStep === WIZ_STEPS.length - 1) return finishWizard();
      S.wizStep++;
      if (WIZ_STEPS[S.wizStep] === 'game' || WIZ_STEPS[S.wizStep] === 'agents') {
        if (!S.detect) void detect();
      }
      render();
      break;
  }
}

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el || el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'checkbox') return;
  e.preventDefault();
  void onAction(el);
});

document.addEventListener('change', async (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.action === 'autostart') {
    try {
      if (el.checked) await enableAutostart();
      else await disableAutostart();
    } catch (err) {
      toast(String(err));
    }
    S.autostart = await autostartEnabled().catch(() => false);
    render();
    return;
  }
  if (el.dataset.action === 'log-filter') {
    S.logFilter = el.value;
    render();
    return;
  }
  if (el.dataset.radio) {
    const path = el.dataset.radio;
    const prev = getPath(S.cfg, path);
    if (el.value === 'bypassPermissions' && !(await ask(t('claude.confirmBypass'), { title: 'WoAI', kind: 'warning' }))) return render();
    if (el.value === 'danger-full-access' && !(await ask(t('codex.confirmFull'), { title: 'WoAI', kind: 'warning' }))) return render();
    if (prev === el.value) return;
    setPath(S.cfg, path, el.value);
    render();
    await save();
    toast(t('common.saved'));
    return;
  }
  const path = el.dataset.bind;
  if (!path) return;
  let value: unknown = el.value;
  if (el.dataset.type === 'bool') value = el.checked;
  if (el.dataset.type === 'number') value = Math.max(Number(el.min || 0), Number(el.value || 0)) * Number(el.dataset.scale || 1);
  if (el.dataset.type === 'lines') value = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
  if ((path === 'claude.bin' || path === 'codex.bin') && !String(value).trim()) value = path.split('.')[0];
  setPath(S.cfg, path, value);
  if (path === 'codex.sandbox' || path === 'app.autoUpdate') render();
  await save();
  toast(t('common.saved'));
});

// ------------------------------------------------------------------ arranque
async function init() {
  [S.info, S.cfg, S.state] = await Promise.all([api.appInfo(), api.getConfig(), api.getState()]);
  setLang(S.cfg.lang ?? S.info.systemLang);
  S.autostart = await autostartEnabled().catch(() => false);
  S.wizard = !S.cfg.app?.onboarded;

  await api.onState((s) => {
    S.state = s;
    refreshState();
  });
  await api.onCompanion((ev) => {
    if (ev.ev === 'log' || ev.ev === 'job') {
      S.state.logs.push({ ...ev, ts: ev.ts ?? Date.now() });
      if (S.state.logs.length > 500) S.state.logs.shift();
      if (ev.ev === 'job' || S.view === 'log') refreshState();
    }
  });
  await api.onCheckUpdates(() => {
    if (!S.wizard) S.view = 'general';
    void checkUpdates(true);
  });

  render();
  if (S.wizard) void detect();

  if (S.cfg.app?.autoUpdate !== false) {
    setTimeout(() => void checkUpdates(false), 5000);
    setInterval(() => S.cfg.app?.autoUpdate !== false && void checkUpdates(false), UPDATE_EVERY_MS);
  }
}

void init();
