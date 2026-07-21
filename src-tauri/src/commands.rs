use std::sync::{Arc, Mutex};
use tauri::State;

use crate::pty::PtyManager;
use crate::session::{SessionInfo, SessionOptions};

/// Shared application state managed by Tauri.
pub struct AppState {
    pub pty_manager: PtyManager,
}

/// Create a new PTY terminal session.
#[tauri::command]
pub fn create_pty(
    state: State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
    shell: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<SessionInfo, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.pty_manager.create_session(
        SessionOptions { shell, cwd, cols, rows },
        app_handle,
    )
}

/// Write data to a PTY session's stdin.
#[tauri::command]
pub fn write_pty(
    state: State<'_, Arc<Mutex<AppState>>>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.pty_manager.write_to_session(&session_id, &data)
}

/// Resize a PTY session.
#[tauri::command]
pub fn resize_pty(
    state: State<'_, Arc<Mutex<AppState>>>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.pty_manager.resize_session(&session_id, cols, rows)
}

/// Close a PTY session.
#[tauri::command]
pub fn close_pty(
    state: State<'_, Arc<Mutex<AppState>>>,
    session_id: String,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.pty_manager.close_session(&session_id)
}

/// List all active sessions.
#[tauri::command]
pub fn list_pty(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<SessionInfo>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.pty_manager.list_sessions())
}
