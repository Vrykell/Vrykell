use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
pub struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_symlink: bool,
}

/// List directory contents (directories first, sorted by name). Uses HOME when path is empty.
fn fs_list_sync(path: Option<String>) -> Result<Vec<FsEntry>, String> {
    let dir = path
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| "/".to_string());
    let mut entries = Vec::new();
    let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
        let p = entry.path();
        entries.push(FsEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: p.is_dir(),
            is_symlink: entry.file_type().map(|kind| kind.is_symlink()).unwrap_or(true),
            path: p.to_string_lossy().to_string(),
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command]
pub async fn fs_list(path: Option<String>) -> Result<Vec<FsEntry>, String> {
    // Keep disk I/O off the main thread (a synchronous command runs on the main thread, so a huge directory would freeze the UI)
    tauri::async_runtime::spawn_blocking(move || fs_list_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

/// Disk entry for the cards in the "This PC" view: name, path and capacity.
#[derive(Clone, Serialize)]
pub struct DiskEntry {
    pub name: String,
    pub path: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// Free and total disk capacity in bytes. Returns (0, 0) when unavailable (the frontend hides the capacity bar).
#[cfg(unix)]
fn disk_space(path: &str) -> (u64, u64) {
    use std::ffi::CString;
    let Ok(c) = CString::new(path) else { return (0, 0) };
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return (0, 0);
    }
    let frsize = if st.f_frsize > 0 { st.f_frsize as u64 } else { st.f_bsize as u64 };
    (
        (st.f_blocks as u64).saturating_mul(frsize),
        (st.f_bavail as u64).saturating_mul(frsize),
    )
}

/// Drive capacity on Windows (GetDiskFreeSpaceExW).
#[cfg(target_os = "windows")]
fn disk_space(path: &str) -> (u64, u64) {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::fileapi::GetDiskFreeSpaceExW;
    use winapi::um::winnt::ULARGE_INTEGER;
    let wide: Vec<u16> = std::ffi::OsStr::new(path).encode_wide().chain(Some(0)).collect();
    let mut free_bytes_to_caller = ULARGE_INTEGER::default();
    let mut total_bytes = ULARGE_INTEGER::default();
    let mut total_free_bytes = ULARGE_INTEGER::default();
    unsafe {
        GetDiskFreeSpaceExW(wide.as_ptr(), &mut free_bytes_to_caller, &mut total_bytes, &mut total_free_bytes);
    }
    unsafe { (*total_bytes.QuadPart(), *free_bytes_to_caller.QuadPart()) }
}

/// List disks (the "This PC" view shows one card per disk):
/// - macOS: the root volume (/, named after the system disk under /Volumes) plus other mounted volumes under /Volumes
/// - Windows: drive letters that exist (C:, D:, ...)
/// - Other Unix: only the root /
fn fs_disks_sync() -> Result<Vec<DiskEntry>, String> {
    let mut disks = Vec::new();
    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            if std::path::Path::new(&drive).exists() {
                let (total_bytes, free_bytes) = disk_space(&drive);
                disks.push(DiskEntry {
                    name: format!("{}:", letter as char),
                    path: drive,
                    total_bytes,
                    free_bytes,
                });
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        // Root volume display name: the /Volumes entry that points at / (for example Macintosh HD)
        let root_name = std::fs::read_dir("/Volumes")
            .ok()
            .and_then(|rd| {
                rd.flatten().find_map(|e| {
                    let ok = std::fs::canonicalize(e.path())
                        .map(|t| t == std::path::Path::new("/"))
                        .unwrap_or(false);
                    ok.then(|| e.file_name().to_string_lossy().to_string())
                })
            })
            .unwrap_or_else(|| "磁盘".to_string());
        let (total_bytes, free_bytes) = disk_space("/");
        disks.push(DiskEntry { name: root_name, path: "/".into(), total_bytes, free_bytes });
        // Other mounted volumes
        if let Ok(rd) = std::fs::read_dir("/Volumes") {
            for entry in rd.flatten() {
                let path = entry.path();
                let is_root = std::fs::canonicalize(&path)
                    .map(|t| t == std::path::Path::new("/"))
                    .unwrap_or(false);
                if is_root {
                    continue;
                }
                let p = path.to_string_lossy().to_string();
                let (total_bytes, free_bytes) = disk_space(&p);
                disks.push(DiskEntry { name: entry.file_name().to_string_lossy().to_string(), path: p, total_bytes, free_bytes });
            }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let (total_bytes, free_bytes) = disk_space("/");
        disks.push(DiskEntry { name: "磁盘".into(), path: "/".into(), total_bytes, free_bytes });
    }
    Ok(disks)
}

#[tauri::command]
pub async fn fs_disks() -> Result<Vec<DiskEntry>, String> {
    tauri::async_runtime::spawn_blocking(fs_disks_sync)
        .await
        .map_err(|e| e.to_string())?
}

/// Return the user's home directory path (used by the file panel's home shortcut).
#[tauri::command]
pub fn fs_home() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .or_else(|| std::env::var("HOME").ok())
        .ok_or_else(|| "无法定位用户主目录".to_string())
}

/// Whether a program resolves on this machine's PATH. The ACP settings and launcher use it to tell
/// a preset whose program is missing from one that is ready, before the user presses anything.
#[tauri::command]
pub async fn which_cmd(cmd: String) -> Result<bool, String> {
    // Resolution starts a login shell, which blocks; keep it off the event loop.
    tokio::task::spawn_blocking(move || which_cmd_sync(cmd))
        .await
        .map_err(|error| format!("could not look up the command: {error}"))?
}

/// Metadata for one path, used by the path bar (file vs directory) and the
/// properties dialog. Times are Unix milliseconds; unavailable times stay None.
#[derive(Clone, Serialize)]
pub struct FsStat {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub created_ms: Option<u64>,
    pub modified_ms: Option<u64>,
}

/// Milliseconds since the Unix epoch for a metadata time; unsupported values stay None.
fn time_ms(value: std::io::Result<std::time::SystemTime>) -> Option<u64> {
    value
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64)
}

/// Read one path's metadata; a symlink reports its target (dangling links fall back
/// to the link itself). Directory size is not summed: it is reported as 0.
fn fs_stat_sync(path: String) -> Result<FsStat, String> {
    let target = std::path::PathBuf::from(&path);
    let link_meta = std::fs::symlink_metadata(&target).map_err(|e| format!("{path}: {e}"))?;
    let is_symlink = link_meta.file_type().is_symlink();
    let meta = if is_symlink {
        std::fs::metadata(&target).unwrap_or(link_meta)
    } else {
        link_meta
    };
    let name = target
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    Ok(FsStat {
        name,
        path,
        is_dir: meta.is_dir(),
        is_symlink,
        size: if meta.is_dir() { 0 } else { meta.len() },
        created_ms: time_ms(meta.created()),
        modified_ms: time_ms(meta.modified()),
    })
}

#[tauri::command]
pub async fn fs_stat(path: String) -> Result<FsStat, String> {
    tauri::async_runtime::spawn_blocking(move || fs_stat_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

/// Rename a local file or directory: old_path to new_name in the same directory.
/// When the target name is taken, append an increasing `name (1)` suffix (never overwrite) and return the final path.
fn fs_rename_sync(old_path: String, new_name: String) -> Result<String, String> {
    // Require new_name to be a single path component so `/`, `..` and similar cannot escape the parent directory
    let np = std::path::Path::new(&new_name);
    if new_name.is_empty()
        || np.components().count() != 1
        || matches!(np.components().next(), Some(std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)))
    {
        return Err("非法文件名".to_string());
    }
    let old = std::path::PathBuf::from(&old_path);
    let parent = old.parent().ok_or("无法定位父目录")?;
    let candidate = parent.join(&new_name);
    let new_path = if candidate.exists() && candidate != old {
        unique_path(parent, &new_name)
    } else {
        candidate
    };
    std::fs::rename(&old, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

/// Find a free path for name in a directory: on collision, try `name (1)`, `name (2)`, ... (keeping the extension).
fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let stem = std::path::Path::new(name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let extension = std::path::Path::new(name)
        .extension()
        .map(|value| value.to_string_lossy().to_string());
    for index in 1..10_000u32 {
        let candidate = match &extension {
            Some(ext) => format!("{stem} ({index}).{ext}"),
            None => format!("{stem} ({index})"),
        };
        let path = dir.join(candidate);
        if !path.exists() {
            return path;
        }
    }
    dir.join(format!("{stem} ({})", uuid::Uuid::new_v4()))
}

/// Create a local file (empty) or folder; append a number on collision and return the final path.
fn fs_create_sync(dir: String, name: String, is_dir: bool) -> Result<String, String> {
    let np = std::path::Path::new(&name);
    if name.is_empty()
        || np.components().count() != 1
        || matches!(np.components().next(), Some(std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)))
    {
        return Err("非法文件名".to_string());
    }
    let parent = std::path::PathBuf::from(&dir);
    if !parent.is_dir() {
        return Err(format!("目标目录不可用：{dir}"));
    }
    let path = {
        let direct = parent.join(&name);
        if direct.exists() {
            // On collision, append name (1), name (2), ... (unique_path is only called when the name exists)
            unique_path(&parent, &name)
        } else {
            direct
        }
    };
    if is_dir {
        std::fs::create_dir(&path).map_err(|e| format!("新建文件夹失败：{e}"))?;
    } else {
        std::fs::File::create(&path).map_err(|e| format!("新建文件失败：{e}"))?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn fs_rename(old_path: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs_rename_sync(old_path, new_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_create_file(dir: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs_create_sync(dir, name, false))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_create_dir(dir: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs_create_sync(dir, name, true))
        .await
        .map_err(|e| e.to_string())?
}

// ── File operations and undo: copy / move / reversible delete ──
//
// Deletion no longer goes straight to the system trash: items are first moved to ~/.vrykell/undo.
// The frontend's "More → Undo delete" moves them back; staged items go to the system trash on the
// next file operation or app start, so deletion still means "moved to trash", with a short undo window.

/// One completed from→to pair (the frontend uses it to record the undo).
#[derive(Clone, Serialize, Deserialize)]
pub struct FileOpPair {
    pub from: String,
    pub to: String,
}

/// Result of a batch file operation: completed items plus failure messages (one failure does not stop the rest).
#[derive(Clone, Serialize)]
pub struct FileOpOutcome {
    pub completed: Vec<FileOpPair>,
    pub errors: Vec<String>,
}

fn file_name_of(path: &std::path::Path) -> Result<String, String> {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| format!("无法定位 {} 的文件名", path.display()))
}

/// Whether the error means a cross-device move (which must fall back to copy plus source removal).
fn is_cross_device(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    {
        error.raw_os_error() == Some(18) // EXDEV
    }
    #[cfg(windows)]
    {
        error.raw_os_error() == Some(17) // ERROR_NOT_SAME_DEVICE
    }
}

#[cfg(unix)]
fn copy_symlink(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    let target = std::fs::read_link(from).map_err(|e| format!("读取符号链接失败: {e}"))?;
    std::os::unix::fs::symlink(target, to).map_err(|e| format!("复制符号链接失败: {e}"))
}

#[cfg(windows)]
fn copy_symlink(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    let target = std::fs::read_link(from).map_err(|e| format!("读取符号链接失败: {e}"))?;
    let target_is_dir = std::fs::metadata(from).map(|m| m.is_dir()).unwrap_or(false);
    let created = if target_is_dir {
        std::os::windows::fs::symlink_dir(&target, to)
    } else {
        std::os::windows::fs::symlink_file(&target, to)
    };
    created.map_err(|e| format!("复制符号链接失败: {e}"))
}

/// Copy one path: directories recursively, symbolic links as links (not followed, to avoid cycles).
fn copy_entry(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(from).map_err(|e| format!("无法读取 {}: {e}", from.display()))?;
    if meta.file_type().is_symlink() {
        return copy_symlink(from, to);
    }
    if meta.is_dir() {
        std::fs::create_dir_all(to).map_err(|e| format!("创建 {} 失败: {e}", to.display()))?;
        let rd = std::fs::read_dir(from).map_err(|e| format!("读取 {} 失败: {e}", from.display()))?;
        for entry in rd {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_entry(&entry.path(), &to.join(entry.file_name()))?;
        }
        return Ok(());
    }
    std::fs::copy(from, to).map(|_| ()).map_err(|e| format!("复制 {} 失败: {e}", from.display()))
}

/// Remove one path (directories recursively; a symbolic link removes only the link, not its target).
#[cfg(unix)]
fn remove_entry(path: &std::path::Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("无法读取 {}: {e}", path.display()))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| format!("删除 {} 失败: {e}", path.display()))
    } else {
        std::fs::remove_file(path).map_err(|e| format!("删除 {} 失败: {e}", path.display()))
    }
}

#[cfg(windows)]
fn remove_entry(path: &std::path::Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("无法读取 {}: {e}", path.display()))?;
    let link_to_dir = meta.file_type().is_symlink()
        && std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false);
    if link_to_dir {
        std::fs::remove_dir(path).map_err(|e| format!("删除 {} 失败: {e}", path.display()))
    } else if meta.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| format!("删除 {} 失败: {e}", path.display()))
    } else {
        std::fs::remove_file(path).map_err(|e| format!("删除 {} 失败: {e}", path.display()))
    }
}

