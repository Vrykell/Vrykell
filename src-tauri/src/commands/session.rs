use crate::db::{BlockEntry, ChatMessageEntry, HistoryState, SessionEntry};

/// 创建会话（新建标签页时调用），携带类型判别 kind 与变体专属 JSON payload。
#[tauri::command]
pub fn create_session(
    state: tauri::State<'_, HistoryState>,
    id: String,
    title: String,
    timestamp: u64,
    cwd: Option<String>,
    kind: Option<String>,
    payload: Option<String>,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.create_session(
        &id,
        &title,
        timestamp,
        cwd.as_deref().unwrap_or_default(),
        kind.as_deref().unwrap_or("local"),
        payload.as_deref().unwrap_or("{}"),
    )
}

#[tauri::command]
pub fn archive_session(
    state: tauri::State<'_, HistoryState>,
    id: String,
    timestamp: u64,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.archive_session(&id, timestamp)
}

#[tauri::command]
pub fn restore_session(
    state: tauri::State<'_, HistoryState>,
    id: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.restore_session(&id)
}

#[tauri::command]
pub fn update_session_title(
    state: tauri::State<'_, HistoryState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.update_session_title(&id, &title)
}

#[tauri::command]
pub fn update_session_cwd(
    state: tauri::State<'_, HistoryState>,
    id: String,
    cwd: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.update_session_cwd(&id, &cwd)
}

#[tauri::command]
pub fn update_session_payload(
    state: tauri::State<'_, HistoryState>,
    id: String,
    payload: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.update_session_payload(&id, &payload)
}

#[tauri::command]
pub fn get_session(
    state: tauri::State<'_, HistoryState>,
    id: String,
) -> Result<SessionEntry, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.get_session(&id)
}

/// 删除会话及关联 block / 聊天（级联删除）
#[tauri::command]
pub fn delete_session(
    state: tauri::State<'_, HistoryState>,
    id: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.delete_session(&id)
}

#[tauri::command]
pub fn record_block(
    state: tauri::State<'_, HistoryState>,
    id: String,
    session_id: String,
    pane_id: Option<String>,
    command: String,
    output_raw: String,
    output_clean: Option<String>,
    exit_code: Option<i32>,
    status: String,
    started_at: u64,
    ended_at: Option<u64>,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.record_block(
        &id,
        &session_id,
        pane_id.as_deref(),
        &command,
        &output_raw,
        &output_clean.unwrap_or_default(),
        exit_code,
        &status,
        started_at,
        ended_at,
    )
}

#[tauri::command]
pub fn set_block_collapsed(
    state: tauri::State<'_, HistoryState>,
    id: String,
    collapsed: bool,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.set_block_collapsed(&id, collapsed)
}

#[tauri::command]
pub fn append_chat_message(
    state: tauri::State<'_, HistoryState>,
    id: String,
    session_id: String,
    role: String,
    content: String,
    created_at: u64,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.append_chat_message(&id, &session_id, &role, &content, created_at)
}

#[tauri::command]
pub fn list_chat_messages(
    state: tauri::State<'_, HistoryState>,
    session_id: String,
) -> Result<Vec<ChatMessageEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.get_chat_messages(&session_id)
}

#[tauri::command]
pub fn list_sessions(
    state: tauri::State<'_, HistoryState>,
) -> Result<Vec<SessionEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.list_sessions()
}

#[tauri::command]
pub fn get_session_blocks(
    state: tauri::State<'_, HistoryState>,
    session_id: String,
) -> Result<Vec<BlockEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.get_session_blocks(&session_id)
}
