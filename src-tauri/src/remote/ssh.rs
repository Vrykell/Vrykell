//! SSH 连接管理：连接 CRUD 存后端 SQLite（见 history.rs 的 ssh_connections 表）。
//!
//! 连接测试 / 远程目录列出走 **SFTP**（ssh2 crate，SSH 自带的文件子系统），
//! 不经过远端 shell、不注入脚本，天然支持特殊字符与文件元数据（对齐 WindTerm 的做法）。
//!
//! 终端会话本身仍由前端经 `pty_spawn`（pty.rs）用 `ssh` CLI 拉起（交互式），这里只做非交互式后端操作。

use crate::db::{HistoryState, SshConnection};
use crate::files::fs::{FileOpOutcome, FileOpPair};
use crate::terminal::ssh_command::SshOptions;
use base64::Engine;
use serde::Serialize;
use ssh2::{CheckResult, HostKeyType, KnownHostFileKind, KnownHostKeyFormat, Session, Sftp};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;
use tauri::State;

static KH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static FILE_SEARCHES: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct SshFsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 目录列表响应：条目 + 实际目录的真实路径（空请求 = 远程 home）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshListResponse {
    pub entries: Vec<SshFsEntry>,
    pub base: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshSearchResponse {
    entries: Vec<SshFsEntry>,
    truncated: bool,
    skipped: usize,
}

/// Search file names through a single authenticated channel with bounded work.
fn ssh_search_sync(conn: &SshConnection, root: &str, query: &str, cancelled: &std::sync::atomic::AtomicBool) -> Result<SshSearchResponse, String> {
    use std::sync::atomic::Ordering;
    let mut result = SshSearchResponse::default();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || cancelled.load(Ordering::Relaxed) { return Ok(result); }
    let session = connect(conn)?;
    if cancelled.load(Ordering::Relaxed) { return Ok(result); }
    session.set_timeout(5000);
    let sftp = session.sftp().map_err(|e| format!("SFTP_UNAVAILABLE: {e}"))?;
    let root = sftp.realpath(Path::new(root)).map_err(|e| format!("Could not read search directory: {e}"))?;
    let root = root.to_string_lossy().to_string();
    let mut queue = std::collections::VecDeque::from([(root.clone(), 0usize)]);
    let mut visited = std::collections::HashSet::new();
    let mut scanned = 0usize;
    let started = std::time::Instant::now();
    while let Some((directory, depth)) = queue.pop_front() {
        if cancelled.load(Ordering::Relaxed) { break; }
        if visited.len() >= 500 || scanned >= 20000 || result.entries.len() >= 200 || started.elapsed() >= Duration::from_secs(20) {
            result.truncated = true;
            break;
        }
        if !visited.insert(directory.clone()) { continue; }
        let remaining = Duration::from_secs(20).saturating_sub(started.elapsed()).as_millis().max(1).min(5000) as u32;
        session.set_timeout(remaining);
        let entries = match sftp.readdir(Path::new(&directory)) {
            Ok(entries) => entries,
            Err(error) if directory == root => return Err(format!("Could not read search directory: {error}")),
            Err(_) => { result.skipped += 1; continue; }
        };
        for (listed, stat) in entries {
            if cancelled.load(Ordering::Relaxed) { break; }
            scanned += 1;
            if scanned > 20000 || result.entries.len() >= 200 { result.truncated = true; break; }
            let Some(name) = crate::platform::path::name_from_listing(&listed.to_string_lossy(), &directory) else { continue; };
            let path = crate::platform::path::join(&directory, &name);
            if name.to_lowercase().contains(&needle) {
                result.entries.push(SshFsEntry { name, path: path.clone(), is_dir: stat.is_dir() });
            }
            if stat.is_dir() {
                if depth < 12 && queue.len() < 500 { queue.push_back((path, depth + 1)); }
                else { result.truncated = true; }
            }
        }
    }
    Ok(result)
}

/// 建立 TCP 连接 + SSH 握手（不含主机密钥校验与认证）。
fn tcp_handshake(conn: &SshConnection) -> Result<Session, String> {
    let host = conn.host.as_str();
    let port = conn.port.unwrap_or(22);

    let tcp = TcpStream::connect((host, port))
        .map_err(|e| format!("连接 {host}:{port} 失败：{e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(15))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(15))).ok();

    let mut sess = Session::new().map_err(|e| format!("初始化 SSH 失败：{e}"))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH 握手失败：{e}"))?;
    Ok(sess)
}

/// 建立 TCP 连接 + SSH 握手 + 主机密钥校验 + 认证，返回已认证的会话。
fn connect(conn: &SshConnection) -> Result<Session, String> {
    if conn.options.jump_host.as_deref().is_some_and(|jump| !jump.eq_ignore_ascii_case("none")) {
        return Err("跳板机连接请使用交互终端；文件管理暂不支持跳板机".into());
    }
    let user = conn.user.trim();
    // 用户名为空时直接报错，绝不静默默认 root（误留空表单会以 root 登录）
    if user.is_empty() {
        return Err("用户名不能为空".to_string());
    }
    let sess = tcp_handshake(conn)?;
    verify_host_key(&sess, &conn.host, conn.port.unwrap_or(22))?;
    authenticate(&sess, conn, user)?;
    if !sess.authenticated() {
        return Err("认证失败".to_string());
    }
    Ok(sess)
}

/// 主机指纹（OpenSSH 风格 SHA256:base64）。
fn fingerprint_of(sess: &Session) -> String {
    match sess.host_key_hash(ssh2::HashType::Sha256) {
        Some(hash) => format!("SHA256:{}", base64::engine::general_purpose::STANDARD_NO_PAD.encode(hash)),
        None => "unknown".to_string(),
    }
}

/// 主机密钥校验（TOFU）：已记录 → 严格比对；未记录 → **不自动记录**，
/// 返回 `HOST_KEY_UNKNOWN:<指纹>` 要求用户显式确认后再信任（见 ssh_trust_host_key）。
/// 整个「读-改-写」在进程级锁内串行，避免多个 SSH 连接并发写互相覆盖。
fn verify_host_key(sess: &Session, host: &str, port: u16) -> Result<(), String> {
    let _guard = KH_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let (key, _key_type) = sess.host_key().ok_or("远端未返回主机密钥".to_string())?;
    let mut kh = sess.known_hosts().map_err(|e| format!("初始化 known_hosts 失败：{e}"))?;

    let kh_path = dirs::home_dir()
        .map(|h| h.join(".ssh").join("known_hosts"))
        .unwrap_or_default();
    if kh_path.exists() {
        kh.read_file(&kh_path, KnownHostFileKind::OpenSSH)
            .map_err(|e| format!("读取 SSH 信任记录失败：{e}"))?;
    }

    match kh.check_port(host, port, key) {
        CheckResult::Match => Ok(()),
        CheckResult::NotFound => Err(format!("HOST_KEY_UNKNOWN:{}", fingerprint_of(sess))),
        CheckResult::Mismatch => Err(format!("主机密钥不匹配（可能存在中间人攻击）：{host}")),
        CheckResult::Failure => Err(format!("主机密钥校验失败：{host}")),
    }
}

/// 记录主机密钥到 known_hosts（用户显式信任后调用）。
fn record_host_key(sess: &Session, host: &str, port: u16, expected_fingerprint: &str) -> Result<(), String> {
    let _guard = KH_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    validate_confirmed_fingerprint(&fingerprint_of(sess), expected_fingerprint)?;

    let (key, key_type) = sess.host_key().ok_or("远端未返回主机密钥".to_string())?;
    let mut kh = sess.known_hosts().map_err(|e| format!("初始化 known_hosts 失败：{e}"))?;

    let kh_path = dirs::home_dir()
        .map(|h| h.join(".ssh").join("known_hosts"))
        .unwrap_or_default();
    if kh_path.exists() {
        kh.read_file(&kh_path, KnownHostFileKind::OpenSSH)
            .map_err(|e| format!("读取 SSH 信任记录失败：{e}"))?;
    }

    match kh.check_port(host, port, key) {
        CheckResult::Match => return Ok(()),
        CheckResult::NotFound => {},
        CheckResult::Mismatch => return Err(format!("主机密钥不匹配，请核对远端主机：{host}")),
        CheckResult::Failure => return Err(format!("主机密钥校验失败：{host}")),
    }
    let fmt = host_key_format(key_type);
    let kh_host = if port == 22 { host.to_string() } else { format!("[{host}]:{port}") };
    kh.add(&kh_host, key, "vrykell", fmt)
        .map_err(|e| format!("记录主机密钥失败：{e}"))?;
    if let Some(dir) = kh_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    kh.write_file(&kh_path, KnownHostFileKind::OpenSSH)
        .map_err(|e| format!("写入 known_hosts 失败：{e}"))?;
    Ok(())
}

fn validate_confirmed_fingerprint(actual: &str, expected: &str) -> Result<(), String> {
    if actual == "unknown" || actual.trim_end_matches('=') != expected.trim_end_matches('=') {
        return Err("主机指纹在确认后发生变化，请重新核对后连接".into());
    }
    Ok(())
}

fn host_key_format(t: HostKeyType) -> KnownHostKeyFormat {
    match t {
        HostKeyType::Rsa => KnownHostKeyFormat::SshRsa,
        HostKeyType::Dss => KnownHostKeyFormat::SshDss,
        HostKeyType::Ecdsa256 => KnownHostKeyFormat::Ecdsa256,
        HostKeyType::Ecdsa384 => KnownHostKeyFormat::Ecdsa384,
        HostKeyType::Ecdsa521 => KnownHostKeyFormat::Ecdsa521,
        HostKeyType::Ed25519 => KnownHostKeyFormat::Ed25519,
        HostKeyType::Unknown => KnownHostKeyFormat::Unknown,
    }
}

fn authenticate(sess: &Session, conn: &SshConnection, user: &str) -> Result<(), String> {
    if let Some(identity) = &conn.options.identity_file {
        sess.userauth_pubkey_file(user, None, Path::new(identity), None)
            .map_err(|e| format!("指定私钥认证失败（加密私钥请在终端输入口令）：{e}"))?;
        return Ok(());
    }
    // 密码认证
    if conn.auth_method == "password" && !conn.password.is_empty() {
        sess.userauth_password(user, &conn.password)
            .map_err(|e| format!("密码认证失败：{e}"))?;
        return Ok(());
    }

    // 密钥认证：先 SSH Agent，再默认密钥文件
    if sess.userauth_agent(user).is_ok() && sess.authenticated() {
        return Ok(());
    }
    if let Some(home) = dirs::home_dir() {
        for key in ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"] {
            let priv_path = home.join(".ssh").join(key);
            if !priv_path.exists() {
                continue;
            }
            let pub_path = priv_path.with_extension("pub");
            let pub_opt = pub_path.exists().then_some(pub_path.as_path());
            if sess.userauth_pubkey_file(user, pub_opt, &priv_path, None).is_ok() && sess.authenticated() {
                return Ok(());
            }
        }
    }
    Err("认证失败：请配置 SSH 密钥（~/.ssh）或改用密码认证".to_string())
}

fn ssh_test_sync(conn: &SshConnection) -> Result<String, String> {
    let _sess = connect(conn)?;
    Ok("连接成功".to_string())
}

fn ssh_list_sync(conn: &SshConnection, path: Option<String>) -> Result<SshListResponse, String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;

    let dir = path.unwrap_or_default();
    // 空路径 → 远程 home（SFTP 的当前目录即登录主目录）；其它路径 realpath 规范化
    let base = sftp
        .realpath(Path::new(if dir.is_empty() { "." } else { &dir }))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| if dir.is_empty() { "/".to_string() } else { dir });

    let entries = sftp
        .readdir(Path::new(&base))
        .map_err(|e| format!("读取目录 {base} 失败：{e}"))?;

    let mut result: Vec<SshFsEntry> = Vec::new();
    for (listed, stat) in entries {
        // ssh2 用宿主平台的 join 返回路径（Windows 上会出现反斜杠），因此只取文件名，
        // 再由平台层的 POSIX 拼接生成条目路径。
        let Some(name) = crate::platform::path::name_from_listing(&listed.to_string_lossy(), &base) else {
            continue;
        };
        result.push(SshFsEntry {
            name: name.clone(),
            path: crate::platform::path::join(&base, &name),
            is_dir: stat.is_dir(),
        });
    }
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(SshListResponse { entries: result, base })
}

