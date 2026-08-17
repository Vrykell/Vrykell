use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// 列出目录内容（目录在前，按名称排序）。path 为空时用 HOME。
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
            path: p.to_string_lossy().to_string(),
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command]
pub async fn fs_list(path: Option<String>) -> Result<Vec<FsEntry>, String> {
    // 磁盘 IO 移出主线程（同步 command 会在主线程执行，巨型目录会冻结 UI）
    tauri::async_runtime::spawn_blocking(move || fs_list_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

/// 重命名本地文件/目录：old_path → 同目录 new_name。
fn fs_rename_sync(old_path: String, new_name: String) -> Result<(), String> {
    // 校验 new_name 为单一 path component，防止 `/`、`..` 等路径遍历逃逸出父目录
    let np = std::path::Path::new(&new_name);
    if new_name.is_empty()
        || np.components().count() != 1
        || matches!(np.components().next(), Some(std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)))
    {
        return Err("非法文件名".to_string());
    }
    let old = std::path::PathBuf::from(&old_path);
    let parent = old.parent().ok_or("无法定位父目录")?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err("目标名称已存在".to_string());
    }
    std::fs::rename(&old, &new_path).map_err(|e| e.to_string())
}

/// 删除本地文件/目录：移入系统回收站（trash crate 跨平台，macOS 用原生
/// NSFileManager trashItemAtURL，Windows 用回收站，Linux 走 XDG trash 规范）。
fn fs_delete_sync(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_rename(old_path: String, new_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fs_rename_sync(old_path, new_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_delete(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fs_delete_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

/// 检测命令是否可用（经登录 shell 解析用户 PATH，GUI 进程 PATH 找不到 code 等自定义命令）。
/// 仅接受简单命令名（字母数字及 -._+），其余一律视为不可用。
pub(crate) fn which_cmd_sync(cmd: String) -> Result<bool, String> {
    if cmd.is_empty()
        || !cmd
            .chars()
            .all(|c| c.is_alphanumeric() || "-._+".contains(c))
    {
        return Ok(false);
    }
    // 用 /bin/sh 而非硬编码 zsh：无 zsh 的环境（最小 Linux/容器）也能解析用户 PATH
    let out = std::process::Command::new("/bin/sh")
        .args(["-lc", &format!("command -v -- {}", cmd)])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(out.status.success())
}

#[tauri::command]
pub async fn which_cmd(cmd: String) -> Result<bool, String> {
    // spawn 登录 shell（zshrc 重时 50-500ms）移出 async runtime worker，避免占用调度线程
    tauri::async_runtime::spawn_blocking(move || which_cmd_sync(cmd))
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
        // 目录必须排在文件前面
        let first_file = entries.iter().position(|e| !e.is_dir);
        if let Some(idx) = first_file {
            assert!(entries[..idx].iter().all(|e| e.is_dir));
        }
    }

    #[test]
    fn which_cmd_finds_sh_and_rejects_injection() {
        assert!(super::which_cmd_sync("sh".to_string()).unwrap());
        assert!(!super::which_cmd_sync("definitely-not-a-cmd-xyz".to_string()).unwrap());
        // 注入式命令名直接判不可用
        assert!(!super::which_cmd_sync("sh; rm -rf /".to_string()).unwrap());
        assert!(!super::which_cmd_sync("".to_string()).unwrap());
    }
}
