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

/// Discard the local download copies left behind when a native drag-out is cancelled.
/// Only paths inside the downloads root are removed, so a stray path can never delete a user file.
#[tauri::command]
pub fn downloads_discard(
    state: tauri::State<'_, HistoryState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let root = crate::remote::ssh::downloads_dir()?;
    let db = state.0.lock().map_err(|e| e.to_string())?;
    for path in paths {
        let candidate = std::path::Path::new(&path);
        if !candidate.starts_with(&root) {
            continue;
        }
        let removed = if candidate.is_dir() {
            std::fs::remove_dir_all(candidate)
        } else {
            std::fs::remove_file(candidate)
        };
        if let Err(error) = removed {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("清理下载副本失败：{error}"));
            }
        }
        db.remove_download(&path)?;
    }
    Ok(())
}
