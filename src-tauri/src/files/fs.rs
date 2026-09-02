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

/// 列出文件系统根：Windows 返回存在的盘符（C:、D:…），Unix 返回 `/`。
/// 供文件面板「盘符 / 根」导航——否则只能看 HOME，看不到整个盘。
fn fs_roots_sync() -> Result<Vec<FsEntry>, String> {
    let mut entries = Vec::new();
    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            if std::path::Path::new(&drive).exists() {
                entries.push(FsEntry {
                    name: format!("{}:", letter as char),
                    path: drive,
                    is_dir: true,
                });
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        entries.push(FsEntry {
            name: "/".into(),
            path: "/".into(),
            is_dir: true,
        });
    }
    Ok(entries)
}

/// 磁盘条目（「此电脑」视图小卡片展示用）：名称 + 路径 + 容量。
#[derive(Clone, Serialize)]
pub struct DiskEntry {
    pub name: String,
    pub path: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// 磁盘剩余/总容量（字节）。取不到时为 (0, 0)（前端隐藏容量条）。
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

/// Windows 盘符容量（GetDiskFreeSpaceExW）。
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

/// 列出磁盘（按磁盘展示「此电脑」）：
/// - macOS：根卷（/，显示名取 /Volumes 下的系统盘）+ /Volumes 下其它挂载卷
/// - Windows：存在的盘符（C:、D:…）
/// - 其它 Unix：仅根 /
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
        // 根卷显示名：/Volumes 里指向 / 的条目（如 Macintosh HD）
        let root_name = std::fs::read_dir("/Volumes")
            .ok()
            .and_then(|rd| {
                rd.flatten().find_map(|e| {
                    let ok = std::fs::canonicalize(&e.path())
                        .map(|t| t == std::path::Path::new("/"))
                        .unwrap_or(false);
                    ok.then(|| e.file_name().to_string_lossy().to_string())
                })
            })
            .unwrap_or_else(|| "磁盘".to_string());
        let (total_bytes, free_bytes) = disk_space("/");
        disks.push(DiskEntry { name: root_name, path: "/".into(), total_bytes, free_bytes });
        // 其它挂载卷
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

/// 返回用户主目录路径（供文件面板做「家目录」快捷跳转）。
#[tauri::command]
pub fn fs_home() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .or_else(|| std::env::var("HOME").ok())
        .ok_or_else(|| "无法定位用户主目录".to_string())
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
    // Windows 用 where.exe；Unix 用 /bin/sh（而非硬编码 zsh：无 zsh 的环境
    // （最小 Linux/容器）也能解析用户 PATH）
    #[cfg(windows)]
    let out = std::process::Command::new("where.exe")
        .arg(&cmd)
        .output()
        .map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
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

// ── Agent 文件工具（M2）：读 / 写 / 精确编辑 / 搜索 ──

/// 读取文本文件。超过 max_bytes 截断并附截断标记（LLM 消费，默认 256KB）；
/// 非 UTF-8 直接报错（二进制文件不该喂给模型）。
fn read_file_text_sync(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    let max = max_bytes.unwrap_or(256 * 1024);
    let meta = std::fs::metadata(&path).map_err(|e| format!("无法读取 {path}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{path} 是目录，不是文件"));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("无法读取 {path}: {e}"))?;
    let truncated = bytes.len() > max;
    let slice = if truncated { &bytes[..max] } else { &bytes[..] };
    // 截断点可能落在 UTF-8 字符中间，from_utf8 会失败 —— 用 lossy 兜住截断场景，
    // 完整读取时仍严格校验（二进制文件不该进上下文）
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
pub async fn read_file_text(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_file_text_sync(path, max_bytes))
        .await
        .map_err(|e| e.to_string())?
}

/// 整文件写入。已存在时先备份到 ~/.vrykell/backups/<epoch秒>_<文件名>（后悔药），
/// 父目录不存在则创建。
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
        let backup = dir.join(format!("{ts}_{fname}"));
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
pub async fn write_file_text(path: String, content: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || write_file_text_sync(path, content))
        .await
        .map_err(|e| e.to_string())?
}

/// 精确字符串替换：old_string 必须在文件中唯一命中，0 处 / 多处命中均报错
/// 并返回命中数（让模型拿到足够信息自我修正，而不是静默改错位置）。
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
    path: String,
    old_string: String,
    new_string: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || edit_file_text_sync(path, old_string, new_string))
        .await
        .map_err(|e| e.to_string())?
}

/// 搜索命中：path + 可选行号（内容模式）+ 预览文本
#[derive(Clone, Serialize)]
pub struct FsSearchHit {
    path: String,
    line: Option<u32>,
    preview: String,
}

/// 递归搜索。content=false：按文件名子串匹配（大小写不敏感）；
/// content=true：按文件内容逐行匹配（跳过 >1MB / 含 NUL 的二进制文件）。
/// 永远跳过 .git/node_modules/target 等重型目录；结果封顶 max_results。
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
            Err(_) => continue, // 无权限等：跳过不炸
        };
        for entry in rd.flatten() {
            if hits.len() >= max {
                break;
            }
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(p);
                }
                continue;
            }
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
            // 内容模式：>1MB 跳过
            let Ok(meta) = p.metadata() else { continue };
            if meta.len() > 1024 * 1024 {
                continue;
            }
            let Ok(bytes) = std::fs::read(&p) else { continue };
            if bytes.contains(&0) {
                continue; // 二进制
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
    root: String,
    query: String,
    content: bool,
    max_results: Option<usize>,
) -> Result<Vec<FsSearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || fs_search_sync(root, query, content, max_results))
        .await
        .map_err(|e| e.to_string())?
}

// ── 附件（M5）：~/.vrykell/attachments/ 的保存/读取/导入 ──