// ── 连接 CRUD（后端 SQLite） ──

#[tauri::command]
pub fn ssh_connections_list(state: State<'_, HistoryState>) -> Result<Vec<SshConnection>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.list_ssh_connections()
}

#[tauri::command]
pub fn ssh_connection_save(state: State<'_, HistoryState>, conn: SshConnection) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.save_ssh_connection(&conn)
}

#[tauri::command]
pub fn ssh_connection_delete(state: State<'_, HistoryState>, id: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.delete_ssh_connection(&id)
}

#[tauri::command]
pub fn ssh_connection_touch(state: State<'_, HistoryState>, id: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    db.touch_ssh_connection(&id, now)
}

// ── 连接测试 / 主机指纹 / 远程目录 ──

/// 主机密钥信息（用于首次连接确认：展示指纹 + 是否已记录）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKeyInfo {
    pub fingerprint: String,
    pub known: bool,
    pub key_type: String,
}

/// 查询主机指纹与 known_hosts 记录状态（不做任何写入）。
#[tauri::command]
pub async fn ssh_host_key_info(host: String, port: Option<u16>) -> Result<SshHostKeyInfo, String> {
    let conn = SshConnection {
        id: String::new(),
        name: String::new(),
        host,
        port,
        user: String::new(),
        password: String::new(),
        auth_method: "password".to_string(),
        last_opened_at: None,
        has_password: false,
        options: Default::default(),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let sess = tcp_handshake(&conn)?;
        let (_, key_type) = sess.host_key().ok_or("远端未返回主机密钥".to_string())?;
        let known = match verify_host_key(&sess, &conn.host, conn.port.unwrap_or(22)) {
            Ok(()) => true,
            Err(error) if error.starts_with("HOST_KEY_UNKNOWN:") => false,
            Err(error) => return Err(error),
        };
        Ok(SshHostKeyInfo {
            fingerprint: fingerprint_of(&sess),
            known,
            key_type: format!("{key_type:?}").to_lowercase(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 用户确认指纹后，记录主机密钥到 known_hosts（幂等）。
#[tauri::command]
pub async fn ssh_trust_host_key(host: String, port: Option<u16>, expected_fingerprint: String) -> Result<(), String> {
    let conn = SshConnection {
        id: String::new(),
        name: String::new(),
        host,
        port,
        user: String::new(),
        password: String::new(),
        auth_method: "password".to_string(),
        last_opened_at: None,
        has_password: false,
        options: Default::default(),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let sess = tcp_handshake(&conn)?;
        record_host_key(&sess, &conn.host, conn.port.unwrap_or(22), &expected_fingerprint)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 测试连接（显式参数，供表单在保存前测试）。
#[tauri::command]
pub async fn ssh_test(
    host: String,
    port: Option<u16>,
    user: String,
    password: String,
    options: Option<SshOptions>,
) -> Result<String, String> {
    let conn = SshConnection {
        id: String::new(),
        name: String::new(),
        host,
        port,
        user,
        password,
        auth_method: "password".to_string(),
        last_opened_at: None,
        has_password: false,
        options: options.unwrap_or_default(),
    };
    tauri::async_runtime::spawn_blocking(move || ssh_test_sync(&conn))
        .await
        .map_err(|e| e.to_string())?
}

/// 列出远程目录（按连接 id，密码由后端解析）。返回条目 + 实际目录真实路径。
#[tauri::command]
pub async fn ssh_list(
    state: State<'_, HistoryState>,
    id: String,
    path: Option<String>,
) -> Result<SshListResponse, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_list_sync(&conn, path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_search(state: State<'_, HistoryState>, id: String, path: String, text: String, request_id: String) -> Result<SshSearchResponse, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?.get_ssh_connection(&id)?;
    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    FILE_SEARCHES.lock().map_err(|e| e.to_string())?.insert(request_id.clone(), cancelled.clone());
    let result = tauri::async_runtime::spawn_blocking(move || ssh_search_sync(&conn, &path, &text, &cancelled)).await;
    if let Ok(mut requests) = FILE_SEARCHES.lock() { requests.remove(&request_id); }
    result.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ssh_search_cancel(request_id: String) {
    if let Ok(requests) = FILE_SEARCHES.lock() {
        if let Some(cancelled) = requests.get(&request_id) { cancelled.store(true, std::sync::atomic::Ordering::Relaxed); }
    }
}

/// 本地下载根目录：~/.vrykell/downloads
pub(crate) fn downloads_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or("无法定位主目录".to_string())?
        .join(".vrykell")
        .join("downloads");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    Ok(dir)
}

/// 递归下载远程目录到本地 dest，返回累计字节数。
fn download_dir_recursive(sftp: &Sftp, remote: &Path, local: &Path, depth: u32) -> Result<u64, String> {
    if depth > 40 {
        return Err("目录层级过深，已中止下载".to_string());
    }
    let mut total: u64 = 0;
    let entries = sftp
        .readdir(remote)
        .map_err(|e| format!("读取目录 {} 失败：{e}", remote.display()))?;
    for (p, stat) in entries {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        // 校验为安全单组件：拒绝 `.`/`..` 与含分隔符的名称，防止路径遍历逃逸
        if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
            continue;
        }
        let local_child = local.join(&name);
        if stat.is_dir() {
            std::fs::create_dir_all(&local_child)
                .map_err(|e| format!("创建本地目录失败：{e}"))?;
            total += download_dir_recursive(sftp, &p, &local_child, depth + 1)?;
        } else {
            let mut file = sftp
                .open(&p)
                .map_err(|e| format!("打开远程文件失败：{e}"))?;
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)
                .map_err(|e| format!("下载 {} 失败：{e}", p.display()))?;
            std::fs::write(&local_child, &buf)
                .map_err(|e| format!("写入本地文件失败：{e}"))?;
            total += buf.len() as u64;
        }
    }
    Ok(total)
}

/// 下载远程文件/目录到 ~/.vrykell/downloads，返回 (本地路径, 字节数)。
fn ssh_download_sync(conn: &SshConnection, remote_path: &str) -> Result<(String, u64), String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    let stat = sftp
        .stat(Path::new(remote_path))
        .map_err(|e| format!("读取文件信息失败：{e}"))?;
    let name = Path::new(remote_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());
    let dest = downloads_dir()?.join(&name);

    if stat.is_dir() {
        std::fs::create_dir_all(&dest).map_err(|e| format!("创建本地目录失败：{e}"))?;
        let size = download_dir_recursive(&sftp, Path::new(remote_path), &dest, 0)?;
        Ok((dest.to_string_lossy().to_string(), size))
    } else {
        let mut file = sftp
            .open(Path::new(remote_path))
            .map_err(|e| format!("打开远程文件失败：{e}"))?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf).map_err(|e| format!("下载失败：{e}"))?;
        std::fs::write(&dest, &buf).map_err(|e| format!("写入本地文件失败：{e}"))?;
        Ok((dest.to_string_lossy().to_string(), buf.len() as u64))
    }
}

/// 下载远程文件/目录，返回本地路径，并写入下载历史。
#[tauri::command]
pub async fn ssh_download(
    state: State<'_, HistoryState>,
    id: String,
    path: String,
) -> Result<String, String> {
    let (conn, conn_name) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let c = db.get_ssh_connection(&id)?;
        let name = c.name.clone();
        (c, name)
    };
    let file_name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let remote_path = path.clone();
    let (local_path, size) = tauri::async_runtime::spawn_blocking(move || ssh_download_sync(&conn, &path))
        .await
        .map_err(|e| e.to_string())??;

    let is_dir = std::path::Path::new(&local_path).is_dir();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.record_download(&file_name, &local_path, &remote_path, &conn_name, is_dir, size, now)?;
    Ok(local_path)
}

/// 远端目录里为 name 找可用路径：同名时按 `name (1)`、`name (2)`… 递增（保留扩展名）。
/// 序号规则来自平台层（`crate::platform::path::numbered_name`），远端只负责判断是否存在。
fn unique_remote_path(sftp: &Sftp, dir: &str, name: &str) -> String {
    let candidate = crate::platform::path::numbered_name(name, |candidate| {
        sftp.stat(Path::new(&crate::platform::path::join(dir, candidate))).is_ok()
    });
    crate::platform::path::join(dir, &candidate)
}

/// 重命名远程文件/目录；目标名被占用时自动加序号，返回最终路径。
fn ssh_rename_sync(conn: &SshConnection, path: &str, new_name: &str) -> Result<String, String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    let parent = crate::platform::path::parent(path).ok_or("无法定位父目录")?;
    let candidate = crate::platform::path::join(&parent, new_name);
    let dst = if candidate != path && sftp.stat(Path::new(&candidate)).is_ok() {
        unique_remote_path(&sftp, &parent, new_name)
    } else {
        candidate
    };
    sftp.rename(Path::new(path), Path::new(&dst), None)
        .map_err(|e| format!("重命名失败：{e}"))?;
    Ok(dst)
}

/// 移动远程文件/目录到目标目录（SFTP rename 支持跨目录；原地移动拒绝，重名自动加序号）。
fn ssh_move_sync(conn: &SshConnection, path: &str, dest_dir: &str) -> Result<String, String> {
    let name = crate::platform::path::file_name(path).ok_or("无法定位文件名")?;
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    let candidate = crate::platform::path::join(dest_dir, &name);
    if candidate == path {
        return Err("已在目标目录中".into());
    }
    let dst = if sftp.stat(Path::new(&candidate)).is_ok() {
        unique_remote_path(&sftp, dest_dir, &name)
    } else {
        candidate
    };
    sftp.rename(Path::new(path), Path::new(&dst), None)
        .map_err(|e| format!("移动失败：{e}"))?;
    Ok(dst)
}

/// 新建远程文件（空文件）或目录；同名时自动加序号，返回最终路径。
fn ssh_create_sync(conn: &SshConnection, dir: &str, name: &str, is_dir: bool) -> Result<String, String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    if sftp.stat(Path::new(dir)).is_err() {
        return Err(format!("目标目录不可用：{dir}"));
    }
    let direct = crate::platform::path::join(dir, name);
    let path = if sftp.stat(Path::new(&direct)).is_ok() {
        // 同名时按 name (1) 递增避让（unique_remote_path 只在重名时调用）
        unique_remote_path(&sftp, dir, name)
    } else {
        direct
    };
    if is_dir {
        sftp.mkdir(Path::new(&path), 0o755).map_err(|e| format!("新建文件夹失败：{e}"))?;
    } else {
        sftp.create(Path::new(&path)).map_err(|e| format!("新建文件失败：{e}"))?;
    }
    Ok(path)
}

// ── 远程面板：复制 / 可回退删除（远端暂存） ──

/// 远端 shell 单引号转义（与前端 shellQuote 同规则）。
fn shell_quote_remote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// 远端暂存目录（可回退删除）：<home>/.vrykell/undo
fn ssh_undo_dir(sftp: &Sftp) -> Result<String, String> {
    let home = sftp
        .realpath(Path::new("."))
        .map_err(|e| format!("无法定位远端主目录：{e}"))?;
    let home = home.to_string_lossy().to_string();
    Ok(crate::platform::path::join(&crate::platform::path::join(&home, ".vrykell"), "undo"))
}

/// 逐级创建远端目录（已存在时忽略）。
fn ensure_remote_dir(sftp: &Sftp, dir: &str) -> Result<(), String> {
    let normalized = crate::platform::path::normalize(dir);
    let mut current = String::new();
    for segment in normalized.split('/').filter(|part| !part.is_empty()) {
        current = crate::platform::path::join(&current, segment);
        let _ = sftp.mkdir(Path::new(&current), 0o755); // 已存在会报错，忽略
    }
    Ok(())
}

/// 递归删除远端路径（目录先清空再 rmdir；用于暂存项清理）。
fn remove_remote_recursive(sftp: &Sftp, target: &str) -> Result<(), String> {
    let stat = sftp.stat(Path::new(target)).map_err(|e| format!("读取远端信息失败：{e}"))?;
    if stat.is_dir() {
        if let Ok(children) = sftp.readdir(Path::new(target)) {
            for (child, _) in children {
                // readdir 的路径由宿主平台拼接（Windows 上是 `\`），只取名字再按 POSIX 拼
                let Some(name) = crate::platform::path::name_from_listing(&child.to_string_lossy(), target) else {
                    continue;
                };
                remove_remote_recursive(sftp, &crate::platform::path::join(target, &name))?;
            }
        }
        sftp.rmdir(Path::new(target)).map_err(|e| format!("删除远端目录失败：{e}"))
    } else {
        sftp.unlink(Path::new(target)).map_err(|e| format!("删除远端文件失败：{e}"))
    }
}

/// 远端复制单条到指定目标路径（`cp -R`，参数单引号转义；目标必须尚不存在）。
fn remote_copy_one(sess: &Session, from: &str, to: &str) -> Result<(), String> {
    let command = format!("cp -R -- {} {}", shell_quote_remote(from), shell_quote_remote(to));
    let mut channel = sess.channel_session().map_err(|e| format!("打开远端通道失败：{e}"))?;
    channel.exec(&command).map_err(|e| format!("执行复制失败：{e}"))?;
    let mut stderr = String::new();
    let _ = channel.stderr().read_to_string(&mut stderr);
    let _ = channel.wait_close();
    let code = channel.exit_status().unwrap_or(-1);
    if code != 0 {
        let detail = if stderr.trim().is_empty() { format!("退出码 {code}") } else { stderr.trim().to_string() };
        return Err(format!("复制失败：{detail}"));
    }
    Ok(())
}

/// 复制远程文件/目录到目标目录（逐项预检：原地、自身子树、目标同名都拒绝）。
fn ssh_copy_sync(conn: &SshConnection, paths: Vec<String>, dest_dir: String) -> Result<FileOpOutcome, String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    // 绝对/相对判断必须按远端（POSIX）规则：Windows 宿主上 Path::is_absolute("/home") 为 false
    if !crate::platform::path::is_absolute(&dest_dir) {
        return Err("目标目录必须是绝对路径".into());
    }
    if sftp.stat(Path::new(&dest_dir)).is_err() {
        return Err(format!("目标目录不可用：{dest_dir}"));
    }

    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        let Some(name) = crate::platform::path::file_name(&path) else {
            errors.push(format!("无法定位 {path} 的文件名"));
            continue;
        };
        let src_is_dir = sftp.stat(Path::new(&path)).map(|s| s.is_dir()).unwrap_or(false);
        if src_is_dir && crate::platform::path::is_within(&dest_dir, &path) {
            errors.push(format!("不能把「{name}」放入它自己内部"));
            continue;
        }
        let direct = crate::platform::path::join(&dest_dir, &name);
        // 目标重名（含复制到自己所在目录）→ 自动加序号，不产生重名文件
        let target = if direct == path || sftp.stat(Path::new(&direct)).is_ok() {
            unique_remote_path(&sftp, &dest_dir, &name)
        } else {
            direct
        };
        match remote_copy_one(&sess, &path, &target) {
            Ok(()) => completed.push(FileOpPair { from: path, to: target }),
            Err(error) => errors.push(error),
        }
    }
    Ok(FileOpOutcome { completed, errors })
}

