use serde_json::{json, Value};
use std::collections::{HashSet, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_RECORDS: usize = 2000;
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
static AUTO_SAVE: AtomicBool = AtomicBool::new(false);
static PATHS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();
static RECORDS: Mutex<VecDeque<Value>> = Mutex::new(VecDeque::new());
static FILE_LOCK: Mutex<()> = Mutex::new(());
static RUN_ID: OnceLock<String> = OnceLock::new();

pub fn auto_save() -> bool {
    AUTO_SAVE.load(Ordering::Relaxed)
}

pub fn initialize(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some((log, _)) = PATHS.get() {
        return Ok(log.clone());
    }
    let log = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join("diagnostics.jsonl");
    let config = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("diagnostics.json");
    let enabled = fs::read(&config)
        .ok()
        .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
        .and_then(|value| value.get("autoSave").and_then(Value::as_bool))
        .unwrap_or(false);
    PATHS
        .set((log.clone(), config))
        .map_err(|_| "日志路径重复初始化".to_string())?;
    AUTO_SAVE.store(enabled, Ordering::Relaxed);
    record(
        "backend-start",
        json!({ "os": std::env::consts::OS, "arch": std::env::consts::ARCH,
        "version": env!("CARGO_PKG_VERSION"), "debugBuild": cfg!(debug_assertions), "autoSave": enabled }),
    )?;
    Ok(log)
}

fn redact_text(text: &str) -> String {
    static SECRETS: OnceLock<regex::Regex> = OnceLock::new();
    let regex = SECRETS.get_or_init(|| regex::Regex::new(
        r#"(?i)\bBearer\s+\S+|\bsk-[\w-]+|(?:password|passphrase|api[_-]?key|token|secret|authorization)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)|-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----"#
    ).expect("valid diagnostic redaction pattern"));
    regex
        .replace_all(text, "[redacted]")
        .chars()
        .take(4000)
        .collect()
}

fn sanitize(value: Value, key: &str, depth: usize) -> Value {
    if depth > 12 {
        return json!("[truncated]");
    }
    let normalized = key.to_ascii_lowercase();
    if [
        "password",
        "passphrase",
        "key",
        "apikey",
        "accesstoken",
        "refreshtoken",
        "token",
        "secret",
        "authorization",
        "cookie",
        "privatekey",
        "privatekeycontent",
        "env",
    ]
    .contains(&normalized.as_str())
    {
        return json!("[redacted]");
    }
    if [
        "data", "raw", "output", "content", "text", "payload", "prompt", "command", "question",
        "messages",
    ]
    .contains(&normalized.as_str())
    {
        return json!({ "redacted": true, "length": value.as_str().map(str::len) });
    }
    match value {
        Value::String(text) => json!(redact_text(&text)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .take(100)
                .map(|item| sanitize(item, "", depth + 1))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .take(100)
                .map(|(key, value)| {
                    let safe = sanitize(value, &key, depth + 1);
                    (key, safe)
                })
                .collect(),
        ),
        value => value,
    }
}

fn rotate(path: &Path) -> Result<(), String> {
    if fs::metadata(path).map(|meta| meta.len()).unwrap_or(0) < MAX_LOG_BYTES {
        return Ok(());
    }
    let first = path.with_extension("jsonl.1");
    let second = path.with_extension("jsonl.2");
    if second.exists() {
        fs::remove_file(&second).map_err(|e| e.to_string())?;
    }
    if first.exists() {
        fs::rename(&first, &second).map_err(|e| e.to_string())?;
    }
    fs::rename(path, first).map_err(|e| e.to_string())
}

fn append_file(path: &Path, record: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    rotate(path)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, record).map_err(|e| e.to_string())?;
    file.write_all(b"\n")
        .and_then(|_| file.flush())
        .map_err(|e| e.to_string())
}