/// Move within a device, or copy before removing the source across devices.
/// Source removal can partially succeed, so its complete destination copy must survive errors.
fn move_entry(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(error) if is_cross_device(&error) => {
            copy_entry(from, to)?;
            finish_cross_device_move(from, to, remove_entry)
        }
        Err(error) => Err(format!("移动 {} 失败: {error}", from.display())),
    }
}

fn finish_cross_device_move(
    from: &std::path::Path,
    to: &std::path::Path,
    remove_source: impl FnOnce(&std::path::Path) -> Result<(), String>,
) -> Result<(), String> {
    remove_source(from).map_err(|error| format!(
        "Source cleanup failed. The complete copy is preserved at {}: {error}", to.display()
    ))
}

/// Validate and resolve the source to a destination path: refuse to put a directory inside itself; add a number on name collisions.
fn resolve_dest(from: &std::path::Path, dest_dir: &std::path::Path, copy: bool) -> Result<std::path::PathBuf, String> {
    let name = file_name_of(from)?;
    let meta = std::fs::symlink_metadata(from).map_err(|e| format!("无法读取 {}: {e}", from.display()))?;
    let is_real_dir = meta.is_dir() && !meta.file_type().is_symlink();
    if is_real_dir {
        let src = std::fs::canonicalize(from).map_err(|e| format!("无法解析 {}: {e}", from.display()))?;
        let dst = std::fs::canonicalize(dest_dir).map_err(|e| format!("无法解析 {}: {e}", dest_dir.display()))?;
        if dst.starts_with(&src) {
            return Err(format!("不能把「{name}」放入它自己内部"));
        }
    }
    let direct = dest_dir.join(&name);
    if direct == from {
        if !copy {
            return Err(format!("「{name}」已在目标目录中"));
        }
        // Copying into its own directory: create a "name (1)" duplicate
        return Ok(unique_path(dest_dir, &name));
    }
    if direct.exists() {
        return Ok(unique_path(dest_dir, &name));
    }
    Ok(direct)
}

