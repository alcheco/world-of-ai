import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectOf } from '../src/env.js';

const MAC_HOME = '/Users/ana';
const MAC_TMP = '/var/folders/xy/T';
const mac = (cwd) => projectOf(cwd, MAC_HOME, MAC_TMP);

const WIN_HOME = 'C:\\Users\\Ana';
const WIN_TMP = 'C:\\Users\\Ana\\AppData\\Local\\Temp';
const win = (cwd) => projectOf(cwd, WIN_HOME, WIN_TMP);

const NONE = { project: null, projectPath: null, worktree: null };

test('macOS: repo normal', () => {
  assert.deepEqual(mac('/Users/ana/dev/woai'), { project: 'woai', projectPath: '/Users/ana/dev/woai', worktree: null });
  assert.deepEqual(mac('/Users/ana/dev/woai/'), { project: 'woai', projectPath: '/Users/ana/dev/woai', worktree: null });
});

test('macOS: worktree de Claude', () => {
  assert.deepEqual(mac('/Users/ana/dev/woai/.claude/worktrees/feat-x/companion'), {
    project: 'woai',
    projectPath: '/Users/ana/dev/woai',
    worktree: 'feat-x',
  });
});

test('macOS: worktree de Codex', () => {
  assert.deepEqual(mac('/Users/ana/.codex/worktrees/a1b2/woai/src'), { project: 'woai', projectPath: null, worktree: 'a1b2' });
});

test('macOS: sin proyecto', () => {
  for (const cwd of [null, '/', MAC_HOME, '/tmp/x', '/private/tmp/y', '/var/folders/xy/T/z']) assert.deepEqual(mac(cwd), NONE, cwd);
});

test('Windows: repo normal conserva la ruta original', () => {
  assert.deepEqual(win('C:\\Users\\Ana\\dev\\woai'), { project: 'woai', projectPath: 'C:\\Users\\Ana\\dev\\woai', worktree: null });
  assert.deepEqual(win('D:\\code\\woai\\'), { project: 'woai', projectPath: 'D:\\code\\woai', worktree: null });
});

test('Windows: worktrees de Claude y Codex', () => {
  assert.deepEqual(win('C:\\Users\\Ana\\dev\\woai\\.claude\\worktrees\\feat-x'), {
    project: 'woai',
    projectPath: 'C:\\Users\\Ana\\dev\\woai',
    worktree: 'feat-x',
  });
  // Mayúsculas distintas en el home: en Windows da igual.
  assert.deepEqual(win('c:\\users\\ana\\.codex\\worktrees\\a1b2\\woai'), { project: 'woai', projectPath: null, worktree: 'a1b2' });
});

test('Windows: sin proyecto', () => {
  for (const cwd of [WIN_HOME, 'c:\\users\\ana', 'C:\\', 'C:\\Users\\Ana\\AppData\\Local\\Temp\\x', 'C:\\Windows\\Temp\\y']) {
    assert.deepEqual(win(cwd), NONE, cwd);
  }
});
