use crate::db::{DownloadEntry, HistoryState};

#[tauri::command]
pub fn downloads_list(
    state: tauri::State<'_, HistoryState>,
) -> Result<Vec<DownloadEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.list_downloads()
}

#[tauri::command]
pub fn downloads_clear(state: tauri::State<'_, HistoryState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.clear_downloads()
}
