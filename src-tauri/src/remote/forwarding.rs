use crate::db::{HistoryState, SshConnection};
use serde::{Deserialize, Serialize};
use ssh2::{Channel, ErrorCode, Session};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForwardingRule {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub bind: String,
    pub port: u16,
    pub host: String,
    pub target_port: u16,
    pub auto_start: bool,
}

impl ForwardingRule {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.id.len() > 128 || !self.id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
            || self.name.len() > 256 || self.name.chars().any(char::is_control) { return Err("Invalid forwarding rule name or identifier".into()); }
        if !matches!(self.kind.as_str(), "local" | "remote" | "dynamic") || self.port == 0 || self.kind != "dynamic" && self.target_port == 0 {
            return Err("Invalid forwarding type or port".into());
        }
        let valid_host = |host: &str| !host.is_empty() && host.len() <= 253 && host.bytes().all(|byte| byte.is_ascii_alphanumeric() || b".-_:[]".contains(&byte));
        if !valid_host(&self.bind) || !valid_host(&self.host) { return Err("Invalid forwarding address".into()); }
        Ok(())
    }
}

#[derive(Clone)]
struct RunningForward {
    stop: Arc<AtomicBool>,
    ready: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    rule: ForwardingRule,
    target: String,
}

static RUNNING: LazyLock<Mutex<HashMap<String, RunningForward>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardingStatus { id: String, running: bool, error: Option<String> }

fn key(connection: &str, rule: &str) -> String { format!("{connection}/{rule}") }
fn retryable(error: &ssh2::Error) -> bool { error.code() == ErrorCode::Session(-37) }
fn hostname(host: &str) -> &str { host.trim_start_matches('[').trim_end_matches(']') }
fn target_signature(connection: &SshConnection) -> String {
    serde_json::json!([connection.host, connection.port, connection.user, connection.auth_method,
        connection.options.identity_file, connection.options.proxy_id, connection.options.jump_host]).to_string()
}

