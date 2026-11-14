//! config.json en la carpeta de datos de la app. Lo comparten la app (sección
//! "app") y el companion (el resto), que lo recibe con WOAI_DATA_DIR.
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

pub fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("sin carpeta de datos");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn file(app: &AppHandle) -> PathBuf {
    data_dir(app).join("config.json")
}

/// Idioma del sistema reducido a "es" o "en".
pub fn system_lang() -> String {
    let l = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    if l.starts_with("es") { "es".into() } else { "en".into() }
}

pub fn read(app: &AppHandle) -> Value {
    let mut cfg: Value = fs::read_to_string(file(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(|v: &Value| v.is_object())
        .unwrap_or_else(|| json!({}));
    let obj = cfg.as_object_mut().unwrap();
    if !obj.get("lang").map(|v| v.is_string()).unwrap_or(false) {
        obj.insert("lang".into(), json!(system_lang()));
    }
    let app_section = obj.entry("app").or_insert_with(|| json!({}));
    if !app_section.is_object() {
        *app_section = json!({});
    }
    let a = app_section.as_object_mut().unwrap();
    a.entry("appearance").or_insert(json!("window"));
    a.entry("autoUpdate").or_insert(json!(true));
    a.entry("onboarded").or_insert(json!(false));
    cfg
}

pub fn write(app: &AppHandle, cfg: &Value) -> Result<(), String> {
    let path = file(app);
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Guarda solo si aún no existe (primer arranque: fija el idioma detectado).
pub fn ensure(app: &AppHandle) {
    if !file(app).exists() {
        let _ = write(app, &read(app));
    }
}

pub fn lang(cfg: &Value) -> String {
    cfg.get("lang").and_then(|v| v.as_str()).unwrap_or("es").to_string()
}

pub fn tray_mode(cfg: &Value) -> bool {
    cfg.pointer("/app/appearance").and_then(|v| v.as_str()) == Some("tray")
}