fn fs_transfer_sync(paths: Vec<String>, dest_dir: String, copy: bool) -> Result<FileOpOutcome, String> {
    let dest_dir = std::path::PathBuf::from(&dest_dir);
    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        let from = std::path::PathBuf::from(&path);
        let outcome = resolve_dest(&from, &dest_dir, copy).and_then(|dest| {
            let result = if copy { copy_entry(&from, &dest) } else { move_entry(&from, &dest) };
            result.map(|()| dest)
        });
        match outcome {
            Ok(dest) => completed.push(FileOpPair { from: path, to: dest.to_string_lossy().to_string() }),
            Err(error) => errors.push(error),
        }
    }
    Ok(FileOpOutcome { completed, errors })
}

fn undo_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or("无法定位主目录")?
        .join(".vrykell")
        .join("undo");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建暂存目录: {e}"))?;
    Ok(dir)
}

/// Move items to delete into the staging directory (returns original→staged pairs for undo).
fn stage_delete_into(dir: &std::path::Path, paths: Vec<String>) -> Result<FileOpOutcome, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建暂存目录: {e}"))?;
    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        let from = std::path::PathBuf::from(&path);
        let result = file_name_of(&from).and_then(|name| {
            let staged = dir.join(format!("{}-{}", uuid::Uuid::new_v4(), name));
            move_entry(&from, &staged).map(|()| staged)
        });
        match result {
            Ok(staged) => completed.push(FileOpPair { from: path, to: staged.to_string_lossy().to_string() }),
            Err(error) => errors.push(error),
        }
    }
    Ok(FileOpOutcome { completed, errors })
}

/// Undo a delete: move staged items back to their original paths (skip and report an error if the name is taken).
fn restore_staged_sync(items: Vec<FileOpPair>) -> Result<FileOpOutcome, String> {
    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for item in items {
        let staged = std::path::PathBuf::from(&item.to);
        let original = std::path::PathBuf::from(&item.from);
        if original.exists() {
            errors.push(format!("恢复失败：{} 已存在同名项", original.display()));
            continue;
        }
        let prepared = original
            .parent()
            .map(|parent| std::fs::create_dir_all(parent).map_err(|e| format!("无法创建 {}: {e}", parent.display())))
            .unwrap_or(Ok(()))
            .and_then(|()| move_entry(&staged, &original));
        match prepared {
            Ok(()) => completed.push(FileOpPair { from: item.from, to: item.to }),
            Err(error) => errors.push(error),
        }
    }
    Ok(FileOpOutcome { completed, errors })
}

/// Send staged items to the system trash (finishing the delete on the next file operation or app start). A single failure does not block the rest.
fn purge_staged(paths: Vec<String>) {
    for path in paths {
        let _ = trash::delete(&path);
    }
}

/// On startup, clear staged items left from the previous session: the user already deleted them, they just never reached the trash.
pub fn sweep_undo_dir() {
    let Some(home) = dirs::home_dir() else { return };
    let dir = home.join(".vrykell").join("undo");
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let _ = trash::delete(entry.path());
        }
    }
}

#[tauri::command]
pub async fn fs_copy(paths: Vec<String>, dest_dir: String) -> Result<FileOpOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || fs_transfer_sync(paths, dest_dir, true))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_move(paths: Vec<String>, dest_dir: String) -> Result<FileOpOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || fs_transfer_sync(paths, dest_dir, false))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_stage_delete(paths: Vec<String>, undo_enabled: Option<bool>) -> Result<FileOpOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if undo_enabled == Some(false) {
            let mut completed = Vec::new();
            let mut errors = Vec::new();
            for path in paths {
                match trash::delete(&path) {
                    Ok(()) => completed.push(FileOpPair { from: path, to: String::new() }),
                    Err(error) => errors.push(error.to_string()),
                }
            }
            return Ok(FileOpOutcome { completed, errors });
        }
        let dir = undo_dir()?;
        stage_delete_into(&dir, paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_restore_staged(items: Vec<FileOpPair>) -> Result<FileOpOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || restore_staged_sync(items))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_purge_staged(paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || purge_staged(paths))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Check whether a command is available (user PATH is resolved through a login shell, because a GUI
/// process PATH often misses custom commands such as code). Only simple command names (alphanumerics
/// plus -._+) are accepted; anything else is treated as unavailable.
pub(crate) fn which_cmd_sync(cmd: String) -> Result<bool, String> {
    if cmd.is_empty()
        || !cmd
            .chars()
            .all(|c| c.is_alphanumeric() || "-._+".contains(c))
    {
        return Ok(false);
    }
    // Windows uses where.exe; Unix uses /bin/sh (not a hardcoded zsh, so environments without
    // zsh, such as minimal Linux images or containers, can still resolve the user PATH)
    #[cfg(windows)]
    let out = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("where.exe")
            .arg(&cmd)
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?
    };
    #[cfg(not(windows))]
    let out = std::process::Command::new("/bin/sh")
        .args(["-lc", &format!("command -v -- {}", cmd)])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(out.status.success())
}