/// 可回退删除：把远程条目移动到远端暂存目录。
fn ssh_stage_delete_sync(conn: &SshConnection, paths: Vec<String>) -> Result<FileOpOutcome, String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    let dir = ssh_undo_dir(&sftp)?;
    ensure_remote_dir(&sftp, &dir)?;

    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        let Some(name) = crate::platform::path::file_name(&path) else {
            errors.push(format!("无法定位 {path} 的文件名"));
            continue;
        };
        let staged = crate::platform::path::join(&dir, &format!("{}-{name}", uuid::Uuid::new_v4()));
        match sftp.rename(Path::new(&path), Path::new(&staged), None) {
            Ok(()) => completed.push(FileOpPair { from: path, to: staged }),
            Err(error) => errors.push(format!("删除失败：{error}")),
        }
    }
    Ok(FileOpOutcome { completed, errors })
}

/// 回退删除：把暂存项移回原位（原位置已有同名项时该项报错）。
fn ssh_restore_staged_sync(conn: &SshConnection, items: Vec<FileOpPair>) -> Result<FileOpOutcome, String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for item in items {
        if sftp.stat(Path::new(&item.from)).is_ok() {
            errors.push(format!("恢复失败：{} 已存在同名项", item.from));
            continue;
        }
        match sftp.rename(Path::new(&item.to), Path::new(&item.from), None) {
            Ok(()) => completed.push(item),
            Err(error) => errors.push(format!("恢复失败：{error}")),
        }
    }
    Ok(FileOpOutcome { completed, errors })
}

