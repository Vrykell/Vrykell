use crate::db::{AcpTranscriptDetail, AcpTranscriptSummary, HistoryState};

const MAX_TRANSCRIPT_BYTES: usize = 16 * 1024 * 1024;
const MAX_CWD_CHARS: usize = 8192;
const MAX_TITLE_CHARS: usize = 320;

fn valid_identity(harness: &str, session_id: &str) -> Result<(), String> {
    if harness.trim().is_empty() || harness.len() > 256 {
        return Err("Invalid ACP harness name".into());
    }
    if session_id.trim().is_empty() || session_id.len() > 2048 {
        return Err("Invalid ACP session identifier".into());
    }
    Ok(())
}

/// Metadata limits count characters, not UTF-8 bytes: a 120-character CJK title is valid.
fn valid_metadata(cwd: &str, title: &str) -> Result<(), String> {
    if cwd.chars().count() > MAX_CWD_CHARS || title.chars().count() > MAX_TITLE_CHARS {
        return Err("ACP transcript metadata exceeds its size limit".into());
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
    valid_metadata(&cwd, &title)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_limits_count_characters_not_utf8_bytes() {
        assert!(valid_metadata("/work", &"中".repeat(120)).is_ok());
        assert!(valid_metadata("/work", &"中".repeat(MAX_TITLE_CHARS + 1)).is_err());
        assert!(valid_metadata(&"路".repeat(MAX_CWD_CHARS + 1), "Title").is_err());
    }

    #[test]
    fn identity_limits_stay_bounded() {
        assert!(valid_identity("Agent", "session").is_ok());
        assert!(valid_identity("", "session").is_err());
        assert!(valid_identity("Agent", "").is_err());
        assert!(valid_identity(&"a".repeat(257), "session").is_err());
        assert!(valid_identity("Agent", &"a".repeat(2049)).is_err());
    }
}
