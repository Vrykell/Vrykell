use crate::db::{BlockEntry, HistoryEntry, HistoryState, SessionEntry};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

/// 文件匹配结果
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

/// 搜索上下文
#[derive(Clone, Serialize, Debug, Default)]
pub struct SearchContext {
    pub cwd: String,
    pub home: String,
    pub shell: String,
    pub git_branch: Option<String>,
    pub project_name: Option<String>,
}

/// 文件系统搜索 — 使用 ripgrep 的 `ignore` crate 进行遍历：
/// - 自动尊重 .gitignore / .ignore / 全局 gitignore
/// - 跳过隐藏文件和二进制文件
/// - 支持文件名 / 路径 / 内容匹配
fn search_files_sync(
    query: String,
    max_results: usize,
    search_content: bool,
    root: Option<String>,
    roots: Option<Vec<String>>,
) -> Vec<FileMatch> {
    // 合并 root 和 roots 参数
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

    for search_root in &search_roots {
        if results.len() >= max_results {
            break;
        }

        let walker = WalkBuilder::new(search_root)
            .standard_filters(true)
            .max_depth(Some(20))
            .build();

        for entry in walker {
            if results.len() >= max_results {
                break;
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            let path_str = path.to_string_lossy().to_string();

            // 跨工作区去重
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
            }
        }
    }

    // 目录优先，然后按修改时间降序
    results.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| b.modified.cmp(&a.modified)));
    results
}

#[tauri::command]
pub async fn search_files(
    query: String,
    max_results: usize,
    search_content: bool,
    root: Option<String>,
    roots: Option<Vec<String>>,
) -> Vec<FileMatch> {
    // 整树遍历 + 内容读取是重 IO，移出主线程（同步 command 会冻结 UI）
    tauri::async_runtime::spawn_blocking(move || {
        search_files_sync(query, max_results, search_content, root, roots)
    })
    .await
    .unwrap_or_default()
}

/// 用 regex 在文本文件中搜索，返回匹配行上下文（最多 100 字符）
fn match_in_file(path: &std::path::Path, re: &regex::Regex) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;

    // 跳过超过 512KB 的文件
    if metadata.len() > 512 * 1024 {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;
    if let Some(m) = re.find(&content) {
        let pos = m.start();
        let match_len = m.end() - m.start();
        let raw_start = pos.saturating_sub(40);
        let raw_end = std::cmp::min(pos + match_len + 40, content.len());
        // 上下文窗口可能落在多字节 UTF-8 中间，先对齐到字符边界避免切片 panic
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

/// 搜索命令历史（后端 SQLite 查询）
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

/// 获取搜索上下文（环境元数据）。
/// cwd 由前端传入活跃终端 tab 的工作目录；缺省时回退到进程启动目录。
fn get_search_context_sync(cwd: Option<String>) -> SearchContext {
    let cwd = cwd
        .filter(|c| !c.is_empty())
        .or_else(|| {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .ok()
        })
        .unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    let shell = std::env::var("SHELL")
        .unwrap_or_else(|_| "/bin/zsh".to_string())
        .split('/')
        .next_back()
        .unwrap_or("zsh")
        .to_string();

    let mut git = std::process::Command::new("git");
    git.args(["rev-parse", "--abbrev-ref", "HEAD"]).current_dir(&cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        git.creation_flags(0x08000000);
    }
    let git_branch = git.output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    let project_name = detect_project_name(&cwd);

    SearchContext {
        cwd,
        home,
        shell,
        git_branch,
        project_name,
    }
}

#[tauri::command]
pub async fn get_search_context(cwd: Option<String>) -> SearchContext {
    // spawn git rev-parse 是阻塞调用，移出 async runtime worker
    tauri::async_runtime::spawn_blocking(move || get_search_context_sync(cwd))
        .await
        .unwrap_or_default()
}

fn detect_project_name(cwd: &str) -> Option<String> {
    let cwd = PathBuf::from(cwd);

    if let Ok(content) = fs::read_to_string(cwd.join("Cargo.toml")) {
        for line in content.lines() {
            if let Some(name) = line.strip_prefix("name = \"") {
                if let Some(end) = name.find('"') {
                    return Some(name[..end].to_string());
                }
            }
        }
    }

    if let Ok(content) = fs::read_to_string(cwd.join("package.json")) {
        if let Some(name) = extract_json_field(&content, "name") {
            return Some(name);
        }
    }

    cwd.file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

fn extract_json_field(json: &str, field: &str) -> Option<String> {
    let pattern = format!("\"{}\"", field);
    let pos = json.find(&pattern)?;
    let after = &json[pos + pattern.len()..];
    let after_colon = after.find(':')?;
    let value_start = &after[after_colon + 1..].trim_start();
    if let Some(stripped) = value_start.strip_prefix('"') {
        let end = stripped.find('"')?;
        Some(value_start[1..=end].to_string())
    } else {
        None
    }
}

/// 记录命令到 SQLite 历史
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

/// 获取命令统计
#[tauri::command]
pub fn history_stats(
    state: tauri::State<'_, HistoryState>,
    top_n: usize,
) -> Result<Vec<HistoryEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.stats(top_n)
}

/// 清空命令历史
#[tauri::command]
pub fn clear_history(state: tauri::State<'_, HistoryState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.clear_history()
}

/// 按关键词搜索命令块（联表 sessions 拿标题/状态）
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

/// 按标题搜索会话
#[tauri::command]
pub fn search_sessions(
    state: tauri::State<'_, HistoryState>,
    query: String,
    max_results: usize,
) -> Result<Vec<SessionEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.search_sessions(&query, max_results)
}
