use crate::platform::clipboard_files::{self, encoding::ClipMode};

/// Put the given real files on the system clipboard so they can be pasted into the OS file
/// manager. `mode` is "copy" or "cut" and only changes the advertised intent.
#[tauri::command]
pub fn clipboard_write_files(paths: Vec<String>, mode: String) -> Result<(), String> {
    clipboard_files::write_files(&paths, ClipMode::from_str(&mode))
}

/// Read the file paths currently on the system clipboard (empty when it holds no files).
#[tauri::command]
pub fn clipboard_read_files() -> Vec<String> {
    clipboard_files::read_files()
}
