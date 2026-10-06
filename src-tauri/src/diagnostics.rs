use serde_json::{json, Value};
use std::collections::{HashSet, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_RECORDS: usize = 2000;
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
static AUTO_SAVE: AtomicBool = AtomicBool::new(false);
static PATHS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();
static RECORDS: Mutex<VecDeque<Value>> = Mutex::new(VecDeque::new());
static FILE_LOCK: Mutex<()> = Mutex::new(());
static RUN_ID: OnceLock<String> = OnceLock::new();
static LOG_WRITER: OnceLock<DiagnosticWriter> = OnceLock::new();

enum LogMessage {
    Append(Value),
    Flush(Sender<Result<(), String>>),
}

struct DiagnosticWriter { sender: Sender<LogMessage> }

impl DiagnosticWriter {
    fn new(path: PathBuf) -> Self {
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut file: Option<BufWriter<fs::File>> = None;
            let mut size = 0;
            let mut pending = Vec::new();
            let mut error: Option<String> = None;
            let mut pending_since = Instant::now();
            loop {
                let interval = Duration::from_millis(50);
                let timeout = if pending.is_empty() { interval } else { interval.saturating_sub(pending_since.elapsed()) };
                let message = receiver.recv_timeout(timeout);
                if let Ok(LogMessage::Append(ref record)) = message {
                    if pending.is_empty() { pending_since = Instant::now(); }
                    pending.push(record.clone());
                    if pending.len() < 64 { continue; }
                }
                if !pending.is_empty() {
                    let result = write_batch(&path, &mut file, &mut size, &pending);
                    pending.clear();
                    if let Err(reason) = result {
                        file = None;
                        eprintln!("[diagnostics] {reason}");
                        error = Some(reason);
                    }
                }
                match message {
                    Ok(LogMessage::Flush(reply)) => { let _ = reply.send(error.take().map_or(Ok(()), Err)); }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    _ => {}
                }
            }
        });
        Self { sender }
    }

    fn append(&self, record: Value) -> Result<(), String> {
        self.sender.send(LogMessage::Append(record)).map_err(|error| error.to_string())
    }

    fn flush(&self) -> Result<(), String> {
        let (sender, receiver) = mpsc::channel();
        self.sender.send(LogMessage::Flush(sender)).map_err(|error| error.to_string())?;
        receiver.recv().map_err(|error| error.to_string())?
    }
}

fn write_batch(path: &Path, file: &mut Option<BufWriter<fs::File>>, size: &mut u64, records: &[Value]) -> Result<(), String> {
    let _lock = FILE_LOCK.lock().map_err(|error| error.to_string())?;
    for record in records {
        if file.is_some() && *size >= MAX_LOG_BYTES {
            if let Some(mut writer) = file.take() { writer.flush().map_err(|error| error.to_string())?; }
            rotate(path)?;
        }
        if file.is_none() {
            if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            rotate(path)?;
            let handle = OpenOptions::new().create(true).append(true).open(path).map_err(|error| error.to_string())?;
            *size = handle.metadata().map_err(|error| error.to_string())?.len();
            *file = Some(BufWriter::with_capacity(64 * 1024, handle));
        }
        let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
        let writer = file.as_mut().expect("writer was initialized");
        writer.write_all(&bytes).and_then(|_| writer.write_all(b"\n")).map_err(|error| error.to_string())?;
        *size += bytes.len() as u64 + 1;
    }
    if let Some(writer) = file { writer.flush().map_err(|error| error.to_string())?; }
    Ok(())
}

pub fn flush_logs() -> Result<(), String> {
    if let Some(writer) = LOG_WRITER.get() { writer.flush()?; }
    Ok(())
}

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
    if auto_save() {
        if let Some((path, _)) = PATHS.get() {
            LOG_WRITER.get_or_init(|| DiagnosticWriter::new(path.clone())).append(record)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn diagnostics_set_auto_save(enabled: bool) -> Result<bool, String> {
    let (log, config) = PATHS.get().ok_or("日志尚未初始化")?;
    let writer = LOG_WRITER.get_or_init(|| DiagnosticWriter::new(log.clone()));
    writer.append(json!({ "timestampMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(), "source": "backend", "event": if enabled { "auto-save-enabled" } else { "auto-save-disabled" } }))?;
    writer.flush()?;
    let _lock = FILE_LOCK.lock().map_err(|e| e.to_string())?;
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
    flush_logs()?;
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
    fn background_writer_preserves_all_records_and_flushes_before_reading() {
        let directory = std::env::temp_dir().join(format!("vrykell-log-writer-{}", uuid::Uuid::new_v4()));
        let path = directory.join("diagnostics.jsonl");
        let writer = DiagnosticWriter::new(path.clone());
        for sequence in 0..1025 { writer.append(json!({ "sequence": sequence })).unwrap(); }
        writer.flush().unwrap();
        let lines: Vec<Value> = fs::read_to_string(&path).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(lines.len(), 1025);
        for (sequence, record) in lines.iter().enumerate() { assert_eq!(record["sequence"], sequence); }
        drop(writer);
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn buffered_writer_rotates_complete_json_lines() {
        let directory = std::env::temp_dir().join(format!("vrykell-log-batch-{}", uuid::Uuid::new_v4()));
        let path = directory.join("diagnostics.jsonl");
        let mut file = None;
        let mut size = 0;
        let payload = "x".repeat(1024 * 1024);
        let records: Vec<Value> = (0..12).map(|sequence| json!({ "sequence": sequence, "detail": payload })).collect();
        write_batch(&path, &mut file, &mut size, &records).unwrap();
        drop(file);
        let mut sequences = Vec::new();
        for file in [path.with_extension("jsonl.2"), path.with_extension("jsonl.1"), path.clone()] {
            let lines = fs::read_to_string(&file).unwrap();
            for line in lines.lines() { sequences.push(serde_json::from_str::<Value>(line).unwrap()["sequence"].as_u64().unwrap()); }
            fs::remove_file(file).unwrap();
        }
        assert_eq!(sequences, (0..12).collect::<Vec<_>>());
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn background_write_failures_are_reported_by_flush() {
        let path = std::env::temp_dir().join(format!("vrykell-log-denied-{}", uuid::Uuid::new_v4()));
        fs::write(&path, "not a directory").unwrap();
        let writer = DiagnosticWriter::new(path.join("diagnostics.jsonl"));
        writer.append(json!({ "event": "fixture" })).unwrap();
        assert!(writer.flush().is_err());
        drop(writer);
        fs::remove_file(path).unwrap();
    }
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
