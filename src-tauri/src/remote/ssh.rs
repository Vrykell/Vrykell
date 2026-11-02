//! SSH connection management: connection CRUD lives in backend SQLite (see the ssh_connections
//! table in history.rs).
//!
//! Connection tests and remote directory listings use **SFTP** (the ssh2 crate, the file
//! subsystem built into SSH); they do not go through a remote shell or inject scripts, and
//! naturally support special characters and file metadata.
//!
//! The terminal session itself is still started by the frontend through `pty_spawn` (pty.rs)
//! with the `ssh` CLI (interactive); this module handles non-interactive backend operations only.

use crate::db::{HistoryState, SshConnection};
use crate::files::fs::{FileOpOutcome, FileOpPair};
use crate::terminal::ssh_command::SshOptions;
use base64::Engine;
use serde::{Deserialize, Serialize};
use ssh2::{CheckResult, ExtendedData, HostKeyType, KnownHostFileKind, KnownHostKeyFormat, Session, Sftp};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;
use tauri::State;
use super::session_auth::{AuthMethod, Credential, AUTH_CACHE};
use zeroize::Zeroizing;

static KH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
thread_local! { static TEST_KNOWN_HOSTS: std::cell::RefCell<Option<std::path::PathBuf>> = const { std::cell::RefCell::new(None) }; }

pub(crate) fn known_hosts_path() -> Result<std::path::PathBuf, String> {
    #[cfg(test)]
    if let Some(path) = TEST_KNOWN_HOSTS.with(|path| path.borrow().clone()) { return Ok(path); }
    dirs::home_dir().map(|home| home.join(".ssh/known_hosts")).ok_or_else(|| "Home directory is unavailable".into())
}

/// Prefer recorded key types without changing the supported set or the later key check.
fn prefer_known_host_key(sess: &Session, host: &str, port: u16, path: &Path) -> Result<Option<String>, String> {
    if !path.exists() { return Ok(None); }
    let mut known = sess.known_hosts().map_err(|error| error.to_string())?;
    known.read_file(path, KnownHostFileKind::OpenSSH).map_err(|error| error.to_string())?;
    let endpoint = format!("[{host}]:{port}");
    let mut trusted_types = Vec::new();
    for entry in known.hosts().map_err(|error| error.to_string())? {
        if entry.name().is_some_and(|name| name != host && name != endpoint) { continue; }
        let key = base64::engine::general_purpose::STANDARD.decode(entry.key()).map_err(|error| error.to_string())?;
        // The library also matches hashed names and explicit ports.
        if !matches!(known.check_port(host, port, &key), CheckResult::Match) { continue; }
        let line = known.write_string(&entry, KnownHostFileKind::OpenSSH).map_err(|error| error.to_string())?;
        if let Some(kind) = line.split_whitespace().nth(1) {
            if !trusted_types.iter().any(|trusted| trusted == kind) { trusted_types.push(kind.to_owned()); }
        }
    }
    if trusted_types.is_empty() { return Ok(None); }
    let supported = sess.supported_algs(ssh2::MethodType::HostKey).map_err(|error| error.to_string())?;
    let (mut preferred, remaining): (Vec<_>, Vec<_>) = supported.into_iter().partition(|algorithm| {
        let kind = match *algorithm {
            "rsa-sha2-512" | "rsa-sha2-256" => "ssh-rsa",
            other => other,
        };
        trusted_types.iter().any(|trusted| trusted == kind)
    });
    if preferred.is_empty() { return Ok(None); }
    preferred.extend(remaining);
    let algorithms = preferred.join(",");
    sess.method_pref(ssh2::MethodType::HostKey, &algorithms).map_err(|error| error.to_string())?;
    Ok(Some(algorithms))
}

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
    super::file_channel::run_session(conn, |session| {
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
    })
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

/// Directory listing response: entries plus the real path of the actual directory (empty
/// request = remote home).
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

/// Establish a TCP connection and perform the SSH handshake (without host key verification or
/// authentication).
fn tcp_handshake(conn: &SshConnection) -> Result<Session, String> {
    tcp_handshake_with_timeout(conn, None)
}

fn tcp_handshake_with_timeout(conn: &SshConnection, timeout: Option<Duration>) -> Result<Session, String> {
    crate::terminal::ssh_command::validate_options(&conn.options)?;
    let mut upstream = None;
    if conn.options.resolved_jumps.0.is_empty() && (conn.options.jump_connection_id.is_some()
        || conn.options.jump_host.as_deref().is_some_and(|jump| !jump.eq_ignore_ascii_case("none"))) {
        return Err("Jump route has not been resolved".into());
    }
    for hop in &conn.options.resolved_jumps.0 {
        let connected = (|| {
            let sess = connection_stage(hop, "handshake", || handshake_transport(hop, upstream.take(), timeout))?;
            connection_stage(hop, "host-trust", || verify_host_key(&sess, &hop.host, hop.port.unwrap_or(22)))?;
            let credential = AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.get(hop);
            let result = connection_stage(hop, "authentication", || {
                authenticate(&sess, hop, &hop.user, credential.as_deref())?;
                if !sess.authenticated() { return Err("SSH_AUTH_FAILED: Additional authentication is required".into()); }
                Ok(())
            });
            if result.is_err() {
                if let Some(credential) = &credential {
                    AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.reject(&hop.id, credential);
                }
            }
            result?;
            if !sess.authenticated() { return Err("SSH_AUTH_FAILED: Additional authentication is required".into()); }
            Ok::<_, String>(sess)
        })();
        upstream = Some(connected.map_err(|error| format!("SSH_JUMP_FAILED:{}: {error}", hop.id))?);
    }
    handshake_transport(conn, upstream, timeout)
}

fn handshake_transport(conn: &SshConnection, upstream: Option<Session>, timeout: Option<Duration>) -> Result<Session, String> {
    let mut sess = Session::new().map_err(|error| error.to_string())?;
    sess.set_timeout(timeout.unwrap_or(Duration::from_secs(15)).as_millis().min(u32::MAX as u128) as u32);
    let preferred = {
        let _guard = KH_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        prefer_known_host_key(&sess, &conn.host, conn.port.unwrap_or(22), &known_hosts_path()?)?
    };
    if let Some(upstream) = upstream {
        sess.set_tcp_stream(super::jump::tunnel(upstream, &conn.host, conn.port.unwrap_or(22))?);
    } else {
        let tcp = crate::ssh_proxy::connect_target(&conn.host, conn.port.unwrap_or(22), conn.options.proxy_id.as_deref(), timeout)?;
        tcp.set_read_timeout(Some(Duration::from_secs(15))).ok();
        tcp.set_write_timeout(Some(Duration::from_secs(15))).ok();
        sess.set_tcp_stream(tcp);
    }
    sess.handshake().map_err(|error| format!("SSH handshake failed: {error}"))?;
    let _ = crate::diagnostics::record("ssh-host-key-negotiation", serde_json::json!({
        "connectionId": conn.id, "host": conn.host, "port": conn.port.unwrap_or(22),
        "knownKeyPreferred": preferred.is_some(), "algorithm": sess.methods(ssh2::MethodType::HostKey),
    }));
    Ok(sess)
}

/// Establish a TCP connection, perform the SSH handshake, verify the host key and authenticate;
/// returns an authenticated session.
fn connect(conn: &SshConnection) -> Result<Session, String> {
    connect_with_timeout(conn, None)
}