/// 把暂存项永久删除（回退窗口结束）。
fn ssh_purge_staged_sync(conn: &SshConnection, paths: Vec<String>) {
    let Ok(sess) = connect(conn) else { return };
    let Ok(sftp) = sess.sftp() else { return };
    for path in paths {
        let _ = remove_remote_recursive(&sftp, &path);
    }
}

/// 清理远端暂存目录残留（面板挂载时调用一次）。
fn ssh_sweep_undo_sync(conn: &SshConnection) {
    let Ok(sess) = connect(conn) else { return };
    let Ok(sftp) = sess.sftp() else { return };
    let Ok(dir) = ssh_undo_dir(&sftp) else { return };
    let Ok(children) = sftp.readdir(Path::new(&dir)) else { return };
    for (child, _) in children {
        let Some(name) = crate::platform::path::name_from_listing(&child.to_string_lossy(), &dir) else {
            continue;
        };
        let _ = remove_remote_recursive(&sftp, &crate::platform::path::join(&dir, &name));
    }
}

#[tauri::command]
pub async fn ssh_copy(
    state: State<'_, HistoryState>,
    id: String,
    paths: Vec<String>,
    dest_dir: String,
) -> Result<FileOpOutcome, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_copy_sync(&conn, paths, dest_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_stage_delete(
    state: State<'_, HistoryState>,
    id: String,
    paths: Vec<String>,
) -> Result<FileOpOutcome, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_stage_delete_sync(&conn, paths))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_restore_staged(
    state: State<'_, HistoryState>,
    id: String,
    items: Vec<FileOpPair>,
) -> Result<FileOpOutcome, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_restore_staged_sync(&conn, items))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_purge_staged(
    state: State<'_, HistoryState>,
    id: String,
    paths: Vec<String>,
) -> Result<(), String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_purge_staged_sync(&conn, paths))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_sweep_undo(state: State<'_, HistoryState>, id: String) -> Result<(), String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_sweep_undo_sync(&conn))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 递归上传本地目录到远程目录，返回上传文件数（远端路径按 POSIX 拼接，本地路径用 std）。
fn upload_dir_recursive(sftp: &Sftp, local: &Path, remote: &str, depth: u32) -> Result<u64, String> {
    if depth > 40 {
        return Err("目录层级过深，已中止上传".to_string());
    }
    let mut count = 0u64;
    let rd = std::fs::read_dir(local).map_err(|e| format!("读取本地目录失败：{e}"))?;
    for entry in rd.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let remote_child = crate::platform::path::join(remote, &name);
        let ft = entry.file_type().map_err(|e| format!("读取文件类型失败：{e}"))?;
        if ft.is_dir() {
            sftp.mkdir(Path::new(&remote_child), 0o755)
                .map_err(|e| format!("创建远程目录失败：{e}"))?;
            count += upload_dir_recursive(sftp, &p, &remote_child, depth + 1)?;
        } else if ft.is_file() {
            let bytes = std::fs::read(&p).map_err(|e| format!("读取本地文件失败：{e}"))?;
            let mut file = sftp
                .create(Path::new(&remote_child))
                .map_err(|e| format!("创建远程文件失败：{e}"))?;
            file.write_all(&bytes).map_err(|e| format!("上传失败：{e}"))?;
            count += 1;
        }
    }
    Ok(count)
}

