use crate::db::{BlockEntry, HistoryEntry, HistoryState, SessionEntry};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::Serialize;
use std::fs;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, LazyLock, Mutex};

static FILE_SEARCHES: LazyLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// File match result.
#[derive(Clone, Serialize, Debug)]
pub struct FileMatch {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
    pub match_type: String, // "name" | "content" | "path"
    pub content_snippet: Option<String>,
}

/// Filesystem search traversal using ripgrep's `ignore` crate:
/// - Respects .gitignore, .ignore and global gitignore rules.
/// - Skips hidden and binary files.
/// - Supports name, path and content matches.
fn search_files_sync(
    query: String,
    max_results: usize,
    search_content: bool,
    root: Option<String>,
    roots: Option<Vec<String>>,
    cancelled: &AtomicBool,
    mut on_progress: impl FnMut(&[FileMatch]),
) -> Vec<FileMatch> {
    // Merge the root and roots arguments.
    let search_roots: Vec<String> = if let Some(roots) = roots {
        roots
    } else if let Some(root) = root {
        vec![root]
    } else {
        vec![std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "/".to_string())]
    };

    let query_lower = query.to_lowercase();
    let content_re = if search_content {
        RegexBuilder::new(&regex::escape(&query))
            .case_insensitive(true)
            .build()
            .ok()
    } else {
        None
    };

    let mut seen = std::collections::HashSet::new();
    let mut results: Vec<FileMatch> = Vec::new();
    let mut published = 0;
    let mut last_publish = std::time::Instant::now();

    for search_root in &search_roots {
        if results.len() >= max_results || cancelled.load(Ordering::Relaxed) {
            break;
        }

        let walker = WalkBuilder::new(search_root)
            .standard_filters(true)
            .max_depth(Some(20))
            .build();

        for entry in walker {
            if results.len() >= max_results || cancelled.load(Ordering::Relaxed) {
                break;
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            let path_str = path.to_string_lossy().to_string();

            // Deduplicate across workspaces.
            if seen.contains(&path_str) {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let name_lower = name.to_lowercase();
            let path_lower = path_str.to_lowercase();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

            let mut matched = false;
            let mut match_type = "name";
            let mut content_snippet: Option<String> = None;

            if name_lower.contains(&query_lower) {
                matched = true;
                match_type = "name";
            } else if path_lower.contains(&query_lower) {
                matched = true;
                match_type = "path";
            } else if let (true, Some(ref re)) = (!is_dir, &content_re) {
                if let Some(snippet) = match_in_file(path, re) {
                    matched = true;
                    match_type = "content";
                    content_snippet = Some(snippet);
                }
            }

            if matched {
                seen.insert(path_str.clone());
                let metadata = fs::metadata(path).ok();
                results.push(FileMatch {
                    name,
                    path: path_str,
                    is_dir,
                    size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                    modified: metadata
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                    match_type: match_type.to_string(),
                    content_snippet,
                });
                if published == 0 || results.len() - published >= 20 || last_publish.elapsed() >= std::time::Duration::from_millis(100) {
                    on_progress(&results);
                    published = results.len();
                    last_publish = std::time::Instant::now();
                }
            }
            if results.len() != published && last_publish.elapsed() >= std::time::Duration::from_millis(100) {
                on_progress(&results);
                published = results.len();
                last_publish = std::time::Instant::now();
            }
        }
    }

    // Directories first, then newest modification time.
    results.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| b.modified.cmp(&a.modified)));
    results
}