/// Record connection stages without storing credentials, key paths or command output.
pub(super) fn connection_stage<T>(conn: &SshConnection, stage: &str, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let started = std::time::Instant::now();
    let result = action();
    let _ = crate::diagnostics::record("ssh-backend-stage", serde_json::json!({
        "connectionId": conn.id, "stage": stage, "savedProfile": !conn.id.is_empty(),
        "authMethod": conn.auth_method, "hasPassword": !conn.password.is_empty(),
        "hasIdentityFile": conn.options.identity_file.is_some(),
        "durationMs": started.elapsed().as_millis(), "succeeded": result.is_ok(),
        "error": result.as_ref().err(),
    }));
    result.map_err(|cause| {
        if cause.contains("SSH_CONNECTION_FAILED:") { return cause; }
        format!("SSH_CONNECTION_FAILED:{}", serde_json::json!({
            "connectionId": conn.id, "host": conn.host, "port": conn.port.unwrap_or(22), "stage": stage, "cause": cause,
        }))
    })
}

pub(crate) fn connect_with_timeout(conn: &SshConnection, timeout: Option<Duration>) -> Result<Session, String> {
    let (credential, interactive) = {
        let mut cache = AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?;
        let interactive = cache.service(conn).is_some();
        (cache.get(conn), interactive)
    };
    let result = connect_authenticated(conn, timeout, credential.as_deref());
    if result.as_ref().err().is_some_and(|error| !error.starts_with("SSH_JUMP_FAILED:") && error.contains("SSH_AUTH_FAILED:")) {
        if let Some(credential) = &credential {
            AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.reject(&conn.id, credential);
        }
    }
    result.map_err(|error| {
        if interactive && error.contains("SSH_AUTH_FAILED:") {
            format!("SSH_AUTH_FAILED: This operation needs a separate authenticated connection. Authenticate it independently. {error}")
        } else { error }
    })
}

