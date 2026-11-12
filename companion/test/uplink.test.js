import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodePng, decodeGrid, parsePayload, readUplink, scanScreenshots } from '../src/uplink.js';

// ---- copia en JS de addon/WoAI/Uplink.lua (Payload, Frame, Sixes, Grid)
function adler32(buf) {
  let a = 1, b = 0;
  for (const x of buf) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return b * 65536 + a;
}
function frame(job) {
  const payload = Buffer.from(
    [job.id, job.agent, job.sessionId ?? '', job.cwd ?? '', String(job.createdAt ?? 0), job.prompt].join('\n'),
    'utf8',
  );
  const head = Buffer.alloc(8);
  head.write('WOAI', 0, 'latin1');
  head[4] = 1;
  head.writeUIntBE(payload.length, 5, 3);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(adler32(payload));
  return Buffer.concat([head, payload, sum]);
}
function sixes(bytes) {
  const out = [];
  let acc = 0, nbits = 0;
  for (const x of bytes) {
    acc = acc * 256 + x;
    nbits += 8;
    while (nbits >= 6) {
      nbits -= 6;
      const p = 2 ** nbits;
      out.push(Math.floor(acc / p));
      acc %= p;
    }
  }
  if (nbits > 0) out.push(acc * 2 ** (6 - nbits));
  return out;
}
function grid(bytes, W) {
  const rows = [[], []];
  for (let c = 1; c <= W; c++) rows[0].push(c % 2 === 1 ? 0 : 63);
  for (let k = 0; k < 4; k++) rows[1].push(k * 21);
  rows[1].push(Math.floor(W / 64), W % 64);
  sixes(bytes).forEach((v, i) => {
    const r = 2 + Math.floor(i / W);
    (rows[r] ??= [])[i % W] = v;
  });
  return rows;
}

// ---- "captura": pinta la cuadrícula sobre un fondo con ruido
const LEVEL = [0, 85, 170, 255];
function render(rows, W, { width = 1920, height = 1080, pitch = 6, noise = 0, seed = 1 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < px.length; i++) px[i] = Math.floor(rnd() * 256); // escena del juego
  for (let y = 0; y < height; y++) {
    const r = Math.floor(y / pitch);
    if (!rows[r]) continue;
    for (let x = 0; x < width; x++) {
      const c = Math.floor(x / pitch);
      if (c >= W) break;
      const v = rows[r][c];
      if (v == null) continue;
      const rgb = [LEVEL[v >> 4], LEVEL[(v >> 2) & 3], LEVEL[v & 3]];
      for (let ch = 0; ch < 3; ch++) {
        const n = noise ? Math.round((rnd() - 0.5) * 2 * noise) : 0;
        px[(y * width + x) * 3 + ch] = Math.max(0, Math.min(255, rgb[ch] + n));
      }
    }
  }
  return { width, height, bpp: 3, px };
}
function encodePng(img) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = img.width * 3;
  // Filtro "Up" en todas las filas para ejercitar el des-filtrado.
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 2;
    for (let x = 0; x < stride; x++) {
      const up = y > 0 ? img.px[(y - 1) * stride + x] : 0;
      raw[y * (stride + 1) + 1 + x] = (img.px[y * stride + x] - up) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const JOB = {
  id: '1731400000-7-1234',
  agent: 'claude',
  sessionId: 'abc-123',
  cwd: '/Users/me/Developer/woa',
  createdAt: 1731400000,
  prompt: 'Arregla el bug ñandú 🚀\nsegunda línea | con pipe\n\n' + 'x'.repeat(3000),
};

test('ida y vuelta: cuadrícula → imagen → job', () => {
  const W = 320;
  const img = render(grid(frame(JOB), W), W);
  assert.deepEqual(parsePayload(decodeGrid(img)), JOB);
});

test('tolera escala no entera y ruido de color', () => {
  const W = 300;
  const img = render(grid(frame(JOB), W), W, { width: 1700, height: 960, pitch: 5.5, noise: 40 });
  assert.deepEqual(parsePayload(decodeGrid(img)), JOB);
});

test('sesión nueva: sessionId y cwd vacíos', () => {
  const job = { id: '1-1-1', agent: 'codex', createdAt: 5, prompt: 'hola' };
  const img = render(grid(frame(job), 64), 64, { width: 640, height: 480 });
  assert.deepEqual(parsePayload(decodeGrid(img)), { ...job, sessionId: undefined, cwd: undefined });
});

test('una captura normal no es de WoAI', () => {
  assert.equal(decodeGrid(render([], 0)), null);
});

test('checksum corrupto → null', () => {
  const W = 320;
  const rows = grid(frame(JOB), W);
  rows[10][5] ^= 1;
  assert.equal(decodeGrid(render(rows, W)), null);
});

test('PNG: decodifica y scanScreenshots borra solo las de WoAI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'woai-shots-'));
  const W = 320;
  const img = render(grid(frame(JOB), W), W);
  const png = encodePng(img);
  assert.deepEqual(decodePng(png).px, img.px);
  const mine = path.join(dir, 'WoWScrnShot_111226_101010.png');
  const other = path.join(dir, 'WoWScrnShot_111226_101011.png');
  fs.writeFileSync(mine, png);
  fs.writeFileSync(other, encodePng(render([], 0, { width: 200, height: 100 })));
  assert.deepEqual(readUplink(mine), JOB);
  const jobs = scanScreenshots(dir, { minAgeMs: 0 });
  assert.deepEqual(jobs, [JOB]);
  assert.equal(fs.existsSync(mine), false);
  assert.equal(fs.existsSync(other), true);
  assert.deepEqual(scanScreenshots(dir, { minAgeMs: 0 }), []);
});
