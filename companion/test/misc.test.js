import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { candidateWowDirs, isWowDir, defaultWowDir } from '../src/wow.js';
import { t, messageKeys, KeyedError, setLang } from '../src/log.js';

test('isWowDir reconoce una instalación', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'woai-wow-'));
  assert.equal(isWowDir(d), false);
  fs.mkdirSync(path.join(d, 'WTF'));
  assert.equal(isWowDir(d), true);
  assert.equal(isWowDir(path.join(d, 'no-existe')), false);
  assert.equal(isWowDir(null), false);
});

test('candidatos de Windows incluyen Program Files (x86) de C:', () => {
  const c = candidateWowDirs('win32', 'C:\\Users\\Ana');
  assert.ok(c.includes('C:\\Program Files (x86)\\World of Warcraft\\_forever_'));
  assert.ok(c.every((p) => p.endsWith('_forever_')));
  assert.equal(defaultWowDir('win32'), 'C:\\Program Files (x86)\\World of Warcraft\\_forever_');
});

test('candidatos de macOS', () => {
  const c = candidateWowDirs('darwin', '/Users/ana');
  assert.equal(c[0], '/Applications/World of Warcraft/_forever_');
  assert.ok(c.includes('/Users/ana/Applications/World of Warcraft/_forever_'));
});

test('los mensajes existen en español e inglés', () => {
  assert.deepEqual(messageKeys('en').sort(), messageKeys('es').sort());
});

test('t formatea parámetros e idioma', () => {
  assert.equal(t('data.updated', { n: 3, kb: 10 }, 'en'), 'Data.lua updated: 3 sessions, 10 KB');
  assert.equal(t('data.updated', { n: 3, kb: 10 }, 'es'), 'Data.lua actualizado: 3 sesiones, 10 KB');
  assert.equal(t('no.existe'), 'no.existe');
  setLang('en-US');
  assert.equal(new KeyedError('woai.badCommand', { cmd: 'x' }).message, 'Unknown command: x');
  setLang('es');
});

import { claudeOptions, codexOptions } from '../src/runner.js';

test('claudeOptions convierte los permisos en flags', () => {
  assert.deepEqual(claudeOptions({ permissionMode: 'acceptEdits', extraArgs: [] }), []);
  assert.deepEqual(
    claudeOptions({ model: 'opus', allowedTools: ['Bash(git *)', ' WebFetch '], disallowedTools: 'Bash(rm *)\n', mcp: 'none', extraArgs: ['--verbose'] }),
    ['--model', 'opus', '--allowedTools', 'Bash(git *),WebFetch', '--disallowedTools', 'Bash(rm *)', '--strict-mcp-config', '--verbose'],
  );
});

test('codexOptions: red solo con workspace-write', () => {
  assert.deepEqual(codexOptions({ sandbox: 'workspace-write', networkAccess: true, model: 'gpt-5' }), [
    '-m',
    'gpt-5',
    '-c',
    'sandbox_workspace_write.network_access=true',
  ]);
  assert.deepEqual(codexOptions({ sandbox: 'read-only', networkAccess: true }), []);
});
