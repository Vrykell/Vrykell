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
/// Diagnostics logs rotate by UTC hour, and the hour lives in the file name.
const LOG_FILE_PREFIX: &str = "diagnostics-";
const LOG_FILE_SUFFIX: &str = ".jsonl";
/// Kept history: at most a day of hourly segments, plus a disk safety net for the whole set.
const MAX_LOG_SEGMENTS: usize = 24;
const MAX_LOG_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
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
            let directory = path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
            let mut segment = LogSegment::default();
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
                    let result = write_records(&directory, &mut segment, &pending, SystemTime::now());
                    pending.clear();
                    if let Err(reason) = result {
                        segment = LogSegment::default();
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

/// The open hourly segment; records append to it until the UTC hour changes.
#[derive(Default)]
struct LogSegment {
    path: PathBuf,
    file: Option<BufWriter<fs::File>>,
}

fn write_records(directory: &Path, segment: &mut LogSegment, records: &[Value], now: SystemTime) -> Result<(), String> {
    let _lock = FILE_LOCK.lock().map_err(|error| error.to_string())?;
    let target = directory.join(format!("{LOG_FILE_PREFIX}{}{LOG_FILE_SUFFIX}", utc_hour_stamp(now)));
    if segment.file.is_some() && segment.path != target {
        if let Some(mut writer) = segment.file.take() { writer.flush().map_err(|error| error.to_string())?; }
        prune_segments(directory, &target, MAX_LOG_SEGMENTS, MAX_LOG_TOTAL_BYTES)?;
    }
    if segment.file.is_none() {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let handle = OpenOptions::new().create(true).append(true).open(&target).map_err(|error| error.to_string())?;
        segment.path = target;
        segment.file = Some(BufWriter::with_capacity(64 * 1024, handle));
    }
    for record in records {
        let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
        let writer = segment.file.as_mut().expect("writer was initialized");
        writer.write_all(&bytes).and_then(|_| writer.write_all(b"\n")).map_err(|error| error.to_string())?;
    }
    if let Some(writer) = &mut segment.file { writer.flush().map_err(|error| error.to_string())?; }
    Ok(())
}

/// `20261014T07` for the UTC hour that contains `now`.
fn utc_hour_stamp(now: SystemTime) -> String {
    let seconds = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let hours = seconds / 3600;
    let (year, month, day) = civil_date((hours / 24) as i64);
    format!("{year:04}{month:02}{day:02}T{:02}", hours % 24)
}

/// Proleptic Gregorian date for a day count since 1970-01-01.
fn civil_date(mut days: i64) -> (i64, u32, u32) {
    let mut year = 1970;
    loop {
        let length = if is_leap_year(year) { 366 } else { 365 };
        if days < length { break; }
        days -= length;
        year += 1;
    }
    let months = [31, if is_leap_year(year) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 0;
    while days >= months[month] as i64 {
        days -= months[month] as i64;
        month += 1;
    }
    (year, month as u32 + 1, days as u32 + 1)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Diagnostics logs in the log directory, including the legacy `diagnostics.jsonl` set.
fn is_log_artifact(name: &str) -> bool {
    name.starts_with("diagnostics") && name.contains(".jsonl")
}

/// Delete the oldest segments until the kept set fits `keep` files and `max_bytes` (the active
/// segment is never a candidate, so an hour of heavy output cannot delete itself).
fn prune_segments(directory: &Path, active: &Path, keep: usize, max_bytes: u64) -> Result<(), String> {
    let mut candidates: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let entries = match fs::read_dir(directory) { Ok(entries) => entries, Err(_) => return Ok(()) };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == active || !is_log_artifact(&entry.file_name().to_string_lossy()) { continue; }
        let metadata = match entry.metadata() { Ok(metadata) => metadata, Err(_) => continue };
        if !metadata.is_file() { continue; }
        candidates.push((path, metadata.len(), metadata.modified().unwrap_or(UNIX_EPOCH)));
    }
    candidates.sort_by_key(|(_, _, modified)| *modified);
    let mut total: u64 = candidates.iter().map(|(_, bytes, _)| *bytes).sum();
    let mut remaining = candidates.len();
    for (path, bytes, _) in candidates {
        if remaining <= keep && total <= max_bytes { break; }
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(bytes);
            remaining -= 1;
        }
    }
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
        .join(format!("{LOG_FILE_PREFIX}{}{LOG_FILE_SUFFIX}", utc_hour_stamp(SystemTime::now())));
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

/// Redact secrets and cap the length. The pattern is shared with history persistence
/// ([`crate::redact`]); the length cap is a diagnostic-log concern only.
fn redact_text(text: &str) -> String {
    crate::redact::redact_text(text).chars().take(4000).collect()
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

/// The current auto-save flag (the frontend mirrors it once at startup).
#[tauri::command]
pub fn diagnostics_auto_save() -> bool {
    auto_save()
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

/// Append a batch of frontend records in one call; order is preserved.
#[tauri::command]
pub fn diagnostics_records(records: Vec<Value>) -> Result<(), String> {
    for entry in records {
        let event = entry.get("event").and_then(Value::as_str).unwrap_or("frontend-event").to_owned();
        record(&event, entry)?;
    }
    Ok(())
}

/// The current log segment's file path (initializes the log directory on first use).
#[tauri::command]
pub fn diagnostics_log_path(app: AppHandle) -> Result<String, String> {
    initialize(&app).map(|path| path.to_string_lossy().into_owned())
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
        let path = directory.join(format!("{LOG_FILE_PREFIX}{}{LOG_FILE_SUFFIX}", utc_hour_stamp(SystemTime::now())));
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
    fn buffered_writer_keeps_complete_json_lines_in_one_hour_segment() {
        let directory = std::env::temp_dir().join(format!("vrykell-log-batch-{}", uuid::Uuid::new_v4()));
        let mut segment = LogSegment::default();
        let payload = "x".repeat(1024 * 1024);
        let records: Vec<Value> = (0..12).map(|sequence| json!({ "sequence": sequence, "detail": payload })).collect();
        let now = UNIX_EPOCH + Duration::from_secs(1_791_963_297);
        write_records(&directory, &mut segment, &records, now).unwrap();
        drop(segment);
        let path = directory.join("diagnostics-20261014T07.jsonl");
        let lines = fs::read_to_string(&path).unwrap();
        let sequences: Vec<u64> = lines.lines().map(|line| serde_json::from_str::<Value>(line).unwrap()["sequence"].as_u64().unwrap()).collect();
        assert_eq!(sequences, (0..12).collect::<Vec<_>>());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn records_move_to_a_new_segment_when_the_utc_hour_changes() {
        let directory = std::env::temp_dir().join(format!("vrykell-log-hour-{}", uuid::Uuid::new_v4()));
        let mut segment = LogSegment::default();
        let first = UNIX_EPOCH + Duration::from_secs(1_791_963_297);
        write_records(&directory, &mut segment, &[json!({ "sequence": 0 })], first).unwrap();
        write_records(&directory, &mut segment, &[json!({ "sequence": 1 })], first + Duration::from_secs(3600)).unwrap();
        drop(segment);
        let earlier = fs::read_to_string(directory.join("diagnostics-20261014T07.jsonl")).unwrap();
        let later = fs::read_to_string(directory.join("diagnostics-20261014T08.jsonl")).unwrap();
        assert!(earlier.contains("\"sequence\":0") && !earlier.contains("\"sequence\":1"));
        assert!(later.contains("\"sequence\":1") && !later.contains("\"sequence\":0"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn utc_hour_stamp_uses_civil_dates() {
        assert_eq!(utc_hour_stamp(UNIX_EPOCH), "19700101T00");
        assert_eq!(utc_hour_stamp(UNIX_EPOCH + Duration::from_secs(1_791_963_297)), "20261014T07");
        // 2027 is not a leap year: 2027-03-01 is 59 days after 2027-01-01.
        let march_first_2027 = UNIX_EPOCH + Duration::from_secs(1_803_859_200);
        assert_eq!(utc_hour_stamp(march_first_2027), "20270301T00");
        // 2028 is a leap year: 02-29 sits exactly between 02-28 and 03-01.
        let february_28_2028 = UNIX_EPOCH + Duration::from_secs(1_835_308_800);
        assert_eq!(utc_hour_stamp(february_28_2028), "20280228T00");
        assert_eq!(utc_hour_stamp(february_28_2028 + Duration::from_secs(86_400)), "20280229T00");
        assert_eq!(utc_hour_stamp(february_28_2028 + Duration::from_secs(2 * 86_400)), "20280301T00");
    }

    #[test]
    fn pruning_keeps_the_newest_segments_within_both_limits() {
        let directory = std::env::temp_dir().join(format!("vrykell-log-prune-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let active = directory.join("diagnostics-20261014T09.jsonl");
        for hour in 0..8 {
            let file = directory.join(format!("diagnostics-20261014T{hour:02}.jsonl"));
            fs::write(&file, "x".repeat(4)).unwrap();
            // Space the modification times so "oldest first" is deterministic.
            let when = fs::File::open(&file).unwrap();
            drop(when);
        }
        fs::write(&active, "active").unwrap();
        // A legacy segment from the size-rotation era is pruned like any other.
        let legacy = directory.join("diagnostics.jsonl.1");
        fs::write(&legacy, "legacy").unwrap();
        prune_segments(&directory, &active, 3, u64::MAX).unwrap();
        let mut kept: Vec<String> = fs::read_dir(&directory).unwrap().flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
        kept.sort();
        assert_eq!(kept.len(), 4, "three kept segments plus the active one: {kept:?}");
        assert!(active.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn pruning_also_enforces_the_total_size_limit() {
        let directory = std::env::temp_dir().join(format!("vrykell-log-size-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let active = directory.join("diagnostics-20261014T05.jsonl");
        for hour in 0..4 {
            fs::write(directory.join(format!("diagnostics-20261014T0{hour}.jsonl")), "x".repeat(1024)).unwrap();
        }
        fs::write(&active, "active").unwrap();
        prune_segments(&directory, &active, usize::MAX, 2048).unwrap();
        let kept: usize = fs::read_dir(&directory).unwrap().flatten().count();
        assert_eq!(kept, 3, "two kilobyte-sized segments plus the active one");
        assert!(active.exists());
        fs::remove_dir_all(directory).unwrap();
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
}
