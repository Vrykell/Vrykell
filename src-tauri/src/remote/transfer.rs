use crate::db::{HistoryState, SshConnection};
use serde::{Deserialize, Serialize};
use ssh2::{ErrorCode, OpenFlags, OpenType, Sftp};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::{atomic::{AtomicU8, Ordering}, Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const CHUNK_SIZE: usize = 256 * 1024;
static ACTIVE: LazyLock<Mutex<HashMap<String, Arc<AtomicU8>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFile {
    local: String,
    remote: String,
    size: u64,
    modified: u64,
    directory: bool,
    done: bool,
    bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferJob {
    pub id: String,
    pub connection_id: String,
    pub connection_name: String,
    host: String,
    port: Option<u16>,
    user: String,
    pub direction: String,
    pub name: String,
    pub local_path: String,
    pub remote_path: String,
    pub is_dir: bool,
    pub status: String,
    pub bytes: u64,
    pub total: u64,
    pub speed: u64,
    pub error: String,
    pub created_at: u64,
    files: Vec<TransferFile>,
    prepared: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferView {
    id: String,
    connection_id: String,
    connection_name: String,
    direction: String,
    name: String,
    local_path: String,
    remote_path: String,
    is_dir: bool,
    status: String,
    bytes: u64,
    total: u64,
    speed: u64,
    error: String,
    created_at: u64,
}

impl From<TransferJob> for TransferView {
    fn from(job: TransferJob) -> Self {
        Self { id: job.id, connection_id: job.connection_id, connection_name: job.connection_name,
            direction: job.direction, name: job.name, local_path: job.local_path, remote_path: job.remote_path,
            is_dir: job.is_dir, status: job.status, bytes: job.bytes, total: job.total, speed: job.speed,
            error: job.error, created_at: job.created_at }
    }
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn persist(app: &tauri::AppHandle, job: &TransferJob) -> Result<(), String> {
    app.state::<HistoryState>().0.lock().map_err(|e| e.to_string())?.save_transfer(job)
}
fn local_modified(meta: &std::fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|v| v.duration_since(UNIX_EPOCH).ok()).map(|v| v.as_nanos() as u64).unwrap_or(0)
}
fn partial(path: &str, id: &str) -> String { format!("{path}.part-{id}") }
fn remote_join(base: &str, name: &str) -> String { crate::platform::path::join(base, name) }

/// Incomplete files are staged beside their destinations with the job-specific suffix above, so
/// the record alone decides which staged files belong to it. Directories are created in place:
/// their published children stay, only regular files are staged. An upload renames each staged
/// file into place, so a completed upload holds no staged data and needs no server connection.
fn partial_targets(job: &TransferJob) -> Vec<String> {
    let upload = job.direction == "upload";
    if upload && job.status == "completed" { return Vec::new(); }
    let staged: Vec<&str> = job.files.iter().filter(|file| !file.directory)
        .map(|file| if upload { file.remote.as_str() } else { file.local.as_str() }).collect();
    if staged.is_empty() && !job.is_dir {
        let target = if upload { &job.remote_path } else { &job.local_path };
        return vec![partial(target, &job.id)];
    }
    staged.into_iter().map(|path| partial(path, &job.id)).collect()
}

/// Removes staged regular files below the downloads root. Anything else at such a path was not
/// staged by a transfer and stays.
fn discard_local_partials(root: &Path, targets: &[String]) -> Result<(), String> {
    for target in targets {
        let staged = Path::new(target);
        if !staged.starts_with(root) { continue; }
        match std::fs::symlink_metadata(staged) {
            Ok(metadata) if metadata.is_file() => std::fs::remove_file(staged).map_err(|error| format!("Unable to remove the incomplete transfer file: {error}"))?,
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

/// Removes staged regular files on the remote host. Files the transfer never opened have no
/// staged data, so a missing entry is normal; every other lookup failure keeps the record.
fn discard_remote_partials(conn: &SshConnection, targets: &[String]) -> Result<(), String> {
    let session = super::ssh::connect_with_timeout(conn, Some(Duration::from_secs(15)))?;
    session.set_timeout(15_000);
    let sftp = session.sftp().map_err(|e| e.to_string())?;
    for target in targets {
        let staged = Path::new(target);
        match sftp.lstat(staged) {
            Ok(stat) if stat.is_file() => { sftp.unlink(staged).map_err(|e| e.to_string())?; }
            Ok(_) => (),
            // SSH_FX_NO_SUCH_FILE is the expected answer for files the transfer never opened.
            Err(error) if !matches!(error.code(), ErrorCode::SFTP(2)) => return Err(error.to_string()),
            Err(_) => (),
        }
    }
    Ok(())
}

/// Deleting a record takes its staged data with it: local partials beside a download destination
/// and remote partials on the host an upload wrote to. A connection that no longer matches the
/// transfer's destination cannot address the staged files any more, so only local records remain
/// to delete.
fn discard_partials(job: &TransferJob, conn: Option<&SshConnection>) -> Result<(), String> {
    let targets = partial_targets(job);
    if targets.is_empty() { return Ok(()); }
    if job.direction == "upload" {
        return match conn { Some(conn) => discard_remote_partials(conn, &targets), None => Ok(()) };
    }
    discard_local_partials(&super::ssh::downloads_root()?, &targets)
}

fn digest(mut reader: impl Read) -> Result<Vec<u8>, String> {
    let mut hash = Sha256::new();
    let mut buffer = vec![0; CHUNK_SIZE];
    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { return Ok(hash.finalize().to_vec()); }
        hash.update(&buffer[..count]);
    }
}

fn published_matches(sftp: &Sftp, file: &TransferFile) -> Result<bool, String> {
    let local = std::fs::File::open(&file.local).map_err(|e| e.to_string())?;
    let remote = sftp.open(Path::new(&file.remote)).map_err(|e| e.to_string())?;
    Ok(digest(local)? == digest(remote)?)
}

fn scan(sftp: &Sftp, local: &Path, remote: &str, upload: bool, depth: usize, files: &mut Vec<TransferFile>, control: &AtomicU8) -> Result<(), String> {
    match control.load(Ordering::SeqCst) {
        1 => return Err("Transfer paused".into()),
        2 => return Err("Transfer cancelled".into()),
        3 => return Err("Transfer deleted".into()),
        _ => (),
    }
    if depth > 40 { return Err("Directory nesting exceeds the transfer limit".into()); }
    let (directory, size, modified) = if upload {
        let meta = std::fs::symlink_metadata(local).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() || (!meta.is_dir() && !meta.is_file()) { return Err("Symbolic links and special files cannot be transferred".into()); }
        (meta.is_dir(), meta.len(), local_modified(&meta))
    } else {
        let meta = sftp.lstat(Path::new(remote)).map_err(|e| e.to_string())?;
        if !meta.is_dir() && !meta.is_file() { return Err("Symbolic links and special files cannot be transferred".into()); }
        (meta.is_dir(), meta.size.unwrap_or(0), meta.mtime.unwrap_or(0))
    };
    files.push(TransferFile { local: local.to_string_lossy().into_owned(), remote: remote.into(), size: if directory { 0 } else { size }, modified, directory, done: false, bytes: 0 });
    if directory {
        if upload {
            for entry in std::fs::read_dir(local).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name().to_string_lossy().into_owned();
                scan(sftp, &entry.path(), &remote_join(remote, &name), upload, depth + 1, files, control)?;
            }
        } else {
            for (path, _) in sftp.readdir(Path::new(remote)).map_err(|e| e.to_string())? {
                let Some(name) = crate::platform::path::name_from_listing(&path.to_string_lossy(), remote) else { continue };
                if !crate::platform::path::is_safe_component(&name) || name.contains(':') { return Err("Unsafe remote file name".into()); }
                scan(sftp, &local.join(&name), &remote_join(remote, &name), upload, depth + 1, files, control)?;
            }
        }
    }
    Ok(())
}

fn validate_source(sftp: &Sftp, file: &TransferFile, upload: bool) -> Result<(), String> {
    let (size, modified) = if upload {
        let meta = std::fs::symlink_metadata(&file.local).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.file_type().is_symlink() { return Err("Transfer source is no longer a regular file".into()); }
        (meta.len(), local_modified(&meta))
    } else {
        let meta = sftp.lstat(Path::new(&file.remote)).map_err(|e| e.to_string())?;
        if !meta.is_file() { return Err("Transfer source is no longer a regular file".into()); }
        (meta.size.unwrap_or(0), meta.mtime.unwrap_or(0))
    };
    if size != file.size || modified != file.modified { return Err("Transfer source changed; start a new transfer".into()); }
    Ok(())
}

fn check_control(app: &tauri::AppHandle, job: &mut TransferJob, control: &AtomicU8) -> Result<(), String> {
    if control.load(Ordering::SeqCst) == 1 {
        job.status = "paused".into(); job.speed = 0; persist(app, job)?;
        return Err("Transfer paused".into());
    }
    if control.load(Ordering::SeqCst) == 2 { return Err("Transfer cancelled".into()); }
    if control.load(Ordering::SeqCst) == 3 { return Err("Transfer deleted".into()); }
    Ok(())
}

fn copy_chunks<R: Read, W: Write>(reader: &mut R, writer: &mut W, size: u64, mut offset: u64, mut progress: impl FnMut(u64) -> Result<(), String>) -> Result<(), String> {
    let mut buffer = vec![0; CHUNK_SIZE];
    while offset < size {
        progress(offset)?;
        let limit = ((size - offset) as usize).min(buffer.len());
        let count = reader.read(&mut buffer[..limit]).map_err(|e| e.to_string())?;
        if count == 0 { return Err("Transfer source ended unexpectedly".into()); }
        writer.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
        offset += count as u64;
    }
    writer.flush().map_err(|e| e.to_string())?;
    progress(offset)
}

fn execute(app: &tauri::AppHandle, conn: &SshConnection, job: &mut TransferJob, control: &AtomicU8) -> Result<(), String> {
    let session = super::ssh::connect_with_timeout(conn, Some(Duration::from_secs(15)))?;
    session.set_timeout(15_000);
    let sftp = session.sftp().map_err(|e| e.to_string())?;
    let upload = job.direction == "upload";
    if !job.prepared {
        let mut files = Vec::new();
        scan(&sftp, Path::new(&job.local_path), &job.remote_path, upload, 0, &mut files, control)?;
        job.total = files.iter().map(|f| f.size).sum();
        job.is_dir = files.first().is_some_and(|f| f.directory);
        job.files = files; job.prepared = true; persist(app, job)?;
    }
    let mut checkpoint = Instant::now();
    let rate_time = Instant::now();
    let rate_bytes = job.bytes;
    for index in 0..job.files.len() {
        check_control(app, job, control)?;
        let file = job.files[index].clone();
        if file.done { continue; }
        if file.directory {
            if upload {
                match sftp.lstat(Path::new(&file.remote)) {
                    Ok(stat) if stat.is_dir() => (),
                    Ok(_) => return Err("Transfer directory was replaced".into()),
                    Err(_) => sftp.mkdir(Path::new(&file.remote), 0o755).map_err(|e| e.to_string())?,
                }
            } else { std::fs::create_dir_all(&file.local).map_err(|e| e.to_string())?; }
            job.files[index].done = true; persist(app, job)?; continue;
        }
        validate_source(&sftp, &file, upload)?;
        let dest = if upload { &file.remote } else { &file.local };
        let temp = partial(dest, &job.id);
        let final_exists = if upload { sftp.lstat(Path::new(dest)).is_ok() } else { Path::new(dest).exists() };
        if final_exists {
            // A crash after rename is recoverable only when completion was checkpointed.
            if file.bytes == file.size && published_matches(&sftp, &file)? {
                job.files[index].done = true; continue;
            }
            return Err("Transfer destination already exists".into());
        }
        let offset = if upload {
            match sftp.lstat(Path::new(&temp)) {
                Ok(stat) if stat.is_file() => stat.size.unwrap_or(0),
                Ok(_) => return Err("Partial transfer is no longer a regular file".into()),
                Err(_) => 0,
            }
        } else {
            match std::fs::symlink_metadata(&temp) {
                Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => meta.len(),
                Ok(_) => return Err("Partial transfer is no longer a regular file".into()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
                Err(e) => return Err(e.to_string()),
            }
        };
        if offset > file.size { return Err("Partial transfer exceeds source size".into()); }
        let mut progress = |bytes: u64| -> Result<(), String> {
            job.files[index].bytes = bytes;
            job.bytes = job.files.iter().map(|f| f.bytes).sum();
            check_control(app, job, control)?;
            let elapsed = rate_time.elapsed().as_secs_f64();
            job.speed = if elapsed > 0.2 { (job.bytes.saturating_sub(rate_bytes) as f64 / elapsed) as u64 } else { 0 };
            if checkpoint.elapsed() >= Duration::from_millis(500) || bytes == file.size {
                persist(app, job)?; checkpoint = Instant::now();
            }
            Ok(())
        };
        if upload {
            let mut reader = std::fs::File::open(&file.local).map_err(|e| e.to_string())?;
            reader.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            let mut writer = sftp.open_mode(Path::new(&temp), OpenFlags::WRITE | OpenFlags::CREATE, 0o600, OpenType::File).map_err(|e| e.to_string())?;
            writer.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            copy_chunks(&mut reader, &mut writer, file.size, offset, &mut progress)?;
            writer.close().map_err(|e| e.to_string())?;
            validate_source(&sftp, &file, upload)?;
            sftp.rename(Path::new(&temp), Path::new(dest), Some(ssh2::RenameFlags::empty())).map_err(|e| e.to_string())?;
        } else {
            let mut reader = sftp.open(Path::new(&file.remote)).map_err(|e| e.to_string())?;
            reader.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            let mut writer = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(&temp).map_err(|e| e.to_string())?;
            writer.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            copy_chunks(&mut reader, &mut writer, file.size, offset, &mut progress)?;
            writer.sync_all().map_err(|e| e.to_string())?; drop(writer);
            validate_source(&sftp, &file, upload)?;
            if Path::new(dest).exists() { return Err("Transfer destination already exists".into()); }
            // Linking within the destination directory publishes without replacing a file.
            std::fs::hard_link(&temp, dest).map_err(|e| e.to_string())?;
            std::fs::remove_file(&temp).map_err(|e| e.to_string())?;
        }
        job.files[index].done = true; persist(app, job)?;
    }
    Ok(())
}

fn run(app: tauri::AppHandle, conn: SshConnection, mut job: TransferJob, control: Arc<AtomicU8>) -> Result<String, String> {
    job.status = "running".into(); job.error.clear();
    let result = loop {
        let result = persist(&app, &job).and_then(|()| execute(&app, &conn, &mut job, &control));
        if result.as_ref().err().map(String::as_str) != Some("Transfer paused") { break result; }
        job.status = "paused".into(); job.speed = 0;
        if let Err(error) = persist(&app, &job) { break Err(error); }
        // The session and all file handles have closed before waiting.
        while control.load(Ordering::SeqCst) == 1 { std::thread::sleep(Duration::from_millis(100)); }
        if control.load(Ordering::SeqCst) == 2 { break Err("Transfer cancelled".into()); }
        if control.load(Ordering::SeqCst) == 3 { break Err("Transfer deleted".into()); }
        job.status = "running".into();
    };
    job.speed = 0;
    let deleted = control.load(Ordering::SeqCst) == 3 || result.as_ref().err().is_some_and(|error| error == "Transfer deleted");
    if deleted {
        // The staged data leaves before the record does: a failed cleanup keeps the record so the
        // delete can be retried once the destination is reachable again. Either way the task
        // leaves the active map, so a retry falls back to the stored record.
        let staged = partial_targets(&job);
        let outcome = discard_partials(&job, Some(&conn)).and_then(|()| {
            let state = app.state::<HistoryState>();
            let db = state.0.lock().map_err(|e| e.to_string())?;
            db.remove_transfer(&job.id)?;
            if job.direction == "download" { db.remove_download(&job.local_path)?; }
            Ok(())
        });
        ACTIVE.lock().map_err(|e| e.to_string())?.remove(&job.id);
        let _ = crate::diagnostics::record("transfer-delete", serde_json::json!({
            "id": job.id, "stage": "cleanup", "worker": true, "direction": job.direction,
            "status": job.status, "stagedCount": staged.len(), "succeeded": outcome.is_ok(),
        }));
        outcome?;
        return Err("Transfer deleted".into());
    }
    let mut active = ACTIVE.lock().map_err(|e| e.to_string())?;
    let state = app.state::<HistoryState>();
    let db = state.0.lock().map_err(|e| e.to_string())?;
    job.status = if result.is_ok() { "completed" } else if control.load(Ordering::SeqCst) == 2 { "cancelled" } else { "failed" }.into();
    if let Err(error) = &result { job.error = error.clone(); }
    db.save_transfer(&job)?;
    if result.is_ok() && job.direction == "download" {
        db.record_download(&job.name, &job.local_path, &job.remote_path, &job.connection_name, job.is_dir, job.total, now())?;
    }
    active.remove(&job.id);
    drop(db);
    drop(active);
    result?;
    if job.direction == "download" { Ok(job.local_path) } else { Ok(job.remote_path) }
}

pub fn start(app: tauri::AppHandle, conn: SshConnection, source: String, destination: String, upload: bool) -> Result<String, String> {
    let session = super::ssh::connect_with_timeout(&conn, Some(Duration::from_secs(15)))?;
    session.set_timeout(15_000);
    let sftp = session.sftp().map_err(|e| e.to_string())?;
    let name = if upload { Path::new(&source).file_name().map(|s| s.to_string_lossy().into_owned()) } else { crate::platform::path::file_name(&source) }.ok_or("Invalid transfer source")?;
    if !crate::platform::path::is_safe_component(&name) || (!upload && name.contains(':')) { return Err("Unsafe transfer file name".into()); }
    let (local, remote) = if upload {
        let base = if destination.is_empty() { sftp.realpath(Path::new(".")).map_err(|e| e.to_string())?.to_string_lossy().into_owned() } else { destination };
        let target = super::ssh::unique_remote_path(&sftp, &base, &name);
        (source, target)
    } else {
        let root = super::ssh::downloads_dir()?;
        let candidate = crate::platform::path::available_name(&name, |candidate| root.join(candidate).exists());
        (root.join(candidate).to_string_lossy().into_owned(), source)
    };
    drop(sftp); drop(session);
    let job = TransferJob { id: uuid::Uuid::new_v4().to_string(), connection_id: conn.id.clone(), connection_name: conn.name.clone(), host: conn.host.clone(), port: conn.port, user: conn.user.clone(), direction: if upload { "upload" } else { "download" }.into(), name, local_path: local, remote_path: remote, is_dir: false, status: "running".into(), bytes: 0, total: 0, speed: 0, error: String::new(), created_at: now(), files: Vec::new(), prepared: false };
    let control = Arc::new(AtomicU8::new(0));
    ACTIVE.lock().map_err(|e| e.to_string())?.insert(job.id.clone(), control.clone());
    run(app, conn, job, control)
}

#[tauri::command]
pub fn transfers_list(state: tauri::State<'_, HistoryState>) -> Result<Vec<TransferView>, String> {
    let mut jobs = state.0.lock().map_err(|e| e.to_string())?.list_transfers()?;
    let active = ACTIVE.lock().map_err(|e| e.to_string())?;
    for job in &mut jobs {
        if active.get(&job.id).is_some_and(|control| control.load(Ordering::SeqCst) == 1) {
            job.status = "paused".into(); job.speed = 0;
        }
        if !active.contains_key(&job.id) && matches!(job.status.as_str(), "running" | "paused") { job.status = "interrupted".into(); job.speed = 0; }
    }
    Ok(jobs.into_iter().map(TransferView::from).collect())
}

#[tauri::command]
pub fn transfers_clear(state: tauri::State<'_, HistoryState>, direction: String) -> Result<(), String> {
    if direction != "upload" && direction != "download" { return Err("Unknown transfer direction".into()); }
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.clear_completed_transfers(&direction)?;
    if direction == "download" { db.clear_downloads()?; }
    Ok(())
}

#[tauri::command]
pub fn transfers_control(app: tauri::AppHandle, state: tauri::State<'_, HistoryState>, id: String, action: String) -> Result<(), String> {
    let mut active = ACTIVE.lock().map_err(|e| e.to_string())?;
    if let Some(control) = active.get(&id) {
        // A delete request is final: the task is only finishing the removal of its staged data.
        if control.load(Ordering::SeqCst) == 3 { return Err("Transfer deleted".into()); }
        let value = match action.as_str() { "pause" => 1, "resume" => 0, "cancel" => 2, _ => return Err("Unknown transfer action".into()) };
        control.store(value, Ordering::SeqCst); return Ok(());
    }
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut job = db.list_transfers()?.into_iter().find(|j| j.id == id).ok_or("Transfer not found")?;
    if job.status == "completed" { return Err("Transfer is already complete".into()); }
    if action == "cancel" { job.status = "cancelled".into(); job.speed = 0; return db.save_transfer(&job); }
    if action != "resume" { return Err("Transfer is not running".into()); }
    let conn = db.get_ssh_connection(&job.connection_id)?;
    if conn.host != job.host || conn.port != job.port || conn.user != job.user {
        return Err("Connection destination changed; start a new transfer".into());
    }
    let control = Arc::new(AtomicU8::new(0));
    active.insert(id, control.clone());
    drop(db); drop(active);
    tauri::async_runtime::spawn_blocking(move || { let _ = run(app, conn, job, control); });
    Ok(())
}

/// Delete a transfer record together with its incomplete staged files. An active task stops first
/// and its worker performs the cleanup; an idle one is cleaned here. When the staged files cannot
/// leave, the record stays so the delete can be retried once the destination is reachable again.
#[tauri::command]
pub async fn transfers_delete(state: tauri::State<'_, HistoryState>, id: String) -> Result<(), String> {
    let _ = crate::diagnostics::record("transfer-delete", serde_json::json!({ "id": id, "stage": "request" }));
    {
        let active = ACTIVE.lock().map_err(|e| e.to_string())?;
        if let Some(control) = active.get(&id) { control.store(3, Ordering::SeqCst); return Ok(()); }
    }
    let (job, conn) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let job = db.list_transfers()?.into_iter().find(|job| job.id == id).ok_or("Transfer not found")?;
        // Staged uploads are reachable only through the destination the transfer wrote to.
        let conn = if job.direction == "upload" {
            db.get_ssh_connection(&job.connection_id).ok()
                .filter(|conn| conn.host == job.host && conn.port == job.port && conn.user == job.user)
        } else { None };
        (job, conn)
    };
    // Claim the id while the staged files leave so a resume cannot start a worker again.
    {
        let mut active = ACTIVE.lock().map_err(|e| e.to_string())?;
        if let Some(control) = active.get(&id) { control.store(3, Ordering::SeqCst); return Ok(()); }
        active.insert(id.clone(), Arc::new(AtomicU8::new(3)));
    }
    let staged = job.clone();
    let cleanup = tauri::async_runtime::spawn_blocking(move || discard_partials(&staged, conn.as_ref())).await;
    let outcome = match cleanup {
        Ok(result) => result.and_then(|()| {
            let db = state.0.lock().map_err(|e| e.to_string())?;
            db.remove_transfer(&id)?;
            if job.direction == "download" { db.remove_download(&job.local_path)?; }
            Ok(())
        }),
        Err(error) => Err(error.to_string()),
    };
    ACTIVE.lock().map_err(|e| e.to_string())?.remove(&id);
    let _ = crate::diagnostics::record("transfer-delete", serde_json::json!({
        "id": id, "stage": "cleanup", "worker": false, "direction": job.direction,
        "status": job.status, "stagedCount": partial_targets(&job).len(), "succeeded": outcome.is_ok(),
    }));
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn chunks_resume_at_offset_and_report_exact_progress() {
        let source = vec![42; CHUNK_SIZE * 3 + 7];
        let offset = 123;
        let mut reader = Cursor::new(&source); reader.set_position(offset);
        let mut output = Cursor::new(source[..offset as usize].to_vec()); output.set_position(offset);
        let mut updates = Vec::new();
        copy_chunks(&mut reader, &mut output, source.len() as u64, offset, |n| { updates.push(n); Ok(()) }).unwrap();
        assert_eq!(output.into_inner(), source);
        assert_eq!(updates.last(), Some(&(source.len() as u64)));
        assert!(updates.windows(2).all(|v| v[1] - v[0] <= CHUNK_SIZE as u64));
    }

    #[test]
    fn interruption_keeps_partial_bytes_and_truncated_sources_fail() {
        let source = vec![1; CHUNK_SIZE * 2];
        let mut output = Vec::new();
        let result = copy_chunks(&mut Cursor::new(&source), &mut output, source.len() as u64, 0, |n| if n > 0 { Err("cancelled".into()) } else { Ok(()) });
        assert!(result.is_err()); assert_eq!(output.len(), CHUNK_SIZE);
        assert!(copy_chunks(&mut Cursor::new([1]), &mut Vec::new(), 2, 0, |_| Ok(())).is_err());
    }

    fn staged_file(local: &str, remote: &str, directory: bool) -> TransferFile {
        TransferFile { local: local.into(), remote: remote.into(), size: if directory { 0 } else { 4 }, modified: 1, directory, done: false, bytes: 0 }
    }

    fn staged_job(id: &str, direction: &str, files: Vec<TransferFile>) -> TransferJob {
        TransferJob { id: id.into(), connection_id: "server".into(), connection_name: "Server".into(),
            host: "localhost".into(), port: Some(22), user: "tester".into(), direction: direction.into(),
            name: "data.bin".into(), local_path: "/local/data.bin".into(), remote_path: "/remote/data.bin".into(),
            is_dir: false, status: "paused".into(), bytes: 0, total: 0, speed: 0, error: String::new(), created_at: 1,
            files, prepared: true }
    }

    #[test]
    fn staged_targets_follow_the_transfer_direction() {
        let files = vec![staged_file("/local/dir", "/remote/dir", true),
            staged_file("/local/dir/one.bin", "/remote/dir/one.bin", false),
            staged_file("/local/dir/two.bin", "/remote/dir/two.bin", false)];
        assert_eq!(partial_targets(&staged_job("job-1", "upload", files.clone())),
            ["/remote/dir/one.bin.part-job-1", "/remote/dir/two.bin.part-job-1"]);
        assert_eq!(partial_targets(&staged_job("job-1", "download", files)),
            ["/local/dir/one.bin.part-job-1", "/local/dir/two.bin.part-job-1"]);
        assert_eq!(partial_targets(&staged_job("job-2", "download", Vec::new())), ["/local/data.bin.part-job-2"]);
        let mut empty_dir = staged_job("job-3", "upload", vec![staged_file("/local/dir", "/remote/dir", true)]);
        empty_dir.is_dir = true;
        assert!(partial_targets(&empty_dir).is_empty());
        let mut completed_upload = staged_job("job-4", "upload", vec![staged_file("/local/dir/one.bin", "/remote/dir/one.bin", false)]);
        completed_upload.status = "completed".into();
        assert!(partial_targets(&completed_upload).is_empty());
        let mut completed_download = staged_job("job-4", "download", vec![staged_file("/local/dir/one.bin", "/remote/dir/one.bin", false)]);
        completed_download.status = "completed".into();
        assert_eq!(partial_targets(&completed_download), ["/local/dir/one.bin.part-job-4"]);
    }

    #[test]
    fn deleting_a_record_removes_staged_files_and_keeps_anything_else() {
        let root = std::env::temp_dir().join(format!("vrykell-staged-{}", uuid::Uuid::new_v4()));
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        let staged = nested.join("data.bin.part-job-1");
        std::fs::write(&staged, b"half").unwrap();
        let neighbor = nested.join("data.bin.part-other");
        std::fs::write(&neighbor, b"keep").unwrap();
        let directory_target = nested.join("taken.part-job-1");
        std::fs::create_dir(&directory_target).unwrap();
        let outside = std::env::temp_dir().join(format!("outside-{}.part-job-1", uuid::Uuid::new_v4()));
        std::fs::write(&outside, b"keep").unwrap();
        let never_opened = nested.join("never-opened.bin.part-job-1");
        let targets: Vec<String> = [&staged, &outside, &directory_target, &never_opened].iter()
            .map(|path| path.to_string_lossy().into_owned()).collect();
        discard_local_partials(&root, &targets).unwrap();
        assert!(!staged.exists());
        assert!(!never_opened.exists());
        assert!(neighbor.exists(), "a staged file of another job stays");
        assert!(outside.exists(), "paths outside the downloads root stay");
        assert!(directory_target.exists(), "non-regular entries are not staged files");
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_file(&outside).unwrap();
    }

    #[test]
    fn upload_cleanup_without_the_saved_destination_skips_the_remote_host() {
        let job = staged_job("job-5", "upload", Vec::new());
        assert!(discard_partials(&job, None).is_ok());
    }
}
