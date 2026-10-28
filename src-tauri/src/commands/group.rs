use crate::db::{GroupEntry, HistoryState};

#[tauri::command]
pub fn groups_apply_plan(state: tauri::State<'_, HistoryState>, groups: Vec<crate::db::session::GroupAssignment>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.apply_group_plan(&groups)
}

#[tauri::command]
pub fn groups_list(state: tauri::State<'_, HistoryState>) -> Result<Vec<GroupEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.list_groups()
}

#[tauri::command]
pub fn group_create(
    state: tauri::State<'_, HistoryState>,
    id: String,
    title: String,
    timestamp: u64,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.create_group(&id, &title, timestamp)
}

#[tauri::command]
pub fn group_rename(state: tauri::State<'_, HistoryState>, id: String, title: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.rename_group(&id, &title)
}

#[tauri::command]
pub fn group_set_collapsed(state: tauri::State<'_, HistoryState>, id: String, collapsed: bool) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.set_group_collapsed(&id, collapsed)
}

/// Deletes a group (its sessions are kept and become ungrouped).
#[tauri::command]
pub fn group_delete(state: tauri::State<'_, HistoryState>, id: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.delete_group(&id)
}

/// Deletes a group and all session history it contains.
#[tauri::command]
pub fn group_delete_with_sessions(state: tauri::State<'_, HistoryState>, id: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.delete_group_with_sessions(&id)
}

#[tauri::command]
pub fn groups_reorder(state: tauri::State<'_, HistoryState>, ids: Vec<String>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.groups_reorder(&ids)
}

#[tauri::command]
pub fn session_set_group(
    state: tauri::State<'_, HistoryState>,
    session_id: String,
    group_id: Option<String>,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.session_set_group(&session_id, group_id.as_deref())
}

#[tauri::command]
pub fn sessions_reorder(
    state: tauri::State<'_, HistoryState>,
    group_id: Option<String>,
    ids: Vec<String>,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.sessions_reorder(group_id.as_deref(), &ids)
}

#[tauri::command]
pub fn group_restore(state: tauri::State<'_, HistoryState>, id: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.restore_group(&id)
}

#[tauri::command]
pub fn group_archive(state: tauri::State<'_, HistoryState>, id: String, timestamp: u64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.archive_group(&id, timestamp)
}
