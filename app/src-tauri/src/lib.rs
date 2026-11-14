mod companion;
mod i18n;
mod settings;
mod tray;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_opener::OpenerExt;

/// Argumento con el que el inicio de sesión lanza la app: arranca oculta.
const HIDDEN_ARG: &str = "--hidden";

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Ventana normal (Dock / barra de tareas) o solo en la bandeja.
fn apply_appearance(app: &AppHandle, cfg: &Value) {
    let tray_only = settings::tray_mode(cfg);
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        let _ = app.set_activation_policy(if tray_only { ActivationPolicy::Accessory } else { ActivationPolicy::Regular });
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_skip_taskbar(tray_only);
    }
}

pub fn quit(app: &AppHandle) {
    companion::stop(app);
    app.exit(0);
}

// ---------------------------------------------------------------- comandos

#[tauri::command]
fn get_config(app: AppHandle) -> Value {
    settings::read(&app)
}

#[tauri::command]
async fn save_config(app: AppHandle, config: Value) -> Result<Value, String> {
    let old = settings::read(&app);
    settings::write(&app, &config)?;
    if settings::tray_mode(&old) != settings::tray_mode(&config) {
        apply_appearance(&app, &config);
        // En macOS, al cambiar la política de activación la ventana puede quedar detrás.
        show_main(&app);
    }
    if settings::lang(&old) != settings::lang(&config) {
        tray::rebuild(&app);
    }
    if companion::is_running(&app) {
        companion::request(&app, "reload-config", json!({})).await
    } else {
        Ok(json!({ "ok": true, "result": null }))
    }
}

#[tauri::command]
async fn companion_request(app: AppHandle, cmd: String, args: Option<Value>) -> Result<Value, String> {
    companion::request(&app, &cmd, args.unwrap_or(json!({}))).await
}

#[tauri::command]
fn get_state(app: AppHandle) -> Value {
    companion::state(&app)
}

#[tauri::command]
fn restart_companion(app: AppHandle) {
    companion::restart(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    quit(&app);
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn app_info(app: AppHandle) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "dataDir": settings::data_dir(&app),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "systemLang": settings::system_lang(),
    })
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- arranque

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Debe ir primero: si ya hay una instancia, la enfoca y esta termina.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .manage(companion::Companion::default())
        .manage(tray::TrayState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            settings::ensure(&handle);
            let cfg = settings::read(&handle);
            tray::build(&handle)?;
            apply_appearance(&handle, &cfg);

            let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
            let onboarded = cfg.pointer("/app/onboarded").and_then(|v| v.as_bool()).unwrap_or(false);
            if !hidden || !onboarded {
                show_main(&handle);
            }
            companion::start(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar la ventana la oculta: el companion sigue trabajando.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            companion_request,
            get_state,
            restart_companion,
            quit_app,
            hide_window,
            app_info,
            open_path
        ])
        .build(tauri::generate_context!())
        .expect("error al iniciar WoAI");

    app.run(|app, event| match event {
        // Clic en el icono del Dock con la ventana oculta.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        RunEvent::Exit => companion::stop(app),
        _ => {}
    });
}
