//! SSH 连接管理：连接 CRUD 存后端 SQLite（见 history.rs 的 ssh_connections 表）。
//!
//! 连接测试 / 远程目录列出走 **SFTP**（ssh2 crate，SSH 自带的文件子系统），
//! 不经过远端 shell、不注入脚本，天然支持特殊字符与文件元数据（对齐 WindTerm 的做法）。
//!
//! 终端会话本身仍由前端经 `pty_spawn`（pty.rs）用 `ssh` CLI 拉起（交互式），这里只做非交互式后端操作。

use crate::db::{HistoryState, SshConnection};
use serde::Serialize;
use ssh2::{CheckResult, HostKeyType, KnownHostFileKind, KnownHostKeyFormat, Session, Sftp};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;
use tauri::State;

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct SshFsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 建立 TCP 连接 + SSH 握手 + 认证，返回已认证的会话。
fn connect(conn: &SshConnection) -> Result<Session, String> {
    let host = conn.host.as_str();
    let port = conn.port.unwrap_or(22);
    let user = conn.user.trim();
    // 用户名为空时直接报错，绝不静默默认 root（误留空表单会以 root 登录）
    if user.is_empty() {
        return Err("用户名不能为空".to_string());
    }

    let tcp = TcpStream::connect((host, port))
        .map_err(|e| format!("连接 {host}:{port} 失败：{e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(15))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(15))).ok();

    let mut sess = Session::new().map_err(|e| format!("初始化 SSH 失败：{e}"))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH 握手失败：{e}"))?;

    // 主机密钥校验（TOFU：首次记录，之后严格比对，防中间人）
    verify_host_key(&sess, host, port)?;

    authenticate(&sess, conn, user)?;
    if !sess.authenticated() {
        return Err("认证失败".to_string());
    }
    Ok(sess)
}

/// 主机密钥校验：读 ~/.ssh/known_hosts，首次连接记录（TOFU），之后严格比对。
fn verify_host_key(sess: &Session, host: &str, port: u16) -> Result<(), String> {
    let (key, key_type) = sess.host_key().ok_or("远端未返回主机密钥".to_string())?;
    let mut kh = sess.known_hosts().map_err(|e| format!("初始化 known_hosts 失败：{e}"))?;

    let kh_path = dirs::home_dir()
        .map(|h| h.join(".ssh").join("known_hosts"))
        .unwrap_or_default();
    if kh_path.exists() {
        kh.read_file(&kh_path, KnownHostFileKind::OpenSSH).ok();
    }

    match kh.check_port(host, port, key) {
        CheckResult::Match => Ok(()),
        CheckResult::NotFound => {
            // TOFU：首次连接记录主机密钥
            let fmt = host_key_format(key_type);
            let kh_host = if port == 22 { host.to_string() } else { format!("[{host}]:{port}") };
            kh.add(&kh_host, key, "ai-terminal", fmt)
                .map_err(|e| format!("记录主机密钥失败：{e}"))?;
            if let Some(dir) = kh_path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            kh.write_file(&kh_path, KnownHostFileKind::OpenSSH)
                .map_err(|e| format!("写入 known_hosts 失败：{e}"))?;
            Ok(())
        }
        CheckResult::Mismatch => Err(format!("主机密钥不匹配（可能存在中间人攻击）：{host}")),
        CheckResult::Failure => Err(format!("主机密钥校验失败：{host}")),
    }
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
            let pub_opt = pub_path.exists().then(|| pub_path.as_path());
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

fn ssh_list_sync(conn: &SshConnection, path: Option<String>) -> Result<Vec<SshFsEntry>, String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;

    let dir = path.unwrap_or_default();
    // 空路径 → 远程 home（SFTP 的当前目录即登录主目录）
    let base = if dir.is_empty() {
        sftp.realpath(Path::new("."))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "/".to_string())
    } else {
        dir
    };

    let entries = sftp
        .readdir(Path::new(&base))
        .map_err(|e| format!("读取目录 {base} 失败：{e}"))?;

    let mut result: Vec<SshFsEntry> = Vec::new();
    for (p, stat) in entries {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        result.push(SshFsEntry {
            name: name.clone(),
            path: join_path(&base, &name),
            is_dir: stat.is_dir(),
        });
    }
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(result)
}

/// 拼接目录路径（去掉重复斜杠）。纯函数，便于单测。
fn join_path(base: &str, name: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), name)
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

// ── 连接测试 / 远程目录 ──

/// 测试连接（显式参数，供表单在保存前测试）。
#[tauri::command]
pub async fn ssh_test(
    host: String,
    port: Option<u16>,
    user: String,
    password: String,
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
    };
    tauri::async_runtime::spawn_blocking(move || ssh_test_sync(&conn))
        .await
        .map_err(|e| e.to_string())?
}

/// 列出远程目录（按连接 id，密码由后端解析）。
#[tauri::command]
pub async fn ssh_list(
    state: State<'_, HistoryState>,
    id: String,
    path: Option<String>,
) -> Result<Vec<SshFsEntry>, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_list_sync(&conn, path))
        .await
        .map_err(|e| e.to_string())?
}