// ── Agent file tools (M2): read / write / exact edit / search ──

/// Read a text file. Truncate beyond max_bytes with a marker (for LLM consumption, 256KB by default);
/// reject non-UTF-8 input (binary files should not be fed to the model).
fn read_file_text_sync(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    use std::io::Read;
    let max = max_bytes.unwrap_or(256 * 1024).min(8 * 1024 * 1024);
    let meta = std::fs::metadata(&path).map_err(|e| format!("无法读取 {path}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{path} 是目录，不是文件"));
    }
    if !meta.is_file() { return Err("Only regular files can be read as text".into()); }
    let file = std::fs::File::open(&path).map_err(|e| format!("无法读取 {path}: {e}"))?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1).read_to_end(&mut bytes).map_err(|e| format!("无法读取 {path}: {e}"))?;
    let truncated = bytes.len() > max;
    let slice = if truncated { &bytes[..max] } else { &bytes[..] };
    // The truncation point may fall inside a UTF-8 character, which makes from_utf8 fail; use lossy
    // conversion for truncated reads and keep strict validation for complete reads (binary files do not belong in context)
    let text = if truncated {
        String::from_utf8_lossy(slice).to_string()
    } else {
        String::from_utf8(slice.to_vec()).map_err(|_| format!("{path} 不是 UTF-8 文本文件"))?
    };
    Ok(if truncated {
        format!("{text}\n…（文件超过 {}KB，已截断）", max / 1024)
    } else {
        text
    })
}

#[tauri::command]
pub async fn read_file_text(
    policy: tauri::State<'_, crate::agent::permissions::ToolPolicy>,
    path: String,
    max_bytes: Option<usize>,
    lease: Option<String>,
) -> Result<String, String> {
    // Agent-only command: the caller must present the lease Rust issued for exactly these args.
    crate::agent::permissions::require_lease(
        &policy,
        lease,
        "read_file_text",
        &serde_json::json!({ "path": path, "maxBytes": max_bytes }),
    )?;
    tauri::async_runtime::spawn_blocking(move || read_file_text_sync(path, max_bytes))
        .await
        .map_err(|e| e.to_string())?
}

/// Back up an existing file under a unique name before replacing its content.
fn write_file_text_sync(path: String, content: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {e}"))?;
        }
    }
    let mut backup_note = String::new();
    if p.exists() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let fname = p
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "unnamed".into());
        let dir = dirs::home_dir()
            .ok_or("无法定位主目录")?
            .join(".vrykell")
            .join("backups");
        std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建备份目录: {e}"))?;
        let backup = dir.join(format!("{ts}_{}_{fname}", uuid::Uuid::new_v4()));
        std::fs::copy(&p, &backup).map_err(|e| format!("备份失败: {e}"))?;
        backup_note = format!("（原文件已备份到 {}）", backup.to_string_lossy());
    }
    std::fs::write(&p, content).map_err(|e| format!("写入 {path} 失败: {e}"))?;
    Ok(if backup_note.is_empty() {
        format!("已写入 {path}")
    } else {
        format!("已写入 {path} {backup_note}")
    })
}

#[tauri::command]
pub async fn write_file_text(
    policy: tauri::State<'_, crate::agent::permissions::ToolPolicy>,
    path: String,
    content: String,
    lease: Option<String>,
) -> Result<String, String> {
    crate::agent::permissions::require_lease(
        &policy,
        lease,
        "write_file_text",
        &serde_json::json!({ "path": path, "content": content }),
    )?;
    tauri::async_runtime::spawn_blocking(move || write_file_text_sync(path, content))
        .await
        .map_err(|e| e.to_string())?
}

/// Exact string replacement: old_string must match exactly once; zero or multiple matches are errors
/// that report the match count (so the model has enough information to correct itself instead of silently editing the wrong place).
fn edit_file_text_sync(
    path: String,
    old_string: String,
    new_string: String,
) -> Result<String, String> {
    if old_string.is_empty() {
        return Err("old_string 不能为空".into());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("无法读取 {path}: {e}"))?;
    let hits = content.matches(&old_string).count();
    if hits == 0 {
        return Err(format!("在 {path} 中未找到匹配内容（0 处命中），请检查缩进/空白是否一致"));
    }
    if hits > 1 {
        return Err(format!(
            "old_string 在 {path} 中命中 {hits} 处，请补充更多上下文使其唯一"
        ));
    }
    let updated = content.replacen(&old_string, &new_string, 1);
    std::fs::write(&path, updated).map_err(|e| format!("写入 {path} 失败: {e}"))?;
    Ok(format!("已修改 {path}（1 处替换）"))
}

#[tauri::command]
pub async fn edit_file_text(
    policy: tauri::State<'_, crate::agent::permissions::ToolPolicy>,
    path: String,
    old_string: String,
    new_string: String,
    lease: Option<String>,
) -> Result<String, String> {
    crate::agent::permissions::require_lease(
        &policy,
        lease,
        "edit_file_text",
        &serde_json::json!({ "path": path, "oldString": old_string, "newString": new_string }),
    )?;
    tauri::async_runtime::spawn_blocking(move || edit_file_text_sync(path, old_string, new_string))
        .await
        .map_err(|e| e.to_string())?
}

/// Search hit: path plus an optional line number (content mode) and preview text
#[derive(Clone, Serialize)]
pub struct FsSearchHit {
    path: String,
    line: Option<u32>,
    preview: String,
}

/// Recursive search. content=false: match a case-insensitive substring in file names;
/// content=true: match line by line in file contents (skip files over 1MB and binaries containing NUL).
/// Heavy directories such as .git/node_modules/target are always skipped; results are capped at max_results.
fn fs_search_sync(
    root: String,
    query: String,
    content: bool,
    max_results: Option<usize>,
) -> Result<Vec<FsSearchHit>, String> {
    let max = max_results.unwrap_or(100);
    let q = query.to_lowercase();
    if q.is_empty() {
        return Err("搜索词不能为空".into());
    }
    const SKIP_DIRS: &[&str] = &[
        ".git", "node_modules", "target", "dist", "build", ".next", "__pycache__", ".venv",
    ];
    let mut hits = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(&root)];
    while let Some(dir) = stack.pop() {
        if hits.len() >= max {
            break;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue, // Permission errors and the like: skip instead of failing
        };
        for entry in rd.flatten() {
            if hits.len() >= max {
                break;
            }
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() { continue; }
            if kind.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(p);
                }
                continue;
            }
            if !kind.is_file() { continue; }
            if !content {
                if name.to_lowercase().contains(&q) {
                    hits.push(FsSearchHit {
                        path: p.to_string_lossy().to_string(),
                        line: None,
                        preview: name,
                    });
                }
                continue;
            }
            // Content mode: skip files over 1MB
            let Ok(meta) = p.metadata() else { continue };
            if meta.len() > 1024 * 1024 {
                continue;
            }
            use std::io::Read;
            let Ok(file) = std::fs::File::open(&p) else { continue };
            let mut bytes = Vec::new();
            if file.take(1024 * 1024 + 1).read_to_end(&mut bytes).is_err() || bytes.len() > 1024 * 1024 { continue; }
            if bytes.contains(&0) {
                continue; // Binary file
            }
            let Ok(text) = String::from_utf8(bytes) else { continue };
            for (idx, line) in text.lines().enumerate() {
                if hits.len() >= max {
                    break;
                }
                if line.to_lowercase().contains(&q) {
                    hits.push(FsSearchHit {
                        path: p.to_string_lossy().to_string(),
                        line: Some(idx as u32 + 1),
                        preview: line.trim().chars().take(160).collect(),
                    });
                }
            }
        }
    }
    Ok(hits)
}

