//! Ciclo de vida del companion (sidecar `woai-companion --ipc`).
//!
//! - Lo lanza con WOAI_DATA_DIR (config.json de la app) y WOAI_ADDON_SRC (addon
//!   empaquetado en los recursos).
//! - Lee sus eventos JSON por stdout, guarda el último estado y los logs, y los
//!   reenvía a la UI con el evento "companion".
//! - `request` manda un comando por stdin y espera su `reply`.
//! - Si el proceso muere, lo vuelve a lanzar con espera creciente (1 s → 30 s).
use crate::{settings, tray};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

const MAX_LOGS: usize = 500;

#[derive(Default)]
pub struct Companion {
    child: Mutex<Option<CommandChild>>,
    /// Sube en cada arranque: los eventos de un proceso anterior se ignoran.
    generation: AtomicU64,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    status: Mutex<Value>,
    logs: Mutex<VecDeque<Value>>,
    running: AtomicBool,
    quitting: AtomicBool,
    failures: AtomicU32,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn push_log(app: &AppHandle, mut v: Value) {
    if let Some(o) = v.as_object_mut() {
        o.entry("ts").or_insert(json!(now_ms()));
    }
    let c = app.state::<Companion>();
    let mut logs = c.logs.lock().unwrap();
    if logs.len() >= MAX_LOGS {
        logs.pop_front();
    }
    logs.push_back(v);
}

/// Log generado por la app (no por el companion).
fn app_log(app: &AppHandle, level: &str, key: &str, msg: String) {
    let v = json!({ "ev": "log", "level": level, "scope": "app", "key": key, "params": {}, "msg": msg, "ts": now_ms() });
    push_log(app, v.clone());
    let _ = app.emit("companion", v);
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit("companion-state", state(app));
    tray::update_status(app);
}

pub fn state(app: &AppHandle) -> Value {
    let c = app.state::<Companion>();
    json!({
        "running": c.running.load(Ordering::SeqCst),
        "status": c.status.lock().unwrap().clone(),
        "logs": c.logs.lock().unwrap().iter().cloned().collect::<Vec<_>>(),
    })
}

pub fn is_running(app: &AppHandle) -> bool {
    app.state::<Companion>().running.load(Ordering::SeqCst)
}

pub fn status(app: &AppHandle) -> Value {
    app.state::<Companion>().status.lock().unwrap().clone()
}

pub fn start(app: &AppHandle) {
    let c = app.state::<Companion>();
    if c.quitting.load(Ordering::SeqCst) {
        return;
    }
    let gen = c.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let mut cmd = match app.shell().sidecar("woai-companion") {
        Ok(cmd) => cmd,
        Err(e) => {
            app_log(app, "error", "app.sidecarMissing", format!("sidecar: {e}"));
            return;
        }
    };
    cmd = cmd.args(["--ipc"]).env("WOAI_DATA_DIR", settings::data_dir(app)).set_raw_out(true);
    if let Ok(addon) = app.path().resolve("addon/WoAI", BaseDirectory::Resource) {
        if addon.exists() {
            cmd = cmd.env("WOAI_ADDON_SRC", addon);
        }
    }

    let (mut rx, child) = match cmd.spawn() {
        Ok(x) => x,
        Err(e) => {
            app_log(app, "error", "app.spawnFailed", format!("companion: {e}"));
            schedule_restart(app, gen);
            return;
        }
    };
    *c.child.lock().unwrap() = Some(child);
    c.running.store(true, Ordering::SeqCst);
    *c.status.lock().unwrap() = json!({});
    emit_state(app);

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut out: Vec<u8> = Vec::new();
        let mut err: Vec<u8> = Vec::new();
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(bytes) => {
                    out.extend(bytes);
                    while let Some(pos) = out.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = out.drain(..=pos).collect();
                        handle_line(&app2, gen, String::from_utf8_lossy(&line).trim());
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    err.extend(bytes);
                    while let Some(pos) = err.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = err.drain(..=pos).collect();
                        let text = String::from_utf8_lossy(&line).trim().to_string();
                        if !text.is_empty() && is_current(&app2, gen) {
                            app_log(&app2, "error", "app.stderr", text);
                        }
                    }
                }
                CommandEvent::Error(e) => {
                    if is_current(&app2, gen) {
                        app_log(&app2, "error", "app.sidecarError", e);
                    }
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
        on_exit(&app2, gen);
    });
}

fn is_current(app: &AppHandle, gen: u64) -> bool {
    app.state::<Companion>().generation.load(Ordering::SeqCst) == gen
}

