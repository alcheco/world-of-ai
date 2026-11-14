// Mensajes del companion.
//
// Cada mensaje tiene una clave y parámetros. En la terminal se imprime el texto
// en el idioma configurado; con --ipc se emite como JSON por línea en stdout
// (con la clave, los parámetros y el texto ya formateado) para la app.

const MESSAGES = {
  es: {
    'woai.wowDir': 'WoW: {dir}',
    'woai.dataDir': 'Configuración y estado: {dir}',
    'woai.liveMissing':
      'faltan los slots/señales: instala el addon y reinicia WoW. Mientras, las respuestas llegan con /reload.',
    'woai.savedVariables': 'SavedVariables vigiladas: {files}',
    'woai.configReloaded': 'Configuración recargada.',
    'woai.configError': 'No se pudo leer la configuración: {error}',
    'woai.shutdown': 'Cerrando el companion.',
    'woai.badCommand': 'Comando desconocido: {cmd}',
    'outbox.parseError': 'no se pudo parsear {file}: {error}',
    'job.accepted': 'nuevo prompt {id} ({via}) → {agent} {session}',
    'job.newSession': '(nueva sesión)',
    'job.done': '{id} listo en {secs}s (sesión {session})',
    'job.failed': '{id} falló en {secs}s: {error}',
    'job.interrupted': 'El companion se detuvo antes de terminar. Reenvía el prompt.',
    'data.noAddonDir': 'no existe {dir}. Instala el addon.',
    'data.updated': 'Data.lua actualizado: {n} sesiones, {kb} KB',
    'live.updated': 'slots actualizados{signal}: {n} sesión(es), {kb} KB',
    'live.signal': ' + señal {seq}',
    'sessions.readError': 'no se pudo leer {file}: {error}',
    'uplink.readError': 'no se pudo leer {file}: {error}',
    'tick.error': 'error en el ciclo: {error}',
    'addon.noAddonsDir': 'No existe {dir}. Revisa la carpeta de WoW (wowDir).',
    'addon.brokenLink': 'Enlace roto ({target}). Lo reemplazo.',
    'addon.foreign': '{dir} ya existe y no es una instalación de WoAI. Bórralo o renómbralo y vuelve a intentarlo.',
    'addon.isLink': '{dir} es un enlace a {target} (instalación de desarrollo). Usa --force para reemplazarlo por una copia.',
    'addon.linked': 'Enlazado: {dir} → {source}',
    'addon.alreadyLinked': 'Ya enlazado: {dir} → {source}',
    'addon.copied': 'Addon {version} copiado en {dir} ({files} archivos).',
    'addon.live': 'Slots ({slots}) y señales ({signals}) listos en {dir}.',
    'addon.restart': 'Hay archivos nuevos: cierra WoW del todo y vuelve a abrirlo (el juego solo los descubre al arrancar).',
    'addon.removed': 'Addon desinstalado: {n} carpetas borradas de {dir}.',
    'addon.notInstalled': 'El addon no está instalado en {dir}.',
  },
  en: {
    'woai.wowDir': 'WoW: {dir}',
    'woai.dataDir': 'Settings and state: {dir}',
    'woai.liveMissing':
      'reply slots/signals are missing: install the addon and restart WoW. Until then, replies arrive on /reload.',
    'woai.savedVariables': 'Watching SavedVariables: {files}',
    'woai.configReloaded': 'Settings reloaded.',
    'woai.configError': 'Could not read the settings: {error}',
    'woai.shutdown': 'Shutting down the companion.',
    'woai.badCommand': 'Unknown command: {cmd}',
    'outbox.parseError': 'could not parse {file}: {error}',
    'job.accepted': 'new prompt {id} ({via}) → {agent} {session}',
    'job.newSession': '(new session)',
    'job.done': '{id} finished in {secs}s (session {session})',
    'job.failed': '{id} failed after {secs}s: {error}',
    'job.interrupted': 'The companion stopped before finishing. Send the prompt again.',
    'data.noAddonDir': '{dir} does not exist. Install the addon.',
    'data.updated': 'Data.lua updated: {n} sessions, {kb} KB',
    'live.updated': 'slots updated{signal}: {n} session(s), {kb} KB',
    'live.signal': ' + signal {seq}',
    'sessions.readError': 'could not read {file}: {error}',
    'uplink.readError': 'could not read {file}: {error}',
    'tick.error': 'error in the loop: {error}',
    'addon.noAddonsDir': '{dir} does not exist. Check the WoW folder (wowDir).',
    'addon.brokenLink': 'Broken link ({target}). Replacing it.',
    'addon.foreign': '{dir} already exists and is not a WoAI install. Delete or rename it and try again.',
    'addon.isLink': '{dir} links to {target} (development install). Use --force to replace it with a copy.',
    'addon.linked': 'Linked: {dir} → {source}',
    'addon.alreadyLinked': 'Already linked: {dir} → {source}',
    'addon.copied': 'Addon {version} copied to {dir} ({files} files).',
    'addon.live': 'Slots ({slots}) and signals ({signals}) ready in {dir}.',
    'addon.restart': 'There are new files: quit WoW completely and open it again (the game only finds them at startup).',
    'addon.removed': 'Addon uninstalled: {n} folders removed from {dir}.',
    'addon.notInstalled': 'The addon is not installed in {dir}.',
  },
};

/** Error con clave de mensaje, para que la app lo muestre en su idioma. */
export class KeyedError extends Error {
  constructor(key, params = {}) {
    super(t(key, params));
    this.key = key;
    this.params = params;
  }
}

let lang = 'es';
let ipc = false;

export function setLang(l) {
  lang = String(l || '').toLowerCase().startsWith('en') ? 'en' : 'es';
}
export function setIpc(on) {
  ipc = !!on;
}
export const isIpc = () => ipc;

/** Texto de un mensaje en el idioma actual. */
export function t(key, params = {}, l = lang) {
  const tpl = MESSAGES[l]?.[key] ?? MESSAGES.es[key] ?? key;
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
}

export const messageKeys = (l) => Object.keys(MESSAGES[l]);

/** Escribe un evento para la app (solo en modo --ipc). */
export function emit(ev, data = {}) {
  if (ipc) process.stdout.write(JSON.stringify({ ev, ...data }) + '\n');
}

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} scope prefijo en la terminal ([job], [data]…)
 */
export function log(level, scope, key, params = {}) {
  const msg = t(key, params);
  if (ipc) {
    emit('log', { level, scope, key, params, msg });
    return;
  }
  const line = `[${scope}] ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
