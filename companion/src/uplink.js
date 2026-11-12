// Canal de ida sin /reload: lee los prompts que el addon dibuja en una captura.
//
// El addon pinta una cuadrícula de celdas en la esquina superior izquierda y
// llama a Screenshot() (ver addon/WoAI/Uplink.lua para el formato). Aquí se
// decodifica el PNG, se mide el tamaño de celda con la fila 0 (alterna
// negro/blanco), se calibran los niveles con la fila 1 y se leen los bytes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const MAGIC = 'WOAI';
const VERSION = 1;
const CAL_CELLS = 16; // transiciones de la fila 0 que se usan para medir la celda

// ------------------------------------------------------------ PNG
/** Decodifica un PNG de 8 bits (RGB o RGBA, sin entrelazar). */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es PNG');
  let off = 8;
  let width, height, bitDepth, colorType, interlace;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`PNG no soportado (depth ${bitDepth}, color ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[out + x - bpp] : 0;
      const b = y > 0 ? px[out - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[out - stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[out + x] = v & 0xff;
    }
  }
  return { width, height, bpp, px };
}

/** Lee cualquier formato de captura (png directo; jpg/tga vía `sips` de macOS). */
export function readImage(file) {
  if (file.toLowerCase().endsWith('.png')) return decodePng(fs.readFileSync(file));
  const tmp = path.join(os.tmpdir(), `woai-shot-${process.pid}.png`);
  execFileSync('sips', ['-s', 'format', 'png', file, '--out', tmp], { stdio: 'ignore' });
  try {
    return decodePng(fs.readFileSync(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ------------------------------------------------------------ cuadrícula
function adler32(buf) {
  let a = 1, b = 0;
  for (const byte of buf) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (b * 65536 + a) >>> 0;
}

const lum = (img, x, y) => {
  const i = (y * img.width + x) * img.bpp;
  return (img.px[i] + img.px[i + 1] + img.px[i + 2]) / 3;
};

/**
 * Busca la cuadrícula de WoAI en la imagen. Devuelve los bytes del payload o
 * null si la imagen no es una captura de WoAI (o está dañada).
 */
export function decodeGrid(img) {
  // Fila 0: negro, blanco, negro… Mide dónde cambia en una línea cerca del borde.
  const y0 = 1;
  if (img.height < 4 || lum(img, 0, y0) > 64) return null;
  const edges = [];
  let dark = true;
  for (let x = 0; x < img.width && edges.length < CAL_CELLS; x++) {
    const l = lum(img, x, y0);
    if (dark && l > 160) (dark = false), edges.push(x);
    else if (!dark && l < 96) (dark = true), edges.push(x);
  }
  if (edges.length < CAL_CELLS) return null;
  const pitch = edges[CAL_CELLS - 1] / CAL_CELLS;
  if (pitch < 2) return null;
  // Las transiciones deben ser regulares.
  for (let i = 0; i < CAL_CELLS; i++) if (Math.abs(edges[i] - (i + 1) * pitch) > pitch / 3) return null;

  // Promedia un parche en el centro de la celda (aguanta JPEG y bordes difusos).
  const half = Math.max(0, Math.floor(pitch / 4));
  const at = (c, r) => {
    const cx = Math.floor((c + 0.5) * pitch);
    const cy = Math.floor((r + 0.5) * pitch);
    if (cx + half >= img.width || cy + half >= img.height) return null;
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = cy - half; y <= cy + half; y++) {
      for (let x = cx - half; x <= cx + half; x++) {
        const i = (y * img.width + x) * img.bpp;
        sum[0] += img.px[i];
        sum[1] += img.px[i + 1];
        sum[2] += img.px[i + 2];
        n++;
      }
    }
    return sum.map((v) => v / n);
  };

  // Fila 1: niveles 0..3 → umbrales por canal.
  const cal = [0, 1, 2, 3].map((k) => at(k, 1));
  if (cal.some((v) => !v)) return null;
  const thresholds = [0, 1, 2].map((ch) => {
    const lv = cal.map((v) => v[ch]);
    for (let k = 1; k < 4; k++) if (lv[k] <= lv[k - 1] + 20) return null;
    return [(lv[0] + lv[1]) / 2, (lv[1] + lv[2]) / 2, (lv[2] + lv[3]) / 2];
  });
  if (thresholds.some((t) => !t)) return null;
  const level = (v, t) => (v < t[0] ? 0 : v < t[1] ? 1 : v < t[2] ? 2 : 3);
  const six = (c, r) => {
    const v = at(c, r);
    if (!v) return null;
    return level(v[0], thresholds[0]) * 16 + level(v[1], thresholds[1]) * 4 + level(v[2], thresholds[2]);
  };

  const hi = six(4, 1), lo = six(5, 1);
  if (hi == null || lo == null) return null;
  const W = hi * 64 + lo;
  if (W < CAL_CELLS) return null;

  // Lee bytes de 6 bits en 6 bits a partir de la fila 2.
  let cell = 0, acc = 0, nbits = 0;
  const readBytes = (n) => {
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      while (nbits < 8) {
        const v = six(cell % W, 2 + Math.floor(cell / W));
        if (v == null) return null;
        cell++;
        acc = ((acc << 6) | v) & 0xffff;
        nbits += 6;
      }
      nbits -= 8;
      out[i] = (acc >> nbits) & 0xff;
    }
    return out;
  };
  const head = readBytes(8);
  if (!head || head.toString('latin1', 0, 4) !== MAGIC || head[4] !== VERSION) return null;
  const len = head.readUIntBE(5, 3);
  const body = readBytes(len + 4);
  if (!body) return null;
  const payload = body.subarray(0, len);
  if (body.readUInt32BE(len) !== adler32(payload)) return null;
  return payload;
}

/** Payload → job (mismo orden que U.Payload en el addon). */
export function parsePayload(buf) {
  const text = buf.toString('utf8');
  const parts = text.split('\n');
  const [id, agent, sessionId, cwd, createdAt] = parts;
  const prompt = parts.slice(5).join('\n');
  if (!id || !agent || !prompt) return null;
  return { id, agent, sessionId: sessionId || undefined, cwd: cwd || undefined, createdAt: Number(createdAt) || 0, prompt };
}

/** Decodifica un archivo de captura. Devuelve el job o null si no es de WoAI. */
export function readUplink(file) {
  const payload = decodeGrid(readImage(file));
  return payload ? parsePayload(payload) : null;
}

// ------------------------------------------------------------ vigilancia
const seen = new Map(); // archivo → mtime ya revisado

/**
 * Revisa Screenshots/ y devuelve los jobs nuevos. Las capturas de WoAI se
 * borran; las demás se dejan como están.
 */
export function scanScreenshots(dir, { minAgeMs = 500 } = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const jobs = [];
  for (const name of names) {
    if (!/^WoWScrnShot_.*\.(png|jpe?g|tga)$/i.test(name)) continue;
    const file = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (seen.get(file) === st.mtimeMs) continue;
    if (Date.now() - st.mtimeMs < minAgeMs) continue; // aún se está escribiendo
    seen.set(file, st.mtimeMs);
    try {
      const job = readUplink(file);
      if (job) {
        jobs.push(job);
        fs.rmSync(file, { force: true });
        seen.delete(file);
      }
    } catch (e) {
      console.warn(`[uplink] no se pudo leer ${name}: ${e.message}`);
    }
  }
  return jobs;
}