fn handle_line(app: &AppHandle, gen: u64, line: &str) {
    if line.is_empty() || !is_current(app, gen) {
        return;
    }
    let Ok(mut v) = serde_json::from_str::<Value>(line) else {
        app_log(app, "info", "app.stdout", line.to_string());
        return;
    };
    let c = app.state::<Companion>();
    match v.get("ev").and_then(|e| e.as_str()).unwrap_or("") {
        "ready" | "status" => {
            if v["ev"] == "ready" {
                c.failures.store(0, Ordering::SeqCst);
            }
            let mut s = v.clone();
            s.as_object_mut().map(|o| o.remove("ev"));
            *c.status.lock().unwrap() = s;
            emit_state(app);
        }
        "reply" => {
            if let Some(id) = v.get("re").and_then(|r| r.as_u64()) {
                if let Some(tx) = c.pending.lock().unwrap().remove(&id) {
                    let _ = tx.send(v.clone());
                }
            }
        }
        "log" | "job" => {
            if let Some(o) = v.as_object_mut() {
                o.insert("ts".into(), json!(now_ms()));
            }
            push_log(app, v.clone());
        }
        _ => {}
    }
    let _ = app.emit("companion", v);
}

fn on_exit(app: &AppHandle, gen: u64) {
    if !is_current(app, gen) {
        return;
    }
    let c = app.state::<Companion>();
    c.running.store(false, Ordering::SeqCst);
    *c.child.lock().unwrap() = None;
    // Las peticiones en curso fallan (el emisor se descarta).
    c.pending.lock().unwrap().clear();
    emit_state(app);
    if !c.quitting.load(Ordering::SeqCst) {
        app_log(app, "warn", "app.companionExited", "companion exited".into());
        schedule_restart(app, gen);
    }
}

fn schedule_restart(app: &AppHandle, gen: u64) {
    let c = app.state::<Companion>();
    let n = c.failures.fetch_add(1, Ordering::SeqCst).min(5);
    let delay = Duration::from_secs((1u64 << n).min(30));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        if is_current(&app, gen) && !is_running(&app) {
            start(&app);
        }
    });
}

/// Manda un comando y espera su respuesta (`{"ev":"reply","ok":…}`).
pub async fn request(app: &AppHandle, cmd: &str, args: Value) -> Result<Value, String> {
    let c = app.state::<Companion>();
    let id = c.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let mut msg = if args.is_object() { args } else { json!({}) };
    msg["cmd"] = json!(cmd);
    msg["id"] = json!(id);
    let (tx, rx) = oneshot::channel();
    c.pending.lock().unwrap().insert(id, tx);
    {
        let mut child = c.child.lock().unwrap();
        let Some(child) = child.as_mut() else {
            c.pending.lock().unwrap().remove(&id);
            return Err("companion-stopped".into());
        };
        let line = format!("{}\n", msg);
        if let Err(e) = child.write(line.as_bytes()) {
            c.pending.lock().unwrap().remove(&id);
            return Err(e.to_string());
        }
    }
    match tokio::time::timeout(Duration::from_secs(120), rx).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => Err("companion-stopped".into()),
        Err(_) => {
            c.pending.lock().unwrap().remove(&id);
            Err("timeout".into())
        }
    }
}

/// Pide al proceso actual que se cierre y lo mata si no lo hace a tiempo.
fn stop_child(mut child: CommandChild, wait: Duration) {
    let _ = child.write(b"{\"cmd\":\"shutdown\"}\n");
    std::thread::spawn(move || {
        std::thread::sleep(wait);
        let _ = child.kill();
    });
}

pub fn restart(app: &AppHandle) {
    let c = app.state::<Companion>();
    // Invalida el proceso actual para que su salida no dispare otro reinicio.
    c.generation.fetch_add(1, Ordering::SeqCst);
    c.failures.store(0, Ordering::SeqCst);
    c.running.store(false, Ordering::SeqCst);
    c.pending.lock().unwrap().clear();
    if let Some(child) = c.child.lock().unwrap().take() {
        stop_child(child, Duration::from_millis(2000));
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Deja que el anterior suelte sus archivos antes de arrancar el nuevo.
        tokio::time::sleep(Duration::from_millis(600)).await;
        start(&app);
    });
}

/// Al salir de la app.
pub fn stop(app: &AppHandle) {
    let c = app.state::<Companion>();
    c.quitting.store(true, Ordering::SeqCst);
    c.generation.fetch_add(1, Ordering::SeqCst);
    let child = c.child.lock().unwrap().take();
    if let Some(mut child) = child {
        let _ = child.write(b"{\"cmd\":\"shutdown\"}\n");
        // El companion se cierra solo al leer "shutdown" o al cerrarse su stdin.
        std::thread::sleep(Duration::from_millis(700));
        let _ = child.kill();
    }
}