fn connect_authenticated(conn: &SshConnection, timeout: Option<Duration>, credential: Option<&Credential>) -> Result<Session, String> {
    let user = conn.user.trim();
    // Reject an empty username outright; never silently default to root (an accidentally blank
    // form would log in as root)
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

pub(super) fn connect_interactive(conn: &SshConnection, exchange: &super::interactive_auth::Exchange) -> Result<Session, String> {
    crate::terminal::ssh_command::validate_options(&conn.options)?;
    let mut upstream = None;
    for endpoint in conn.options.resolved_jumps.0.iter().chain(std::iter::once(conn)) {
        exchange.attempt.check()?;
        let user = endpoint.user.trim();
        if user.is_empty() { return Err("SSH_AUTH_FAILED: Username must not be empty".into()); }
        let session = connection_stage(endpoint, "handshake", || handshake_transport(endpoint, upstream.take(), Some(Duration::from_secs(10))))?;
        connection_stage(endpoint, "host-trust", || {
            match verify_host_key(&session, &endpoint.host, endpoint.port.unwrap_or(22)) {
                Err(error) if error.starts_with("HOST_KEY_UNKNOWN:") => {
                    let fingerprint = fingerprint_of(&session);
                    let (_, key_type) = session.host_key().ok_or("The server did not provide a host key")?;
                    exchange.host_key(endpoint, fingerprint.clone(), format!("{key_type:?}").to_lowercase())?;
                    record_host_key(&session, &endpoint.host, endpoint.port.unwrap_or(22), &fingerprint)
                }
                result => result,
            }
        })?;
        connection_stage(endpoint, "authentication", || {
            let credential = AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.get(endpoint);
            let _ = authenticate_checked(&session, endpoint, user, credential.as_deref(), || exchange.attempt.check());
            exchange.attempt.check()?;
            if session.authenticated() { return Ok(()); }
            struct Prompter<'a> {
                conn: &'a SshConnection,
                exchange: &'a super::interactive_auth::Exchange,
                error: Option<String>,
                rounds: u32,
            }
            impl ssh2::KeyboardInteractivePrompt for Prompter<'_> {
                fn prompt(&mut self, _: &str, instructions: &str, prompts: &[ssh2::Prompt<'_>]) -> Vec<String> {
                    if self.error.is_some() { return Vec::new(); }
                    self.rounds += 1;
                    match self.exchange.prompts(self.conn, instructions, prompts) {
                        Ok(responses) => responses,
                        Err(error) => { self.error = Some(error); Vec::new() }
                    }
                }
            }
            let mut prompter = Prompter { conn: endpoint, exchange, error: None, rounds: 0 };
            // Network waiting stays cancellable, and time spent answering does not consume its timeout.
            session.set_blocking(false);
            let mut deadline = std::time::Instant::now() + Duration::from_secs(10);
            let result = loop {
                exchange.attempt.check()?;
                let rounds = prompter.rounds;
                let result = session.userauth_keyboard_interactive(user, &mut prompter);
                if prompter.error.is_some() { break result; }
                if rounds != prompter.rounds { deadline = std::time::Instant::now() + Duration::from_secs(10); }
                match &result {
                    Err(error) if error.code() == ssh2::ErrorCode::Session(-37) => {
                        if std::time::Instant::now() >= deadline { return Err("SSH_AUTH_TIMEOUT: Authentication server did not respond".into()); }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    _ => break result,
                }
            };
            session.set_blocking(true);
            if let Some(error) = prompter.error { return Err(error); }
            exchange.attempt.check()?;
            result.map_err(|_| "SSH_AUTH_FAILED: The server rejected interactive authentication or does not support it")?;
            if !session.authenticated() { return Err("SSH_AUTH_FAILED: Additional authentication is required".into()); }
            Ok(())
        })?;
        upstream = Some(session);
    }
    upstream.ok_or_else(|| "SSH_AUTH_FAILED: No authentication target is available".into())
}

/// Host fingerprint (SHA256:base64).
fn fingerprint_of(sess: &Session) -> String {
    match sess.host_key_hash(ssh2::HashType::Sha256) {
        Some(hash) => format!("SHA256:{}", base64::engine::general_purpose::STANDARD_NO_PAD.encode(hash)),
        None => "unknown".to_string(),
    }
}

/// Host key verification (TOFU): recorded → strict comparison; not recorded → **not recorded
/// automatically**, returns `HOST_KEY_UNKNOWN:<fingerprint>` and requires explicit user
/// confirmation before trusting (see ssh_trust_host_key). The whole read-modify-write sequence
/// is serialized behind a process-wide lock so concurrent SSH connections cannot overwrite each
/// other.
fn verify_host_key(sess: &Session, host: &str, port: u16) -> Result<(), String> {
    let _guard = KH_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let (key, _key_type) = sess.host_key().ok_or("远端未返回主机密钥".to_string())?;
    let mut kh = sess.known_hosts().map_err(|e| format!("初始化 known_hosts 失败：{e}"))?;

    let kh_path = known_hosts_path()?;
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

/// Record the host key in known_hosts (called after the user explicitly trusts it).
fn record_host_key(sess: &Session, host: &str, port: u16, expected_fingerprint: &str) -> Result<(), String> {
    let _guard = KH_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    validate_confirmed_fingerprint(&fingerprint_of(sess), expected_fingerprint)?;

    let (key, key_type) = sess.host_key().ok_or("远端未返回主机密钥".to_string())?;
    let mut kh = sess.known_hosts().map_err(|e| format!("初始化 known_hosts 失败：{e}"))?;

    let kh_path = known_hosts_path()?;
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
    authenticate_checked(sess, conn, user, credential, || Ok(()))
}

fn authenticate_checked(sess: &Session, conn: &SshConnection, user: &str, credential: Option<&Credential>, check: impl Fn() -> Result<(), String>) -> Result<(), String> {
    check()?;
    if let Some(credential) = credential {
        return match credential.method {
            AuthMethod::Password => sess.userauth_password(user, &credential.secret)
                .map_err(|error| format!("SSH_AUTH_FAILED: Password authentication failed: {error}")),
            AuthMethod::KeyPassphrase => {
                let identity = conn.options.identity_file.as_deref().ok_or("SSH_AUTH_FAILED: No private key is configured")?;
                sess.userauth_pubkey_file(user, None, Path::new(identity), Some(&credential.secret))
                    .map_err(|error| format!("SSH_AUTH_FAILED: Private key authentication failed: {error}"))
            }
            AuthMethod::KeyboardInteractive => Err("SSH_AUTH_FAILED: Interactive authentication requires server challenges".into()),
        };
    }
    if conn.options.authentication_mode.as_deref() == Some("ask") { return Err("SSH_AUTH_FAILED: Enter credentials to connect".into()); }
    if let Some(identity) = &conn.options.identity_file {
        sess.userauth_pubkey_file(user, None, Path::new(identity), None)
            .map_err(|error| format!("SSH_AUTH_FAILED: Private key authentication failed: {error}"))?;
        return Ok(());
    }
    // Password authentication
    if conn.auth_method == "password" && !conn.password.is_empty() {
        sess.userauth_password(user, &conn.password)
            .map_err(|error| format!("SSH_AUTH_FAILED: Password authentication failed: {error}"))?;
        return Ok(());
    }

    // Key authentication: SSH agent first, then default key files
    if sess.userauth_agent(user).is_ok() && sess.authenticated() {
        return Ok(());
    }
    if conn.options.authentication_mode.as_deref() == Some("agent") { return Err("SSH_AUTH_FAILED: No accepted agent identities are available".into()); }
    if let Some(home) = dirs::home_dir() {
        for key in ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"] {
            check()?;
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
    let dir = path.unwrap_or_default();
    super::file_channel::run(conn, true, |_, sftp| {
    // Empty path → remote home (the SFTP current directory is the login home); other paths are
    // normalized with realpath
    let base = sftp
        .realpath(Path::new(if dir.is_empty() { "." } else { &dir }))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| if dir.is_empty() { "/".to_string() } else { dir.clone() });

    let entries = sftp
        .readdir(Path::new(&base))
        .map_err(|e| format!("读取目录 {base} 失败：{e}"))?;

    let mut result: Vec<SshFsEntry> = Vec::new();
    for (listed, stat) in entries {
        // ssh2 returns paths joined by the host platform (backslashes on Windows), so take only
        // the file name and let the platform layer join it with POSIX rules to build the entry
        // path.
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
    })
}

// ── Connection CRUD (backend SQLite) ──

#[tauri::command]
pub fn ssh_connections_list(state: State<'_, HistoryState>) -> Result<Vec<SshConnection>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.list_ssh_connections()
}

#[tauri::command]
pub fn ssh_connection_save(state: State<'_, HistoryState>, conn: SshConnection) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.save_ssh_connection(&conn)?;
    super::interactive_auth::cancel_connection(&conn.id);
    super::forwarding::invalidate_connection(&conn);
    AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.clear(&conn.id);
    super::file_channel::invalidate_all();
    super::forwarding::stop_dependents(&conn.id);
    Ok(())
}

#[tauri::command]
pub fn ssh_connection_delete(state: State<'_, HistoryState>, id: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.delete_ssh_connection(&id)?;
    super::interactive_auth::cancel_connection(&id);
    super::forwarding::stop_connection(&id);
    AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.clear(&id);
    super::file_channel::invalidate_all();
    super::forwarding::stop_dependents(&id);
    Ok(())
}

/// Validate a temporary credential against the displayed profile before retaining it in memory.
#[tauri::command]
pub async fn ssh_authenticate_session(
    webview: tauri::Webview, state: State<'_, HistoryState>, id: String, host: String, port: u16, user: String,
    method: AuthMethod, password: String, passphrase: String,
    attempt_id: Option<String>, on_challenge: Option<tauri::ipc::JavaScriptChannelId>,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    let passphrase = Zeroizing::new(passphrase);
    let interactive = matches!(method, AuthMethod::KeyboardInteractive);
    let secret = match method { AuthMethod::Password => password, AuthMethod::KeyPassphrase => passphrase, AuthMethod::KeyboardInteractive => Zeroizing::new(String::new()) };
    if !interactive && (secret.is_empty() || secret.len() > 4096) { return Err("Enter a credential between 1 and 4096 bytes".into()); }
    let (conn, revision, exchange) = {
        let db = state.0.lock().map_err(|error| error.to_string())?;
        let conn = db.get_ssh_connection(&id)?;
        if conn.host != host || conn.port.unwrap_or(22) != port || conn.user != user {
            return Err("Saved SSH connection changed. Reopen the panel before authenticating.".into());
        }
        if matches!(method, AuthMethod::KeyPassphrase) && conn.options.identity_file.is_none() {
            return Err("No private key is configured for this connection".into());
        }
        super::interactive_auth::cancel_connection(&id);
        let exchange = if interactive {
            let owner = webview.label().to_owned();
            let channel: tauri::ipc::Channel<super::interactive_auth::Challenge> = on_challenge.ok_or("Authentication challenge channel is required")?.channel_on(webview);
            Some(super::interactive_auth::Exchange::new(attempt_id.ok_or("Authentication attempt identifier is required")?, owner, &conn,
                move |challenge| channel.send(challenge).map_err(|_| "Authentication dialog is no longer available".into()))?)
        } else { None };
        let revision = AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.begin(&id);
        super::file_channel::invalidate_all();
        (conn, revision, exchange)
    };
    if let Some(exchange) = exchange {
        let tested = conn.clone();
        let (session, exchange) = tauri::async_runtime::spawn_blocking(move || {
            connect_interactive(&tested, &exchange).map(|session| (session, exchange))
        }).await.map_err(|error| error.to_string())??;
        let db = state.0.lock().map_err(|error| error.to_string())?;
        let current = db.get_ssh_connection(&id)?;
        if super::session_auth::binding(&current) != super::session_auth::binding(&conn) {
            return Err("Saved SSH connection changed. Retry authentication.".into());
        }
        return exchange.attempt.finish(&id, revision, || {
            if !AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.store_session(&conn, revision, session) {
                return Err("SSH authentication was cancelled or the connection changed. Retry authentication.".into());
            }
            Ok(())
        });
    }
    let credential = std::sync::Arc::new(Credential { method, secret });
    let validated = std::sync::Arc::clone(&credential);
    let tested = conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        connect_authenticated(&tested, Some(Duration::from_secs(5)), Some(&validated)).map(|_| ())
    }).await.map_err(|error| error.to_string())??;
    // Saving, deleting or clearing during validation invalidates the revision under the same lock order.
    let db = state.0.lock().map_err(|error| error.to_string())?;
    if super::session_auth::binding(&db.get_ssh_connection(&id)?) != super::session_auth::binding(&conn) {
        return Err("Saved SSH connection changed. Retry authentication.".into());
    }
    if !AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.store(&conn, revision, credential) {
        return Err("SSH authentication was cancelled or the connection changed. Retry authentication.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_forget_session_auth(id: String) -> Result<(), String> {
    super::interactive_auth::cancel_connection(&id);
    AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?.clear(&id);
    super::file_channel::invalidate_all();
    super::forwarding::stop_dependents(&id);
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

// ── Connection test / host fingerprint / remote directory ──

/// Host key information (for first-connection confirmation: fingerprint plus whether it is
/// already recorded).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKeyInfo {
    pub fingerprint: String,
    pub known: bool,
    pub key_type: String,
}

/// Query the host fingerprint and its known_hosts status (never writes anything).
#[tauri::command]
pub async fn ssh_host_key_info(state: State<'_, HistoryState>, host: String, port: Option<u16>, options: Option<SshOptions>) -> Result<SshHostKeyInfo, String> {
    let mut conn = SshConnection {
        id: String::new(),
        name: String::new(),
        host,
        port,
        user: String::new(),
        password: String::new(),
        auth_method: "password".to_string(),
        last_opened_at: None,
        has_password: false,
        options: options.unwrap_or_default(),
    };
    state.0.lock().map_err(|error| error.to_string())?.resolve_ssh_route(&mut conn.options, None)?;
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

/// Record the host key in known_hosts after the user confirms the fingerprint (idempotent).
#[tauri::command]
pub async fn ssh_trust_host_key(state: State<'_, HistoryState>, host: String, port: Option<u16>, expected_fingerprint: String, options: Option<SshOptions>) -> Result<(), String> {
    let mut conn = SshConnection {
        id: String::new(),
        name: String::new(),
        host,
        port,
        user: String::new(),
        password: String::new(),
        auth_method: "password".to_string(),
        last_opened_at: None,
        has_password: false,
        options: options.unwrap_or_default(),
    };
    state.0.lock().map_err(|error| error.to_string())?.resolve_ssh_route(&mut conn.options, None)?;
    tauri::async_runtime::spawn_blocking(move || {
        let sess = tcp_handshake(&conn)?;
        record_host_key(&sess, &conn.host, conn.port.unwrap_or(22), &expected_fingerprint)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Test a connection with explicit parameters, so a form can test before saving.
#[tauri::command]
pub async fn ssh_test(
    state: State<'_, HistoryState>,
    host: String,
    port: Option<u16>,
    user: String,
    password: String,
    options: Option<SshOptions>,
) -> Result<String, String> {
    let mut conn = SshConnection {
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
    state.0.lock().map_err(|error| error.to_string())?.resolve_ssh_route(&mut conn.options, None)?;
    tauri::async_runtime::spawn_blocking(move || ssh_test_sync(&conn))
        .await
        .map_err(|e| e.to_string())?
}

/// List a remote directory by connection id (the backend resolves the password). Returns
/// entries plus the real path of the actual directory.
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
    super::file_channel::run(conn, true, |_, sftp| {
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
    })
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

/// Recursively download a remote directory to the local dest, returning the total byte count.
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
        // Enforce a safe single component: reject `.`/`..` and names containing separators to
        // prevent path traversal escapes
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

/// Download a remote file/directory to ~/.vrykell/downloads, returning (local path, byte count).
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

/// Download a remote file/directory, return the local path and record it in download history.
#[tauri::command]
pub async fn ssh_download(app: tauri::AppHandle, state: State<'_, HistoryState>, id: String, path: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?.get_ssh_connection(&id)?;
    tauri::async_runtime::spawn_blocking(move || super::transfer::start(app, conn, path, String::new(), false))
        .await.map_err(|e| e.to_string())?
}

/// Find an available path for name in a remote directory: on collision, increment through
/// `name (1)`, `name (2)`... (keeping the extension). The numbering rule lives in the platform
/// layer (`crate::platform::path::numbered_name`); the remote side only checks existence.
pub(super) fn unique_remote_path(sftp: &Sftp, dir: &str, name: &str) -> String {
    let candidate = crate::platform::path::available_name(name, |candidate| {
        sftp.stat(Path::new(&crate::platform::path::join(dir, candidate))).is_ok()
    });
    crate::platform::path::join(dir, &candidate)
}

/// Rename a remote file/directory; append a sequence number when the target name is taken,
/// returning the final path.
fn ssh_rename_sync(conn: &SshConnection, path: &str, new_name: &str) -> Result<String, String> {
    validate_remote_name(new_name)?;
    super::file_channel::run(conn, false, |_, sftp| {
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
    })
}

/// Move a remote file/directory to a destination directory (SFTP rename works across
/// directories; same-place moves are rejected and name collisions get a sequence number).
fn ssh_move_sync(conn: &SshConnection, path: &str, dest_dir: &str) -> Result<String, String> {
    let name = crate::platform::path::file_name(path).ok_or("无法定位文件名")?;
    super::file_channel::run(conn, false, |_, sftp| {
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
    })
}

/// Create a remote file (empty) or directory; append a sequence number on collision, returning
/// the final path.
fn ssh_create_sync(conn: &SshConnection, dir: &str, name: &str, is_dir: bool) -> Result<String, String> {
    validate_remote_name(name)?;
    super::file_channel::run(conn, false, |_, sftp| {
    if sftp.stat(Path::new(dir)).is_err() {
        return Err(format!("目标目录不可用：{dir}"));
    }
    let direct = crate::platform::path::join(dir, name);
    let path = if sftp.stat(Path::new(&direct)).is_ok() {
        // On collision, step through name (1), name (2), ... (unique_remote_path is called only
        // on collision)
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
    })
}

// ── Remote panel: copy / undoable delete (remote staging) ──

/// Remote shell single-quote escaping (same rule as the frontend shellQuote).
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

/// Remote staging directory for undoable delete: <home>/.vrykell/undo
fn ssh_undo_dir(sftp: &Sftp) -> Result<String, String> {
    let home = sftp
        .realpath(Path::new("."))
        .map_err(|e| format!("无法定位远端主目录：{e}"))?;
    let home = home.to_string_lossy().to_string();
    Ok(crate::platform::path::join(&crate::platform::path::join(&home, ".vrykell"), "undo"))
}

/// Create a remote directory level by level (existing levels are ignored).
fn ensure_remote_dir(sftp: &Sftp, dir: &str) -> Result<(), String> {
    let normalized = crate::platform::path::normalize(dir);
    let mut current = String::new();
    for segment in normalized.split('/').filter(|part| !part.is_empty()) {
        current = crate::platform::path::join(&current, segment);
        let _ = sftp.mkdir(Path::new(&current), 0o755); // errors when it already exists; ignore
    }
    Ok(())
}

/// Recursively delete a remote path (empties directories before rmdir; used to clean up staged
/// items).
fn remove_remote_recursive(sftp: &Sftp, target: &str) -> Result<(), String> {
    let stat = sftp.lstat(Path::new(target)).map_err(|e| format!("读取远端信息失败：{e}"))?;
    if stat.is_dir() {
        if let Ok(children) = sftp.readdir(Path::new(target)) {
            for (child, _) in children {
                // readdir paths are joined by the host platform (`\` on Windows), so take only
                // the name and rejoin with POSIX rules
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

/// Copy one remote entry to an explicit target path (`cp -R`, arguments single-quote escaped;
/// the target must not exist yet).
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

/// Copy remote files/directories to a destination directory (each item is pre-checked: same
/// place, its own subtree and target name collisions are rejected).
fn ssh_copy_sync(conn: &SshConnection, paths: Vec<String>, dest_dir: String) -> Result<FileOpOutcome, String> {
    super::file_channel::run(conn, false, |sess, sftp| {
    // Absolute/relative checks must follow remote (POSIX) rules: Path::is_absolute("/home") is
    // false on a Windows host
    if !crate::platform::path::is_absolute(&dest_dir) {
        return Err("目标目录必须是绝对路径".into());
    }
    if sftp.stat(Path::new(&dest_dir)).is_err() {
        return Err(format!("目标目录不可用：{dest_dir}"));
    }

    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for path in paths.iter().cloned() {
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
        // Target name collision (including copying into the source directory) → add a sequence
        // number instead of creating a duplicate
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
    })
}

/// Undoable delete: move remote entries into the remote staging directory.
fn ssh_stage_delete_sync(conn: &SshConnection, paths: Vec<String>) -> Result<FileOpOutcome, String> {
    super::file_channel::run(conn, false, |_, sftp| {
    let dir = ssh_undo_dir(&sftp)?;
    ensure_remote_dir(&sftp, &dir)?;
    sftp.setstat(Path::new(&dir), ssh2::FileStat { size: None, uid: None, gid: None, perm: Some(0o700), atime: None, mtime: None })
        .map_err(|e| format!("Failed to restrict staging permissions: {e}"))?;

    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for path in paths.iter().cloned() {
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
    })
}

/// Undo delete: move staged items back to their original location (an item fails when the
/// original path already has an entry with that name).
fn ssh_restore_staged_sync(conn: &SshConnection, items: Vec<FileOpPair>) -> Result<FileOpOutcome, String> {
    super::file_channel::run(conn, false, |_, sftp| {
    let mut completed = Vec::new();
    let mut errors = Vec::new();
    for item in items.iter().cloned() {
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
    })
}

/// Permanently delete staged items (when the undo window ends).
fn ssh_purge_staged_sync(conn: &SshConnection, paths: Vec<String>) {
    let _ = super::file_channel::run(conn, false, |_, sftp| {
    for path in &paths {
        let _ = remove_remote_recursive(&sftp, &path);
    }
    Ok(())
    });
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
        super::file_channel::run(&conn, false, |_, sftp| {
        let mut outcome = FileOpOutcome { completed: Vec::new(), errors: Vec::new() };
        for path in paths.iter().cloned() {
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
    #[cfg(windows)]
    fn desktop_crypto_supports_modern_keys_and_key_exchange() {
        let session = Session::new().unwrap();
        assert!(session.supported_algs(ssh2::MethodType::Kex).unwrap().iter().any(|algorithm| algorithm.starts_with("curve25519-sha256")));
        assert!(session.supported_algs(ssh2::MethodType::HostKey).unwrap().contains(&"ssh-ed25519"));
    }

    #[test]
    fn failure_context_preserves_the_original_endpoint_and_stage() {
        let conn: SshConnection = serde_json::from_value(serde_json::json!({ "id": "stage-test", "name": "server", "host": "gateway.test", "port": 2222, "user": "tester", "authMethod": "ask" })).unwrap();
        let error = connection_stage::<()>(&conn, "authentication", || Err("SSH_AUTH_FAILED: rejected".into())).unwrap_err();
        let wrapped = connection_stage::<()>(&conn, "resource-collection", || Err(error.clone())).unwrap_err();
        assert_eq!(wrapped, error);
        let detail: serde_json::Value = serde_json::from_str(error.strip_prefix("SSH_CONNECTION_FAILED:").unwrap()).unwrap();
        assert_eq!(detail["connectionId"], "stage-test");
        assert_eq!(detail["stage"], "authentication");
        assert_eq!(detail["host"], "gateway.test");
        assert_eq!(detail["port"], 2222);
    }

    #[test]
    #[ignore = "Run through scripts/test-ssh-jumps.py for isolated protocol servers"]
    fn interactive_protocol_fixture() -> Result<(), String> {
        use super::super::interactive_auth::{respond, Challenge, Exchange};
        let fixture: serde_json::Value = serde_json::from_str(&std::env::var("VRYKELL_SSH_JUMP_FIXTURE").map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        let root = std::path::PathBuf::from(fixture["directory"].as_str().ok_or("Missing fixture directory")?);
        let ports = fixture["ports"].as_array().ok_or("Missing fixture ports")?;
        let known_hosts = root.join("interactive-known-hosts");
        TEST_KNOWN_HOSTS.with(|path| *path.borrow_mut() = Some(known_hosts.clone()));
        struct TrustScope;
        impl Drop for TrustScope { fn drop(&mut self) { TEST_KNOWN_HOSTS.with(|path| *path.borrow_mut() = None); } }
        let _scope = TrustScope;
        let profile = |name: &str, index: usize| -> SshConnection {
            serde_json::from_value(serde_json::json!({ "id": format!("mfa-{name}"), "name": name, "host": "127.0.0.1", "port": ports[index],
                "user": format!("mfa-{name}-user"), "authMethod": "ask", "authenticationMode": "ask", "proxyId": "none" })).unwrap()
        };
        let first = profile("first", 0);
        let second = profile("second", 1);
        let mut target = profile("target", 2);
        target.options.jump_connection_id = Some(second.id.clone());
        target.options.resolved_jumps.0 = vec![first, second];
        let attempt_id = uuid::Uuid::new_v4().to_string();
        let reply_id = attempt_id.clone();
        let rounds = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = rounds.clone();
        let exchange = Exchange::new(attempt_id, "fixture".into(), &target, move |challenge| {
            observed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let value = serde_json::to_value(&challenge).map_err(|error| error.to_string())?;
            let name = value["target"]["connectionId"].as_str().unwrap().strip_prefix("mfa-").unwrap();
            match challenge {
                Challenge::HostKey { round, fingerprint, .. } => respond("fixture", &reply_id, round, vec![fingerprint]),
                Challenge::Prompts { round, prompts, .. } => {
                    let answers = if prompts.len() == 2 {
                        assert!(!prompts[0].echo); assert!(prompts[1].echo);
                        vec![format!("{name}-test-secret"), format!("mfa-{name}-user")]
                    } else { vec![format!("{name}-one-time-code")] };
                    respond("fixture", &reply_id, round, answers)
                }
            }
        })?;
        let revision = AUTH_CACHE.lock().unwrap().begin(&target.id);
        println!("Fixture: authenticating two interactive hops and destination");
        let session = connect_interactive(&target, &exchange)?;
        assert_eq!(rounds.load(std::sync::atomic::Ordering::Relaxed), 9);
        assert!(known_hosts.exists());
        exchange.attempt.finish(&target.id, revision, || {
            assert!(AUTH_CACHE.lock().unwrap().store_session(&target, revision, session)); Ok(())
        })?;
        drop(exchange);
        println!("Fixture: concurrently reusing the authenticated connection for files and monitoring");
        std::thread::scope(|scope| {
            let listing = scope.spawn(|| ssh_list_sync(&target, None));
            let monitoring = scope.spawn(|| ssh_system_status_sync(&target, SshStatusMetrics::all()));
            assert_eq!(listing.join().unwrap()?.entries[0].name, "fixture.txt");
            assert_eq!(monitoring.join().unwrap()?.system, "Fixture Unix");
            Ok::<_, String>(())
        })?;
        assert_eq!(ssh_list_sync(&target, None)?.entries.len(), 1);
        let independent = connect_with_timeout(&target, Some(Duration::from_secs(5))).err().ok_or("An independent transport unexpectedly replayed interactive credentials")?;
        assert!(independent.contains("separate authenticated connection"));
        println!("Fixture: reopening a closed file channel without repeating authentication");
        let retained = AUTH_CACHE.lock().unwrap().service(&target).unwrap();
        retained.session(|session| {
            let mut channel = session.channel_session().map_err(|error| error.to_string())?;
            channel.exec("fixture-close-sftp").map_err(|error| error.to_string())?;
            channel.read_to_end(&mut Vec::new()).map_err(|error| error.to_string())?;
            channel.wait_close().map_err(|error| error.to_string())
        })?;
        let closed = ssh_list_sync(&target, None).err().ok_or("Closed file channel unexpectedly succeeded")?;
        println!("Fixture: closed file channel returned {closed}");
        assert_eq!(ssh_system_status_sync(&target, SshStatusMetrics::all())?.system, "Fixture Unix");
        assert_eq!(ssh_list_sync(&target, None)?.entries[0].name, "fixture.txt");
        println!("Fixture: a timed-out monitoring channel retains the authenticated file connection");
        retained.session(|session| {
            let mut channel = session.channel_session().map_err(|error| error.to_string())?;
            channel.exec("fixture-stall-next-status").map_err(|error| error.to_string())?;
            channel.read_to_end(&mut Vec::new()).map_err(|error| error.to_string())?;
            channel.wait_close().map_err(|error| error.to_string())
        })?;
        let timeout = ssh_system_status_sync(&target, SshStatusMetrics { cpu: true, ..Default::default() }).err().ok_or("Stalled resource collection unexpectedly succeeded")?;
        assert!(!timeout.contains("SSH_AUTH_FAILED:"), "{timeout}");
        assert_eq!(ssh_list_sync(&target, None)?.entries[0].name, "fixture.txt");
        assert_eq!(ssh_system_status_sync(&target, SshStatusMetrics::all())?.system, "Fixture Unix");
        println!("Fixture: expired service transport requires fresh authentication without replay");
        let retained = AUTH_CACHE.lock().unwrap().service(&target).unwrap();
        let _ = retained.session(|session| {
            let mut channel = session.channel_session().map_err(|error| error.to_string())?;
            channel.exec("fixture-disconnect").map_err(|error| error.to_string())?;
            channel.read_to_end(&mut Vec::new()).map_err(|error| error.to_string())?;
            Err::<(), String>("Expected the server to disconnect".into())
        });
        let expired = ssh_list_sync(&target, None).err().ok_or("Expired service unexpectedly remained available")?;
        assert!(expired.contains("SSH_AUTH_FAILED:"), "{expired}");
        AUTH_CACHE.lock().unwrap().clear("mfa-first");
        assert!(AUTH_CACHE.lock().unwrap().service(&target).is_none());
        let direct = profile("target", 2);
        let id = uuid::Uuid::new_v4().to_string();
        let reply = id.clone();
        let rejected = Exchange::new(id, "fixture".into(), &direct, move |challenge| match challenge {
            Challenge::Prompts { round, prompts, .. } => respond("fixture", &reply, round, vec!["rejected-answer".into(); prompts.len()]),
            _ => Err("Unexpected trust prompt".into()),
        })?;
        assert!(connect_interactive(&direct, &rejected).err().unwrap().contains("SSH_AUTH_FAILED:"));
        drop(rejected);
        let cancelled = Exchange::new(uuid::Uuid::new_v4().to_string(), "fixture".into(), &direct, |_| {
            super::super::interactive_auth::cancel_connection("mfa-target"); Ok(())
        })?;
        assert!(connect_interactive(&direct, &cancelled).err().unwrap().contains("SSH_AUTH_CANCELLED:"));
        drop(cancelled);
        // A known key mismatch must fail before any credentials are requested.
        let text = std::fs::read_to_string(&known_hosts).map_err(|error| error.to_string())?;
        let target_line = text.lines().find(|line| line.starts_with(&format!("[127.0.0.1]:{} ", direct.port.unwrap()))).ok_or("Missing trusted target")?;
        let first_line = text.lines().find(|line| line.starts_with(&format!("[127.0.0.1]:{} ", ports[0]))).ok_or("Missing trusted first hop")?;
        let target_parts: Vec<_> = target_line.split_whitespace().collect();
        let first_parts: Vec<_> = first_line.split_whitespace().collect();
        let changed = text.replace(target_line, &format!("{} {} {}", target_parts[0], first_parts[1], first_parts[2]));
        std::fs::write(&known_hosts, changed).map_err(|error| error.to_string())?;
        let mismatch = Exchange::new(uuid::Uuid::new_v4().to_string(), "fixture".into(), &direct, |_| Err("A mismatched key reached authentication".into()))?;
        let error = connect_interactive(&direct, &mismatch).err().unwrap();
        assert!(error.contains("host-trust"), "{error}");
        Ok(())
    }

    #[test]
    #[ignore = "Run through scripts/test-ssh-jumps.py for isolated protocol servers"]
    fn jump_protocol_fixture() -> Result<(), String> {
        let fixture: serde_json::Value = serde_json::from_str(&std::env::var("VRYKELL_SSH_JUMP_FIXTURE").map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        let root = std::path::PathBuf::from(fixture["directory"].as_str().ok_or("Missing fixture directory")?);
        let ports: Vec<u16> = fixture["ports"].as_array().ok_or("Missing fixture ports")?.iter().map(|port| port.as_u64().unwrap() as u16).collect();
        struct TrustScope;
        impl Drop for TrustScope { fn drop(&mut self) { TEST_KNOWN_HOSTS.with(|path| *path.borrow_mut() = None); } }
        let _scope = TrustScope;
        TEST_KNOWN_HOSTS.with(|path| *path.borrow_mut() = Some(root.join("known_hosts")));
        let profile = |name: &str, port: u16| -> SshConnection {
            serde_json::from_value(serde_json::json!({ "id": format!("fixture-{name}"), "name": name, "host": "127.0.0.1", "port": port,
                "user": format!("{name}-user"), "authMethod": "password", "password": format!("{name}-test-secret"), "proxyId": "none" })).unwrap()
        };
        let first = profile("first", ports[0]);
        let mut second = profile("second", ports[1]);
        second.auth_method = "key".into();
        second.password.clear();
        second.options.identity_file = Some(root.join("client-key").to_string_lossy().into_owned());
        let mut target = profile("target", ports[2]);
        target.options.jump_connection_id = Some("fixture-second".into());
        target.options.resolved_jumps = super::super::jump::ResolvedJumps(vec![first.clone(), second]);
        println!("Fixture: checking repeated direct handshakes");
        let mut direct = target.clone();
        direct.options.jump_connection_id = None;
        direct.options.resolved_jumps.0.clear();
        for index in 0..10 {
            let session = connect_with_timeout(&direct, Some(Duration::from_secs(10))).map_err(|error| format!("Direct handshake {index}: {error}"))?;
            assert!(matches!(session.host_key().unwrap().1, HostKeyType::Rsa));
        }
        println!("Fixture: checking repeated routed handshakes");
        for index in 0..5 {
            connect_with_timeout(&target, Some(Duration::from_secs(10))).map_err(|error| format!("Routed handshake {index}: {error}"))?;
        }
        println!("Fixture: connecting through two hops");
        let session = connect_with_timeout(&target, Some(Duration::from_secs(10)))?;
        println!("Fixture: checking file service");
        let sftp = session.sftp().map_err(|error| error.to_string())?;
        assert_eq!(sftp.realpath(Path::new(".")).map_err(|error| error.to_string())?, Path::new("/"));
        assert!(sftp.readdir(Path::new("/")).map_err(|error| error.to_string())?.iter().any(|(path, _)| path.file_name().unwrap() == "fixture.txt"));
        drop(sftp);
        println!("Fixture: checking forwarded channel");
        let mut echo = session.channel_direct_tcpip("127.0.0.1", ports[3], None).map_err(|error| error.to_string())?;
        echo.write_all(b"forwarded").map_err(|error| error.to_string())?;
        let mut response = [0; 9];
        echo.read_exact(&mut response).map_err(|error| error.to_string())?;
        assert_eq!(&response, b"forwarded");
        drop(echo);
        drop(session);
        println!("Fixture: checking resource collection");
        let status = ssh_system_status_sync(&target, SshStatusMetrics::all())?;
        assert_eq!(status.system, "Fixture Unix");
        assert_eq!(status.memory_total, Some(1024.0));
        let service = connect_with_timeout(&target, Some(Duration::from_secs(10)))?;
        let revision = AUTH_CACHE.lock().unwrap().begin(&target.id);
        assert!(AUTH_CACHE.lock().unwrap().store_session(&target, revision, service));
        let independent = connect_with_timeout(&target, Some(Duration::from_secs(10)))?;
        assert!(independent.authenticated());
        drop(independent);
        AUTH_CACHE.lock().unwrap().clear(&target.id);
        println!("Fixture: using independent temporary credentials through two saved hops");
        let mut temporary_first = profile("first", ports[0]);
        temporary_first.options.authentication_mode = Some("ask".into());
        let first_secret = std::sync::Arc::new(Credential { method: AuthMethod::Password, secret: Zeroizing::new(std::mem::take(&mut temporary_first.password)) });
        let revision = AUTH_CACHE.lock().unwrap().begin(&temporary_first.id);
        connect_authenticated(&temporary_first, Some(Duration::from_secs(5)), Some(&first_secret))?;
        assert!(AUTH_CACHE.lock().unwrap().store(&temporary_first, revision, first_secret));
        let mut temporary_second = profile("second", ports[1]);
        temporary_second.options.authentication_mode = Some("ask".into());
        temporary_second.options.jump_connection_id = Some(temporary_first.id.clone());
        temporary_second.options.resolved_jumps.0 = vec![temporary_first.clone()];
        let second_secret = std::sync::Arc::new(Credential { method: AuthMethod::Password, secret: Zeroizing::new(std::mem::take(&mut temporary_second.password)) });
        let revision = AUTH_CACHE.lock().unwrap().begin(&temporary_second.id);
        connect_authenticated(&temporary_second, Some(Duration::from_secs(5)), Some(&second_secret))?;
        assert!(AUTH_CACHE.lock().unwrap().store(&temporary_second, revision, second_secret));
        temporary_second.options.resolved_jumps.0.clear();
        let mut temporary_target = target.clone();
        temporary_target.options.resolved_jumps.0 = vec![temporary_first.clone(), temporary_second.clone()];
        assert_eq!(ssh_list_sync(&temporary_target, None)?.entries[0].name, "fixture.txt");
        assert_eq!(ssh_system_status_sync(&temporary_target, SshStatusMetrics::all())?.system, "Fixture Unix");
        AUTH_CACHE.lock().unwrap().clear(&temporary_first.id);
        AUTH_CACHE.lock().unwrap().clear(&temporary_second.id);
        super::super::file_channel::invalidate_all();
        println!("Fixture: cancellation after handshake prevents sending a saved password");
        let mut cancelled = direct.clone();
        cancelled.id = "cancelled-before-auth".into();
        cancelled.user = "cancelled-target-user".into();
        let session = tcp_handshake(&cancelled)?;
        verify_host_key(&session, &cancelled.host, cancelled.port.unwrap_or(22))?;
        let exchange = super::super::interactive_auth::Exchange::new(uuid::Uuid::new_v4().to_string(), "fixture".into(), &cancelled, |_| Err("Unexpected challenge".into()))?;
        super::super::interactive_auth::cancel_connection(&cancelled.id);
        let error = authenticate_checked(&session, &cancelled, &cancelled.user, None, || exchange.attempt.check()).unwrap_err();
        assert!(error.contains("SSH_AUTH_CANCELLED:"));
        assert!(!session.authenticated());
        drop(session);
        drop(exchange);
        println!("Fixture: checking authentication and trust failures");
        let mut wrong = target.clone();
        wrong.options.resolved_jumps.0[0].password = "incorrect".into();
        let error = connect_with_timeout(&wrong, Some(Duration::from_secs(5))).err().ok_or("Wrong hop credential was accepted")?;
        assert!(error.starts_with("SSH_JUMP_FAILED:fixture-first:"), "{error}");
        assert!(error.contains("SSH_AUTH_FAILED:"), "{error}");
        TEST_KNOWN_HOSTS.with(|path| *path.borrow_mut() = Some(root.join("untrusted_hosts")));
        assert!(connect_with_timeout(&target, Some(Duration::from_secs(5))).err().unwrap().contains("HOST_KEY_UNKNOWN:"));
        let known = std::fs::read_to_string(root.join("known_hosts")).map_err(|error| error.to_string())?;
        let mut lines = known.lines();
        let first_address = lines.next().unwrap().split_whitespace().next().unwrap();
        let other_key = known.lines().last().unwrap().split_once(' ').unwrap().1;
        let changed = root.join("changed_hosts");
        std::fs::write(&changed, format!("{first_address} {other_key}\n")).map_err(|error| error.to_string())?;
        TEST_KNOWN_HOSTS.with(|path| *path.borrow_mut() = Some(changed));
        assert!(connect_with_timeout(&target, Some(Duration::from_secs(5))).err().unwrap().contains("主机密钥不匹配"));
        TEST_KNOWN_HOSTS.with(|path| *path.borrow_mut() = Some(root.join("known_hosts")));

        for hop in &mut target.options.resolved_jumps.0 {
            hop.auth_method = "key".into(); hop.options.authentication_mode = Some("key".into()); hop.password.clear();
            hop.options.identity_file = Some(root.join("client-key").to_string_lossy().into_owned());
        }
        target.options.identity_file = Some(root.join("client-key").to_string_lossy().into_owned());
        target.options.authentication_mode = Some("key".into());
        println!("Fixture: checking interactive client configuration");
        let _config = super::super::jump::LaunchConfig::create(&mut target.options)?;
        std::fs::OpenOptions::new().append(true).open(target.options.config_file.as_ref().unwrap()).map_err(|error| error.to_string())?
            .write_all(b"\nHost *\n BatchMode yes\n").map_err(|error| error.to_string())?;
        let launch = crate::terminal::ssh_command::build_ssh_command(&crate::terminal::ssh_command::SshTarget {
            host: target.host.clone(), port: target.port, user: Some(target.user.clone()), host_key_type: None, options: target.options,
        }, Some("fixture-probe"))?;
        let arguments = launch.get_argv();
        let output = std::process::Command::new(&arguments[0]).args(&arguments[1..]).stdin(std::process::Stdio::null()).output().map_err(|error| error.to_string())?;
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(String::from_utf8_lossy(&output.stdout).contains("destination reached"));
        Ok(())
    }

    #[test]
    fn an_explicit_no_jump_profile_uses_the_direct_file_connection_path() {
        let mut conn: SshConnection = serde_json::from_value(serde_json::json!({
            "id": "direct", "name": "direct", "host": "localhost", "jumpHost": "none"
        })).unwrap();
        assert_eq!(connect(&conn).err().as_deref(), Some("用户名不能为空"));
        conn.options.jump_host = Some("bastion".into());
        assert_eq!(connect(&conn).err().as_deref(), Some("用户名不能为空"));
    }

    #[test]
    fn host_key_preferences_follow_only_the_recorded_endpoint() {
        let session = Session::new().unwrap();
        let mut known = session.known_hosts().unwrap();
        known.add("trusted.test", b"rsa-fixture-key", "", KnownHostKeyFormat::SshRsa).unwrap();
        known.add("other.test", b"other-key", "", KnownHostKeyFormat::Ecdsa256).unwrap();
        let path = std::env::temp_dir().join(format!("host-key-preference-{}", uuid::Uuid::new_v4()));
        known.write_file(&path, KnownHostFileKind::OpenSSH).unwrap();
        let supported = session.supported_algs(ssh2::MethodType::HostKey).unwrap();
        let algorithms = prefer_known_host_key(&session, "trusted.test", 22, &path).unwrap().unwrap();
        let preferred: Vec<_> = algorithms.split(',').collect();
        let rsa: Vec<_> = supported.iter().copied().filter(|algorithm| matches!(*algorithm, "rsa-sha2-512" | "rsa-sha2-256" | "ssh-rsa")).collect();
        assert!(preferred.starts_with(&rsa));
        assert!(preferred.iter().all(|algorithm| supported.contains(algorithm)));
        assert_eq!(preferred.len(), supported.len());
        assert_eq!(prefer_known_host_key(&session, "unknown.test", 22, &path).unwrap(), None);
        known.add("trusted.test", b"ecdsa-fixture-key", "", KnownHostKeyFormat::Ecdsa256).unwrap();
        known.write_file(&path, KnownHostFileKind::OpenSSH).unwrap();
        let algorithms = prefer_known_host_key(&session, "trusted.test", 22, &path).unwrap().unwrap();
        let trusted: Vec<_> = supported.iter().copied().filter(|algorithm| rsa.contains(algorithm) || *algorithm == "ecdsa-sha2-nistp256").collect();
        assert!(algorithms.split(',').collect::<Vec<_>>().starts_with(&trusted));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn host_key_preferences_match_hashed_names_and_nondefault_ports() {
        let session = Session::new().unwrap();
        let path = std::env::temp_dir().join(format!("host-key-preference-{}", uuid::Uuid::new_v4()));
        let text = "|1|AQIDBAUGBwgJCgsMDQ4PEBESExQ=|C9Z1umYH0Hc57MeO1vlidxT1mhE= ssh-rsa cnNhLWZpeHR1cmUta2V5\n";
        std::fs::write(&path, text).unwrap();
        assert!(prefer_known_host_key(&session, "trusted.test", 2222, &path).unwrap().unwrap().starts_with("rsa-sha2-512,rsa-sha2-256,"));
        assert_eq!(prefer_known_host_key(&session, "trusted.test", 22, &path).unwrap(), None);
        assert_eq!(prefer_known_host_key(&session, "trusted.test", 2223, &path).unwrap(), None);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(prefer_known_host_key(&session, "trusted.test", 2222, &path).unwrap(), None);
    }

    #[test]
    #[ignore = "Requires VRYKELL_SSH_TRUST_PROBE_HOST and an existing trusted endpoint"]
    fn manual_trusted_host_preflight() -> Result<(), String> {
        let host = std::env::var("VRYKELL_SSH_TRUST_PROBE_HOST").map_err(|error| error.to_string())?;
        let port: u16 = std::env::var("VRYKELL_SSH_TRUST_PROBE_PORT").unwrap_or_else(|_| "22".into()).parse::<u16>().map_err(|error| error.to_string())?;
        let conn: SshConnection = serde_json::from_value(serde_json::json!({
            "id": "trust-probe", "name": "trust-probe", "host": host, "port": port,
            "user": "", "authMethod": "key", "proxyId": "none",
        })).map_err(|error| error.to_string())?;
        let session = tcp_handshake_with_timeout(&conn, Some(Duration::from_secs(6)))?;
        verify_host_key(&session, &conn.host, port)?;
        assert!(!session.authenticated());
        println!("Trusted host preflight passed: algorithm={:?}", session.methods(ssh2::MethodType::HostKey));
        Ok(())
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
        // Entry paths are produced by the platform layer's POSIX join: no backslashes or doubled
        // slashes even on a Windows host
        let path = crate::platform::path::join("/home/user/", "docs");
        assert_eq!(path, "/home/user/docs");
        assert!(!path.contains('\\'));
        assert_eq!(crate::platform::path::name_from_listing("/home/user\\docs", "/home/user").as_deref(), Some("docs"));
        assert_eq!(crate::platform::path::name_from_listing("/home/user/docs", "/home/user").as_deref(), Some("docs"));
    }

    #[test]
    fn sftp_entry_shape_is_stable() {
        // Only verify the serialized shape of the struct fields (the frontend consumes camelCase)
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

    // Note: connect / ssh_list_sync need a real SSH service, so they cannot be unit tested
    // offline; e2e (with a mocked ssh_list) and manual verification on a real machine cover them.
    // Manual verification on a real machine: `cargo test manual_local_sftp -- --ignored --nocapture`
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
        // Download a file to verify ssh_download
        let (local, size) = ssh_download_sync(&conn, "/Users/wuzhe/.DS_Store").expect("下载失败");
        println!("下载到: {local}（{size} 字节）");
        assert!(std::path::Path::new(&local).exists());
    }
    /// Find a verification-code line in the screen text (single digits separated by spaces).
    fn captcha_digits(text: &str) -> Option<String> {
        text.lines().rev().find_map(|line| {
            let tokens: Vec<&str> = line.split_whitespace().collect();
            (tokens.len() >= 4 && tokens.iter().all(|token| token.len() == 1 && token.chars().all(|c| c.is_ascii_digit())))
                .then(|| tokens.concat())
        })
    }

    // Manual verification on a real machine (requires network access and an external service):
    // `cargo test manual_chat_server_flow -- --ignored --nocapture`
    // Exercises the flow: initial fingerprint check → production command construction → PTY start
    // → password → verification code → interactive UI → quit.
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

        // 1) Same pre-checks as the frontend prepareSshHost
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

        // 2) Start an interactive session with the production command builder
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