/// 本地下载根目录：~/.ai-terminal/downloads
fn downloads_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or("无法定位主目录".to_string())?
        .join(".ai-terminal")
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

/// 下载远程文件/目录到 ~/.ai-terminal/downloads，返回 (本地路径, 字节数)。
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

/// 重命名远程文件/目录。
fn ssh_rename_sync(conn: &SshConnection, path: &str, new_name: &str) -> Result<(), String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    let parent = Path::new(path).parent().ok_or("无法定位父目录")?;
    let dst = parent.join(new_name);
    sftp.rename(Path::new(path), &dst, None)
        .map_err(|e| format!("重命名失败：{e}"))
}

/// 删除远程文件（空目录用 rmdir，文件用 unlink）。
fn ssh_delete_sync(conn: &SshConnection, path: &str) -> Result<(), String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败：{e}"))?;
    let stat = sftp.stat(Path::new(path)).map_err(|e| format!("读取文件信息失败：{e}"))?;
    if stat.is_dir() {
        sftp.rmdir(Path::new(path)).map_err(|e| format!("删除目录失败（需为空目录）：{e}"))
    } else {
        sftp.unlink(Path::new(path)).map_err(|e| format!("删除文件失败：{e}"))
    }
}

/// 递归上传本地目录到远程目录，返回上传文件数。
fn upload_dir_recursive(sftp: &Sftp, local: &Path, remote: &Path, depth: u32) -> Result<u64, String> {
    if depth > 40 {
        return Err("目录层级过深，已中止上传".to_string());
    }
    let mut count = 0u64;
    let rd = std::fs::read_dir(local).map_err(|e| format!("读取本地目录失败：{e}"))?;
    for entry in rd.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let remote_child = remote.join(&name);
        let ft = entry.file_type().map_err(|e| format!("读取文件类型失败：{e}"))?;
        if ft.is_dir() {
            sftp.mkdir(&remote_child, 0o755)
                .map_err(|e| format!("创建远程目录失败：{e}"))?;
            count += upload_dir_recursive(sftp, &p, &remote_child, depth + 1)?;
        } else if ft.is_file() {
            let bytes = std::fs::read(&p).map_err(|e| format!("读取本地文件失败：{e}"))?;
            let mut file = sftp
                .create(&remote_child)
                .map_err(|e| format!("创建远程文件失败：{e}"))?;
            file.write_all(&bytes).map_err(|e| format!("上传失败：{e}"))?;
            count += 1;
        }
    }
    Ok(count)
}

/// 上传本地文件/目录到远程目录（remote_dir 为空表示远程 home）。
fn ssh_upload_sync(conn: &SshConnection, remote_dir: &str, local_path: &str) -> Result<(), String> {
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
    let remote_path = join_path(&base, &name);

    let meta = std::fs::metadata(local_path).map_err(|e| format!("读取本地文件信息失败：{e}"))?;
    if meta.is_dir() {
        sftp.mkdir(Path::new(&remote_path), 0o755)
            .map_err(|e| format!("创建远程目录失败：{e}"))?;
        upload_dir_recursive(&sftp, Path::new(local_path), Path::new(&remote_path), 0)?;
    } else {
        let bytes = std::fs::read(local_path).map_err(|e| format!("读取本地文件失败：{e}"))?;
        let mut file = sftp
            .create(Path::new(&remote_path))
            .map_err(|e| format!("创建远程文件失败：{e}"))?;
        file.write_all(&bytes).map_err(|e| format!("上传失败：{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_rename(
    state: State<'_, HistoryState>,
    id: String,
    path: String,
    new_name: String,
) -> Result<(), String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_rename_sync(&conn, &path, &new_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_delete(
    state: State<'_, HistoryState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh_delete_sync(&conn, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_upload(
    state: State<'_, HistoryState>,
    id: String,
    remote_dir: String,
    local_path: String,
) -> Result<(), String> {
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
    fn join_path_trims_trailing_slash() {
        assert_eq!(join_path("/home/user", "docs"), "/home/user/docs");
        assert_eq!(join_path("/home/user/", "docs"), "/home/user/docs");
        assert_eq!(join_path("/", "etc"), "/etc");
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
        };
        let entries = ssh_list_sync(&conn, None).expect("列出远程 home 失败");
        println!("SFTP 条目数: {}", entries.len());
        for e in entries.iter().take(10) {
            println!("  {}  {}", if e.is_dir { "d" } else { "-" }, e.name);
        }
        assert!(!entries.is_empty(), "远程 home 不应为空");
        // 下载一个文件验证 ssh_download
        let (local, size) = ssh_download_sync(&conn, "/Users/wuzhe/.DS_Store").expect("下载失败");
        println!("下载到: {local}（{size} 字节）");
        assert!(std::path::Path::new(&local).exists());
    }
}
