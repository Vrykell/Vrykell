use crate::db::{HistoryState, command_history::{HistoryCommand, HistoryCommandMutation}};
use serde::Serialize;
use std::{io::Read, path::{Path, PathBuf}};

#[tauri::command]
pub fn command_history_record(state: tauri::State<'_, HistoryState>, entry: HistoryCommand) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.record_command_history(&entry)
}
#[tauri::command]
pub fn command_history_list(state: tauri::State<'_, HistoryState>, target: String, root: String) -> Result<Vec<HistoryCommand>, String> {
    state.0.lock().map_err(|e| e.to_string())?.command_history(&target, &root)
}
#[tauri::command]
pub fn command_history_mutate(state: tauri::State<'_, HistoryState>, change: HistoryCommandMutation) -> Result<serde_json::Value, String> {
    state.0.lock().map_err(|e| e.to_string())?.mutate_command_history(change)
}
#[tauri::command]
pub fn command_history_preferences(state: tauri::State<'_, HistoryState>, scope: String) -> Result<serde_json::Value, String> {
    state.0.lock().map_err(|e| e.to_string())?.history_preferences(&scope)
}
#[tauri::command]
pub fn command_history_save_preferences(state: tauri::State<'_, HistoryState>, scope: String, payload: serde_json::Value) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.save_history_preferences(&scope, &payload)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext { root: String, files: Vec<ContextFile>, platform: String }
#[derive(Serialize)]
pub struct ContextFile { path: String, text: String }
const CONFIGS: &[&str] = &["package.json", "Cargo.toml", "CMakeLists.txt", "Makefile", "makefile", "justfile", "pyproject.toml", "go.mod", "Dockerfile", "compose.yaml", "src-tauri/Cargo.toml", "src-tauri/tauri.conf.json"];

// File access stays behind one context command for local and remote projects.
#[tauri::command]
pub async fn command_history_context(state: tauri::State<'_, HistoryState>, cwd: String, root: Option<String>, connection_id: Option<String>, include_files: bool) -> Result<ProjectContext, String> {
    let connection = if let Some(id) = connection_id {
        Some(state.0.lock().map_err(|e| e.to_string())?.get_ssh_connection(&id)?)
    } else { None };
    tauri::async_runtime::spawn_blocking(move || {
        let remote = connection.is_some();
        let session = connection.as_ref().map(|conn| crate::remote::ssh::connect_with_timeout(conn, Some(std::time::Duration::from_secs(5)))).transpose()?;
        if let Some(session) = &session { session.set_timeout(5000); }
        let sftp = session.as_ref().map(|s| s.sftp().map_err(|e| e.to_string())).transpose()?;
        let exists = |path: &Path| sftp.as_ref().map(|s| s.stat(Path::new(&path.to_string_lossy().replace('\\', "/"))).is_ok()).unwrap_or_else(|| path.exists());
        let root = if let Some(path) = root.filter(|s| !s.is_empty()) { PathBuf::from(path) } else {
            let original = PathBuf::from(&cwd);
            let mut found = original.clone();
            for ancestor in original.ancestors() {
                if exists(&ancestor.join(".git")) { found = ancestor.to_owned(); break; }
            }
            found
        };
        let directory = sftp.as_ref().map(|s| s.stat(Path::new(&root.to_string_lossy().replace('\\', "/"))).map(|s| s.is_dir()).unwrap_or(false)).unwrap_or_else(|| root.is_dir());
        let absolute = if remote { root.to_string_lossy().starts_with('/') } else { root.is_absolute() };
        if !absolute || !directory { return Err("The project root must be an existing absolute directory.".into()); }
        let mut files = Vec::new();
        if include_files {
            let mut directories = vec![root.clone()];
            let current = PathBuf::from(&cwd);
            if current != root && current.starts_with(&root) { directories.push(current); }
            let mut remaining = 48 * 1024;
            for directory in directories {
              for name in CONFIGS {
                if remaining == 0 { break; }
                let path = directory.join(name);
                let file: Option<Box<dyn Read>> = if let Some(sftp) = &sftp {
                    sftp.open(Path::new(&path.to_string_lossy().replace('\\', "/"))).ok().map(|file| Box::new(file) as Box<dyn Read>)
                } else { std::fs::File::open(&path).ok().map(|file| Box::new(file) as Box<dyn Read>) };
                if let Some(file) = file {
                    let mut bytes = Vec::new();
                    if file.take(8192.min(remaining)).read_to_end(&mut bytes).is_ok() {
                        remaining -= bytes.len() as u64;
                        let label = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                        files.push(ContextFile { path: label, text: crate::redact::redact_text(&String::from_utf8_lossy(&bytes)) });
                    }
                }
              }
            }
        }
        Ok(ProjectContext { root: root.to_string_lossy().replace('\\', "/"), files, platform: if remote { "remote POSIX".into() } else { std::env::consts::OS.into() } })
    }).await.map_err(|e| e.to_string())?
}
