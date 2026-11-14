# Protocolo `woai-companion --ipc`

Así habla la app de escritorio con el companion (sidecar). Una línea = un mensaje JSON.

## Arranque

La app lanza el binario con:

| Variable | Valor |
|---|---|
| `WOAI_DATA_DIR` | Carpeta de datos de la app (`config.json`, `.state.json`). |
| `WOAI_ADDON_SRC` | Carpeta `WoAI` de los recursos del bundle. Con ella, el addon se **copia** a `Interface/AddOns`. |
| `WOAI_LANG` | Opcional: `es` / `en` (si no, el `lang` de `config.json`). |
| `WOAI_WOW_DIR` | Opcional: fuerza la carpeta del juego. |

No hace falta pasar `PATH`: el companion completa el suyo con el de la shell de login y carpetas habituales para encontrar `claude` y `codex`.

Si se cierra el stdin del companion (la app se cerró o murió), el companion se apaga y mata los CLIs en curso.

## Eventos (stdout)

```json
{"ev":"ready","version":"0.1.0","pid":123, ...status}
{"ev":"status","version":"0.1.0","wowDir":"…","wowOk":true,"dataDir":"…","addon":{"kind":"copy","version":"0.1.0"},"liveOk":true,"savedVariables":1,"sessions":40,"queue":0,"working":null}
{"ev":"job","id":"…","status":"queued|running|done|error","agent":"claude","sessionId":"…","error":"…","secs":12.3}
{"ev":"log","level":"info|warn|error","scope":"data","key":"data.updated","params":{"n":40,"kb":"469"},"msg":"Data.lua actualizado: 40 sesiones, 469 KB"}
{"ev":"reply","re":1,"cmd":"detect","ok":true,"result":{…}}
{"ev":"reply","re":2,"cmd":"install-addon","ok":false,"error":{"key":"addon.isLink","params":{…},"msg":"…"}}
```

- `status` se emite solo cuando cambia.
- `addon.kind`: `none`, `copy`, `link` (instalación de desarrollo), `broken-link` o `foreign` (hay una carpeta `WoAI` que no es nuestra).
- `log.msg` ya viene en el idioma del companion; `key` + `params` permiten traducirlo en la app (claves en `companion/src/log.js`).

## Comandos (stdin)

`{"cmd": "...", "id": <cualquier valor>, ...args}`. La respuesta es un `reply` con `re` = `id`.

| Comando | Args | Resultado |
|---|---|---|
| `status` | — | El objeto de estado. |
| `reload-config` | — | Relee `config.json` (carpeta del juego, idioma, permisos, intervalo) sin reiniciar el proceso. Devuelve el estado. |
| `install-addon` | `force?: boolean` | Instala o actualiza el addon. `{mode, created, files, version, needsRestart}`. Con `needsRestart`, hay que pedir que se reinicie WoW. Si hay un enlace de desarrollo, falla con `addon.isLink` salvo con `force`. |
| `uninstall-addon` | — | `{removed}`: carpetas borradas. |
| `detect` | — | `{wowDirs, wowDir, wowOk, claude, codex}`; cada CLI es `{bin, path, version, error?}` (`error: "not-found"` si no está). |
| `process-now` | — | Revisa la outbox y las capturas ya. Devuelve el estado. |
| `shutdown` | — | Se apaga ordenadamente. |
