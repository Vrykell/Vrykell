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
use serde::{Deserialize, Serialize};
use ssh2::{CheckResult, ExtendedData, HostKeyType, KnownHostFileKind, KnownHostKeyFormat, Session, Sftp};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;
use tauri::State;
use super::session_auth::{AuthMethod, Credential, AUTH_CACHE};
use zeroize::Zeroizing;

static KH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SshSystemStatus {
    system: String,
    hostname: String,
    latency_ms: u128,
    uptime_seconds: Option<f64>,
    load: String,
    cpu_total: Option<f64>,
    cpu_idle: Option<f64>,
    memory_total: Option<f64>,
    memory_available: Option<f64>,
    disk_total: Option<f64>,
    disk_used: Option<f64>,
    network_received: Option<f64>,
    network_transmitted: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SshStatusMetrics {
    status: bool,
    cpu: bool,
    memory: bool,
    disk: bool,
    network: bool,
    load: bool,
    uptime: bool,
}

impl SshStatusMetrics {
    fn all() -> Self { Self { status: true, cpu: true, memory: true, disk: true, network: true, load: true, uptime: true } }
    fn any(self) -> bool { self.status || self.cpu || self.memory || self.disk || self.network || self.load || self.uptime }
}

/// Only fixed script sections enter the remote command; selections never contain command text.
fn system_status_command(metrics: SshStatusMetrics) -> String {
    [
        (metrics.status, "printf 'system=%s\\n' \"$(uname -sr 2>/dev/null)\"\nprintf 'hostname=%s\\n' \"$(hostname 2>/dev/null)\"\n"),
        (metrics.uptime, "if [ -r /proc/uptime ]; then awk '{print \"uptime=\" $1}' /proc/uptime; fi\n"),
        (metrics.load, "if [ -r /proc/loadavg ]; then awk '{print \"load=\" $1 \" \" $2 \" \" $3}' /proc/loadavg; fi\n"),
        (metrics.cpu, "if [ -r /proc/stat ]; then awk '/^cpu / {total=0; for(i=2;i<=9;i++) total+=$i; printf \"cpuTotal=%.0f\\ncpuIdle=%.0f\\n\", total, $5+$6; exit}' /proc/stat; fi\n"),
        (metrics.memory, "if [ -r /proc/meminfo ]; then awk '/^MemTotal:/ {printf \"memoryTotal=%.0f\\n\", $2*1024} /^MemAvailable:/ {printf \"memoryAvailable=%.0f\\n\", $2*1024}' /proc/meminfo; fi\n"),
        (metrics.disk, "LC_ALL=C df -Pk / 2>/dev/null | awk 'NR==2 {printf \"diskTotal=%.0f\\ndiskUsed=%.0f\\n\", $2*1024, $3*1024}'\n"),
        (metrics.network, "if [ -r /proc/net/dev ]; then awk 'NR>2 {split($0, parts, \":\"); iface=parts[1]; gsub(/[[:space:]]/, \"\", iface); if(iface!=\"lo\") {split(parts[2], bytes); received+=bytes[1]; transmitted+=bytes[9]}} END {printf \"networkReceived=%.0f\\nnetworkTransmitted=%.0f\\n\", received, transmitted}' /proc/net/dev; fi\n"),
    ].into_iter().filter_map(|(enabled, command)| enabled.then_some(command)).collect()
}

fn parse_system_status(output: &str, latency_ms: u128) -> SshSystemStatus {
    let fields: std::collections::HashMap<&str, &str> = output.lines().filter_map(|line| line.split_once('=')).collect();
    let number = |key: &str| fields.get(key).and_then(|value| value.parse::<f64>().ok()).filter(|value| value.is_finite() && *value >= 0.0);
    let string = |key: &str| fields.get(key).copied().unwrap_or_default().to_owned();
    SshSystemStatus { system: string("system"), hostname: string("hostname"), latency_ms,
        uptime_seconds: number("uptime"), load: string("load"), cpu_total: number("cpuTotal"), cpu_idle: number("cpuIdle"),
        memory_total: number("memoryTotal"), memory_available: number("memoryAvailable"), disk_total: number("diskTotal"), disk_used: number("diskUsed"),
        network_received: number("networkReceived"), network_transmitted: number("networkTransmitted") }
}

fn ssh_system_status_sync(conn: &SshConnection, metrics: SshStatusMetrics) -> Result<SshSystemStatus, String> {
    if !metrics.any() { return Ok(parse_system_status("", 0)); }
    let session = connect_with_timeout(conn, Some(Duration::from_secs(5)))?;
    session.set_timeout(5000);
    let latency = if metrics.status {
        let started = std::time::Instant::now();
        let mut probe = session.channel_session().map_err(|error| error.to_string())?;
        probe.handle_extended_data(ExtendedData::Merge).map_err(|error| error.to_string())?;
        probe.exec("true").map_err(|error| error.to_string())?;
        probe.send_eof().map_err(|error| error.to_string())?;
        let discarded = std::io::copy(&mut (&mut probe).take(16385), &mut std::io::sink()).map_err(|error| error.to_string())?;
        if discarded > 16384 { return Err("Probe response exceeded the size limit".into()); }
        probe.wait_eof().map_err(|error| error.to_string())?;
        probe.close().map_err(|error| error.to_string())?;
        probe.wait_close().map_err(|error| error.to_string())?;
        started.elapsed().as_millis()
    } else { 0 };
    let mut channel = session.channel_session().map_err(|error| error.to_string())?;
    channel.handle_extended_data(ExtendedData::Merge).map_err(|error| error.to_string())?;
    channel.exec("sh -s").map_err(|error| error.to_string())?;
    channel.write_all(system_status_command(metrics).as_bytes()).map_err(|error| error.to_string())?;
    channel.send_eof().map_err(|error| error.to_string())?;
    let mut output = String::new();
    // Bound remote output even when the server replaces the requested command.
    (&mut channel).take(16385).read_to_string(&mut output).map_err(|error| error.to_string())?;
    if output.len() > 16384 { return Err("Resource response exceeded the size limit".into()); }
    channel.wait_eof().map_err(|error| error.to_string())?;
    channel.close().map_err(|error| error.to_string())?;
    channel.wait_close().map_err(|error| error.to_string())?;
    if channel.exit_status().map_err(|error| error.to_string())? != 0 { return Err("Remote resource command failed".into()); }
    let status = parse_system_status(&output, latency);
    if metrics.status && status.system.is_empty() { return Err("Remote system does not support resource collection".into()); }
    Ok(status)
}

/// Read system metadata independently of the interactive terminal.
#[tauri::command]
pub async fn ssh_system_status(state: State<'_, HistoryState>, id: String, host: String, port: u16, user: Option<String>, metrics: Option<SshStatusMetrics>) -> Result<SshSystemStatus, String> {
    let conn = {
        let db = state.0.lock().map_err(|error| error.to_string())?;
        db.get_ssh_connection(&id)?
    };
    if conn.host != host || conn.port.unwrap_or(22) != port || user.as_ref().is_some_and(|user| *user != conn.user) {
        return Err("Saved connection address changed. Reopen the terminal to monitor its resources.".into());
    }
    tauri::async_runtime::spawn_blocking(move || connection_stage(&conn, "resource-collection", || ssh_system_status_sync(&conn, metrics.unwrap_or_else(SshStatusMetrics::all))))
        .await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod status_tests {
    use super::{connect_with_timeout, parse_system_status, ssh_system_status_sync, system_status_command, SshStatusMetrics};

    #[test]
    fn metric_selection_excludes_every_disabled_script_section() {
        let sections = [("status", "uname -sr"), ("cpu", "/proc/stat"), ("memory", "/proc/meminfo"),
            ("disk", "df -Pk"), ("network", "/proc/net/dev"), ("load", "/proc/loadavg"), ("uptime", "/proc/uptime")];
        for (selected, _) in sections {
            let metrics: SshStatusMetrics = serde_json::from_value(serde_json::json!({ selected: true })).unwrap();
            let command = system_status_command(metrics);
            for (name, marker) in sections { assert_eq!(command.contains(marker), name == selected, "selection={selected}, section={name}"); }
        }
        assert!(system_status_command(SshStatusMetrics::default()).is_empty());
        let all = system_status_command(SshStatusMetrics::all());
        for (_, marker) in sections { assert!(all.contains(marker)); }
    }

    #[test]
    fn no_metrics_returns_without_opening_a_remote_connection() {
        let connection = crate::db::SshConnection {
            id: "disabled".into(), name: "Disabled".into(), host: String::new(), port: Some(0), user: String::new(),
            password: String::new(), auth_method: "key".into(), options: Default::default(), last_opened_at: None, has_password: false,
        };
        let status = ssh_system_status_sync(&connection, SshStatusMetrics::default()).unwrap();
        assert!(status.system.is_empty());
        assert_eq!(status.cpu_total, None);
        assert_eq!(status.latency_ms, 0);
    }

    #[test]
    fn metric_selection_rejects_command_text_and_unknown_fields() {
        assert!(serde_json::from_value::<SshStatusMetrics>(serde_json::json!({ "cpu": "unexpected command text" })).is_err());
        assert!(serde_json::from_value::<SshStatusMetrics>(serde_json::json!({ "command": "uname" })).is_err());
    }

    #[test]
    #[ignore = "Requires VRYKELL_SSH_PROFILE_ID and a reachable saved SSH profile"]
    fn saved_profile_supports_sftp_and_resource_collection() -> Result<(), String> {
        let id = std::env::var("VRYKELL_SSH_PROFILE_ID").map_err(|error| error.to_string())?;
        let home = dirs::home_dir().ok_or("Home directory is unavailable")?;
        let database = rusqlite::Connection::open_with_flags(
            home.join(".vrykell/history.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ).map_err(|error| error.to_string())?;
        let profile = database.query_row(
            "SELECT name, host, port, user, auth_method, options_json FROM ssh_connections WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<u16>>(2)?,
                row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?)),
        ).map_err(|error| error.to_string())?;
        let connection = crate::db::SshConnection {
            password: crate::secret::get_secret(&id).unwrap_or_default(), id, name: profile.0,
            host: profile.1, port: profile.2, user: profile.3, auth_method: profile.4,
            options: serde_json::from_str(&profile.5).map_err(|error| error.to_string())?,
            last_opened_at: None, has_password: false,
        };
        let session = connect_with_timeout(&connection, Some(std::time::Duration::from_secs(5)))?;
        session.set_timeout(5000);
        println!("Authentication: succeeded");
        let files = session.sftp().map_err(|error| error.to_string()).and_then(|sftp| {
            let directory = sftp.realpath(std::path::Path::new(".")).map_err(|error| error.to_string())?;
            sftp.readdir(&directory).map(|entries| entries.len()).map_err(|error| error.to_string())
        });
        match &files {
            Ok(count) => println!("SFTP: succeeded ({count} directory entries)"),
            Err(error) => println!("SFTP: failed: {error}"),
        }
        drop(session);
        let resources = ssh_system_status_sync(&connection, SshStatusMetrics::all());
        match &resources {
            Ok(status) => println!("Resources: succeeded (CPU={}, memory={}, disk={})",
                status.cpu_total.is_some(), status.memory_total.is_some(), status.disk_total.is_some()),
            Err(error) => println!("Resources: failed: {error}"),
        }
        files?;
        resources?;
        Ok(())
    }

    #[test]
    fn collects_system_metadata_from_a_script_on_standard_input() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        #[cfg(windows)]
        let shell = std::path::Path::new("C:/Program Files/Git/usr/bin/sh.exe");
        #[cfg(windows)]
        if !shell.exists() { return; }
        #[cfg(not(windows))]
        let shell = std::path::Path::new("sh");
        let mut child = Command::new(shell).arg("-s")
            .env("PATH", "/usr/bin:/bin")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().expect("A POSIX shell is required for the collection test");
        child.stdin.take().unwrap().write_all(system_status_command(SshStatusMetrics::all()).as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let status = parse_system_status(&String::from_utf8_lossy(&output.stdout), 0);
        assert!(!status.system.is_empty());
        assert!(!status.hostname.is_empty());
    }

    #[test]
    fn parses_resource_samples_and_keeps_missing_values_unavailable() {
        let status = parse_system_status("system=Linux 6.8\nhostname=node\nuptime=90.5\nload=0.1 0.2 0.3\ncpuTotal=1000\ncpuIdle=700\nmemoryTotal=8192\nmemoryAvailable=4096\ndiskTotal=10000\ndiskUsed=3000\nnetworkReceived=123456\nnetworkTransmitted=654321", 42);
        assert_eq!(status.system, "Linux 6.8");
        assert_eq!(status.latency_ms, 42);
        assert_eq!(status.uptime_seconds, Some(90.5));
        assert_eq!(status.cpu_idle, Some(700.0));
        assert_eq!(status.memory_available, Some(4096.0));
        assert_eq!(status.disk_used, Some(3000.0));
        assert_eq!(status.network_received, Some(123456.0));
        assert_eq!(status.network_transmitted, Some(654321.0));
        let missing = parse_system_status("system=Darwin\nmemoryTotal=NaN\ncpuTotal=-1\ndiskUsed=invalid", 1);
        assert_eq!(missing.memory_total, None);
        assert_eq!(missing.cpu_total, None);
        assert_eq!(missing.disk_used, None);
        assert_eq!(missing.uptime_seconds, None);
        assert_eq!(missing.network_received, None);
        assert_eq!(missing.network_transmitted, None);
    }
}
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

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshSearchResponse {
    entries: Vec<SshFsEntry>,
    truncated: bool,
    skipped: usize,
}

/// Search file names through a single authenticated channel with bounded work.
fn ssh_search_sync(conn: &SshConnection, root: &str, query: &str, cancelled: &std::sync::atomic::AtomicBool,
    mut on_progress: impl FnMut(&SshSearchResponse)) -> Result<SshSearchResponse, String> {
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
    let mut published = 0;
    let mut last_publish = started;
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
                if published == 0 || result.entries.len() - published >= 20 || last_publish.elapsed() >= Duration::from_millis(100) {
                    on_progress(&result);
                    published = result.entries.len();
                    last_publish = std::time::Instant::now();
                }
            }
            if stat.is_dir() {
                if depth < 12 && queue.len() < 500 { queue.push_back((path, depth + 1)); }
                else { result.truncated = true; }
            }
        }
        if result.entries.len() != published {
            on_progress(&result);
            published = result.entries.len();
            last_publish = std::time::Instant::now();
        }
    }
    Ok(result)
}

