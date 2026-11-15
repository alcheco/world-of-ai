# Plan: app instalable de WoAI (Tauri)

Objetivo: reemplazar "clona el repo, `npm run install-addon`, deja una terminal con `npm start`" por una app instalable en **macOS y Windows** que:

1. Corre el companion en segundo plano.
2. Instala y actualiza el addon en WoW Forever.
3. Permite configurar todo (carpeta del juego, permisos de Claude y Codex, límites).
4. Se muestra como **ventana normal** o **solo en la barra de menús / bandeja**.
5. Opcionalmente **arranca al iniciar sesión**.
6. Está en **inglés y español**.
7. Se **actualiza sola** desde GitHub Releases.

---

## 1. Arquitectura

```
┌──────────────────────── WoAI.app / WoAI.exe (Tauri 2) ────────────────────────┐
│  UI (webview, Vite + TS)        Núcleo Rust                                   │
│  · Asistente inicial            · Ciclo de vida del sidecar (start/stop/restart)│
│  · Ajustes / Permisos           · Bandeja + menú, modo ventana/bandeja          │
│  · Estado y registro            · Autostart, updater, i18n del menú             │
│            ▲  invoke/events  ▲  · Lee/escribe config.json (app data dir)        │
│            └─────────────────┘            │ stdin/stdout (JSON por línea)       │
│                                           ▼                                    │
│                         sidecar `woai-companion` (Node compilado a binario)    │
└───────────────────────────────────────────┼───────────────────────────────────┘
                                            ▼
                     WoW Forever (AddOns, Screenshots, WTF)  ·  claude / codex
```

### Decisión clave: el companion sigue en Node, como *sidecar*

- El companion ya funciona y tiene tests (decodificación de capturas, Lua, buzones). Reescribirlo en Rust no aporta nada ahora.
- Se compila a un **binario único por plataforma** y se empaqueta con `bundle.externalBin` de Tauri. El usuario **no necesita Node instalado**.
  - Opción A (recomendada): **Node SEA** (`node --experimental-sea-config` + `postject`), sin dependencias nuevas.
  - Opción B: `bun build --compile`, más simple de invocar y con cross-compile, pero hay que verificar compatibilidad (fs.watch, child_process).
- Targets: `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`.

### Protocolo app ⇄ companion

El companion gana un modo `--ipc`:
- **stdout:** un evento JSON por línea: `{"ev":"ready"}`, `{"ev":"status","sessions":32,"queue":1,"working":"…"}`, `{"ev":"job","id":"…","status":"done"}`, `{"ev":"log","level":"warn","msg":"…"}`, `{"ev":"error",…}`.
- **stdin:** comandos: `{"cmd":"reload-config"}`, `{"cmd":"install-addon"}`, `{"cmd":"once"}`, `{"cmd":"shutdown"}`.
- Los mensajes de log llevan una **clave** + parámetros (`{"key":"data.updated","n":32}`), no texto ya traducido: la UI los traduce.
- Rust reinicia el sidecar si muere (backoff 1 s → 30 s) y lo muestra en el icono de la bandeja (verde / ámbar / rojo).

---

## 2. Cambios necesarios en el companion (fase 0)

Hoy asume macOS y que vive dentro del repo. Antes de empaquetarlo:

| Problema | Cambio |
|---|---|
| `config.json` y `.state.json` viven en `companion/` | Leer la carpeta de `WOAI_DATA_DIR` (la pasa Tauri: `~/Library/Application Support/com.woai.app/`, `%APPDATA%\com.woai.app\`). Si no existe, usar `companion/` como hoy (modo desarrollo). |
| El addon se **enlaza** desde el repo y `Data.lua` se escribe en el repo | En modo app el addon se **copia** a `Interface/AddOns/WoAI` desde los recursos del bundle (en Windows los symlinks piden permisos de admin) y `Data.lua` se escribe directamente ahí. `install-addon` del repo sigue usando symlink. |
| `wowDir` por defecto solo para Mac | Detección por plataforma (rutas típicas de Battle.net en `C:\Program Files (x86)\World of Warcraft\_forever_`, unidades D:/E:, y lectura de la instalación registrada de Battle.net si está disponible) + selector de carpeta en la UI. Validar que tenga `Interface/AddOns` y `WTF`. |
| `env.js` usa regex con `/` (`/private/tmp`, `.claude/worktrees`) | Normalizar separadores (`path.sep`, `\\` → `/`) antes de comparar; temporales de Windows (`%TEMP%`). |
| `spawn('claude')` | En Windows los CLIs son `claude.cmd` / `codex.cmd`: resolver la ruta real (buscar en `PATH` + `PATHEXT`) o usar `shell: true` con argumentos escapados. |
| **PATH de apps gráficas en macOS** | Una app lanzada desde Finder/LaunchAgent **no hereda el PATH de la shell**, así que `claude` y `codex` (Homebrew, npm global, `~/.local/bin`) no se encuentran. Rust obtiene el PATH con `$SHELL -ilc 'printf %s "$PATH"'` (o el crate `fix-path-env`) y se lo pasa al sidecar. Además, en ajustes se puede fijar la ruta de cada CLI (`claude.bin`, `codex.bin`). |
| Logs en español con `console.log` | Modo `--ipc` emite eventos con clave; el modo terminal sigue igual. |
| `SIGTERM` en timeouts | En Windows `kill()` no mata el árbol: usar `taskkill /T /F /PID` para los procesos de los CLIs. |

---

## 3. La app Tauri

Nueva carpeta `app/` en el repo:

```
app/
  src/              UI (Vite + TypeScript; Svelte o vanilla)
    i18n/en.json
    i18n/es.json
  src-tauri/
    src/main.rs     setup, tray, comandos
    src/sidecar.rs  ciclo de vida del companion
    src/paths.rs    PATH de la shell, detección de WoW y CLIs
    binaries/       woai-companion-<target-triple>[.exe]
    resources/addon/WoAI/…   copia del addon para instalar
    tauri.conf.json
```

Plugins oficiales de Tauri 2:

| Necesidad | Plugin |
|---|---|
| Sidecar | `tauri-plugin-shell` (`Command::sidecar`) |
| Arranque al iniciar sesión | `tauri-plugin-autostart` (LaunchAgent en macOS, clave `Run` del registro en Windows) |
| Actualizaciones | `tauri-plugin-updater` + `tauri-plugin-process` (reinicio) |
| Una sola instancia | `tauri-plugin-single-instance` (si se abre de nuevo, enfoca la ventana) |
| Selector de carpeta | `tauri-plugin-dialog` |
| Ajustes de la app | `tauri-plugin-store` (o el mismo `config.json`, ver abajo) |
| Abrir enlaces/carpetas | `tauri-plugin-opener` |

### 3.1 Pantallas

1. **Asistente inicial** (primera vez):
   1. Idioma (preseleccionado por el idioma del sistema).
   2. Carpeta de WoW Forever (detectada; botón "Elegir…"; validación en vivo).
   3. Agentes: detecta `claude` y `codex` (ruta + `--version`), indica si falta alguno o si no tiene sesión iniciada, con enlace a cómo instalarlo.
   4. Permisos (ver 3.2).
   5. Comportamiento: ventana o bandeja, iniciar con la sesión.
   6. Instalar addon → mensaje grande: **"Cierra WoW del todo y vuelve a abrirlo"** + recordatorio de activar *WoAI* y los *WoAI slot* en AddOns.
2. **Estado:** companion activo / detenido / error, sesiones exportadas, cola, último prompt, buzones, versión del addon instalada vs la del bundle; botones *Reiniciar companion*, *Procesar ahora*, *Abrir carpeta del juego*.
3. **Ajustes:** General (idioma, ventana/bandeja, autostart, actualizaciones), Juego (carpeta, reinstalar/desinstalar addon), Claude, Codex, Avanzado (`maxSessions`, `maxMessages`, `timeoutMs`, `pollMs`, `live.*`).
4. **Registro:** los últimos N eventos del companion, filtrables, con "Copiar".

### 3.2 Permisos de los agentes

Se guardan en el `config.json` del companion (en la carpeta de datos de la app). La UI no muestra JSON: muestra opciones con su explicación y una advertencia en las peligrosas.

**Claude Code** (`claude -p`):
- `permissionMode`: `default` (no puede usar herramientas que piden permiso), `acceptEdits` (recomendado), `plan` (solo planifica), `bypassPermissions` (⚠ confirmación explícita).
- Herramientas permitidas / bloqueadas → `--allowedTools` / `--disallowedTools` (lista editable con sugerencias: `Bash(git *)`, `Bash(npm test)`, `WebFetch`, …).
- MCP: usar los configurados o `--strict-mcp-config` (ninguno).
- Modelo (opcional) → `--model`.
- Argumentos extra (texto libre, modo avanzado) → `extraArgs`.

**Codex** (`codex exec`):
- `sandbox`: `read-only`, `workspace-write` (recomendado), `danger-full-access` (⚠).
- Acceso a red dentro del sandbox (`-c sandbox_workspace_write.network_access=true`).
- Modelo (opcional) → `-m`.
- Argumentos extra.

Notas:
- **No se editan** los archivos propios de cada CLI (`~/.claude/settings.json`, `~/.codex/config.toml`); el companion solo pasa flags. La UI puede mostrar en solo lectura qué reglas trae ya cada CLI, para que se entienda por qué algo se deniega.
- Botón "Probar" por agente: lanza un prompt corto (`di "ok"`) con la configuración actual y muestra el resultado o el error.
- Al guardar, Rust escribe `config.json` y manda `reload-config` al sidecar (sin reiniciar el proceso si no hace falta).

### 3.3 Ventana normal o bandeja

Ajuste `appearance: "window" | "tray"` (se puede cambiar en caliente):

- **Ambos modos** tienen icono en la barra de menús (macOS) / bandeja (Windows) con menú: Abrir WoAI · Estado (texto) · Reiniciar companion · Buscar actualizaciones · Salir.
- **window:** icono en el Dock / barra de tareas; cerrar la ventana la oculta (el companion sigue corriendo) y *Salir* cierra de verdad.
- **tray:** sin icono en el Dock / barra de tareas.
  - macOS: `app.set_activation_policy(ActivationPolicy::Accessory)` (y `Regular` al volver a modo ventana).
  - Windows: `window.set_skip_taskbar(true)`; la ventana se abre como panel junto al icono.
- Si se arranca con la sesión, empieza **oculta** (argumento `--hidden` que pasa el autostart) en cualquiera de los dos modos.

### 3.4 Idiomas (en / es)

- UI: diccionarios `en.json` / `es.json` con una librería mínima (p. ej. `i18next` o un `t()` propio). Idioma por defecto = idioma del sistema (`navigator.language` / `tauri-plugin-os`), si no es `es*` → `en`.
- Menú de la bandeja y notificaciones: se construyen en Rust con un diccionario igual (`rust-i18n` o un `HashMap` cargado de los mismos JSON) y se reconstruyen al cambiar de idioma.
- Mensajes del companion: llegan con clave y se traducen en la UI (ver §1).
- **Addon (fuera del alcance de la v1, pero conviene planearlo):** hoy está en español. Se puede localizar con `GetLocale()` y una tabla `L[...]`, o que la app escriba el idioma elegido en `Data.lua` para que el addon use el mismo que la app.

---

## 4. Instalación del addon desde la app

- El addon va dentro del bundle (`resources/addon/WoAI`). Su versión es la del `## Version:` del `.toc`.
- **Instalar / actualizar:** copia a `Interface/AddOns/WoAI` sin pisar `Data.lua` (lo regenera el companion), crea buzones `WoAI_S001…` y señales (`installLive`), y guarda en el estado qué archivos existían.
- Si la instalación **agregó archivos nuevos** (un `.lua` nuevo, buzones nuevos), la app avisa: *"Cierra WoW del todo y vuelve a abrirlo"*. Si solo cambió contenido de archivos existentes, basta un `/reload`.
- Si en `AddOns/WoAI` hay un **symlink al repo** (instalación de desarrollo), la app lo detecta y pregunta antes de reemplazarlo.
- **Desinstalar addon:** borra `WoAI` y `WoAI_S*` (con confirmación).
- Detectar si WoW está abierto (proceso `World of Warcraft`/`Wow.exe`) para advertir antes de instalar.

---

## 5. Actualizaciones con GitHub

### 5.1 Releases

- Un **único número de versión** para app, companion y addon. Un script `scripts/bump.mjs X.Y.Z` lo escribe en `app/src-tauri/tauri.conf.json`, `app/package.json`, `companion/package.json` y `WoAI.toc`.
- Publicar = `git tag vX.Y.Z && git push --tags`.
- GitHub Actions (`.github/workflows/release.yml`) con matriz `macos-latest` (arm64 y x64, o `universal-apple-darwin`) y `windows-latest`:
  1. Instala Node y Rust.
  2. Compila el sidecar del companion para el target.
  3. Copia el addon a `resources/`.
  4. `tauri-apps/tauri-action` construye, firma y sube a un **Release borrador**: `.dmg` + `.app.tar.gz` (macOS), instalador **NSIS** `.exe` (Windows; MSI opcional), sus `.sig` y el **`latest.json`** que lee el updater.
  5. Se revisa el borrador y se publica a mano (o automático en tags sin `-beta`).

### 5.2 Updater

- `tauri-plugin-updater` con endpoint `https://github.com/alcheco/world-of-ai/releases/latest/download/latest.json`.
- Firma obligatoria de Tauri: `tauri signer generate` → la clave privada va en los secrets `TAURI_SIGNING_PRIVATE_KEY` / `…_PASSWORD`; la pública en `tauri.conf.json`. **Si se pierde la clave privada, las instalaciones existentes ya no pueden actualizarse**: guardarla en un gestor de contraseñas.
- Comportamiento: buscar al arrancar y cada 6 h; notificación "Hay una versión nueva" → *Instalar y reiniciar* / *Más tarde*; ajuste para desactivar la búsqueda automática; mostrar las notas del release.
- Tras actualizar, la app compara la versión del addon instalado con la del bundle y ofrece actualizarlo (con el aviso de reiniciar WoW si hay archivos nuevos).
- Canal beta (opcional, después): tags `vX.Y.Z-beta.N` como *prerelease* con su propio `latest-beta.json`.

### 5.3 Firma de código (necesaria para que se pueda instalar sin pelear con el sistema)

- **macOS:** sin firma + notarización, Gatekeeper bloquea la app ("está dañada" al descargarla). Requiere cuenta de Apple Developer (99 USD/año), certificado *Developer ID Application* y secrets `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`; `tauri-action` firma y notariza. El sidecar también debe quedar firmado (Tauri lo hace al empaquetarlo).
- **Windows:** sin certificado, SmartScreen muestra "Windows protegió tu PC" (se puede continuar). Opciones: aceptarlo al principio, o Azure Trusted Signing / certificado OV más adelante.
- **Permisos de macOS:** el companion lee `~/Library/Application Support`, `~/.claude`, `~/.codex` y la carpeta del juego en `/Applications`; no necesita *Full Disk Access*. Si el usuario tiene WoW en `Documentos`/`Escritorio`, macOS pedirá permiso una vez.

---

## 6. Fases

| Fase | Contenido | Resultado |
|---|---|---|
| **0. Companion portable** ✅ | §2: carpeta de datos, copia del addon, rutas Windows, resolución de CLIs, modo `--ipc`, compilar a binario. Tests para `env.js` con rutas Windows. | `woai-companion` corre como binario en Mac y Windows. |
| **1. Esqueleto Tauri** | `app/`, sidecar con reinicio, bandeja, modo ventana/bandeja, single-instance, autostart, i18n en/es. | App local que arranca y vigila el companion. |
| **2. Ajustes y asistente** | Pantallas §3.1, permisos §3.2, detección de WoW y CLIs, botón "Probar". | Configurable sin tocar JSON. |
| **3. Addon desde la app** | §4. | Instalación completa sin terminal. |
| **4. Releases y updater** | §5.1–5.2, `bump.mjs`, workflow, claves. Primero sin firma de SO. | Tag → instaladores en GitHub → autoactualización. |
| **5. Firma** | §5.3. | Instalación limpia en Mac y Windows. |
| **6. Extras** | Addon localizado, canal beta, notificaciones del sistema al terminar un prompt. | — |

---

## 7. Decisiones abiertas

1. **Firma en macOS:** ¿hay (o se crea) cuenta de Apple Developer? Sin ella, para distribuir a otros hay que explicar `xattr -dr com.apple.quarantine`.
2. **Node SEA o Bun** para el binario del companion.
3. **Framework de UI:** Svelte (recomendado: bundle pequeño, rápido de escribir) o vanilla TS.
4. **Ruta de WoW Forever en Windows:** confirmar dónde lo instala Battle.net para afinar la detección.
5. **Repo público o privado:** el updater descarga `latest.json` sin autenticación, así que los Releases deben ser públicos (o usar un repo público solo para releases).
6. ¿Mantener el flujo de desarrollo actual (`npm start` + symlink) junto a la app? Recomendado: sí, la app detecta el symlink y no lo pisa.
