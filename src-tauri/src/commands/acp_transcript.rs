use crate::db::{AcpTranscriptDetail, AcpTranscriptSummary, HistoryState};

const MAX_TRANSCRIPT_BYTES: usize = 16 * 1024 * 1024;

fn valid_identity(harness: &str, session_id: &str) -> Result<(), String> {
    if harness.trim().is_empty() || harness.len() > 256 {
        return Err("Invalid ACP harness name".into());
    }
    if session_id.trim().is_empty() || session_id.len() > 2048 {
        return Err("Invalid ACP session identifier".into());
    }
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn acp_transcript_save(
    state: tauri::State<'_, HistoryState>,
    harness: String,
    session_id: String,
    cwd: String,
    title: String,
    created_at: u64,
    updated_at: u64,
    pending: bool,
    messages: String,
) -> Result<(), String> {
    valid_identity(&harness, &session_id)?;
    if cwd.len() > 8192 || title.len() > 320 {
        return Err("ACP transcript metadata exceeds its size limit".into());
    }
    if messages.len() > MAX_TRANSCRIPT_BYTES {
        return Err("ACP transcript exceeds its size limit".into());
    }
    if serde_json::from_str::<Vec<serde_json::Value>>(&messages).is_err() {
        return Err("ACP transcript is not a JSON message list".into());
    }
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .save_acp_transcript(&harness, &session_id, &cwd, &title, created_at, updated_at, pending, &messages)
}

#[tauri::command]
pub fn acp_transcript_list(
    state: tauri::State<'_, HistoryState>,
) -> Result<Vec<AcpTranscriptSummary>, String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .list_acp_transcripts()
}

#[tauri::command]
pub fn acp_transcript_get(
    state: tauri::State<'_, HistoryState>,
    harness: String,
    session_id: String,
) -> Result<Option<AcpTranscriptDetail>, String> {
    valid_identity(&harness, &session_id)?;
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .get_acp_transcript(&harness, &session_id)
}

#[tauri::command]
pub fn acp_transcript_delete(
    state: tauri::State<'_, HistoryState>,
    harness: String,
    session_id: String,
) -> Result<(), String> {
    valid_identity(&harness, &session_id)?;
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .delete_acp_transcript(&harness, &session_id)
}
