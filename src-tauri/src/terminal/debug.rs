use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::AppHandle;

pub fn enabled() -> bool { true }

pub fn initialize(app: &AppHandle) -> Result<PathBuf, String> {
    crate::diagnostics::initialize(app)
}

pub fn write(event: &str, detail: impl std::fmt::Display) {
    if let Err(error) = crate::diagnostics::record(event, json!({ "message": detail.to_string() })) {
        eprintln!("[diagnostics] {error}");
    }
}

#[tauri::command]
pub fn terminal_debug_set(enabled: bool) -> Result<bool, String> {
    crate::diagnostics::diagnostics_set_auto_save(enabled)
}

#[tauri::command]
pub fn terminal_debug_status() -> bool { crate::diagnostics::auto_save() }

#[tauri::command]
pub fn terminal_debug_record(event: String, detail: Value) -> Result<(), String> {
    crate::diagnostics::record(&event, detail)
}

#[tauri::command]
pub fn terminal_debug_log_path(app: AppHandle) -> Result<String, String> {
    initialize(&app).map(|path| path.to_string_lossy().into_owned())
}