#[tauri::command]
pub async fn search_files(
    webview: tauri::Webview,
    query: String,
    max_results: usize,
    search_content: bool,
    root: Option<String>,
    roots: Option<Vec<String>>,
    request_id: Option<String>,
    on_progress: Option<tauri::ipc::JavaScriptChannelId>,
) -> Vec<FileMatch> {
    let on_progress: Option<tauri::ipc::Channel<Vec<FileMatch>>> = on_progress.map(|channel| channel.channel_on(webview));
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Some(id) = &request_id {
        if let Ok(mut searches) = FILE_SEARCHES.lock() { searches.insert(id.clone(), cancelled.clone()); }
    }
    // Whole-tree traversal and content reads are heavy I/O; keep them off the main thread so the UI does not freeze.
    let result = tauri::async_runtime::spawn_blocking(move || {
        search_files_sync(query, max_results, search_content, root, roots, &cancelled, |matches| {
            if let Some(channel) = &on_progress { let _ = channel.send(matches.to_vec()); }
        })
    })
    .await
    .unwrap_or_default();
    if let Some(id) = &request_id {
        if let Ok(mut searches) = FILE_SEARCHES.lock() { searches.remove(id); }
    }
    result
}

#[tauri::command]
pub fn search_files_cancel(request_id: String) {
    if let Ok(searches) = FILE_SEARCHES.lock() {
        if let Some(cancelled) = searches.get(&request_id) { cancelled.store(true, Ordering::Relaxed); }
    }
}

/// Search a text file with a regex and return up to 100 characters of matching context.
fn match_in_file(path: &std::path::Path, re: &regex::Regex) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;

    // Skip files larger than 512 KB.
    if metadata.len() > 512 * 1024 {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;
    if let Some(m) = re.find(&content) {
        let pos = m.start();
        let match_len = m.end() - m.start();
        let raw_start = pos.saturating_sub(40);
        let raw_end = std::cmp::min(pos + match_len + 40, content.len());
        // The context window may land inside a multi-byte UTF-8 sequence; align to character boundaries to avoid a slice panic.
        let start = content.floor_char_boundary(raw_start);
        let end = content.ceil_char_boundary(raw_end);
        let snippet = &content[start..end];
        let prefix = if start > 0 { "…" } else { "" };
        let suffix = if end < content.len() { "…" } else { "" };
        Some(format!(
            "{}{}{}",
            prefix,
            snippet.replace('\n', " ").replace('\r', ""),
            suffix
        ))
    } else {
        None
    }
}

/// Search command history through SQLite.
#[tauri::command]
pub fn search_history(
    state: tauri::State<'_, HistoryState>,
    query: String,
    max_results: usize,
    filter_exit_code: Option<i32>,
    since: Option<u64>,
    cwd: Option<String>,
) -> Result<Vec<HistoryEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.search(
        &query,
        max_results,
        filter_exit_code,
        since,
        cwd.as_deref(),
    )
}

/// Record a command in SQLite history.
#[tauri::command]
pub fn record_history(
    state: tauri::State<'_, HistoryState>,
    command: String,
    cwd: String,
    exit_code: Option<i32>,
    timestamp: u64,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.record(&command, &cwd, exit_code, timestamp)
}

/// Clear command history.
#[tauri::command]
pub fn clear_history(state: tauri::State<'_, HistoryState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.clear_history()
}

/// Search command blocks, joining sessions for title and status.
#[tauri::command]
pub fn search_blocks(
    state: tauri::State<'_, HistoryState>,
    query: String,
    max_results: usize,
    filter_session_status: Option<String>,
) -> Result<Vec<BlockEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.search_blocks(&query, max_results, filter_session_status.as_deref())
}

/// Search sessions by title.
#[tauri::command]
pub fn search_sessions(
    state: tauri::State<'_, HistoryState>,
    query: String,
    max_results: usize,
) -> Result<Vec<SessionEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.search_sessions(&query, max_results)
}

#[cfg(test)]
mod progressive_tests {
    use super::*;

    #[test]
    fn publishes_the_first_match_before_finishing_and_honors_cancellation() {
        let root = std::env::temp_dir().join(format!("search-progress-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        for index in 0..30 { fs::write(root.join(format!("match-{index}.txt")), b"sample").unwrap(); }
        let cancelled = AtomicBool::new(false);
        let mut batches = Vec::new();
        let results = search_files_sync("match-".into(), 50, false, Some(root.to_string_lossy().into()), None, &cancelled, |matches| {
            batches.push(matches.len());
            cancelled.store(true, Ordering::Relaxed);
        });
        assert_eq!(batches, vec![1]);
        assert_eq!(results.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
