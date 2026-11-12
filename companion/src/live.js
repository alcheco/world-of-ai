// Canal de vuelta sin /reload.
//
// Un addon solo lee sus archivos en el /reload, salvo los addons LoadOnDemand:
// `C_AddOns.LoadAddOn` lee su Lua del disco en el momento de cargarlos (una vez
// por sesión de UI cada uno). Por eso creamos un pool de slots WoAI_S001… y
// escribimos la misma actualización en todos: el juego carga el siguiente libre.
//
// Para que el juego sepa cuándo cargar uno sin gastar slots, usamos señales:
// `PlaySoundFile` dice si un archivo se puede reproducir. Un .wav vacío no,
// uno válido (silencioso) sí. Levantar sig/NNN.wav = "hay respuesta nueva".
// El juego solo descubre archivos que existían al arrancar, así que todo se
// crea en la instalación y luego hay que reiniciar WoW una vez.
import fs from 'node:fs';
import path from 'node:path';
import { toLua } from './lua.js';

export const slotName = (i) => `WoAI_S${String(i).padStart(3, '0')}`;
export const sigIndex = (seq, n) => ((seq - 1) % n) + 1;
const sigFile = (cfg, i) => path.join(cfg.addonDir, 'sig', `${String(i).padStart(3, '0')}.wav`);

/** WAV PCM 16-bit mono de 50 ms de silencio. */
export function silentWav() {
  const rate = 22050;
  const samples = Math.round(rate * 0.05);
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function slotToc(i) {
  return [
    '## Interface: 16001',
    `## Title: WoAI slot ${i}`,
    '## Notes: Buzón de respuestas de WoAI. No lo desactives.',
    '## Group: WoAI',
    '## LoadOnDemand: 1',
    '',
    'Inbox.lua',
    '',
  ].join('\n');
}

/** Crea los slots y las señales. Devuelve cuántos archivos nuevos hizo. */
export function installLive(cfg) {
  const addonsDir = path.dirname(cfg.addonDir);
  let created = 0;
  for (let i = 1; i <= cfg.live.slots; i++) {
    const dir = path.join(addonsDir, slotName(i));
    fs.mkdirSync(dir, { recursive: true });
    const toc = path.join(dir, `${slotName(i)}.toc`);
    if (!fs.existsSync(toc)) created++;
    fs.writeFileSync(toc, slotToc(i));
    const inbox = path.join(dir, 'Inbox.lua');
    if (!fs.existsSync(inbox)) fs.writeFileSync(inbox, 'WoAI_Live = nil\n');
  }
  fs.mkdirSync(path.join(cfg.addonDir, 'sig'), { recursive: true });
  for (let i = 1; i <= cfg.live.signals; i++) {
    const f = sigFile(cfg, i);
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, '');
      created++;
    }
  }
  const ctl = path.join(cfg.addonDir, 'ctl');
  fs.mkdirSync(ctl, { recursive: true });
  fs.writeFileSync(path.join(ctl, 'empty.wav'), '');
  fs.writeFileSync(path.join(ctl, 'valid.wav'), silentWav());
  return created;
}

export function liveInstalled(cfg) {
  return (
    fs.existsSync(path.join(path.dirname(cfg.addonDir), slotName(cfg.live.slots), 'Inbox.lua')) &&
    fs.existsSync(sigFile(cfg, cfg.live.signals))
  );
}

/**
 * Escribe `live` en todos los slots. Con `signal`, avanza la secuencia y
 * levanta su señal (y vacía las siguientes para que no haya falsos positivos
 * después de reiniciar el juego).
 */
export function publishLive(cfg, state, live, { signal = false } = {}) {
  if (signal) state.seq = (state.seq || 0) + 1;
  const lua = `-- Generado por woai-companion. No editar a mano.\nWoAI_Live = ${toLua({ ...live, seq: state.seq || 0 })}\n`;
  const addonsDir = path.dirname(cfg.addonDir);
  for (let i = 1; i <= cfg.live.slots; i++) {
    const dir = path.join(addonsDir, slotName(i));
    if (fs.existsSync(dir)) writeAtomic(path.join(dir, 'Inbox.lua'), lua);
  }
  if (signal) {
    const n = cfg.live.signals;
    for (let k = 1; k <= Math.min(50, n - 1); k++) {
      const f = sigFile(cfg, sigIndex(state.seq + k, n));
      if (fs.existsSync(f) && fs.statSync(f).size > 0) fs.writeFileSync(f, '');
    }
    writeAtomic(sigFile(cfg, sigIndex(state.seq, n)), silentWav());
  }
  return lua.length;
}