fn open_channel(session: &Session, host: &str, port: u16, stop: &AtomicBool) -> Result<Channel, String> {
    let started = Instant::now();
    loop {
        if stop.load(Ordering::Relaxed) { return Err("Forwarding stopped".into()); }
        match session.channel_direct_tcpip(hostname(host), port, None) {
            Ok(channel) => return Ok(channel),
            Err(error) if retryable(&error) && started.elapsed() < Duration::from_secs(10) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn socks_destination(stream: &mut TcpStream) -> Result<(String, u16), String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
    let mut greeting = [0; 2];
    stream.read_exact(&mut greeting).map_err(|error| error.to_string())?;
    if greeting[0] != 5 || greeting[1] == 0 { return Err("Unsupported proxy handshake".into()); }
    let mut methods = vec![0; greeting[1] as usize];
    stream.read_exact(&mut methods).map_err(|error| error.to_string())?;
    if !methods.contains(&0) { let _ = stream.write_all(&[5, 255]); return Err("Unsupported proxy authentication".into()); }
    stream.write_all(&[5, 0]).map_err(|error| error.to_string())?;
    let mut request = [0; 4];
    stream.read_exact(&mut request).map_err(|error| error.to_string())?;
    if request[0] != 5 || request[1] != 1 || request[2] != 0 { return Err("Only proxy TCP connections are supported".into()); }
    let host = match request[3] {
        1 => { let mut bytes = [0; 4]; stream.read_exact(&mut bytes).map_err(|error| error.to_string())?; std::net::Ipv4Addr::from(bytes).to_string() },
        4 => { let mut bytes = [0; 16]; stream.read_exact(&mut bytes).map_err(|error| error.to_string())?; std::net::Ipv6Addr::from(bytes).to_string() },
        3 => {
            let mut length = [0]; stream.read_exact(&mut length).map_err(|error| error.to_string())?;
            let mut bytes = vec![0; length[0] as usize]; stream.read_exact(&mut bytes).map_err(|error| error.to_string())?;
            let host = String::from_utf8(bytes).map_err(|error| error.to_string())?;
            if host.is_empty() || host.bytes().any(|byte| byte.is_ascii_control()) { return Err("Invalid proxy destination".into()); }
            host
        },
        _ => return Err("Unsupported proxy address".into()),
    };
    let mut bytes = [0; 2]; stream.read_exact(&mut bytes).map_err(|error| error.to_string())?;
    let port = u16::from_be_bytes(bytes);
    if port == 0 { return Err("Invalid proxy port".into()); }
    Ok((host, port))
}

trait ForwardingChannel: Read + Write {
    fn read_eof(&self) -> bool;
    fn write_eof(&mut self) -> std::io::Result<()>;
    fn close_channel(&mut self);
}

impl ForwardingChannel for Channel {
    fn read_eof(&self) -> bool { self.eof() }
    fn write_eof(&mut self) -> std::io::Result<()> { self.send_eof().map_err(Into::into) }
    fn close_channel(&mut self) { let _ = self.close(); }
}

fn bridge(mut stream: TcpStream, mut channel: impl ForwardingChannel, stop: Arc<AtomicBool>) -> Result<(), String> {
    stream.set_nonblocking(true).map_err(|error| error.to_string())?;
    let mut to_remote = Vec::new();
    let mut to_local = Vec::new();
    let mut local_eof = false;
    let mut sent_eof = false;
    let mut local_write_closed = false;
    let mut buffer = [0; 16384];
    while !stop.load(Ordering::Relaxed) {
        let mut progress = false;
        if !local_eof && to_remote.is_empty() {
            match stream.read(&mut buffer) {
                Ok(0) => local_eof = true,
                Ok(length) => { to_remote.extend_from_slice(&buffer[..length]); progress = true; },
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {},
                Err(error) => return Err(error.to_string()),
            }
        }
        if !to_remote.is_empty() {
            match channel.write(&to_remote) {
                Ok(length) => { to_remote.drain(..length); progress |= length > 0; },
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {},
                Err(error) => return Err(error.to_string()),
            }
        }
        if local_eof && to_remote.is_empty() && !sent_eof {
            match channel.write_eof() { Ok(()) => sent_eof = true, Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}, Err(error) => return Err(error.to_string()) }
        }
        if to_local.is_empty() && !channel.read_eof() {
            match channel.read(&mut buffer) {
                Ok(length) => { to_local.extend_from_slice(&buffer[..length]); progress |= length > 0; },
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {},
                Err(error) => return Err(error.to_string()),
            }
        }
        if !to_local.is_empty() {
            match stream.write(&to_local) {
                Ok(length) => { to_local.drain(..length); progress |= length > 0; },
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {},
                Err(error) => return Err(error.to_string()),
            }
        }
        if channel.read_eof() && to_local.is_empty() && !local_write_closed {
            stream.shutdown(std::net::Shutdown::Write).map_err(|error| error.to_string())?;
            local_write_closed = true;
        }
        if channel.read_eof() && sent_eof && to_local.is_empty() && to_remote.is_empty() { break; }
        if !progress { std::thread::sleep(Duration::from_millis(10)); }
    }
    channel.close_channel();
    Ok(())
}

fn reserve(connection: &SshConnection, rule: &ForwardingRule) -> Result<Option<RunningForward>, String> {
    rule.validate()?;
    let id = key(&connection.id, &rule.id);
    let stop = Arc::new(AtomicBool::new(false));
    let ready = Arc::new(AtomicBool::new(false));
    let error = Arc::new(Mutex::new(None));
    {
        let mut running = RUNNING.lock().map_err(|error| error.to_string())?;
        if running.get(&id).is_some_and(|item| !item.stop.load(Ordering::Relaxed)) { return Ok(None); }
        if running.values().filter(|item| !item.stop.load(Ordering::Relaxed)).count() >= 32 { return Err("Too many running forwards".into()); }
        running.insert(id.clone(), RunningForward { stop: stop.clone(), ready: ready.clone(), error: error.clone(), rule: rule.clone(), target: target_signature(&connection) });
    }
    Ok(Some(RunningForward { stop, ready, error, rule: rule.clone(), target: target_signature(connection) }))
}

fn start(connection: SshConnection, runtime: RunningForward) -> Result<(), String> {
    let RunningForward { stop, ready, error, rule, .. } = runtime;
    if stop.load(Ordering::Relaxed) { return Err("Forwarding stopped".into()); }
    let prepared = (|| {
        let session = super::ssh::connect_with_timeout(&connection, Some(Duration::from_secs(10)))?;
        if stop.load(Ordering::Relaxed) { return Err("Forwarding stopped".to_string()); }
        let local = if rule.kind != "remote" {
            let listener = TcpListener::bind((hostname(&rule.bind), rule.port)).map_err(|error| error.to_string())?;
            listener.set_nonblocking(true).map_err(|error| error.to_string())?;
            Some(listener)
        } else { None };
        let remote = if rule.kind == "remote" { Some(session.channel_forward_listen(rule.port, Some(hostname(&rule.bind)), Some(16)).map_err(|error| error.to_string())?.0) } else { None };
        if stop.load(Ordering::Relaxed) { return Err("Forwarding stopped".into()); }
        session.set_blocking(false);
        Ok((session, local, remote))
    })();
    let (session, local, remote) = match prepared {
        Ok(prepared) => prepared,
        Err(failure) => {
            stop.store(true, Ordering::Relaxed);
            *error.lock().map_err(|error| error.to_string())? = Some(failure.clone());
            return Err(failure);
        },
    };
    ready.store(true, Ordering::Relaxed);
    std::thread::spawn(move || {
        let mut remote = remote;
        let workers = Arc::new(AtomicUsize::new(0));
        while !stop.load(Ordering::Relaxed) {
            let accepted = if let Some(listener) = &local {
                match listener.accept() {
                    Ok((stream, _)) => Some((Some(stream), None)),
                    Err(failure) if failure.kind() == std::io::ErrorKind::WouldBlock => None,
                    Err(failure) => { *error.lock().unwrap() = Some(failure.to_string()); break; },
                }
            } else {
                match remote.as_mut().unwrap().accept() {
                    Ok(channel) => Some((None, Some(channel))),
                    Err(failure) if retryable(&failure) => None,
                    Err(failure) => { *error.lock().unwrap() = Some(failure.to_string()); break; },
                }
            };
            if let Some((stream, channel)) = accepted {
                if workers.load(Ordering::Relaxed) >= 64 { continue; }
                let session = session.clone(); let stop = stop.clone(); let rule = rule.clone(); let workers = workers.clone(); let error = error.clone();
                workers.fetch_add(1, Ordering::Relaxed);
                std::thread::spawn(move || {
                    let result = (|| {
                        let mut stream = match stream {
                            Some(stream) => stream,
                            None => {
                                use std::net::ToSocketAddrs;
                                let address = (hostname(&rule.host), rule.target_port).to_socket_addrs().map_err(|failure| failure.to_string())?.next().ok_or("Destination has no address")?;
                                TcpStream::connect_timeout(&address, Duration::from_secs(5)).map_err(|failure| failure.to_string())?
                            },
                        };
                        let channel = match channel {
                            Some(channel) => channel,
                            None if rule.kind == "dynamic" => {
                                let (host, port) = socks_destination(&mut stream)?;
                                let channel = open_channel(&session, &host, port, &stop);
                                let status = if channel.is_ok() { 0 } else { 5 };
                                stream.write_all(&[5, status, 0, 1, 0, 0, 0, 0, 0, 0]).map_err(|failure| failure.to_string())?;
                                channel?
                            },
                            None => open_channel(&session, &rule.host, rule.target_port, &stop)?,
                        };
                        bridge(stream, channel, stop)
                    })();
                    if let Err(failure) = result { *error.lock().unwrap() = Some(failure); }
                    workers.fetch_sub(1, Ordering::Relaxed);
                });
            } else { std::thread::sleep(Duration::from_millis(20)); }
        }
        stop.store(true, Ordering::Relaxed);
        drop(local);
        drop(remote);
        let _ = session.disconnect(None, "Forwarding stopped", None);
        ready.store(false, Ordering::Relaxed);
    });
    Ok(())
}

#[tauri::command]
pub async fn ssh_forward_start(state: State<'_, HistoryState>, connection_id: String, rule_id: String) -> Result<(), String> {
    let (connection, runtime) = {
        let database = state.0.lock().map_err(|error| error.to_string())?;
        let connection = database.get_ssh_connection(&connection_id)?;
        let rule = connection.options.forwarding_rules.as_ref().and_then(|rules| rules.iter().find(|rule| rule.id == rule_id)).ok_or("Forwarding rule no longer exists")?;
        let runtime = reserve(&connection, rule)?;
        (connection, runtime)
    };
    let Some(runtime) = runtime else { return Ok(()); };
    tauri::async_runtime::spawn_blocking(move || start(connection, runtime)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ssh_forward_stop(connection_id: String, rule_id: String) -> Result<(), String> {
    let item = RUNNING.lock().map_err(|error| error.to_string())?.remove(&key(&connection_id, &rule_id));
    if let Some(item) = item {
        item.stop.store(true, Ordering::Relaxed);
        tauri::async_runtime::spawn_blocking(move || {
            let started = Instant::now();
            while item.ready.load(Ordering::Relaxed) && started.elapsed() < Duration::from_secs(3) { std::thread::sleep(Duration::from_millis(10)); }
        }).await.map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_forwards_status() -> Result<Vec<ForwardingStatus>, String> {
    Ok(RUNNING.lock().map_err(|error| error.to_string())?.iter().map(|(id, item)| ForwardingStatus { id: id.clone(), running: item.ready.load(Ordering::Relaxed) && !item.stop.load(Ordering::Relaxed), error: item.error.lock().ok().and_then(|error| error.clone()) }).collect())
}

pub fn stop_all() {
    if let Ok(mut running) = RUNNING.lock() { for (_, item) in running.drain() { item.stop.store(true, Ordering::Relaxed); } }
}

pub fn invalidate_connection(connection: &SshConnection) {
    let prefix = format!("{}/", connection.id);
    let target = target_signature(connection);
    if let Ok(mut running) = RUNNING.lock() {
        running.retain(|id, item| {
            if !id.starts_with(&prefix) { return true; }
            let valid = connection.password.is_empty() && item.target == target && connection.options.forwarding_rules.iter().flatten().any(|rule|
                rule.id == item.rule.id && rule.kind == item.rule.kind && rule.bind == item.rule.bind && rule.port == item.rule.port && rule.host == item.rule.host && rule.target_port == item.rule.target_port);
            if !valid { item.stop.store(true, Ordering::Relaxed); }
            valid
        });
    }
}

pub fn stop_connection(connection_id: &str) {
    let prefix = format!("{connection_id}/");
    if let Ok(mut running) = RUNNING.lock() {
        running.retain(|id, item| { if id.starts_with(&prefix) { item.stop.store(true, Ordering::Relaxed); false } else { true } });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule() -> ForwardingRule { ForwardingRule { id: "rule-1".into(), name: "Database".into(), kind: "local".into(), bind: "127.0.0.1".into(), port: 15432, host: "localhost".into(), target_port: 5432, auto_start: false } }

    struct LoopbackChannel { stream: TcpStream, eof: bool }
    impl Read for LoopbackChannel {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let length = self.stream.read(buffer)?;
            if length == 0 { self.eof = true; }
            Ok(length)
        }
    }
    impl Write for LoopbackChannel {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> { self.stream.write(buffer) }
        fn flush(&mut self) -> std::io::Result<()> { self.stream.flush() }
    }
    impl ForwardingChannel for LoopbackChannel {
        fn read_eof(&self) -> bool { self.eof }
        fn write_eof(&mut self) -> std::io::Result<()> { self.stream.shutdown(std::net::Shutdown::Write) }
        fn close_channel(&mut self) { let _ = self.stream.shutdown(std::net::Shutdown::Both); }
    }

    fn loopback_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let server = listener.accept().unwrap().0;
        client.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        server.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        (client, server)
    }

    #[test]
    fn bridge_preserves_upload_after_remote_read_half_closes() {
        let (mut client, local) = loopback_pair();
        let (upstream, mut server) = loopback_pair();
        upstream.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let worker = std::thread::spawn(move || bridge(local, LoopbackChannel { stream: upstream, eof: false }, worker_stop));
        server.write_all(b"response").unwrap();
        server.shutdown(std::net::Shutdown::Write).unwrap();
        let mut response = Vec::new(); client.read_to_end(&mut response).unwrap(); assert_eq!(response, b"response");
        client.write_all(b"upload-after-response").unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let mut upload = Vec::new(); server.read_to_end(&mut upload).unwrap();
        stop.store(true, Ordering::Relaxed);
        assert!(worker.join().unwrap().is_ok());
        assert_eq!(upload, b"upload-after-response");
    }

    #[test]
    fn rejects_invalid_rule_boundaries() {
        assert!(rule().validate().is_ok());
        for invalid in [ForwardingRule { port: 0, ..rule() }, ForwardingRule { host: "-o command".into(), ..rule() }, ForwardingRule { kind: "invalid".into(), ..rule() }, ForwardingRule { id: "../escape".into(), ..rule() }] { assert!(invalid.validate().is_err()); }
        assert!(ForwardingRule { kind: "dynamic".into(), target_port: 0, ..rule() }.validate().is_ok());
    }

    #[test]
    fn proxy_negotiates_only_bounded_tcp_destinations() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || { let (mut stream, _) = listener.accept().unwrap(); socks_destination(&mut stream).unwrap() });
        let mut stream = TcpStream::connect(address).unwrap();
        stream.write_all(&[5, 1, 0]).unwrap();
        let mut greeting = [0; 2]; stream.read_exact(&mut greeting).unwrap(); assert_eq!(greeting, [5, 0]);
        stream.write_all(&[5, 1, 0, 3, 9, b'l', b'o', b'c', b'a', b'l', b'h', b'o', b's', b't', 0, 80]).unwrap();
        assert_eq!(worker.join().unwrap(), ("localhost".into(), 80));
    }

    #[test]
    fn profile_changes_stop_only_changed_endpoints() {
        let mut connection = SshConnection {
            id: "forwarding-lifecycle-test".into(), name: "Saved".into(), host: "server".into(), port: Some(22), user: "ops".into(),
            password: String::new(), auth_method: "key".into(), options: Default::default(), last_opened_at: None, has_password: false,
        };
        connection.options.forwarding_rules = Some(vec![rule()]);
        let stop = Arc::new(AtomicBool::new(false));
        let id = key(&connection.id, &rule().id);
        RUNNING.lock().unwrap().insert(id.clone(), RunningForward { stop: stop.clone(), ready: Arc::new(AtomicBool::new(true)), error: Arc::new(Mutex::new(None)), rule: rule(), target: target_signature(&connection) });
        connection.options.forwarding_rules.as_mut().unwrap()[0].auto_start = true;
        connection.options.forwarding_rules.as_mut().unwrap()[0].name = "Renamed".into();
        invalidate_connection(&connection);
        assert!(!stop.load(Ordering::Relaxed));
        connection.options.forwarding_rules.as_mut().unwrap()[0].port = 16543;
        invalidate_connection(&connection);
        assert!(stop.load(Ordering::Relaxed));
        assert!(!RUNNING.lock().unwrap().contains_key(&id));
    }

    #[test]
    fn profile_deletion_stops_its_listener_without_stopping_another_profile() {
        let first = Arc::new(AtomicBool::new(false));
        let second = Arc::new(AtomicBool::new(false));
        let make = |stop: Arc<AtomicBool>| RunningForward { stop, ready: Arc::new(AtomicBool::new(true)), error: Arc::new(Mutex::new(None)), rule: rule(), target: String::new() };
        {
            let mut running = RUNNING.lock().unwrap();
            running.insert("deleted-profile/rule-1".into(), make(first.clone()));
            running.insert("retained-profile/rule-1".into(), make(second.clone()));
        }
        stop_connection("deleted-profile");
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
        stop_connection("retained-profile");
    }
}
