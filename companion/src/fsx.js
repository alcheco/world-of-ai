// Utilidades de archivos que también funcionan en Windows.
import fs from 'node:fs';

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => Atomics.wait(sleeper, 0, 0, ms);

/**
 * Reintenta una operación que en Windows falla si otro proceso (el juego, un
 * antivirus) tiene el archivo abierto un instante.
 */
export function retrySync(fn, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      sleepSync(40 * i);
    }
  }
}

/** Escribe en un .tmp y lo renombra, para que el lector nunca vea medio archivo. */
export function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  retrySync(() => fs.renameSync(tmp, file));
}