/// 附件大小上限（与前端 LIMITS 对齐）
const ATTACHMENT_MAX_BYTES: usize = 10 * 1024 * 1024;
/// 文本内联上限（超过则落盘）
const ATTACHMENT_INLINE_TEXT_BYTES: usize = 100 * 1024;

fn attachments_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or("无法定位主目录")?
        .join(".vrykell")
        .join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建附件目录: {e}"))?;
    Ok(dir)
}

/// 文件名净化：只留字母数字与 . _ -（防路径穿越），空则给兜底名
fn sanitize_file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || "._-".contains(c) { c } else { '_' })
        .collect();
    if clean.is_empty() { "attachment".into() } else { clean }
}

/// 按扩展名猜 mime（小表即可：前端只区分 image/* 与文本/其它）
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

/// 导入结果：文本 ≤100KB 内联（text），图片/二进制复制进附件目录（blob_path）
#[derive(Clone, Serialize)]
pub struct AttachmentImport {
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub text: Option<String>,
    pub blob_path: Option<String>,
}

/// 保存 base64 字节为附件（粘贴的图片走这里）。返回落盘路径与大小。
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

/// 读取附件为 base64（构建 dataUrl 喂模型 / 预览）。
/// 只允许读 attachments 目录内的文件（防前端拿它当任意文件读取器）。
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

/// 导入用户选择的文件：UTF-8 文本 ≤100KB 内联返回 text；图片/二进制复制
/// 进附件目录返回 blob_path。>10MB 拒绝。
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
    // 非图片：尝试 UTF-8 内联
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
    // 图片/大文本/二进制：复制进附件目录
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

#[tauri::command]
pub async fn import_attachment(path: String) -> Result<AttachmentImport, String> {
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
        // 目录必须排在文件前面
        let first_file = entries.iter().position(|e| !e.is_dir);
        if let Some(idx) = first_file {
            assert!(entries[..idx].iter().all(|e| e.is_dir));
        }
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
            // 根卷容量应可读（statvfs），>0 而非全 0
            let root = disks.iter().find(|e| e.path == "/").unwrap();
            assert!(root.total_bytes > 0);
            assert!(root.free_bytes > 0);
        }
    }

    #[test]
    fn which_cmd_finds_sh_and_rejects_injection() {
        // Windows 用 where.exe 判定（cmd），Unix 用 command -v（sh）
        #[cfg(windows)]
        let known = "cmd".to_string();
        #[cfg(not(windows))]
        let known = "sh".to_string();
        assert!(super::which_cmd_sync(known).unwrap());
        assert!(!super::which_cmd_sync("definitely-not-a-cmd-xyz".to_string()).unwrap());
        // 注入式命令名直接判不可用
        assert!(!super::which_cmd_sync("sh; rm -rf /".to_string()).unwrap());
        assert!(!super::which_cmd_sync("".to_string()).unwrap());
    }

    /// 临时目录下建测试文件，返回 (目录, 文件路径)。目录名含进程 id 防并发冲突。
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
        // 截断（10 字节落在多字节字符中间也不炸）+ 截断标记
        let t = super::read_file_text_sync(path, Some(10)).unwrap();
        assert!(t.contains("已截断"));
        // 目录 / 不存在 → 结构化错误
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
        // 新建：无备份说明
        let msg = super::write_file_text_sync(path.clone(), "v1".into()).unwrap();
        assert!(!msg.contains("备份"));
        // 覆盖：有备份说明且备份文件内容 = v1
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
        // 多处命中 → 报错带命中数
        let err = super::edit_file_text_sync(path.clone(), "foo".into(), "qux".into()).unwrap_err();
        assert!(err.contains("2 处"), "命中数应写进错误: {err}");
        // 0 处命中
        assert!(super::edit_file_text_sync(path.clone(), "nope".into(), "x".into())
            .unwrap_err()
            .contains("0 处"));
        // 唯一命中 → 替换成功
        super::edit_file_text_sync(path.clone(), "foo bar".into(), "qux bar".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "qux bar\nfoo baz\n");
        // 空 old_string
        assert!(super::edit_file_text_sync(path, "".into(), "x".into()).is_err());
    }

    #[test]
    fn attachment_sanitize_and_mime() {
        // 路径分隔符被替换为 _，穿越失效
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
        // 目录报错
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
        std::fs::write(&path, [0u8, 159, 146, 150]).unwrap(); // 非 UTF-8
        let r = super::import_attachment_sync(path).unwrap();
        assert!(r.text.is_none());
        let blob = r.blob_path.expect("二进制应落盘");
        // read_attachment 读回一致
        let b64 = super::read_attachment_sync(blob.clone()).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        assert_eq!(bytes, vec![0u8, 159, 146, 150]);
        // 附件目录外路径被拒绝
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
        // 坏 base64 报错
        assert!(super::save_attachment_sync("a.png".into(), "!!!not-base64!!!".into()).is_err());
    }

    #[test]
    fn fs_search_by_name_and_content() {
        let dir = std::env::temp_dir().join(format!("vrykell-fs-s-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("apple.txt"), "red fruit\n").unwrap();
        std::fs::write(dir.join("sub").join("banana.txt"), "yellow fruit\n").unwrap();
        let root = dir.to_string_lossy().to_string();
        // 文件名模式：大小写不敏感子串
        let hits = super::fs_search_sync(root.clone(), "APPLE".into(), false, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].path.ends_with("apple.txt"));
        assert!(hits[0].line.is_none());
        // 内容模式：递归进子目录，带行号
        let hits = super::fs_search_sync(root.clone(), "yellow".into(), true, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, Some(1));
        assert!(hits[0].preview.contains("yellow fruit"));
        // 空搜索词报错
        assert!(super::fs_search_sync(root, "".into(), false, None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
