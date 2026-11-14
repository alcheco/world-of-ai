//! Icono en la barra de menús (macOS) / bandeja (Windows) y su menú.
use crate::{companion, i18n::t, settings, show_main};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

const TRAY_ID: &str = "main";

#[derive(Default)]
pub struct TrayState {
    status_item: Mutex<Option<MenuItem<Wry>>>,
}

fn make_menu(app: &AppHandle, lang: &str) -> tauri::Result<Menu<Wry>> {
    let status = MenuItem::with_id(app, "status", t(lang, "st.starting"), false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", t(lang, "open"), true, None::<&str>)?,
            &MenuItem::with_id(app, "restart", t(lang, "restart"), true, None::<&str>)?,
            &MenuItem::with_id(app, "updates", t(lang, "updates"), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", t(lang, "quit"), true, None::<&str>)?,
        ],
    )?;
    *app.state::<TrayState>().status_item.lock().unwrap() = Some(status);
    Ok(menu)
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let lang = settings::lang(&settings::read(app));
    let menu = make_menu(app, &lang)?;

    #[cfg(target_os = "macos")]
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    #[cfg(not(target_os = "macos"))]
    let icon = app.default_window_icon().cloned().expect("sin icono");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("WoAI")
        .menu(&menu)
        // macOS: clic abre el menú. Windows: clic abre la ventana, clic derecho el menú.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "restart" => companion::restart(app),
            "updates" => {
                show_main(app);
                let _ = app.emit("check-updates", ());
            }
            "quit" => crate::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(target_os = "macos") {
                return;
            }
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    update_status(app);
    Ok(())
}

/// Vuelve a crear el menú (al cambiar de idioma).
pub fn rebuild(app: &AppHandle) {
    let lang = settings::lang(&settings::read(app));
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), make_menu(app, &lang)) {
        let _ = tray.set_menu(Some(menu));
    }
    update_status(app);
}

/// Texto de estado del menú y tooltip.
pub fn update_status(app: &AppHandle) {
    let lang = settings::lang(&settings::read(app));
    let status = companion::status(app);
    let key = if !companion::is_running(app) {
        "st.stopped"
    } else if status.get("version").is_none() {
        "st.starting"
    } else if status.get("working").map(|w| !w.is_null()).unwrap_or(false) {
        "st.working"
    } else if status.pointer("/addon/kind").and_then(|k| k.as_str()) == Some("none") {
        "st.noAddon"
    } else {
        "st.running"
    };
    let text = t(&lang, key);
    if let Some(item) = app.state::<TrayState>().status_item.lock().unwrap().as_ref() {
        let _ = item.set_text(text);
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("WoAI — {text}")));
    }
}