#[tauri::command]
pub async fn fs_search(
    policy: tauri::State<'_, crate::agent::permissions::ToolPolicy>,
    root: String,
    query: String,
    content: bool,
    max_results: Option<usize>,
    lease: Option<String>,
) -> Result<Vec<FsSearchHit>, String> {
    crate::agent::permissions::require_lease(
        &policy,
        lease,
        "fs_search",
        &serde_json::json!({ "root": root, "query": query, "content": content, "maxResults": max_results }),
    )?;
    tauri::async_runtime::spawn_blocking(move || fs_search_sync(root, query, content, max_results))
        .await
        .map_err(|e| e.to_string())?
}

// ── Attachments (M5): save/read/import under ~/.vrykell/attachments/ ──

/// Maximum attachment size (kept in sync with the frontend LIMITS)
const ATTACHMENT_MAX_BYTES: usize = 10 * 1024 * 1024;
/// Maximum size for inline text (larger content is written to disk)
const ATTACHMENT_INLINE_TEXT_BYTES: usize = 100 * 1024;

fn attachments_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or("无法定位主目录")?
        .join(".vrykell")
        .join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建附件目录: {e}"))?;
    Ok(dir)
}

/// Sanitize a file name: keep only alphanumerics and . _ - (against path traversal); fall back to a default name when empty
fn sanitize_file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || "._-".contains(c) { c } else { '_' })
        .collect();
    if clean.is_empty() { "attachment".into() } else { clean }
}

/// Guess the MIME type from the extension (a small table is enough: the frontend only distinguishes image/* from text and other)
fn mime_from_name(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "text/plain",
    }
}

/// Import result: text up to 100KB is inlined (text); images and binaries are copied into the attachments directory (blob_path)
#[derive(Clone, Serialize)]
pub struct AttachmentImport {
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub text: Option<String>,
    pub blob_path: Option<String>,
}

