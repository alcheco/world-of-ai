import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBin, quoteCmdArg, cmdLine, spawnCli, killTree } from '../src/bins.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'woai-bins-'));
}
function touch(file, mode = 0o755) {
  fs.writeFileSync(file, '#!/bin/sh\necho hola\n');
  fs.chmodSync(file, mode);
}

test('resolveBin busca en el PATH dado', () => {
  const a = tmpDir();
  const b = tmpDir();
  touch(path.join(b, 'claude'));
  assert.equal(resolveBin('claude', { PATH: [a, b].join(path.delimiter), platform: 'linux' }), path.join(b, 'claude'));
  assert.equal(resolveBin('nada', { PATH: [a, b].join(path.delimiter), platform: 'linux' }), null);
});

test('resolveBin acepta rutas', () => {
  const d = tmpDir();
  touch(path.join(d, 'codex'));
  assert.equal(resolveBin(path.join(d, 'codex'), { PATH: '', platform: 'linux' }), path.join(d, 'codex'));
});

test('resolveBin en Windows prefiere .cmd/.exe al script sin extensión', () => {
  const d = tmpDir();
  touch(path.join(d, 'claude'));
  touch(path.join(d, 'claude.cmd'));
  assert.equal(resolveBin('claude', { PATH: d, platform: 'win32', pathext: '.EXE;.CMD' }), path.join(d, 'claude.cmd'));
});

test('quoteCmdArg escapa comillas y metacaracteres de cmd.exe', () => {
  assert.equal(quoteCmdArg('acceptEdits'), '^"acceptEdits^"');
  assert.equal(quoteCmdArg(''), '^"^"');
  assert.equal(quoteCmdArg('a b&c'), '^"a^ b^&c^"');
  assert.equal(quoteCmdArg('sandbox_mode="read-only"'), '^"sandbox_mode=\\^"read-only\\^"^"');
  // Doble escape para los .cmd de npm.
  assert.equal(quoteCmdArg('a&b', true), '^^^"a^^^&b^^^"');
});

test('cmdLine arma la línea para cmd.exe', () => {
  assert.equal(cmdLine('C:/npm/claude.cmd', ['-p']), `${path.normalize('C:/npm/claude.cmd')} ^^^"-p^^^"`);
});

test('spawnCli ejecuta y killTree mata al grupo', { skip: process.platform === 'win32' }, async () => {
  const d = tmpDir();
  const script = path.join(d, 'lento');
  fs.writeFileSync(script, '#!/bin/sh\nsleep 30 &\nwait\n');
  fs.chmodSync(script, 0o755);
  const child = spawnCli(script, [], { stdio: 'ignore' });
  const closed = new Promise((r) => child.on('close', r));
  await new Promise((r) => setTimeout(r, 200));
  killTree(child);
  const t0 = Date.now();
  await closed;
  assert.ok(Date.now() - t0 < 5000);
});
