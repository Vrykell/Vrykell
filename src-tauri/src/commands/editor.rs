use crate::db::{HistoryState, SshConnection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::Path,
};
const LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EditorEncoding {
    #[default]
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Gb18030,
    Gbk,
    Big5,
    Windows1252,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    path: String,
    connection_id: Option<String>,
    encoding: Option<EditorEncoding>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorContent {
    kind: &'static str,
    text: String,
    revision: String,
    read_only: bool,
    permission_denied: bool,
    encoding: EditorEncoding,
}
fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn detected_encoding(bytes: &[u8]) -> EditorEncoding {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        EditorEncoding::Utf8Bom
    } else if bytes.starts_with(&[0xff, 0xfe]) {
        EditorEncoding::Utf16Le
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        EditorEncoding::Utf16Be
    } else {
        EditorEncoding::Utf8
    }
}
fn legacy_encoding(encoding: EditorEncoding) -> Option<&'static encoding_rs::Encoding> {
    match encoding {
        EditorEncoding::Gb18030 => Some(encoding_rs::GB18030),
        EditorEncoding::Gbk => Some(encoding_rs::GBK),
        EditorEncoding::Big5 => Some(encoding_rs::BIG5),
        EditorEncoding::Windows1252 => Some(encoding_rs::WINDOWS_1252),
        _ => None,
    }
}
fn decode_text(bytes: &[u8], encoding: EditorEncoding) -> Result<String, String> {
    let invalid = || "The file contains invalid bytes for the selected encoding. Choose another encoding; no replacement characters were inserted.".to_string();
    let text = match encoding {
        EditorEncoding::Utf8 | EditorEncoding::Utf8Bom => {
            let body = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
            std::str::from_utf8(body).map_err(|_| invalid())?.to_string()
        }
        EditorEncoding::Utf16Le | EditorEncoding::Utf16Be => {
            let little_endian = encoding == EditorEncoding::Utf16Le;
            let prefix: &[u8] = if little_endian { &[0xff, 0xfe] } else { &[0xfe, 0xff] };
            let opposite: &[u8] = if little_endian { &[0xfe, 0xff] } else { &[0xff, 0xfe] };
            if bytes.starts_with(opposite) {
                return Err(invalid());
            }
            let body = bytes.strip_prefix(prefix).unwrap_or(bytes);
            if body.len() % 2 != 0 {
                return Err(invalid());
            }
            let units = body.chunks_exact(2).map(|pair| {
                let unit = [pair[0], pair[1]];
                if little_endian { u16::from_le_bytes(unit) } else { u16::from_be_bytes(unit) }
            }).collect::<Vec<_>>();
            String::from_utf16(&units).map_err(|_| invalid())?
        }
        _ => legacy_encoding(encoding).ok_or_else(invalid)?
            .decode_without_bom_handling_and_without_replacement(bytes)
            .ok_or_else(invalid)?.into_owned(),
    };
    if encoding == EditorEncoding::Gbk && encoding_rs::GBK.encode(&text).2 {
        return Err(invalid());
    }
    Ok(text)
}
fn encode_text(text: &str, encoding: EditorEncoding) -> Result<Vec<u8>, String> {
    let bytes = match encoding {
        EditorEncoding::Utf8 => text.as_bytes().to_vec(),
        EditorEncoding::Utf8Bom => {
            let mut bytes = vec![0xef, 0xbb, 0xbf];
            bytes.extend_from_slice(text.as_bytes());
            bytes
        }
        EditorEncoding::Utf16Le | EditorEncoding::Utf16Be => {
            let little_endian = encoding == EditorEncoding::Utf16Le;
            let mut bytes = if little_endian { vec![0xff, 0xfe] } else { vec![0xfe, 0xff] };
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&if little_endian { unit.to_le_bytes() } else { unit.to_be_bytes() });
            }
            bytes
        }
        _ => {
            let (bytes, _, had_errors) = legacy_encoding(encoding).ok_or("Unsupported editor encoding")?.encode(text);
            if had_errors {
                return Err("The selected encoding cannot represent all characters. Choose a Unicode encoding; the file has not been changed.".into());
            }
            bytes.into_owned()
        }
    };
    if bytes.len() > LIMIT {
        return Err("The file is too large for the embedded editor".into());
    }
    Ok(bytes)
}
fn content(bytes: Vec<u8>, requested: Option<EditorEncoding>) -> Result<EditorContent, String> {
    let version = revision(&bytes);
    let encoding = requested.unwrap_or_else(|| detected_encoding(&bytes));
    let mut result = EditorContent { kind: "text", text: String::new(), revision: version, read_only: false, permission_denied: false, encoding };
    if bytes.len() > LIMIT {
        result.kind = "tooLarge";
        return Ok(result);
    }
    match decode_text(&bytes, encoding) {
        Ok(text) if !text.contains('\0') => result.text = text,
        Ok(_) => result.kind = "binary",
        Err(_) if requested.is_none() && encoding == EditorEncoding::Utf8 => result.kind = "binary",
        Err(error) => return Err(error),
    }
    Ok(result)
}
fn connection(state: &HistoryState, target: &EditorFile) -> Result<Option<SshConnection>, String> {
    target
        .connection_id
        .as_ref()
        .map(|id| {
            state
                .0
                .lock()
                .map_err(|error| error.to_string())?
                .get_ssh_connection(id)
        })
        .transpose()
}
fn validate(target: &EditorFile) -> Result<(), String> {
    if target.path.contains('\0')
        || if target.connection_id.is_some() {
            !target.path.starts_with('/')
        } else {
            !Path::new(&target.path).is_absolute()
        }
    {
        return Err("The file path must be absolute".into());
    }
    Ok(())
}
fn read_limited(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}
/// SFTP status codes used by the editor's error classification.
const SFTP_PERMISSION_DENIED: i32 = 3;
/// The server refused to replace the destination without an explicit overwrite.
const SFTP_FILE_ALREADY_EXISTS: i32 = 11;
fn permission_denied_status(code: Option<i32>) -> bool {
    code == Some(SFTP_PERMISSION_DENIED)
}
fn rename_fallback_status(code: Option<i32>) -> bool {
    code == Some(SFTP_FILE_ALREADY_EXISTS)
}
/// Distinguishes a real permission failure from a missing file, a dropped connection or
/// any other transport error, so only the former locks the document read-only.
fn is_permission_denied(error: &ssh2::Error) -> bool {
    match error.code() {
        ssh2::ErrorCode::SFTP(code) => permission_denied_status(Some(code)),
        _ => false,
    }
}
fn rename_needs_fallback(error: &ssh2::Error) -> bool {
    match error.code() {
        ssh2::ErrorCode::SFTP(code) => rename_fallback_status(Some(code)),
        _ => false,
    }
}
/// The read already succeeded; a transient write probe must not turn the document read-only.
fn remote_writable(sftp: &ssh2::Sftp, path: &Path) -> bool {
    match sftp.open_mode(path, ssh2::OpenFlags::WRITE, 0, ssh2::OpenType::File) {
        Ok(_) => true,
        Err(error) if is_permission_denied(&error) => false,
        Err(_) => true,
    }
}
/// Remote paths are POSIX even when the desktop displays them through a Windows path.
fn remote_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
fn read_remote_bytes(sftp: &ssh2::Sftp, path: &Path) -> Result<Vec<u8>, String> {
    read_limited(sftp.open(path).map_err(|error| error.to_string())?)
}
fn check_revision(bytes: &[u8], expected: &str) -> Result<(), String> {
    if bytes.len() > LIMIT || revision(bytes) != expected {
        Err("The file changed on disk. Reload it before saving; your unsaved text is kept.".into())
    } else {
        Ok(())
    }
}
fn read_sync(
    target: EditorFile,
    connection: Option<SshConnection>,
) -> Result<EditorContent, String> {
    validate(&target)?;
    if let Some(connection) = connection {
        return crate::remote::file_channel::run(&connection, true, |_, sftp| read_remote(&target, sftp));
    }
    let file = match std::fs::File::open(&target.path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return Ok(denied_content()),
        Err(error) => return Err(error.to_string()),
    };
    let read_only = file.metadata().map_err(|error| error.to_string())?.permissions().readonly();
    let denied = !read_only && std::fs::OpenOptions::new().write(true).open(&target.path).is_err();
    let mut result = content(read_limited(file)?, target.encoding)?;
    result.read_only = read_only || denied;
    result.permission_denied = denied || (!cfg!(windows) && read_only);
    Ok(result)
}
/// Reads through the shared authenticated file channel; a permission failure keeps the
/// read-only notice while any other transport failure reaches the caller as an error.
fn read_remote(target: &EditorFile, sftp: &ssh2::Sftp) -> Result<EditorContent, String> {
    let path = Path::new(&target.path);
    let file = match sftp.open(path) {
        Ok(file) => file,
        Err(error) if is_permission_denied(&error) => return Ok(denied_content()),
        Err(error) => return Err(error.to_string()),
    };
    let bytes = read_limited(file)?;
    let read_only = sftp.stat(path).ok().and_then(|stat| stat.perm).is_some_and(|mode| mode & 0o222 == 0);
    let denied = read_only || !remote_writable(sftp, path);
    let mut result = content(bytes, target.encoding)?;
    result.read_only = read_only || denied;
    result.permission_denied = denied;
    Ok(result)
}
fn denied_content() -> EditorContent {
    EditorContent { kind: "text", text: String::new(), revision: String::new(), read_only: true, permission_denied: true, encoding: EditorEncoding::Utf8 }
}
fn save_local(path: &Path, bytes: &[u8], expected: &str) -> Result<String, String> {
    if expected == "new" {
        let parent = path.parent().ok_or("The destination needs a parent directory")?.canonicalize().map_err(|error| error.to_string())?;
        let destination = parent.join(path.file_name().ok_or("The destination needs a file name")?);
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&destination).map_err(|error| error.to_string())?;
        if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = std::fs::remove_file(&destination);
            return Err(error.to_string());
        }
        return Ok(revision(bytes));
    }
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    if std::fs::metadata(&path).map_err(|error| error.to_string())?.permissions().readonly()
        || std::fs::OpenOptions::new().write(true).open(&path).is_err() {
        return Err("EDITOR_PERMISSION_DENIED: The file is read-only or requires elevated permissions.".into());
    }
    let before = read_limited(std::fs::File::open(&path).map_err(|error| error.to_string())?)?;
    check_revision(&before, expected)?;
    let temporary = path.with_file_name(format!(".vrykell-editor-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        std::fs::set_permissions(
            &temporary,
            std::fs::metadata(&path)
                .map_err(|error| error.to_string())?
                .permissions(),
        )
        .map_err(|error| error.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        drop(file);
        check_revision(
            &read_limited(std::fs::File::open(&path).map_err(|error| error.to_string())?)?,
            expected,
        )?;
        std::fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
        Ok(revision(bytes))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}
fn save_sync(
    target: EditorFile,
    connection: Option<SshConnection>,
    text: String,
    expected: String,
) -> Result<String, String> {
    validate(&target)?;
    if text.len() > LIMIT {
        return Err("The file is too large for the embedded editor".into());
    }
    let bytes = encode_text(&text, target.encoding.unwrap_or_default())?;
    if let Some(connection) = connection {
        return crate::remote::file_channel::run(&connection, false, |_, sftp| {
            save_remote(&target, sftp, &bytes, &expected)
        });
    }
    save_local(Path::new(&target.path), &bytes, &expected)
}
/// Replaces the original without leaving it half-written. Servers that refuse to
/// overwrite keep the original in a backup while the new file is installed.
fn replace_remote(
    sftp: &ssh2::Sftp,
    temporary: &Path,
    path: &Path,
    expected: &str,
    bytes: &[u8],
    connection_id: Option<&str>,
) -> Result<(), String> {
    match sftp.rename(
        temporary,
        path,
        Some(ssh2::RenameFlags::OVERWRITE | ssh2::RenameFlags::ATOMIC),
    ) {
        Ok(()) => return Ok(()),
        Err(error) if rename_needs_fallback(&error) => {}
        Err(error) => return Err(error.to_string()),
    }
    let backup = path.with_file_name(format!(".vrykell-editor-{}.bak", uuid::Uuid::new_v4()));
    if let Err(error) = sftp.rename(path, &backup, Some(ssh2::RenameFlags::empty())) {
        // A lost status reply can hide a successful move: inspect both paths before
        // deciding whether the original is still in place.
        let backup_exists = sftp.stat(&backup).is_ok();
        let path_exists = sftp.stat(path).is_ok();
        if !(backup_exists && !path_exists) {
            if !backup_exists && path_exists {
                return Err(format!(
                    "The remote server could not replace the file and the original was not moved: {error}"
                ));
            }
            return Err(format!(
                "The remote server could not confirm the original backup ({error}); verify {} and {} before retrying.",
                remote_path(path),
                remote_path(&backup)
            ));
        }
    }
    // Re-check the moved original: another writer may have changed it after the
    // pre-save check. A mismatch restores the backup and keeps the draft.
    let moved = read_remote_bytes(sftp, &backup).map_err(|error| {
        format!(
            "The original was moved to {}, but it could not be read back ({error}); it has not been replaced.",
            remote_path(&backup)
        )
    })?;
    if revision(&moved) != expected {
        if sftp.stat(path).is_ok() {
            return Err(format!(
                "The file changed on disk and a new file already exists at {}; the original is kept at {}.",
                remote_path(path),
                remote_path(&backup)
            ));
        }
        return match sftp.rename(&backup, path, Some(ssh2::RenameFlags::empty())) {
            Ok(()) => Err("The file changed on disk. Reload it before saving; your unsaved text is kept.".into()),
            Err(restore) => Err(format!(
                "The file changed on disk and the original could not be restored ({restore}); it is kept at {}.",
                remote_path(&backup)
            )),
        };
    }
    match sftp.rename(temporary, path, Some(ssh2::RenameFlags::empty())) {
        Ok(()) => {
            if sftp.unlink(&backup).is_err() {
                let _ = crate::diagnostics::record("editor-remote-backup", serde_json::json!({
                    "connectionId": connection_id, "succeeded": false,
                }));
            }
            Ok(())
        }
        Err(error) => {
            // The install may have succeeded before the status reply was lost. Only
            // treat it as success when the installed bytes match the buffer.
            if read_remote_bytes(sftp, path).ok().as_deref() == Some(bytes) {
                let _ = sftp.unlink(&backup);
                return Ok(());
            }
            // Never restore the backup over a path that exists: it may be a
            // concurrent write. Restore only when the destination is absent.
            if sftp.stat(path).is_ok() {
                return Err(format!(
                    "The remote file may have been replaced ({error}); the original is kept at {}. Verify the file before retrying.",
                    remote_path(&backup)
                ));
            }
            if let Err(restore) = sftp.rename(&backup, path, Some(ssh2::RenameFlags::empty())) {
                return Err(format!(
                    "The remote file could not be replaced ({error}); the original is kept at {}. Restore it manually; the restore failed too: {restore}",
                    remote_path(&backup)
                ));
            }
            Err(format!("The remote server could not replace the file: {error}"))
        }
    }
}
fn save_remote(
    target: &EditorFile,
    sftp: &ssh2::Sftp,
    bytes: &[u8],
    expected: &str,
) -> Result<String, String> {
    let path = sftp
        .realpath(Path::new(&target.path))
        .map_err(|error| error.to_string())?;
    let original = sftp
        .stat(&path)
        .map_err(|error| format!("Could not read the remote file metadata: {error}"))?;
    let mode = original.perm.map(|perm| perm & 0o777);
    if mode.is_some_and(|mode| mode & 0o222 == 0) {
        return Err("EDITOR_PERMISSION_DENIED: The remote file is read-only or requires elevated permissions.".into());
    }
    match sftp.open_mode(&path, ssh2::OpenFlags::WRITE, 0, ssh2::OpenType::File) {
        Ok(_) => {}
        Err(error) if is_permission_denied(&error) => {
            return Err("EDITOR_PERMISSION_DENIED: The remote file is read-only or requires elevated permissions.".into());
        }
        // A missing file, a dropped connection or a full disk is not a permission problem:
        // returning the real error keeps the document editable for a retry.
        Err(error) => return Err(format!("Could not open the remote file for writing: {error}")),
    }
    check_revision(&read_remote_bytes(sftp, &path)?, expected)?;
    let temporary = path.with_file_name(format!(".vrykell-editor-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = match sftp.open_mode(
            &temporary,
            ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::EXCLUSIVE,
            mode.unwrap_or(0o600) as i32,
            ssh2::OpenType::File,
        ) {
            Ok(file) => file,
            Err(error) if is_permission_denied(&error) => {
                return Err("Saving in place is not possible because the remote directory is not writable. Use Save As or the elevated terminal to edit this file.".into());
            }
            Err(error) => return Err(format!("Could not create a temporary file next to the remote file: {error}")),
        };
        file.write_all(bytes).map_err(|error| error.to_string())?;
        // `sftp::File::flush` is a no-op; close flushes buffered writes and reports
        // delayed server-side errors that must abort the replacement.
        file.close().map_err(|error| error.to_string())?;
        // The mode passed to open is subject to the server umask; restore the exact mode
        // after the content exists. Servers without setstat keep their previous behaviour.
        if let Some(mode) = mode {
            if sftp.setstat(
                &temporary,
                ssh2::FileStat {
                    size: None, uid: None, gid: None,
                    perm: Some(mode), atime: None, mtime: None,
                },
            ).is_err() {
                let _ = crate::diagnostics::record("editor-remote-mode", serde_json::json!({
                    "connectionId": target.connection_id.clone(), "succeeded": false,
                }));
            }
        }
        check_revision(&read_remote_bytes(sftp, &path)?, expected)?;
        replace_remote(
            sftp,
            &temporary,
            &path,
            expected,
            bytes,
            target.connection_id.as_deref(),
        )?;
        Ok(revision(bytes))
    })();
    if result.is_err() {
        let _ = sftp.unlink(&temporary);
    }
    result
}
#[tauri::command]
pub async fn editor_read_file(
    state: tauri::State<'_, HistoryState>,
    target: EditorFile,
) -> Result<EditorContent, String> {
    let connection = connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || read_sync(target, connection))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn editor_save_file(
    state: tauri::State<'_, HistoryState>,
    grants: tauri::State<'_, crate::files::grants::PathGrants>,
    target: EditorFile,
    text: String,
    expected: String,
) -> Result<String, String> {
    if expected == "new" && (target.connection_id.is_some() || !grants.allows(Path::new(&target.path))) {
        return Err("Choose the destination with the save dialog before creating a file.".into());
    }
    let connection = connection(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || save_sync(target, connection, text, expected))
        .await
        .map_err(|error| error.to_string())?
}

