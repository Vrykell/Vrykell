use serde_json::json;
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
