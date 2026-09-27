use serde_json::{json, Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const LOG_FILE: &str = "terminal-debug.jsonl";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const SENSITIVE_KEYS: &[&str] = &[
    "command", "payload", "raw", "text", "data", "output", "cwd", "path", "host", "user",
    "token", "secret", "password", "content", "error", "branch", "argv", "args", "shell",
];

static ENABLED: AtomicBool = AtomicBool::new(cfg!(debug_assertions));
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

pub fn initialize(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = LOG_PATH.get() {
        return Ok(path.clone());
    }

    let directory = app.path().app_log_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(LOG_FILE);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let initialized_here = LOG_PATH.set(path.clone()).is_ok();
    let log_path = LOG_PATH.get().cloned().unwrap_or(path);
    if initialized_here && cfg!(debug_assertions) {
        ENABLED.store(true, Ordering::Relaxed);
        write_record("development-session-start", json!({ "profile": "debug" }));
    }
    Ok(log_path)
}

pub fn write(event: &str, detail: impl std::fmt::Display) {
    if !enabled() {
        return;
    }
    write_record(event, json!({ "message": detail.to_string() }));
}

fn write_record(event: &str, detail: Value) {
    let Some(path) = LOG_PATH.get() else {
        eprintln!("[terminal-debug] log file is not initialized; event={event}");
        return;
    };

    let _guard = match LOG_LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Err(error) = rotate_if_needed(path) {
        eprintln!("[terminal-debug] log rotation failed: {error}");
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let record = json!({
        "timestampMs": timestamp_ms,
        "event": safe_event_name(event),
        "detail": detail,
    });

    let line = match serde_json::to_vec(&record) {
        Ok(line) => line,
        Err(error) => {
            eprintln!("[terminal-debug] failed to serialize record: {error}");
            return;
        }
    };

    let result = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| {
            file.write_all(&line)?;
            file.write_all(b"\n")?;
            file.flush()
        });
    if let Err(error) = result {
        eprintln!("[terminal-debug] failed to write log: {error}");
    }
}

fn rotate_if_needed(path: &PathBuf) -> std::io::Result<()> {
    let size = fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0);
    if size < MAX_LOG_BYTES {
        return Ok(());
    }

    let first = path.with_extension("jsonl.1");
    let second = path.with_extension("jsonl.2");
    let _ = fs::remove_file(&second);
    if first.exists() {
        fs::rename(&first, &second)?;
    }
    fs::rename(path, &first)?;
    Ok(())
}

fn safe_event_name(event: &str) -> String {
    event
        .chars()
        .take(80)
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn sanitize_value(value: Value, key: Option<&str>, depth: usize) -> Value {
    if depth > 8 {
        return Value::String("[truncated]".to_string());
    }
    if key.map(is_sensitive_key).unwrap_or(false) {
        return Value::String("[redacted]".to_string());
    }
    if depth == 0 && value.is_string() {
        return Value::String("[redacted]".to_string());
    }

    match value {
        Value::Object(object) => {
            let sanitized = object
                .into_iter()
                .map(|(key, value)| {
                    let value = sanitize_value(value, Some(&key), depth + 1);
                    (key, value)
                })
                .collect::<Map<String, Value>>();
            Value::Object(sanitized)
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| sanitize_value(item, None, depth + 1))
                .collect(),
        ),
        Value::String(text) if text.chars().count() > 512 => {
            let prefix = text.chars().take(512).collect::<String>();
            Value::String(format!("{prefix}…[truncated]"))
        }
        Value::String(text) => Value::String(text),
        value => value,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    SENSITIVE_KEYS.iter().any(|sensitive| normalized == *sensitive)
}

#[tauri::command]
pub fn terminal_debug_set(enabled: bool) -> bool {
    if enabled {
        ENABLED.store(true, Ordering::Relaxed);
        write_record("diagnostics-enabled", json!({}));
    } else {
        write_record("diagnostics-disabled", json!({}));
        ENABLED.store(false, Ordering::Relaxed);
    }
    enabled
}

#[tauri::command]
pub fn terminal_debug_status() -> bool {
    enabled()
}

#[tauri::command]
pub fn terminal_debug_record(event: String, detail: Value) {
    if enabled() {
        write_record(&event, sanitize_value(detail, None, 0));
    }
}

#[tauri::command]
pub fn terminal_debug_log_path(app: AppHandle) -> Result<String, String> {
    initialize(&app).map(|path| path.to_string_lossy().into_owned())
}