/// Open the local system text editor through the operating system's elevation prompt.
#[tauri::command]
pub async fn editor_open_elevated(target: EditorFile) -> Result<(), String> {
    validate(&target)?;
    if target.connection_id.is_some() { return Err("Use the remote terminal for elevated editing.".into()); }
    let path = std::fs::canonicalize(&target.path).map_err(|error| error.to_string())?;
    if !path.is_file() { return Err("The target must be a file.".into()); }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "shell32")]
        extern "system" { fn ShellExecuteW(window: *mut std::ffi::c_void, verb: *const u16, file: *const u16, arguments: *const u16, directory: *const u16, show: i32) -> isize; }
        let wide = |value: &std::ffi::OsStr| value.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
        #[link(name = "kernel32")]
        extern "system" { fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32; }
        let mut directory = vec![0u16; 32768];
        let length = unsafe { GetSystemDirectoryW(directory.as_mut_ptr(), directory.len() as u32) } as usize;
        if length == 0 || length >= directory.len() { return Err("Could not locate the system editor.".into()); }
        directory.truncate(length);
        let mut editor = directory;
        editor.extend("\\notepad.exe".encode_utf16());
        editor.push(0);
        let verb = wide(std::ffi::OsStr::new("runas"));
        let arguments = wide(std::ffi::OsStr::new(&format!("\"{}\"", path.display())));
        let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), editor.as_ptr(), arguments.as_ptr(), std::ptr::null(), 1) };
        if result <= 32 { return Err("The elevated editor could not be opened or the request was cancelled.".into()); }
        Ok(())
    }
    #[cfg(not(windows))]
    { let _ = path; Err("Use the terminal for elevated editing.".into()) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_sftp_permission_status_locks_a_document_read_only() {
        assert!(permission_denied_status(Some(SFTP_PERMISSION_DENIED)));
        assert!(!permission_denied_status(Some(2)));
        assert!(!permission_denied_status(Some(4)));
        assert!(!permission_denied_status(None));
    }

    #[test]
    fn only_non_overwriting_renames_use_the_backup_path() {
        assert!(rename_fallback_status(Some(SFTP_FILE_ALREADY_EXISTS)));
        assert!(!rename_fallback_status(Some(SFTP_PERMISSION_DENIED)));
        assert!(!rename_fallback_status(Some(8)));
        assert!(!rename_fallback_status(Some(2)));
        assert!(!rename_fallback_status(None));
    }

    #[test]
    fn error_classification_uses_the_sftp_status_code() {
        let denied = ssh2::Error::new(ssh2::ErrorCode::SFTP(SFTP_PERMISSION_DENIED), "denied");
        let missing = ssh2::Error::new(ssh2::ErrorCode::SFTP(2), "missing");
        let unsupported = ssh2::Error::new(ssh2::ErrorCode::SFTP(8), "unsupported");
        let exists = ssh2::Error::new(ssh2::ErrorCode::SFTP(SFTP_FILE_ALREADY_EXISTS), "exists");
        let transport = ssh2::Error::new(ssh2::ErrorCode::Session(-1), "transport");
        assert!(is_permission_denied(&denied));
        assert!(!is_permission_denied(&missing));
        assert!(!is_permission_denied(&transport));
        assert!(rename_needs_fallback(&exists));
        assert!(!rename_needs_fallback(&unsupported));
        assert!(!rename_needs_fallback(&denied));
        assert!(!rename_needs_fallback(&transport));
    }

    #[test]
    fn new_documents_create_exclusively_and_never_replace_existing_destinations() {
        let path = std::env::temp_dir().join(format!("new-editor-{}.txt", uuid::Uuid::new_v4()));
        let version = save_local(&path, b"new document", "new").unwrap();
        assert_eq!(version, revision(b"new document"));
        assert!(save_local(&path, b"unexpected replacement", "new").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"new document");
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn reports_read_only_files_and_never_replaces_them_during_normal_save() {
        let path = std::env::temp_dir().join(format!("readonly-editor-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"protected content").unwrap();
        let original = std::fs::metadata(&path).unwrap().permissions();
        let mut protected = original.clone(); protected.set_readonly(true);
        std::fs::set_permissions(&path, protected).unwrap();
        let result = read_sync(EditorFile { path: path.to_string_lossy().into(), connection_id: None, encoding: None }, None).unwrap();
        assert!(result.read_only);
        assert_eq!(result.text, "protected content");
        assert!(save_local(&path, b"changed", &result.revision).unwrap_err().contains("EDITOR_PERMISSION_DENIED:"));
        assert_eq!(std::fs::read(&path).unwrap(), b"protected content");
        std::fs::set_permissions(&path, original).unwrap();
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_binary_and_large_files_and_preserves_text_encoding() {
        assert_eq!(content(vec![0, 1], None).unwrap().kind, "binary");
        assert_eq!(content(vec![255], None).unwrap().kind, "binary");
        assert_eq!(content(vec![b'a'; LIMIT + 1], None).unwrap().kind, "tooLarge");
        assert_eq!(
            content("\u{feff}one\r\ntwo\r\n".as_bytes().to_vec(), None).unwrap().text,
            "one\r\ntwo\r\n"
        );
    }
    #[test]
    fn saves_text_and_rejects_an_external_change_without_overwriting_it() {
        let path = std::env::temp_dir().join(format!("editor-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"original\r\n").unwrap();
        let first = revision(b"original\r\n");
        let next = save_local(&path, b"updated\r\n", &first).unwrap();
        assert_eq!(next, revision(b"updated\r\n"));
        std::fs::write(&path, b"external").unwrap();
        assert!(save_local(&path, b"draft", &next).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"external");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn encodings_round_trip_without_replacement_and_keep_byte_revisions() {
        for encoding in [EditorEncoding::Utf8, EditorEncoding::Utf8Bom, EditorEncoding::Utf16Le, EditorEncoding::Utf16Be, EditorEncoding::Gb18030, EditorEncoding::Gbk, EditorEncoding::Big5] {
            let text = "Hello \u{4e2d}\u{6587}\r\n";
            let bytes = encode_text(text, encoding).unwrap();
            let read = content(bytes.clone(), Some(encoding)).unwrap();
            assert_eq!(read.text, text);
            assert_eq!(read.revision, revision(&bytes));
            assert_eq!(read.encoding, encoding);
        }
        assert_eq!(decode_text(&encode_text("caf\u{e9}", EditorEncoding::Windows1252).unwrap(), EditorEncoding::Windows1252).unwrap(), "caf\u{e9}");
        assert!(encode_text("\u{4e2d}", EditorEncoding::Windows1252).is_err());
        assert!(decode_text(&[0xff], EditorEncoding::Utf8).is_err());
        assert!(decode_text(&[0xd8, 0], EditorEncoding::Utf16Be).is_err());
    }
}
