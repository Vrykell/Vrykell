use crate::db::{ConversationEntry, ConversationMessageEntry, HistoryState};

#[tauri::command]
pub fn get_conversation(state: tauri::State<'_, HistoryState>, id: String) -> Result<ConversationEntry, String> {
    if id.is_empty() || id.len() > 2048 { return Err("Invalid conversation identifier".into()); }
    state.0.lock().map_err(|error| error.to_string())?.get_conversation(&id)
}

#[tauri::command]
pub fn list_conversations(
    state: tauri::State<'_, HistoryState>,
) -> Result<Vec<ConversationEntry>, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .list_conversations()
}

#[tauri::command]
pub fn save_conversation(
    state: tauri::State<'_, HistoryState>,
    id: String,
    title: String,
    created_at: u64,
    updated_at: u64,
    environment: String,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .save_conversation(&id, &title, created_at, updated_at, &environment)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn append_conversation_message(
    state: tauri::State<'_, HistoryState>,
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    created_at: u64,
    parts: String,
    attachments: String,
    pane_id: Option<String>,
    context: String,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .append_conversation_message(
            &id,
            &conversation_id,
            &role,
            &content,
            created_at,
            &parts,
            &attachments,
            pane_id.as_deref(),
            &context,
        )
}

#[tauri::command]
pub fn list_conversation_messages(
    state: tauri::State<'_, HistoryState>,
    id: String,
) -> Result<Vec<ConversationMessageEntry>, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .list_conversation_messages(&id)
}

#[tauri::command]
pub fn delete_conversation(
    state: tauri::State<'_, HistoryState>,
    id: String,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .delete_conversation(&id)
}

#[tauri::command]
pub fn delete_conversation_message(
    state: tauri::State<'_, HistoryState>,
    id: String,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .delete_conversation_message(&id)
}