/// Upload a local file or directory into a remote directory (empty `remote_dir` means the remote home).
/// Returns the final remote path (a sequence number may have been added to avoid an existing name).
fn ssh_upload_sync(conn: &SshConnection, remote_dir: &str, local_path: &str) -> Result<String, String> {
    // Local side uses host platform rules to get the file name
    let name = Path::new(local_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("无法定位文件名")?;

    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    let base = if remote_dir.is_empty() {
        sftp.realpath(Path::new("."))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "/".to_string())
    } else {
        remote_dir.to_string()
    };
    // 远程已有同名项时自动加序号，上传不静默覆盖
    let direct = crate::platform::path::join(&base, &name);
    let remote_path = if sftp.stat(Path::new(&direct)).is_ok() {
        unique_remote_path(&sftp, &base, &name)
    } else {
        direct
    };

    let meta = std::fs::metadata(local_path).map_err(|e| format!("读取本地文件信息失败：{e}"))?;
    if meta.is_dir() {
        sftp.mkdir(Path::new(&remote_path), 0o755)
            .map_err(|e| format!("创建远程目录失败：{e}"))?;
        upload_dir_recursive(&sftp, Path::new(local_path), &remote_path, 0)?;
    } else {
        let bytes = std::fs::read(local_path).map_err(|e| format!("读取本地文件失败：{e}"))?;
        let mut file = sftp
            .create(Path::new(&remote_path))
            .map_err(|e| format!("创建远程文件失败：{e}"))?;
        file.write_all(&bytes).map_err(|e| format!("上传失败：{e}"))?;
    }
    Ok(remote_path)
}

