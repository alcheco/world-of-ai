//! Textos del menú de la bandeja (la UI web tiene sus propios diccionarios).

pub fn t(lang: &str, key: &str) -> &'static str {
    let en = lang.starts_with("en");
    match (key, en) {
        ("open", false) => "Abrir WoAI",
        ("open", true) => "Open WoAI",
        ("restart", false) => "Reiniciar companion",
        ("restart", true) => "Restart companion",
        ("updates", false) => "Buscar actualizaciones…",
        ("updates", true) => "Check for updates…",
        ("quit", false) => "Salir de WoAI",
        ("quit", true) => "Quit WoAI",
        ("st.starting", false) => "Companion: iniciando…",
        ("st.starting", true) => "Companion: starting…",
        ("st.running", false) => "Companion: activo",
        ("st.running", true) => "Companion: running",
        ("st.working", false) => "Companion: ejecutando un prompt",
        ("st.working", true) => "Companion: running a prompt",
        ("st.stopped", false) => "Companion: detenido",
        ("st.stopped", true) => "Companion: stopped",
        ("st.noAddon", false) => "Companion: falta instalar el addon",
        ("st.noAddon", true) => "Companion: addon not installed",
        _ => "",
    }
}
