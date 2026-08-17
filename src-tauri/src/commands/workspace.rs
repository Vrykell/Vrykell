use crate::db::{HistoryState, WorkspaceEntry};

#[tauri::command]
pub fn add_workspace(
    state: tauri::State<'_, HistoryState>,
    path: String,
    name: String,
    timestamp: u64,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.add_workspace(&path, &name, timestamp)
}

#[tauri::command]
pub fn remove_workspace(
    state: tauri::State<'_, HistoryState>,
    id: i64,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.remove_workspace(id)
}

#[tauri::command]
pub fn list_workspaces(
    state: tauri::State<'_, HistoryState>,
) -> Result<Vec<WorkspaceEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.list_workspaces()
}