#[tauri::command]
pub async fn ssh_move(
    state: State<'_, HistoryState>,
    id: String,
    path: String,
    dest_dir: String,
) -> Result<String, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_move_sync(&conn, &path, &dest_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_rename(
    state: State<'_, HistoryState>,
    id: String,
    path: String,
    new_name: String,
) -> Result<String, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_rename_sync(&conn, &path, &new_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_create_file(
    state: State<'_, HistoryState>,
    id: String,
    dir: String,
    name: String,
) -> Result<String, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_create_sync(&conn, &dir, &name, false))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_create_dir(
    state: State<'_, HistoryState>,
    id: String,
    dir: String,
    name: String,
) -> Result<String, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_create_sync(&conn, &dir, &name, true))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_upload(
    state: State<'_, HistoryState>,
    id: String,
    remote_dir: String,
    local_path: String,
) -> Result<String, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_upload_sync(&conn, &remote_dir, &local_path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_no_jump_profile_uses_the_direct_file_connection_path() {
        let mut conn: SshConnection = serde_json::from_value(serde_json::json!({
            "id": "direct", "name": "direct", "host": "localhost", "jumpHost": "none"
        })).unwrap();
        assert_eq!(connect(&conn).err().as_deref(), Some("用户名不能为空"));
        conn.options.jump_host = Some("bastion".into());
        assert!(connect(&conn).err().unwrap().contains("跳板机"));
    }

    #[test]
    fn trust_requires_the_confirmed_fingerprint() {
        assert!(validate_confirmed_fingerprint("SHA256:abc", "SHA256:abc").is_ok());
        assert!(validate_confirmed_fingerprint("SHA256:abc", "SHA256:abc=").is_ok());
        assert!(validate_confirmed_fingerprint("SHA256:changed", "SHA256:abc").is_err());
        assert!(validate_confirmed_fingerprint("unknown", "unknown").is_err());
    }

    #[test]
    fn remote_entry_paths_follow_posix_rules() {
        // 条目路径由平台层 POSIX 拼接产生：Windows 宿主上也不能出现反斜杠或双斜杠
        let path = crate::platform::path::join("/home/user/", "docs");
        assert_eq!(path, "/home/user/docs");
        assert!(!path.contains('\\'));
        assert_eq!(crate::platform::path::name_from_listing("/home/user\\docs", "/home/user").as_deref(), Some("docs"));
        assert_eq!(crate::platform::path::name_from_listing("/home/user/docs", "/home/user").as_deref(), Some("docs"));
    }

    #[test]
    fn sftp_entry_shape_is_stable() {
        // 仅验证结构体字段序列化形状（camelCase 由前端消费）
        let e = SshFsEntry { name: "a".into(), path: "/a".into(), is_dir: true };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"name\":\"a\""));
        assert!(json.contains("\"is_dir\":true"));
        assert!(json.contains("\"path\":\"/a\""));
    }

    // 说明：connect / ssh_list_sync 依赖真实 SSH 服务，无法离线单测，
    // 由 e2e（mock ssh_list）+ 手动真机验证覆盖。
    // 真机手动验证：`cargo test manual_local_sftp -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn manual_local_sftp() {
        let conn = SshConnection {
            id: String::new(),
            name: String::new(),
            host: "127.0.0.1".into(),
            port: Some(22),
            user: "wuzhe".into(),
            password: String::new(),
            auth_method: "password".into(),
            last_opened_at: None,
            has_password: false,
        options: Default::default(),
        };
        let res = ssh_list_sync(&conn, None).expect("列出远程 home 失败");
        println!("SFTP 条目数: {}（base={}）", res.entries.len(), res.base);
        for e in res.entries.iter().take(10) {
            println!("  {}  {}", if e.is_dir { "d" } else { "-" }, e.name);
        }
        assert!(!res.entries.is_empty(), "远程 home 不应为空");
        // 下载一个文件验证 ssh_download
        let (local, size) = ssh_download_sync(&conn, "/Users/wuzhe/.DS_Store").expect("下载失败");
        println!("下载到: {local}（{size} 字节）");
        assert!(std::path::Path::new(&local).exists());
    }
    /// 从屏幕文本里找出「单个数字用空格分隔」的验证码行。
    fn captcha_digits(text: &str) -> Option<String> {
        text.lines().rev().find_map(|line| {
            let tokens: Vec<&str> = line.split_whitespace().collect();
            (tokens.len() >= 4 && tokens.iter().all(|token| token.len() == 1 && token.chars().all(|c| c.is_ascii_digit())))
                .then(|| tokens.concat())
        })
    }

    // 真机手动验证（需要网络与外部服务）：
    // `cargo test manual_chat_server_flow -- --ignored --nocapture`
    // 走「前置指纹校验 → 生产命令构造 → PTY 启动 → 密码 → 验证码 → 交互界面 → 退出」。
    #[test]
    #[ignore]
    fn manual_chat_server_flow() {
        use std::io::{Read, Write};
        use std::sync::{Arc, Mutex};
        use std::time::{Duration, Instant};

        let host = "www.altzin.com";
        let port = 2222u16;
        let conn = SshConnection {
            id: String::new(),
            name: String::new(),
            host: host.into(),
            port: Some(port),
            user: "vrykell_probe".into(),
            password: String::new(),
            auth_method: "password".into(),
            last_opened_at: None,
            has_password: false,
            options: Default::default(),
        };

        // 1) 与前端 prepareSshHost 相同的前置校验
        let mut host_key_type: Option<String> = None;
        match tcp_handshake(&conn) {
            Ok(sess) => {
                let (_, key_type) = sess.host_key().expect("远端未返回主机密钥");
                println!("key_type={key_type:?} fingerprint={}", fingerprint_of(&sess));
                println!("known_hosts 校验：{:?}", verify_host_key(&sess, host, port));
                host_key_type = Some(format!("{key_type:?}").to_lowercase());
            }
            Err(error) => println!("前置校验失败（继续用真实 ssh 验证）：{error}"),
        }

        // 2) 用生产命令构造器启动交互会话
        let target: crate::terminal::ssh_command::SshTarget = serde_json::from_value(serde_json::json!({
            "host": host, "user": "vrykell_probe", "port": port,
            "hostKeyType": host_key_type,
            "shellIntegration": false, "serverAliveInterval": 30, "hostKeyPolicy": "ask"
        }))
        .expect("构造 SSH 目标失败");
        let cmd = crate::terminal::ssh_command::build_ssh_command(&target, None).expect("构造 ssh 命令失败");
        println!("argv={:?}", cmd.get_argv());

        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(portable_pty::PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 })
            .expect("openpty 失败");
        let mut child = pair.slave.spawn_command(cmd).expect("启动 ssh 失败");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("读取端失败");
        let mut writer = pair.master.take_writer().expect("写入端失败");
        let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = Arc::clone(&buffer);
        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            while let Ok(n) = reader.read(&mut chunk) {
                if n == 0 { break; }
                sink.lock().unwrap().extend_from_slice(&chunk[..n]);
            }
        });

        let screen = |buffer: &Arc<Mutex<Vec<u8>>>| String::from_utf8_lossy(&buffer.lock().unwrap().clone()).to_string();
        let started = Instant::now();
        let (mut sent_password, mut sent_captcha, mut quit) = (false, false, false);
        while started.elapsed() < Duration::from_secs(60) {
            std::thread::sleep(Duration::from_millis(120));
            let text = screen(&buffer);
            if !sent_password && text.contains("password:") {
                writer.write_all(b"probe-passphrase\r").unwrap();
                writer.flush().unwrap();
                sent_password = true;
                println!("[{}ms] 已发送密码", started.elapsed().as_millis());
            }
            if sent_password && !sent_captcha {
                if let Some(captcha) = captcha_digits(&text) {
                    writer.write_all(format!("{captcha}\r").as_bytes()).unwrap();
                    writer.flush().unwrap();
                    sent_captcha = true;
                    println!("[{}ms] 已提交验证码 {captcha}", started.elapsed().as_millis());
                }
            }
            if sent_captcha && !quit && text.contains("sshfm") {
                std::thread::sleep(Duration::from_secs(1));
                writer.write_all(b"q").unwrap();
                writer.flush().unwrap();
                quit = true;
                println!("[{}ms] 已发送退出键", started.elapsed().as_millis());
            }
            if let Ok(Some(status)) = child.try_wait() {
                println!("ssh 退出：{status:?}");
                break;
            }
        }

        if let Some(root) = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            let path = root.join(".cache-usability.local").join("chat-server-stream.bin");
            let _ = std::fs::write(&path, buffer.lock().unwrap().clone());
            println!("原始字节：{}", path.display());
        }
        println!("---- 屏幕 ----\n{}", screen(&buffer).escape_debug());
        assert!(sent_password, "未出现密码提示");
    }

}