/// 建立 TCP 连接 + SSH 握手（不含主机密钥校验与认证）。
fn tcp_handshake(conn: &SshConnection) -> Result<Session, String> {
    tcp_handshake_with_timeout(conn, None)
}

fn tcp_handshake_with_timeout(conn: &SshConnection, timeout: Option<Duration>) -> Result<Session, String> {
    let host = conn.host.as_str();
    let port = conn.port.unwrap_or(22);

    let tcp = if let Some(timeout) = timeout {
        use std::net::ToSocketAddrs;
        let addresses = (host, port).to_socket_addrs().map_err(|error| error.to_string())?;
        let started = std::time::Instant::now();
        let mut result = Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Resource connection timed out"));
        for address in addresses {
            let remaining = timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() { break; }
            result = TcpStream::connect_timeout(&address, remaining);
            if result.is_ok() { break; }
        }
        result
    } else { TcpStream::connect((host, port)) }
        .map_err(|e| format!("连接 {host}:{port} 失败：{e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(15))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(15))).ok();

    let mut sess = Session::new().map_err(|e| format!("初始化 SSH 失败：{e}"))?;
    sess.set_tcp_stream(tcp);
    if let Some(timeout) = timeout { sess.set_timeout(timeout.as_millis() as u32); }
    sess.handshake().map_err(|e| format!("SSH 握手失败：{e}"))?;
    Ok(sess)
}

/// 建立 TCP 连接 + SSH 握手 + 主机密钥校验 + 认证，返回已认证的会话。
fn connect(conn: &SshConnection) -> Result<Session, String> {
    connect_with_timeout(conn, None)
}

/// Record connection stages without storing credentials, key paths or command output.
fn connection_stage<T>(conn: &SshConnection, stage: &str, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let started = std::time::Instant::now();
    let result = action();
    let _ = crate::diagnostics::record("ssh-backend-stage", serde_json::json!({
        "connectionId": conn.id, "stage": stage, "savedProfile": !conn.id.is_empty(),
        "authMethod": conn.auth_method, "hasPassword": !conn.password.is_empty(),
        "hasIdentityFile": conn.options.identity_file.is_some(),
        "durationMs": started.elapsed().as_millis(), "succeeded": result.is_ok(),
        "error": result.as_ref().err(),
    }));
    result
}

pub(crate) fn connect_with_timeout(conn: &SshConnection, timeout: Option<Duration>) -> Result<Session, String> {
    let credential = AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.get(conn);
    let result = connect_authenticated(conn, timeout, credential.as_deref());
    if result.as_ref().err().is_some_and(|error| error.starts_with("SSH_AUTH_FAILED:")) {
        if let Some(credential) = &credential {
            AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.reject(&conn.id, credential);
        }
    }
    result
}

fn connect_authenticated(conn: &SshConnection, timeout: Option<Duration>, credential: Option<&Credential>) -> Result<Session, String> {
    if conn.options.jump_host.as_deref().is_some_and(|jump| !jump.eq_ignore_ascii_case("none")) {
        return Err("跳板机连接请使用交互终端；文件管理暂不支持跳板机".into());
    }
    let user = conn.user.trim();
    // 用户名为空时直接报错，绝不静默默认 root（误留空表单会以 root 登录）
    if user.is_empty() {
        return Err("用户名不能为空".to_string());
    }
    let sess = connection_stage(conn, "handshake", || tcp_handshake_with_timeout(conn, timeout))?;
    connection_stage(conn, "host-trust", || verify_host_key(&sess, &conn.host, conn.port.unwrap_or(22)))?;
    connection_stage(conn, "authentication", || authenticate(&sess, conn, user, credential))?;
    if !sess.authenticated() {
        return Err("SSH_AUTH_FAILED: Additional authentication is required".to_string());
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

fn authenticate(sess: &Session, conn: &SshConnection, user: &str, credential: Option<&Credential>) -> Result<(), String> {
    if let Some(credential) = credential {
        return match credential.method {
            AuthMethod::Password => sess.userauth_password(user, &credential.secret)
                .map_err(|error| format!("SSH_AUTH_FAILED: Password authentication failed: {error}")),
            AuthMethod::KeyPassphrase => {
                let identity = conn.options.identity_file.as_deref().ok_or("SSH_AUTH_FAILED: No private key is configured")?;
                sess.userauth_pubkey_file(user, None, Path::new(identity), Some(&credential.secret))
                    .map_err(|error| format!("SSH_AUTH_FAILED: Private key authentication failed: {error}"))
            }
        };
    }
    if let Some(identity) = &conn.options.identity_file {
        sess.userauth_pubkey_file(user, None, Path::new(identity), None)
            .map_err(|error| format!("SSH_AUTH_FAILED: Private key authentication failed: {error}"))?;
        return Ok(());
    }
    // 密码认证
    if conn.auth_method == "password" && !conn.password.is_empty() {
        sess.userauth_password(user, &conn.password)
            .map_err(|error| format!("SSH_AUTH_FAILED: Password authentication failed: {error}"))?;
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
    Err("SSH_AUTH_FAILED: No accepted SSH credentials are available".to_string())
}

fn ssh_test_sync(conn: &SshConnection) -> Result<String, String> {
    let _sess = connect(conn)?;
    Ok("连接成功".to_string())
}

fn ssh_list_sync(conn: &SshConnection, path: Option<String>) -> Result<SshListResponse, String> {
    let sess = connect(conn)?;
    let sftp = connection_stage(conn, "sftp-open", || sess.sftp().map_err(|error| format!("SFTP_UNAVAILABLE: {error}")))?;

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
    db.save_ssh_connection(&conn)?;
    AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.clear(&conn.id);
    Ok(())
}

#[tauri::command]
pub fn ssh_connection_delete(state: State<'_, HistoryState>, id: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.delete_ssh_connection(&id)?;
    AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.clear(&id);
    Ok(())
}

/// Validate a temporary credential against the displayed profile before retaining it in memory.
#[tauri::command]
pub async fn ssh_authenticate_session(
    state: State<'_, HistoryState>, id: String, host: String, port: u16, user: String,
    method: AuthMethod, password: String, passphrase: String,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    let passphrase = Zeroizing::new(passphrase);
    let secret = match method { AuthMethod::Password => password, AuthMethod::KeyPassphrase => passphrase };
    if secret.is_empty() || secret.len() > 4096 { return Err("Enter a credential between 1 and 4096 bytes".into()); }
    let (conn, revision) = {
        let db = state.0.lock().map_err(|error| error.to_string())?;
        let conn = db.get_ssh_connection(&id)?;
        if conn.host != host || conn.port.unwrap_or(22) != port || conn.user != user {
            return Err("Saved SSH connection changed. Reopen the panel before authenticating.".into());
        }
        if matches!(method, AuthMethod::KeyPassphrase) && conn.options.identity_file.is_none() {
            return Err("No private key is configured for this connection".into());
        }
        let revision = AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.begin(&id);
        (conn, revision)
    };
    let credential = std::sync::Arc::new(Credential { method, secret });
    let validated = std::sync::Arc::clone(&credential);
    let tested = conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        connect_authenticated(&tested, Some(Duration::from_secs(5)), Some(&validated)).map(|_| ())
    }).await.map_err(|error| error.to_string())??;
    // Saving, deleting or clearing during validation invalidates the revision under the same lock order.
    let db = state.0.lock().map_err(|error| error.to_string())?;
    db.get_ssh_connection(&id)?;
    if !AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.store(&conn, revision, credential) {
        return Err("SSH authentication was cancelled or the connection changed. Retry authentication.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_forget_session_auth(id: String) -> Result<(), String> {
    AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.clear(&id);
    Ok(())
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

/// Metadata for one remote path (path bar file/directory detection and the
/// properties dialog). SFTP v3 exposes no creation time, so it stays None.
#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct SshStat {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub created_ms: Option<u64>,
    pub modified_ms: Option<u64>,
}

/// Map one SFTP metadata record onto the frontend stat shape.
fn ssh_stat_from(path: String, name: String, meta: &ssh2::FileStat, is_symlink: bool) -> SshStat {
    SshStat {
        path,
        name,
        is_dir: meta.is_dir(),
        is_symlink,
        size: if meta.is_dir() { 0 } else { meta.size.unwrap_or(0) },
        created_ms: None,
        modified_ms: meta.mtime.map(|seconds| seconds.saturating_mul(1000)),
    }
}

fn ssh_stat_sync(conn: &SshConnection, path: &str) -> Result<SshStat, String> {
    let sess = connect(conn)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP_UNAVAILABLE: {e}"))?;
    // stat follows symlinks (target metadata); lstat only flags the link itself.
    let meta = sftp
        .stat(Path::new(path))
        .map_err(|e| format!("Failed to read remote metadata: {e}"))?;
    let is_symlink = sftp
        .lstat(Path::new(path))
        .map(|link| link.file_type().is_symlink())
        .unwrap_or(false);
    let name = crate::platform::path::file_name(path).unwrap_or_else(|| path.to_string());
    Ok(ssh_stat_from(path.to_string(), name, &meta, is_symlink))
}

/// Read metadata for one remote path (path bar quick open and properties dialog).
#[tauri::command]
pub async fn ssh_stat(
    state: State<'_, HistoryState>,
    id: String,
    path: String,
) -> Result<SshStat, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?.get_ssh_connection(&id)?;
    tauri::async_runtime::spawn_blocking(move || ssh_stat_sync(&conn, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_search(webview: tauri::Webview, state: State<'_, HistoryState>, id: String, path: String, text: String, request_id: String,
    on_progress: Option<tauri::ipc::JavaScriptChannelId>) -> Result<SshSearchResponse, String> {
    let on_progress: Option<tauri::ipc::Channel<SshSearchResponse>> = on_progress.map(|channel| channel.channel_on(webview));
    let conn = state.0.lock().map_err(|e| e.to_string())?.get_ssh_connection(&id)?;
    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    FILE_SEARCHES.lock().map_err(|e| e.to_string())?.insert(request_id.clone(), cancelled.clone());
    let result = tauri::async_runtime::spawn_blocking(move || ssh_search_sync(&conn, &path, &text, &cancelled, |result| {
        if let Some(channel) = &on_progress { let _ = channel.send(result.clone()); }
    })).await;
    if let Ok(mut requests) = FILE_SEARCHES.lock() { requests.remove(&request_id); }
    result.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ssh_search_cancel(request_id: String) {
    if let Ok(requests) = FILE_SEARCHES.lock() {
        if let Some(cancelled) = requests.get(&request_id) { cancelled.store(true, std::sync::atomic::Ordering::Relaxed); }
    }
}

/// Local downloads root. Resolving the path creates nothing, so cleanup never resurrects
/// a directory the user removed.
pub(crate) fn downloads_root() -> Result<std::path::PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".vrykell").join("downloads"))
        .ok_or("Unable to locate the home directory".to_string())
}

/// Local downloads root, created when missing.
pub(crate) fn downloads_dir() -> Result<std::path::PathBuf, String> {
    let dir = downloads_root()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Unable to create the downloads directory: {e}"))?;
    Ok(dir)
}

/// 递归下载远程目录到本地 dest，返回累计字节数。
#[cfg(test)]
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
            let mut output = std::fs::File::create(&local_child).map_err(|e| e.to_string())?;
            total += std::io::copy(&mut file, &mut output).map_err(|e| e.to_string())?;
        }
    }
    Ok(total)
}

/// 下载远程文件/目录到 ~/.vrykell/downloads，返回 (本地路径, 字节数)。
#[cfg(test)]
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
        let mut output = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        let bytes = std::io::copy(&mut file, &mut output).map_err(|e| e.to_string())?;
        Ok((dest.to_string_lossy().to_string(), bytes))
    }
}

