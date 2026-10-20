use crate::db::{HistoryState, SshConnection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::Path,
    time::Duration,
};
const LIMIT: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    path: String,
    connection_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorContent {
    kind: &'static str,
    text: String,
    revision: String,
    read_only: bool,
    permission_denied: bool,
}
fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn content(bytes: Vec<u8>) -> EditorContent {
    let version = revision(&bytes);
    let kind = if bytes.len() > LIMIT {
        "tooLarge"
    } else if bytes.contains(&0) {
        "binary"
    } else {
        "text"
    };
    match String::from_utf8(bytes).ok().filter(|_| kind == "text") {
        Some(text) => EditorContent {
            kind,
            text,
            revision: version,
            read_only: false,
            permission_denied: false,
        },
        None => EditorContent {
            kind: if kind == "tooLarge" { kind } else { "binary" },
            text: String::new(),
            revision: version,
            read_only: false,
            permission_denied: false,
        },
    }
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
    let (bytes, read_only, permission_denied) = if let Some(connection) = connection {
        let session =
            crate::remote::ssh::connect_with_timeout(&connection, Some(Duration::from_secs(5)))?;
        session.set_timeout(15_000);
        let sftp = session.sftp().map_err(|error| error.to_string())?;
        let path = Path::new(&target.path);
        let file = match sftp.open(path) {
            Ok(file) => file,
            Err(error) if error.code() == ssh2::ErrorCode::SFTP(3) => return Ok(denied_content()),
            Err(error) => return Err(error.to_string()),
        };
        let bytes = read_limited(file)?;
        let read_only = sftp.stat(path).ok().and_then(|stat| stat.perm).is_some_and(|mode| mode & 0o222 == 0);
        let denied = read_only || sftp.open_mode(path, ssh2::OpenFlags::WRITE, 0, ssh2::OpenType::File).is_err();
        (bytes, read_only || denied, denied)
    } else {
        let file = match std::fs::File::open(&target.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return Ok(denied_content()),
            Err(error) => return Err(error.to_string()),
        };
        let read_only = file.metadata().map_err(|error| error.to_string())?.permissions().readonly();
        let denied = !read_only && std::fs::OpenOptions::new().write(true).open(&target.path).is_err();
        (read_limited(file)?, read_only || denied, denied || (!cfg!(windows) && read_only))
    };
    let mut result = content(bytes);
    result.read_only = read_only;
    result.permission_denied = permission_denied;
    Ok(result)
}
fn denied_content() -> EditorContent {
    EditorContent { kind: "text", text: String::new(), revision: String::new(), read_only: true, permission_denied: true }
}
fn save_local(path: &Path, text: &str, expected: &str) -> Result<String, String> {
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
        file.write_all(text.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        drop(file);
        check_revision(
            &read_limited(std::fs::File::open(&path).map_err(|error| error.to_string())?)?,
            expected,
        )?;
        std::fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
        Ok(revision(text.as_bytes()))
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
    if let Some(connection) = connection {
        let session =
            crate::remote::ssh::connect_with_timeout(&connection, Some(Duration::from_secs(5)))?;
        session.set_timeout(15_000);
        let sftp = session.sftp().map_err(|error| error.to_string())?;
        let path = sftp
            .realpath(Path::new(&target.path))
            .map_err(|error| error.to_string())?;
        if sftp.stat(&path).ok().and_then(|stat| stat.perm).is_some_and(|mode| mode & 0o222 == 0)
            || sftp.open_mode(&path, ssh2::OpenFlags::WRITE, 0, ssh2::OpenType::File).is_err() {
            return Err("EDITOR_PERMISSION_DENIED: The remote file is read-only or requires elevated permissions.".into());
        }
        check_revision(
            &read_limited(sftp.open(&path).map_err(|error| error.to_string())?)?,
            &expected,
        )?;
        let temporary =
            path.with_file_name(format!(".vrykell-editor-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mode = sftp
                .stat(&path)
                .map_err(|error| error.to_string())?
                .perm
                .unwrap_or(0o600) as i32
                & 0o777;
            let mut file = sftp
                .open_mode(
                    &temporary,
                    ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::EXCLUSIVE,
                    mode,
                    ssh2::OpenType::File,
                )
                .map_err(|error| error.to_string())?;
            file.write_all(text.as_bytes())
                .and_then(|_| file.flush())
                .map_err(|error| error.to_string())?;
            drop(file);
            check_revision(
                &read_limited(sftp.open(&path).map_err(|error| error.to_string())?)?,
                &expected,
            )?;
            sftp.rename(
                &temporary,
                &path,
                Some(ssh2::RenameFlags::OVERWRITE | ssh2::RenameFlags::ATOMIC),
            )
            .map_err(|error| error.to_string())?;
            Ok(revision(text.as_bytes()))
        })();
        if result.is_err() {
            let _ = sftp.unlink(&temporary);
        }
        result
    } else {
        save_local(Path::new(&target.path), &text, &expected)
    }
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
    target: EditorFile,
    text: String,
    expected: String,
) -> Result<String, String> {
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
    fn reports_read_only_files_and_never_replaces_them_during_normal_save() {
        let path = std::env::temp_dir().join(format!("readonly-editor-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"protected content").unwrap();
        let original = std::fs::metadata(&path).unwrap().permissions();
        let mut protected = original.clone(); protected.set_readonly(true);
        std::fs::set_permissions(&path, protected).unwrap();
        let result = read_sync(EditorFile { path: path.to_string_lossy().into(), connection_id: None }, None).unwrap();
        assert!(result.read_only);
        assert_eq!(result.text, "protected content");
        assert!(save_local(&path, "changed", &result.revision).unwrap_err().contains("EDITOR_PERMISSION_DENIED:"));
        assert_eq!(std::fs::read(&path).unwrap(), b"protected content");
        std::fs::set_permissions(&path, original).unwrap();
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_binary_and_large_files_and_preserves_text_encoding() {
        assert_eq!(content(vec![0, 1]).kind, "binary");
        assert_eq!(content(vec![255]).kind, "binary");
        assert_eq!(content(vec![b'a'; LIMIT + 1]).kind, "tooLarge");
        assert_eq!(
            content("\u{feff}one\r\ntwo\r\n".as_bytes().to_vec()).text,
            "\u{feff}one\r\ntwo\r\n"
        );
    }
    #[test]
    fn saves_text_and_rejects_an_external_change_without_overwriting_it() {
        let path = std::env::temp_dir().join(format!("editor-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"original\r\n").unwrap();
        let first = revision(b"original\r\n");
        let next = save_local(&path, "updated\r\n", &first).unwrap();
        assert_eq!(next, revision(b"updated\r\n"));
        std::fs::write(&path, b"external").unwrap();
        assert!(save_local(&path, "draft", &next).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"external");
        std::fs::remove_file(path).unwrap();
    }
}
