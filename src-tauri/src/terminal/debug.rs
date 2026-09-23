use std::sync::atomic::{AtomicBool, Ordering};

static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

pub fn write(event: &str, detail: impl std::fmt::Display) {
    if enabled() {
        eprintln!("[terminal-debug] {event}: {detail}");
    }
}

#[tauri::command]
pub fn terminal_debug_set(enabled: bool) -> bool {
    ENABLED.store(enabled, Ordering::Relaxed);
    eprintln!("[terminal-debug] {}", if enabled { "enabled" } else { "disabled" });
    enabled
}

#[tauri::command]
pub fn terminal_debug_status() -> bool {
    enabled()
}

