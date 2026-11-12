import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installLive, publishLive, liveInstalled, silentWav, sigIndex, slotName } from '../src/live.js';
import { parseSavedVariables } from '../src/lua.js';

function tmpCfg() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'woai-live-'));
  const addonDir = path.join(root, 'AddOns', 'WoAI');
  fs.mkdirSync(addonDir, { recursive: true });
  return { addonDir, live: { slots: 5, signals: 10 } };
}

test('silentWav es un WAV PCM válido', () => {
  const b = silentWav();
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  assert.equal(b.readUInt32LE(4), b.length - 8);
});

test('sigIndex da la vuelta', () => {
  assert.equal(sigIndex(1, 10), 1);
  assert.equal(sigIndex(10, 10), 10);
  assert.equal(sigIndex(11, 10), 1);
});

test('installLive crea slots y señales vacías', () => {
  const cfg = tmpCfg();
  assert.equal(liveInstalled(cfg), false);
  installLive(cfg);
  assert.equal(liveInstalled(cfg), true);
  const toc = fs.readFileSync(path.join(cfg.addonDir, '..', slotName(5), `${slotName(5)}.toc`), 'utf8');
  assert.match(toc, /## LoadOnDemand: 1/);
  assert.equal(fs.statSync(path.join(cfg.addonDir, 'sig', '010.wav')).size, 0);
  assert.equal(fs.statSync(path.join(cfg.addonDir, 'ctl', 'empty.wav')).size, 0);
  assert.ok(fs.statSync(path.join(cfg.addonDir, 'ctl', 'valid.wav')).size > 44);
  // Reinstalar no devuelve archivos nuevos.
  assert.equal(installLive(cfg), 0);
});

test('publishLive escribe todos los slots y levanta la señal', () => {
  const cfg = tmpCfg();
  installLive(cfg);
  const state = { seq: 0 };
  publishLive(cfg, state, { acks: { a: { status: 'running' } }, sessions: [] });
  assert.equal(state.seq, 0);
  const sig1 = path.join(cfg.addonDir, 'sig', '001.wav');
  assert.equal(fs.statSync(sig1).size, 0);

  publishLive(cfg, state, { acks: { a: { status: 'done' } }, sessions: [{ id: 's', messages: [] }] }, { signal: true });
  assert.equal(state.seq, 1);
  assert.ok(fs.statSync(sig1).size > 44);
  for (let i = 1; i <= 5; i++) {
    const src = fs.readFileSync(path.join(cfg.addonDir, '..', slotName(i), 'Inbox.lua'), 'utf8');
    const live = parseSavedVariables(src).WoAI_Live;
    assert.equal(live.seq, 1);
    assert.equal(live.acks.a.status, 'done');
  }
});

test('al dar la vuelta vacía las señales siguientes', () => {
  const cfg = tmpCfg();
  installLive(cfg);
  const state = { seq: 0 };
  for (let i = 0; i < 10; i++) publishLive(cfg, state, { acks: {} }, { signal: true });
  // seq = 10: la 10 está levantada y la 1 (siguiente) vacía.
  assert.ok(fs.statSync(path.join(cfg.addonDir, 'sig', '010.wav')).size > 0);
  assert.equal(fs.statSync(path.join(cfg.addonDir, 'sig', '001.wav')).size, 0);
});