/// Save base64 bytes as an attachment (pasted images take this path). Returns the on-disk path and size.
fn save_attachment_sync(name: String, data_base64: String) -> Result<AttachmentImport, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    if bytes.len() > ATTACHMENT_MAX_BYTES {
        return Err("附件超过 10MB 上限".into());
    }
    let mime = mime_from_name(&name);
    let fname = format!("{}-{}", uuid::Uuid::new_v4(), sanitize_file_name(&name));
    let path = attachments_dir()?.join(fname);
    std::fs::write(&path, &bytes).map_err(|e| format!("写入附件失败: {e}"))?;
    Ok(AttachmentImport {
        name,
        mime: mime.into(),
        size: bytes.len() as u64,
        text: None,
        blob_path: Some(path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn save_attachment(name: String, data_base64: String) -> Result<AttachmentImport, String> {
    tauri::async_runtime::spawn_blocking(move || save_attachment_sync(name, data_base64))
        .await
        .map_err(|e| e.to_string())?
}

/// Read an attachment as base64 (to build a data URL for the model or for preview).
/// Only files inside the attachments directory can be read (so the frontend cannot use this as an arbitrary file reader).
fn read_attachment_sync(path: String) -> Result<String, String> {
    use base64::Engine;
    let dir = std::fs::canonicalize(attachments_dir()?).map_err(|e| e.to_string())?;
    let p = std::fs::canonicalize(&path).map_err(|e| format!("附件不存在: {e}"))?;
    if !p.starts_with(&dir) {
        return Err("只允许读取附件目录内的文件".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("读取附件失败: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn read_attachment(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_attachment_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

/// Import a file the user selected: UTF-8 text up to 100KB is returned inline as text; images and
/// binaries are copied into the attachments directory and returned as blob_path. Files over 10MB are rejected.
fn import_attachment_sync(path: String) -> Result<AttachmentImport, String> {
    let p = std::path::PathBuf::from(&path);
    let name = p
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "attachment".into());
    let meta = std::fs::metadata(&p).map_err(|e| format!("无法读取 {path}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{path} 是目录，不能作为附件"));
    }
    if meta.len() > ATTACHMENT_MAX_BYTES as u64 {
        return Err("附件超过 10MB 上限".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("无法读取 {path}: {e}"))?;
    let mime = mime_from_name(&name);
    // Not an image: try inlining as UTF-8
    if !mime.starts_with("image/") && bytes.len() <= ATTACHMENT_INLINE_TEXT_BYTES {
        if let Ok(text) = String::from_utf8(bytes.clone()) {
            return Ok(AttachmentImport {
                name,
                mime: mime.into(),
                size: text.len() as u64,
                text: Some(text),
                blob_path: None,
            });
        }
    }
    // Image, large text or binary: copy into the attachments directory
    let fname = format!("{}-{}", uuid::Uuid::new_v4(), sanitize_file_name(&name));
    let dest = attachments_dir()?.join(fname);
    std::fs::write(&dest, &bytes).map_err(|e| format!("写入附件失败: {e}"))?;
    Ok(AttachmentImport {
        name,
        mime: mime.into(),
        size: bytes.len() as u64,
        text: None,
        blob_path: Some(dest.to_string_lossy().to_string()),
    })
}

/// Import a file the user pointed at (picker or drop). This command hands file *contents* back to
/// the page, so it only accepts a path an operating-system gesture produced — see
/// [`crate::files::grants`]. The refusal is a stable code the page turns into a message.
#[tauri::command]
pub async fn import_attachment(
    state: tauri::State<'_, crate::files::grants::PathGrants>,
    path: String,
) -> Result<AttachmentImport, String> {
    if !state.allows(std::path::Path::new(&path)) {
        return Err("path-not-granted".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || import_attachment_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn fs_list_returns_entries_sorted_dirs_first() {
        let dir = std::env::temp_dir().to_string_lossy().to_string();
        let entries = super::fs_list_sync(Some(dir)).expect("list temp dir");
        assert!(!entries.is_empty(), "temp dir should not be empty");
        // Directories must come before files
        let first_file = entries.iter().position(|e| !e.is_dir);
        if let Some(idx) = first_file {
            assert!(entries[..idx].iter().all(|e| e.is_dir));
        }
    }

    #[test]
    fn fs_stat_reports_file_and_directory_metadata() {
        let root = temp_workspace("stat");
        let file = root.join("info.txt");
        std::fs::write(&file, "hello").unwrap();

        let file_stat = super::fs_stat_sync(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(file_stat.name, "info.txt");
        assert_eq!(file_stat.path, file.to_string_lossy());
        assert!(!file_stat.is_dir);
        assert!(!file_stat.is_symlink);
        assert_eq!(file_stat.size, 5);
        assert!(file_stat.modified_ms.is_some());

        let dir_stat = super::fs_stat_sync(root.to_string_lossy().to_string()).unwrap();
        assert!(dir_stat.is_dir);
        assert_eq!(dir_stat.size, 0);
        assert_eq!(dir_stat.name, root.file_name().unwrap().to_string_lossy());

        // Missing paths reject instead of returning placeholder data
        assert!(super::fs_stat_sync(root.join("missing").to_string_lossy().to_string()).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn fs_disks_lists_drives_on_windows() {
        let disks = super::fs_disks_sync().expect("disks");
        assert!(!disks.is_empty(), "至少应有 C: 盘");
        assert!(disks.iter().any(|e| e.path == "C:\\"));
    }

    #[test]
    fn fs_disks_returns_at_least_root_on_unix() {
        #[cfg(windows)]
        let _ = ();
        #[cfg(not(windows))]
        {
            let disks = super::fs_disks_sync().expect("disks");
            assert!(disks.iter().any(|e| e.path == "/"), "Unix 应有根卷");
            // Root volume capacity should be readable (statvfs), so it is >0 rather than all zeros
            let root = disks.iter().find(|e| e.path == "/").unwrap();
            assert!(root.total_bytes > 0);
            assert!(root.free_bytes > 0);
        }
    }

    #[test]
    fn which_cmd_finds_sh_and_rejects_injection() {
        // Windows resolves with where.exe (cmd); Unix uses command -v (sh)
        #[cfg(windows)]
        let known = "cmd".to_string();
        #[cfg(not(windows))]
        let known = "sh".to_string();
        assert!(super::which_cmd_sync(known).unwrap());
        assert!(!super::which_cmd_sync("definitely-not-a-cmd-xyz".to_string()).unwrap());
        // Injection-style command names are immediately treated as unavailable
        assert!(!super::which_cmd_sync("sh; rm -rf /".to_string()).unwrap());
        assert!(!super::which_cmd_sync("".to_string()).unwrap());
    }

    /// Create a test file under the temp directory and return (directory, file path). The directory name includes the process id to avoid concurrent clashes.
    fn temp_file(name: &str, content: &str) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("vrykell-fs-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        (dir, path.to_string_lossy().to_string())
    }

    #[test]
    fn read_file_text_reads_and_truncates() {
        let (_dir, path) = temp_file("read.txt", "hello 世界");
        assert_eq!(super::read_file_text_sync(path.clone(), None).unwrap(), "hello 世界");
        // Truncation (10 bytes splits a multi-byte character, which must not panic) plus the truncation marker
        let t = super::read_file_text_sync(path, Some(10)).unwrap();
        assert!(t.contains("已截断"));
        // Directory or missing path → structured error
        let (dir, _) = temp_file("x.txt", "x");
        assert!(super::read_file_text_sync(dir.to_string_lossy().to_string(), None)
            .unwrap_err()
            .contains("是目录"));
        assert!(super::read_file_text_sync("/nonexistent/none.txt".into(), None).is_err());
    }

    #[test]
    fn write_file_text_writes_and_backs_up() {
        let dir = std::env::temp_dir().join(format!("vrykell-fs-w-{}", std::process::id()));
        let path = dir.join("w.txt").to_string_lossy().to_string();
        // New file: no backup note
        let msg = super::write_file_text_sync(path.clone(), "v1".into()).unwrap();
        assert!(!msg.contains("备份"));
        // Overwrite: includes a backup note and the backup contains v1
        let msg = super::write_file_text_sync(path.clone(), "v2".into()).unwrap();
        assert!(msg.contains("备份"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v2");
        let backup = msg
            .split("备份到 ")
            .nth(1)
            .unwrap()
            .trim_end_matches('）')
            .to_string();
        assert_eq!(std::fs::read_to_string(backup).unwrap(), "v1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_file_text_unique_hit_constraint() {
        let (_dir, path) = temp_file("edit.txt", "foo bar\nfoo baz\n");
        // Multiple matches → error that includes the match count
        let err = super::edit_file_text_sync(path.clone(), "foo".into(), "qux".into()).unwrap_err();
        assert!(err.contains("2 处"), "命中数应写进错误: {err}");
        // Zero matches
        assert!(super::edit_file_text_sync(path.clone(), "nope".into(), "x".into())
            .unwrap_err()
            .contains("0 处"));
        // Single match → replacement succeeds
        super::edit_file_text_sync(path.clone(), "foo bar".into(), "qux bar".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "qux bar\nfoo baz\n");
        // Empty old_string
        assert!(super::edit_file_text_sync(path, "".into(), "x".into()).is_err());
    }

    #[test]
    fn attachment_sanitize_and_mime() {
        // Path separators become _, so traversal cannot work
        assert_eq!(super::sanitize_file_name("../../etc/passwd"), ".._.._etc_passwd");
        assert_eq!(super::sanitize_file_name(""), "attachment");
        assert_eq!(super::mime_from_name("a.PNG"), "image/png");
        assert_eq!(super::mime_from_name("b.txt"), "text/plain");
        assert_eq!(super::mime_from_name("noext"), "text/plain");
    }

    #[test]
    fn import_attachment_inlines_small_text() {
        let dir = std::env::temp_dir().join(format!("vrykell-att-i-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        std::fs::write(&path, "hello 附件").unwrap();
        let path = path.to_string_lossy().to_string();
        let r = super::import_attachment_sync(path).unwrap();
        assert_eq!(r.name, "note.md");
        assert_eq!(r.text.as_deref(), Some("hello 附件"));
        assert!(r.blob_path.is_none());
        // Directories are rejected
        assert!(super::import_attachment_sync(dir.to_string_lossy().to_string()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_attachment_stores_binary_and_read_back() {
        use base64::Engine;
        let dir = std::env::temp_dir().join(format!("vrykell-att-b-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bin.dat");
        std::fs::write(&path, [120u8, 60]).unwrap();
        let path = path.to_string_lossy().to_string();
        std::fs::write(&path, [0u8, 159, 146, 150]).unwrap(); // Not UTF-8
        let r = super::import_attachment_sync(path).unwrap();
        assert!(r.text.is_none());
        let blob = r.blob_path.expect("二进制应落盘");
        // read_attachment returns the same bytes
        let b64 = super::read_attachment_sync(blob.clone()).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        assert_eq!(bytes, vec![0u8, 159, 146, 150]);
        // Paths outside the attachments directory are rejected
        assert!(super::read_attachment_sync("/etc/hosts".into()).is_err());
        let _ = std::fs::remove_file(&blob);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_attachment_decodes_base64_and_rejects_garbage() {
        use base64::Engine;
        let data = base64::engine::general_purpose::STANDARD.encode(b"png-bytes");
        let r = super::save_attachment_sync("shot.png".into(), data).unwrap();
        assert_eq!(r.mime, "image/png");
        assert!(r.text.is_none());
        let blob = r.blob_path.unwrap();
        assert_eq!(std::fs::read(&blob).unwrap(), b"png-bytes");
        let _ = std::fs::remove_file(&blob);
        // Invalid base64 is rejected
        assert!(super::save_attachment_sync("a.png".into(), "!!!not-base64!!!".into()).is_err());
    }

    #[test]
    fn fs_search_by_name_and_content() {
        let dir = std::env::temp_dir().join(format!("vrykell-fs-s-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("apple.txt"), "red fruit\n").unwrap();
        std::fs::write(dir.join("sub").join("banana.txt"), "yellow fruit\n").unwrap();
        let root = dir.to_string_lossy().to_string();
        // Name mode: case-insensitive substring
        let hits = super::fs_search_sync(root.clone(), "APPLE".into(), false, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].path.ends_with("apple.txt"));
        assert!(hits[0].line.is_none());
        // Content mode: recurses into subdirectories and reports line numbers
        let hits = super::fs_search_sync(root.clone(), "yellow".into(), true, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, Some(1));
        assert!(hits[0].preview.contains("yellow fruit"));
        // Empty query is rejected
        assert!(super::fs_search_sync(root, "".into(), false, None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Temporary directory owned by this test (a UUID prevents concurrent clashes).
    fn temp_workspace(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("vrykell-op-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn fs_transfer_copies_moves_and_rejects_unsafe_targets() {
        let root = temp_workspace("transfer");
        let src = root.join("src");
        let dst = root.join("dst");
        std::fs::create_dir_all(src.join("folder/inner")).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("a.txt"), "alpha").unwrap();
        std::fs::write(src.join("folder/inner/b.txt"), "beta").unwrap();

        // Copy a file: the source stays and the destination content matches
        let outcome = super::fs_transfer_sync(
            vec![src.join("a.txt").to_string_lossy().to_string()],
            dst.to_string_lossy().to_string(),
            true,
        )
        .unwrap();
        assert_eq!(outcome.errors, Vec::<String>::new());
        assert_eq!(outcome.completed.len(), 1);
        assert!(src.join("a.txt").exists());
        assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "alpha");

        // Name collision: append a number (no overwrite, no error); the undo pair records the real destination path
        let outcome = super::fs_transfer_sync(
            vec![src.join("a.txt").to_string_lossy().to_string()],
            dst.to_string_lossy().to_string(),
            true,
        )
        .unwrap();
        assert_eq!(outcome.errors, Vec::<String>::new());
        assert_eq!(outcome.completed.len(), 1);
        assert!(outcome.completed[0].to.ends_with("a (1).txt"), "{}", outcome.completed[0].to);
        assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "alpha");
        assert_eq!(std::fs::read_to_string(dst.join("a (1).txt")).unwrap(), "alpha");

        // Copy again: the number increases
        let outcome = super::fs_transfer_sync(
            vec![src.join("a.txt").to_string_lossy().to_string()],
            dst.to_string_lossy().to_string(),
            true,
        )
        .unwrap();
        assert!(outcome.completed[0].to.ends_with("a (2).txt"), "{}", outcome.completed[0].to);

        // Move a file with a colliding name: same avoidance, and the source is removed
        let outcome = super::fs_transfer_sync(
            vec![src.join("a.txt").to_string_lossy().to_string()],
            dst.to_string_lossy().to_string(),
            false,
        )
        .unwrap();
        assert_eq!(outcome.errors, Vec::<String>::new());
        assert!(outcome.completed[0].to.ends_with("a (3).txt"), "{}", outcome.completed[0].to);
        assert!(!src.join("a.txt").exists());
        assert!(dst.join("a (3).txt").exists());

        // Copy a directory: the recursive contents are complete
        let outcome = super::fs_transfer_sync(
            vec![src.join("folder").to_string_lossy().to_string()],
            dst.to_string_lossy().to_string(),
            true,
        )
        .unwrap();
        assert_eq!(outcome.errors, Vec::<String>::new());
        assert_eq!(std::fs::read_to_string(dst.join("folder/inner/b.txt")).unwrap(), "beta");

        // Move a file: the source disappears and the destination appears
        std::fs::write(src.join("a.txt"), "alpha").unwrap();
        let outcome = super::fs_transfer_sync(
            vec![src.join("a.txt").to_string_lossy().to_string()],
            root.join("moved").to_string_lossy().to_string(),
            false,
        )
        .unwrap();
        assert_eq!(outcome.errors.len(), 1, "目标目录不存在时应报错");
        std::fs::create_dir_all(root.join("moved")).unwrap();
        let outcome = super::fs_transfer_sync(
            vec![src.join("a.txt").to_string_lossy().to_string()],
            root.join("moved").to_string_lossy().to_string(),
            false,
        )
        .unwrap();
        assert_eq!(outcome.errors, Vec::<String>::new());
        assert!(!src.join("a.txt").exists());
        assert!(root.join("moved/a.txt").exists());

        // Put a directory inside its own subtree: rejected (prevents infinite recursion)
        std::fs::create_dir_all(src.join("folder/sub")).unwrap();
        let outcome = super::fs_transfer_sync(
            vec![src.join("folder").to_string_lossy().to_string()],
            src.join("folder/sub").to_string_lossy().to_string(),
            true,
        )
        .unwrap();
        assert!(outcome.completed.is_empty());
        assert!(outcome.errors[0].contains("自己内部"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stage_delete_and_restore_round_trip() {
        let root = temp_workspace("undo");
        let staging = root.join("staging");
        let file = root.join("note.txt");
        std::fs::write(&file, "keep me").unwrap();

        let staged = super::stage_delete_into(
            &staging,
            vec![file.to_string_lossy().to_string()],
        )
        .unwrap().completed;
        assert_eq!(staged.len(), 1);
        assert!(!file.exists(), "暂存后原位置应消失");
        let staged_path = std::path::PathBuf::from(&staged[0].to);
        assert!(staged_path.exists());

        // Undo: moved back to the original location with identical content
        let outcome = super::restore_staged_sync(staged.clone()).unwrap();
        assert_eq!(outcome.errors, Vec::<String>::new());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "keep me");
        assert!(!staged_path.exists());

        // When the original location is taken, undo reports an error and keeps the staged item
        let staged = super::stage_delete_into(&staging, vec![file.to_string_lossy().to_string()]).unwrap().completed;
        std::fs::write(&file, "occupied").unwrap();
        let outcome = super::restore_staged_sync(staged.clone()).unwrap();
        assert_eq!(outcome.completed.len(), 0);
        assert!(outcome.errors[0].contains("已存在"));
        assert!(std::path::PathBuf::from(&staged[0].to).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stage_delete_reports_successes_even_when_an_item_fails() {
        let root = temp_workspace("partial-delete");
        let first = root.join("first.txt");
        let last = root.join("last.txt");
        std::fs::write(&first, "first").unwrap();
        std::fs::write(&last, "last").unwrap();
        let outcome = super::stage_delete_into(&root.join("staging"), vec![
            first.to_string_lossy().into(), root.join("missing").to_string_lossy().into(), last.to_string_lossy().into(),
        ]).unwrap();
        assert_eq!(outcome.completed.len(), 2);
        assert_eq!(outcome.errors.len(), 1);
        let restored = super::restore_staged_sync(outcome.completed).unwrap();
        assert_eq!(restored.completed.len(), 2);
        assert_eq!(std::fs::read_to_string(first).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(last).unwrap(), "last");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cross_device_cleanup_failure_preserves_the_complete_destination() {
        let root = temp_workspace("move-cleanup");
        let source = root.join("source");
        let destination = root.join("destination");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("first"), "first").unwrap();
        std::fs::write(source.join("last"), "last").unwrap();
        super::copy_entry(&source, &destination).unwrap();
        let error = super::finish_cross_device_move(&source, &destination, |path| {
            std::fs::remove_file(path.join("first")).unwrap();
            Err("Access denied".into())
        }).unwrap_err();
        assert!(error.contains("preserved"));
        assert!(!source.join("first").exists());
        assert_eq!(std::fs::read_to_string(destination.join("first")).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(destination.join("last")).unwrap(), "last");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reading_a_sparse_large_file_is_limited_to_the_requested_prefix() {
        use std::io::{Seek, SeekFrom, Write};
        let root = temp_workspace("bounded-read");
        let path = root.join("large.txt");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"prefix").unwrap();
        file.seek(SeekFrom::Start(1024 * 1024 * 1024)).unwrap();
        file.write_all(b"end").unwrap();
        drop(file);
        let text = super::read_file_text_sync(path.to_string_lossy().into(), Some(6)).unwrap();
        assert!(text.starts_with("prefix\n"));
        assert!(text.len() < 100);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn file_search_skips_link_cycles_and_text_reads_refuse_special_files() {
        let root = temp_workspace("search-links");
        std::fs::write(root.join("match.txt"), "needle").unwrap();
        std::os::unix::fs::symlink(&root, root.join("cycle")).unwrap();
        let hits = super::fs_search_sync(root.to_string_lossy().into(), "needle".into(), true, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(super::read_file_text_sync("/dev/null".into(), None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rapid_writes_keep_each_original_backup() {
        let root = temp_workspace("unique-backups");
        let path = root.join("note.txt");
        std::fs::write(&path, "first").unwrap();
        let write = |content: &str| {
            let message = super::write_file_text_sync(path.to_string_lossy().into(), content.into()).unwrap();
            std::path::PathBuf::from(message.split("备份到 ").nth(1).unwrap().trim_end_matches('）'))
        };
        let first = write("second");
        let second = write("third");
        assert_ne!(first, second);
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "second");
        std::fs::remove_file(first).unwrap();
        std::fs::remove_file(second).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn purge_staged_sends_items_to_system_trash() {
        let root = temp_workspace("purge");
        let staged = root.join("staged.txt");
        std::fs::write(&staged, "gone").unwrap();
        super::purge_staged(vec![staged.to_string_lossy().to_string()]);
        assert!(!staged.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unique_path_appends_index_before_extension() {
        let root = temp_workspace("unique");
        std::fs::write(root.join("a.txt"), "1").unwrap();
        std::fs::write(root.join("a (1).txt"), "2").unwrap();
        std::fs::write(root.join(".bashrc"), "3").unwrap();
        std::fs::create_dir(root.join("Documents")).unwrap();

        assert_eq!(super::unique_path(&root, "a.txt").file_name().unwrap(), "a (2).txt");
        // This helper is only called on collisions: it returns the first available numbered name
        assert_eq!(super::unique_path(&root, "free.txt").file_name().unwrap(), "free (1).txt");
        assert_eq!(super::unique_path(&root, "Documents").file_name().unwrap(), "Documents (1)");
        assert_eq!(super::unique_path(&root, ".bashrc").file_name().unwrap(), ".bashrc (1)");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn create_file_and_dir_avoid_existing_names() {
        let root = temp_workspace("create");
        std::fs::write(root.join("Untitled"), "x").unwrap();
        let dir = root.to_string_lossy().to_string();

        let file = super::fs_create_sync(dir.clone(), "Untitled".into(), false).unwrap();
        assert!(file.ends_with("Untitled (1)"), "{file}");
        assert!(std::path::Path::new(&file).is_file());

        let folder = super::fs_create_sync(dir.clone(), "NewFolder".into(), true).unwrap();
        assert!(folder.ends_with("NewFolder"), "{folder}");
        assert!(std::path::Path::new(&folder).is_dir());
        let folder2 = super::fs_create_sync(dir, "NewFolder".into(), true).unwrap();
        assert!(folder2.ends_with("NewFolder (1)"), "{folder2}");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_returns_final_path_and_avoids_existing_name() {
        let root = temp_workspace("rename");
        let dir = root.to_string_lossy().to_string();
        std::fs::write(root.join("a.txt"), "a").unwrap();
        std::fs::write(root.join("b.txt"), "b").unwrap();

        // Rename to an existing name: append a number and return the real path (the undo pair records it)
        let final_path = super::fs_rename_sync(
            root.join("a.txt").to_string_lossy().to_string(),
            "b.txt".into(),
        )
        .unwrap();
        assert!(final_path.ends_with("b (1).txt"), "{final_path}");
        assert!(std::path::Path::new(&final_path).exists());
        assert!(root.join("b.txt").exists());

        // Ordinary rename: returns the new path directly
        let final_path = super::fs_rename_sync(
            root.join("b.txt").to_string_lossy().to_string(),
            "c.txt".into(),
        )
        .unwrap();
        assert!(final_path.ends_with("c.txt"), "{final_path}");

        // Invalid names are still rejected
        assert!(super::fs_rename_sync(
            root.join("c.txt").to_string_lossy().to_string(),
            "../escape.txt".into(),
        )
        .is_err());
        assert!(super::fs_create_sync(dir, "a/b".into(), false).is_err());

        let _ = std::fs::remove_dir_all(&root);
    }
}