pub fn record(event: &str, detail: Value) -> Result<(), String> {
    let mut detail = sanitize(detail, "", 0);
    if serde_json::to_vec(&detail)
        .map_err(|e| e.to_string())?
        .len()
        > 16 * 1024
    {
        detail = json!({ "truncated": true, "summary": redact_text(&detail.to_string()) });
    }
    let record = json!({ "timestampMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
        "source": "backend", "runId": RUN_ID.get_or_init(|| uuid::Uuid::new_v4().to_string()),
        "event": event.chars().take(100).collect::<String>(), "detail": detail });
    let mut memory = RECORDS.lock().map_err(|e| e.to_string())?;
    memory.push_back(record.clone());
    while memory.len() > MAX_RECORDS {
        memory.pop_front();
    }
    drop(memory);
    let _lock = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    if auto_save() {
        if let Some((path, _)) = PATHS.get() {
            append_file(path, &record)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn diagnostics_set_auto_save(enabled: bool) -> Result<bool, String> {
    let (log, config) = PATHS.get().ok_or("日志尚未初始化")?;
    let _lock = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    append_file(
        log,
        &json!({ "timestampMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(), "source": "backend", "event": if enabled { "auto-save-enabled" } else { "auto-save-disabled" } }),
    )?;
    if let Some(parent) = config.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        config,
        serde_json::to_vec(&json!({ "autoSave": enabled })).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    AUTO_SAVE.store(enabled, Ordering::Relaxed);
    Ok(enabled)
}

#[tauri::command]
pub fn diagnostics_log_directory(app: AppHandle) -> Result<String, String> {
    let directory = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.to_string_lossy().into_owned())
}

fn write_export(
    path: &Path,
    history: Vec<Value>,
    frontend: Vec<Value>,
    context: Value,
) -> Result<(), String> {
    let mut all: Vec<Value> = history
        .into_iter()
        .map(|record| sanitize(record, "", 0))
        .collect();
    all.extend(frontend.into_iter().map(|value| sanitize(value, "", 0)));
    all.sort_by_key(|record| {
        record
            .get("timestampMs")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    });
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(file);
    let header = json!({ "event": "diagnostics-export", "formatVersion": 1, "version": env!("CARGO_PKG_VERSION"), "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "context": sanitize(context, "", 0), "autoSave": auto_save() });
    serde_json::to_writer(&mut writer, &header).map_err(|e| e.to_string())?;
    writer.write_all(b"\n").map_err(|e| e.to_string())?;
    let mut seen = HashSet::new();
    for record in all {
        let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
        if seen.insert(line.clone()) {
            writer
                .write_all(line.as_bytes())
                .and_then(|_| writer.write_all(b"\n"))
                .map_err(|e| e.to_string())?;
        }
    }
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn diagnostics_export(
    path: String,
    frontend: Vec<Value>,
    context: Value,
) -> Result<(), String> {
    let destination = PathBuf::from(path);
    let _lock = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut history = Vec::new();
    if let Some((log, config)) = PATHS.get() {
        let files = [
            log.with_extension("jsonl.2"),
            log.with_extension("jsonl.1"),
            log.clone(),
        ];
        if files.contains(&destination) || destination == *config {
            return Err("请选择日志存储目录以外的导出文件".into());
        }
        for file in files {
            if !file.exists() {
                continue;
            }
            let reader = BufReader::new(fs::File::open(file).map_err(|e| e.to_string())?);
            for line in reader.lines() {
                let line = line.map_err(|e| e.to_string())?;
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    history.push(value);
                }
            }
        }
    }
    history.extend(RECORDS.lock().map_err(|e| e.to_string())?.iter().cloned());
    write_export(&destination, history, frontend, context)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detailed_errors_keep_context_and_remove_credentials() {
        let value = sanitize(
            json!({ "error": "handshake failed", "stack": "connect at ssh.rs:5", "password": "never-export", "parameters": { "data": "private terminal", "cols": 80, "authorization": "Bearer private" } }),
            "",
            0,
        );
        assert_eq!(value["error"], "handshake failed");
        assert_eq!(value["parameters"]["cols"], 80);
        assert!(!value.to_string().contains("never-export"));
        assert!(!value.to_string().contains("private terminal"));
        assert_eq!(
            redact_text("failed token=abc123 Bearer abcdef sk-secret123"),
            "failed [redacted] [redacted] [redacted]"
        );
    }
    #[test]
    fn export_contains_metadata_and_sorted_deduplicated_records() {
        let path =
            std::env::temp_dir().join(format!("vrykell-export-{}.jsonl", uuid::Uuid::new_v4()));
        let record = json!({ "timestampMs": 2, "event": "backend-error" });
        write_export(&path, vec![record.clone(), record], vec![json!({ "timestampMs": 1, "event": "frontend-error", "detail": { "password": "secret-value" } })], json!({ "viewport": { "width": 1240 } })).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        let lines: Vec<Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0]["formatVersion"], 1);
        assert_eq!(lines[1]["event"], "frontend-error");
        assert!(!text.contains("secret-value"));
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn rotation_retains_two_previous_files() {
        let directory =
            std::env::temp_dir().join(format!("vrykell-rotation-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("diagnostics.jsonl");
        for _ in 0..3 {
            let file = fs::File::create(&path).unwrap();
            file.set_len(MAX_LOG_BYTES).unwrap();
            rotate(&path).unwrap();
        }
        assert!(path.with_extension("jsonl.1").exists());
        assert!(path.with_extension("jsonl.2").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
