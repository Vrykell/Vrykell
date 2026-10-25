use crate::db::{history_page::{HistoryPage, HistoryPageRequest}, HistoryState};
use std::time::Instant;
use crate::db::workspace_history::WorkspaceHistorySave;

#[tauri::command]
pub fn save_workspace_history(state: tauri::State<'_, HistoryState>, request: WorkspaceHistorySave) -> Result<(), String> {
    state.0.lock().map_err(|error| error.to_string())?.save_workspace_history(&request)
}

#[tauri::command]
pub fn history_page(state: tauri::State<'_, HistoryState>, request: HistoryPageRequest) -> Result<HistoryPage, String> {
    let started = Instant::now();
    let database = state.0.lock().map_err(|error| error.to_string())?;
    let lock_wait = started.elapsed();
    let result = database.history_page(&request);
    drop(database);
    let _ = crate::diagnostics::record("history-page-read", serde_json::json!({
        "lockWaitMs": lock_wait.as_secs_f64() * 1000.0,
        "queryMs": started.elapsed().saturating_sub(lock_wait).as_secs_f64() * 1000.0,
        "limit": request.limit, "hasCursor": request.cursor.is_some(),
        "recordCount": result.as_ref().map(|page| page.sessions.len() + page.conversations.len()).unwrap_or(0),
        "success": result.is_ok()
    }));
    result
}