/// 下载远程文件/目录，返回本地路径，并写入下载历史。
#[tauri::command]
pub async fn ssh_download(app: tauri::AppHandle, state: State<'_, HistoryState>, id: String, path: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?.get_ssh_connection(&id)?;
    tauri::async_runtime::spawn_blocking(move || super::transfer::start(app, conn, path, String::new(), false))
        .await.map_err(|e| e.to_string())?
}

/// 远端目录里为 name 找可用路径：同名时按 `name (1)`、`name (2)`… 递增（保留扩展名）。
/// 序号规则来自平台层（`crate::platform::path::numbered_name`），远端只负责判断是否存在。
pub(super) fn unique_remote_path(sftp: &Sftp, dir: &str, name: &str) -> String {
    let candidate = crate::platform::path::numbered_name(name, |candidate| {
        sftp.stat(Path::new(&crate::platform::path::join(dir, candidate))).is_ok()
    });
    crate::platform::path::join(dir, &candidate)
}

/// 重命名远程文件/目录；目标名被占用时自动加序号，返回最终路径。
fn ssh_rename_sync(conn: &SshConnection, path: &str, new_name: &str) -> Result<String, String> {
    validate_remote_name(new_name)?;
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
    validate_remote_name(name)?;
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

/// Reject names that would step outside the directory the user pointed at: remote rename and
/// create must accept exactly one path component, like the local file operations do.
fn validate_remote_name(name: &str) -> Result<(), String> {
    if crate::platform::path::is_safe_component(name) {
        Ok(())
    } else {
        Err("名称只能是一个文件名，不能包含路径分隔符或为 . / ..".into())
    }
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
    let stat = sftp.lstat(Path::new(target)).map_err(|e| format!("读取远端信息失败：{e}"))?;
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
    sftp.setstat(Path::new(&dir), ssh2::FileStat { size: None, uid: None, gid: None, perm: Some(0o700), atime: None, mtime: None })
        .map_err(|e| format!("Failed to restrict staging permissions: {e}"))?;

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
    undo_enabled: Option<bool>,
) -> Result<FileOpOutcome, String> {
    let conn = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.get_ssh_connection(&id)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        if undo_enabled != Some(false) { return ssh_stage_delete_sync(&conn, paths); }
        let sess = connect(&conn)?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let mut outcome = FileOpOutcome { completed: Vec::new(), errors: Vec::new() };
        for path in paths {
            if path.trim_matches('/').is_empty() || path.split('/').any(|p| p == ".." || p == ".") {
                outcome.errors.push("Unsafe deletion path".into()); continue;
            }
            match remove_remote_recursive(&sftp, &path) {
                Ok(()) => outcome.completed.push(FileOpPair { from: path, to: String::new() }),
                Err(e) => outcome.errors.push(e),
            }
        }
        Ok(outcome)
    })
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
pub async fn ssh_upload(app: tauri::AppHandle, state: State<'_, HistoryState>, id: String, remote_dir: String, local_path: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?.get_ssh_connection(&id)?;
    tauri::async_runtime::spawn_blocking(move || super::transfer::start(app, conn, local_path, remote_dir, true))
        .await.map_err(|e| e.to_string())?
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
    fn remote_rename_and_create_names_stay_single_components() {
        assert!(validate_remote_name("notes.txt").is_ok());
        assert!(validate_remote_name("reports 2026").is_ok());
        for bad in ["", ".", "..", "../escape", "a/b", "a\\b"] {
            assert!(validate_remote_name(bad).is_err(), "{bad} should be rejected");
        }
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

    #[test]
    fn ssh_stat_maps_sftp_metadata() {
        let file_meta = ssh2::FileStat {
            size: Some(2048),
            uid: Some(1000),
            gid: Some(1000),
            perm: Some(0o100644),
            atime: Some(1_700_000_000),
            mtime: Some(1_700_000_001),
        };
        let file_stat = ssh_stat_from("/home/u/a.txt".into(), "a.txt".into(), &file_meta, false);
        assert_eq!(file_stat.path, "/home/u/a.txt");
        assert_eq!(file_stat.name, "a.txt");
        assert!(!file_stat.is_dir);
        assert!(!file_stat.is_symlink);
        assert_eq!(file_stat.size, 2048);
        assert_eq!(file_stat.modified_ms, Some(1_700_000_001_000));
        assert_eq!(file_stat.created_ms, None);

        // Directories report size 0; missing attributes map to None instead of panicking.
        let dir_meta = ssh2::FileStat {
            size: Some(4096),
            uid: None,
            gid: None,
            perm: Some(0o040555),
            atime: None,
            mtime: None,
        };
        let dir_stat = ssh_stat_from("/home/u/docs".into(), "docs".into(), &dir_meta, true);
        assert!(dir_stat.is_dir);
        assert!(dir_stat.is_symlink);
        assert_eq!(dir_stat.size, 0);
        assert_eq!(dir_stat.modified_ms, None);
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
