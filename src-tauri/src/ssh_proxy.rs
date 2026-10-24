use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

static CONFIG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default, skip_serializing)]
    pub password: String,
    #[serde(default)]
    pub has_password: bool,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfiguration {
    #[serde(default)]
    pub profiles: Vec<ProxyProfile>,
    pub default_id: Option<String>,
}

fn config_path() -> Result<PathBuf, String> {
    #[cfg(test)]
    { Ok(std::env::temp_dir().join(format!("ssh-proxy-isolated-{}.json", std::process::id()))) }
    #[cfg(not(test))]
    Ok(dirs::home_dir().ok_or("Home directory is unavailable")?.join(".vrykell/ssh-proxies.json"))
}

fn read_config() -> Result<ProxyConfiguration, String> {
    read_config_at(&config_path()?)
}

fn read_config_at(path: &std::path::Path) -> Result<ProxyConfiguration, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Proxy configuration is invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ProxyConfiguration::default()),
        Err(_) => Err("Could not read proxy configuration".into()),
    }
}

fn write_config(config: &ProxyConfiguration) -> Result<(), String> {
    write_config_at(&config_path()?, config)
}

fn write_config_at(path: &std::path::Path, config: &ProxyConfiguration) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("Invalid configuration path")?).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && !matches!(id, "none" | "default") && id.len() <= 128 && id.bytes().all(|character| character.is_ascii_alphanumeric() || b"-_".contains(&character))
}

fn validate_host(host: &str) -> Result<(), String> {
    if host.is_empty() || host.len() > 253 || host.starts_with('-') || !host.bytes().all(|character| character.is_ascii_alphanumeric() || b".-_:[]".contains(&character)) {
        return Err("Invalid proxy or destination host".into());
    }
    Ok(())
}

fn validate_profile(profile: &ProxyProfile) -> Result<(), String> {
    validate_host(&profile.host)?;
    if !valid_id(&profile.id) || profile.name.trim().is_empty() || profile.name.len() > 200 || !matches!(profile.kind.as_str(), "http" | "socks5") || profile.port == 0 {
        return Err("Invalid proxy profile".into());
    }
    if profile.username.len() > 255 || profile.username.chars().any(char::is_control) || profile.password.len() > 255 || profile.kind == "http" && profile.username.contains(':') {
        return Err("Proxy credentials exceed the supported size".into());
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_proxy_configuration() -> Result<ProxyConfiguration, String> {
    let _guard = CONFIG_LOCK.lock().map_err(|_| "Proxy configuration is busy")?;
    let mut config = read_config()?;
    for profile in &mut config.profiles {
        profile.password.clear();
        profile.has_password = crate::secret::get_secret(&format!("ssh-proxy:{}", profile.id)).is_some();
    }
    Ok(config)
}

#[tauri::command]
pub fn ssh_proxy_save(mut profile: ProxyProfile) -> Result<(), String> {
    validate_profile(&profile)?;
    let _guard = CONFIG_LOCK.lock().map_err(|_| "Proxy configuration is busy")?;
    let mut config = read_config()?;
    if config.profiles.len() >= 128 && !config.profiles.iter().any(|existing| existing.id == profile.id) { return Err("Too many proxy profiles".into()); }
    if !profile.password.is_empty() {
        crate::secret::set_secret(&format!("ssh-proxy:{}", profile.id), &profile.password)?;
    }
    profile.password.clear();
    if let Some(existing) = config.profiles.iter_mut().find(|existing| existing.id == profile.id) { *existing = profile; }
    else {
        if config.profiles.len() >= 128 { return Err("Too many proxy profiles".into()); }
        config.profiles.push(profile);
    }
    write_config(&config)
}

#[tauri::command]
pub fn ssh_proxy_delete(id: String) -> Result<(), String> {
    if !valid_id(&id) { return Err("Invalid proxy profile".into()); }
    let _guard = CONFIG_LOCK.lock().map_err(|_| "Proxy configuration is busy")?;
    let mut config = read_config()?;
    config.profiles.retain(|profile| profile.id != id);
    if config.default_id.as_deref() == Some(&id) { config.default_id = None; }
    write_config(&config)?;
    crate::secret::delete_secret(&format!("ssh-proxy:{id}"));
    Ok(())
}

#[tauri::command]
pub fn ssh_proxy_set_default(id: Option<String>) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().map_err(|_| "Proxy configuration is busy")?;
    let mut config = read_config()?;
    if id.as_ref().is_some_and(|id| !config.profiles.iter().any(|profile| &profile.id == id)) { return Err("Proxy profile was not found".into()); }
    config.default_id = id;
    write_config(&config)
}

fn selected_profile(id: Option<&str>) -> Result<Option<ProxyProfile>, String> {
    if id == Some("none") { return Ok(None); }
    let config = read_config()?;
    let selected = id.or(config.default_id.as_deref());
    let Some(selected) = selected else { return Ok(None); };
    let mut profile = config.profiles.into_iter().find(|profile| profile.id == selected).ok_or("Proxy profile was not found")?;
    validate_profile(&profile)?;
    profile.password = crate::secret::get_secret(&format!("ssh-proxy:{}", profile.id)).unwrap_or_default();
    validate_profile(&profile)?;
    Ok(Some(profile))
}

fn connect_tcp(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, String> {
    let started = Instant::now();
    for address in (host.trim_matches(['[', ']']), port).to_socket_addrs().map_err(|_| "Could not resolve connection address")? {
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() { break; }
        if let Ok(stream) = TcpStream::connect_timeout(&address, remaining) { return Ok(stream); }
    }
    Err("Connection timed out or was refused".into())
}

struct DeadlineStream<'stream> { stream: &'stream mut TcpStream, deadline: Instant }

impl DeadlineStream<'_> {
    fn remaining(&self) -> std::io::Result<Duration> {
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { Err(std::io::Error::from(std::io::ErrorKind::TimedOut)) } else { Ok(remaining) }
    }
}

impl Read for DeadlineStream<'_> {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        self.stream.set_read_timeout(Some(self.remaining()?))?;
        self.stream.read(bytes)
    }
}

impl Write for DeadlineStream<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.stream.set_write_timeout(Some(self.remaining()?))?;
        self.stream.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> { self.stream.flush() }
}

fn tunnel(socket: &mut TcpStream, profile: &ProxyProfile, host: &str, port: u16, timeout: Duration) -> Result<(), String> {
    let mut timed = DeadlineStream { stream: socket, deadline: Instant::now() + timeout };
    let stream = &mut timed;
    if profile.kind == "http" {
        let authority = if host.contains(':') && !host.starts_with('[') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
        let authentication = if profile.username.is_empty() { String::new() } else {
            let encoded = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", profile.username, profile.password));
            format!("Proxy-Authorization: Basic {encoded}\r\n")
        };
        stream.write_all(format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n{authentication}\r\n").as_bytes()).map_err(|_| "Proxy request failed")?;
        let mut header = Vec::new();
        while header.len() < 8192 && !header.ends_with(b"\r\n\r\n") {
            let mut byte = [0]; stream.read_exact(&mut byte).map_err(|_| "Proxy response failed")?; header.push(byte[0]);
        }
        let accepted = std::str::from_utf8(&header).ok().and_then(|text| text.lines().next()).is_some_and(|line| {
            let mut words = line.split_whitespace(); matches!(words.next(), Some("HTTP/1.0" | "HTTP/1.1")) && words.next() == Some("200")
        });
        if !header.ends_with(b"\r\n\r\n") || !accepted {
            return Err("Proxy rejected the connection".into());
        }
    } else {
        stream.write_all(if profile.username.is_empty() { &[5, 1, 0][..] } else { &[5, 2, 0, 2][..] }).map_err(|_| "Proxy request failed")?;
        let mut answer = [0; 2]; stream.read_exact(&mut answer).map_err(|_| "Proxy response failed")?;
        if answer[0] != 5 { return Err("Invalid proxy response".into()); }
        if answer[1] == 2 && !profile.username.is_empty() {
            let mut authentication = vec![1, profile.username.len() as u8];
            authentication.extend(profile.username.as_bytes()); authentication.push(profile.password.len() as u8); authentication.extend(profile.password.as_bytes());
            stream.write_all(&authentication).map_err(|_| "Proxy authentication failed")?;
            stream.read_exact(&mut answer).map_err(|_| "Proxy authentication failed")?;
            if answer != [1, 0] { return Err("Proxy authentication failed".into()); }
        } else if answer[1] != 0 { return Err("Proxy authentication method is unavailable".into()); }
        let destination = host.trim_matches(['[', ']']);
        let mut request = vec![5, 1, 0];
        match destination.parse::<std::net::IpAddr>() {
            Ok(std::net::IpAddr::V4(address)) => { request.push(1); request.extend(address.octets()); }
            Ok(std::net::IpAddr::V6(address)) => { request.push(4); request.extend(address.octets()); }
            Err(_) => { request.extend([3, destination.len() as u8]); request.extend(destination.as_bytes()); }
        }
        request.extend(port.to_be_bytes());
        stream.write_all(&request).map_err(|_| "Proxy connection failed")?;
        let mut reply = [0; 4]; stream.read_exact(&mut reply).map_err(|_| "Proxy connection failed")?;
        if reply[0] != 5 || reply[1] != 0 || reply[2] != 0 { return Err("Proxy rejected the destination".into()); }
        let length = match reply[3] { 1 => 4, 4 => 16, 3 => { let mut length = [0]; stream.read_exact(&mut length).map_err(|_| "Invalid proxy response")?; length[0] as usize }, _ => return Err("Invalid proxy address".into()) };
        let mut address = vec![0; length + 2]; stream.read_exact(&mut address).map_err(|_| "Invalid proxy response")?;
    }
    Ok(())
}

pub fn connect_target(host: &str, port: u16, proxy_id: Option<&str>, timeout: Option<Duration>) -> Result<TcpStream, String> {
    validate_host(host)?;
    if port == 0 { return Err("Invalid destination port".into()); }
    let timeout = timeout.unwrap_or(Duration::from_secs(15));
    let Some(profile) = selected_profile(proxy_id)? else { return connect_tcp(host, port, timeout); };
    let started = Instant::now();
    let mut stream = connect_tcp(&profile.host, profile.port, timeout)?;
    stream.set_read_timeout(Some(timeout)).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(timeout)).map_err(|error| error.to_string())?;
    tunnel(&mut stream, &profile, host, port, timeout.saturating_sub(started.elapsed()))?;
    stream.set_read_timeout(None).map_err(|error| error.to_string())?;
    stream.set_write_timeout(None).map_err(|error| error.to_string())?;
    Ok(stream)
}

pub fn command_option(proxy_id: Option<&str>, host: &str) -> Result<Option<String>, String> {
    let Some(profile) = selected_profile(proxy_id)? else { return Ok(None); };
    validate_host(host)?;
    helper_option(&std::env::current_exe().map_err(|error| error.to_string())?.to_string_lossy(), &profile.id).map(Some)
}

fn helper_option(path: &str, id: &str) -> Result<String, String> {
    if !valid_id(id) { return Err("Invalid proxy profile".into()); }
    let path = path.replace('\\', "/").replace('%', "%%");
    #[cfg(windows)]
    let executable = format!("\"{path}\"");
    #[cfg(not(windows))]
    let executable = format!("'{}'", path.replace('\'', "'\\''"));
    Ok(format!("ProxyCommand={executable} --ssh-proxy {id} \"%h\" \"%p\""))
}

pub fn helper_exit_code() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("--ssh-proxy") { return None; }
    let bridge = || -> Result<(), String> {
        if args.len() != 4 || !valid_id(&args[1]) { return Err("Invalid proxy helper request".into()); }
        let port = args[3].parse::<u16>().ok().filter(|port| *port > 0).ok_or("Invalid destination port")?;
        let mut stream = connect_target(&args[2], port, Some(&args[1]), None)?;
        let mut upstream = stream.try_clone().map_err(|error| error.to_string())?;
        std::thread::spawn(move || { let _ = std::io::copy(&mut std::io::stdin().lock(), &mut upstream); let _ = upstream.shutdown(Shutdown::Write); });
        let mut output = std::io::stdout().lock();
        std::io::copy(&mut stream, &mut output).map_err(|_| "Proxy stream ended")?;
        output.flush().map_err(|_| "Proxy output failed".to_string())
    };
    Some(match bridge() { Ok(()) => 0, Err(error) => { eprintln!("{error}"); 1 } })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn profile(kind: &str) -> ProxyProfile {
        ProxyProfile { id: "test-proxy".into(), name: "Development".into(), kind: kind.into(), host: "127.0.0.1".into(), port: 1080, username: String::new(), password: String::new(), has_password: false }
    }

    fn exchange(kind: &str, respond: impl FnOnce(TcpStream) + Send + 'static) -> Result<TcpStream, String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || respond(listener.accept().unwrap().0));
        let mut stream = TcpStream::connect(address).unwrap();
        let result = tunnel(&mut stream, &profile(kind), "server.test", 22, Duration::from_secs(2));
        server.join().unwrap();
        result.map(|()| stream)
    }

    #[test]
    fn validates_endpoints_identifiers_and_never_serializes_credentials() {
        for host in ["-option", "server name", "a\r\nHeader:x", "$(touch)", "a;command", ""] { assert!(validate_host(host).is_err()); }
        for host in ["server.test", "127.0.0.1", "::1", "[2001:db8::1]"] { validate_host(host).unwrap(); }
        let mut proxy = profile("http"); proxy.password = "sensitive".into();
        assert!(!serde_json::to_string(&proxy).unwrap().contains("sensitive"));
        proxy.id = "x; echo".into(); assert!(validate_profile(&proxy).is_err());
        proxy.id = "valid".into(); proxy.kind = "unknown".into(); assert!(validate_profile(&proxy).is_err());
    }

    #[test]
    fn configuration_roundtrips_without_secret_values() {
        let path = std::env::temp_dir().join(format!("proxy-profile-roundtrip-{}-{}.json", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut saved = profile("http"); saved.password = "never-save-this-value".into();
        let config = ProxyConfiguration { profiles: vec![saved], default_id: Some("test-proxy".into()) };
        write_config_at(&path, &config).unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("never-save-this-value"));
        let loaded = read_config_at(&path).unwrap();
        assert_eq!(loaded.default_id.as_deref(), Some("test-proxy"));
        assert!(loaded.profiles[0].password.is_empty());
        assert_eq!(loaded.profiles[0].kind, "http");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn helper_quotes_destinations_and_keeps_credentials_out_of_arguments() {
        let command = helper_option("C:/Program Files/terminal.exe", "test-proxy").unwrap();
        assert!(command.ends_with("--ssh-proxy test-proxy \"%h\" \"%p\""));
        assert!(helper_option("/app/terminal", "bad;command").is_err());
        assert!(helper_option("/app/terminal", "none").is_err());
    }

    #[test]
    fn http_connect_preserves_the_first_destination_bytes() {
        let mut stream = exchange("http", |mut socket| {
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") { let mut byte = [0]; socket.read_exact(&mut byte).unwrap(); request.push(byte[0]); }
            assert!(String::from_utf8(request).unwrap().starts_with("CONNECT server.test:22 HTTP/1.1\r\n"));
            socket.write_all(b"HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-test\r\n").unwrap();
        }).unwrap();
        let mut banner = [0; 14]; stream.read_exact(&mut banner).unwrap(); assert_eq!(&banner, b"SSH-2.0-test\r\n");
    }

    #[test]
    fn rejects_proxy_denials_malformed_status_and_oversized_headers() {
        for reply in [b"HTTP/1.1 407 Authentication required\r\n\r\n".to_vec(), b"UNTRUSTED 200 Accepted\r\n\r\n".to_vec(), vec![b'a'; 8192]] {
            assert!(exchange("http", move |mut socket| { let mut input = [0; 1024]; let _ = socket.read(&mut input); let _ = socket.write_all(&reply); }).is_err());
        }
    }

    #[test]
    fn socks5_negotiates_and_encodes_the_destination() {
        exchange("socks5", |mut socket| {
            let mut greeting = [0; 3]; socket.read_exact(&mut greeting).unwrap(); assert_eq!(greeting, [5, 1, 0]);
            socket.write_all(&[5, 0]).unwrap();
            let mut header = [0; 5]; socket.read_exact(&mut header).unwrap(); assert_eq!(header, [5, 1, 0, 3, 11]);
            let mut destination = [0; 13]; socket.read_exact(&mut destination).unwrap(); assert_eq!(&destination[..11], b"server.test"); assert_eq!(&destination[11..], &22u16.to_be_bytes());
            socket.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 22]).unwrap();
        }).unwrap();
    }

    #[test]
    fn socks5_authentication_is_sent_only_to_the_proxy() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let mut socket = listener.accept().unwrap().0;
            let mut greeting = [0; 4]; socket.read_exact(&mut greeting).unwrap(); assert_eq!(greeting, [5, 2, 0, 2]); socket.write_all(&[5, 2]).unwrap();
            let mut auth = [0; 9]; socket.read_exact(&mut auth).unwrap(); assert_eq!(&auth, &[1, 3, b'd', b'e', b'v', 3, b'p', b'w', b'd']); socket.write_all(&[1, 0]).unwrap();
            let mut request = [0; 10]; socket.read_exact(&mut request).unwrap(); assert_eq!(&request, &[5, 1, 0, 1, 127, 0, 0, 1, 0, 22]); socket.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).unwrap();
        });
        let mut proxy = profile("socks5"); proxy.username = "dev".into(); proxy.password = "pwd".into();
        tunnel(&mut TcpStream::connect(address).unwrap(), &proxy, "127.0.0.1", 22, Duration::from_secs(2)).unwrap(); server.join().unwrap();
    }

    #[test]
    fn stalls_are_bounded_by_one_handshake_deadline() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap(); let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || { let mut socket = listener.accept().unwrap().0; for _ in 0..10 { if socket.write_all(b"H").is_err() { break; } std::thread::sleep(Duration::from_millis(30)); } });
        let mut stream = TcpStream::connect(address).unwrap(); let started = Instant::now();
        assert!(tunnel(&mut stream, &profile("http"), "server.test", 22, Duration::from_millis(80)).is_err());
        assert!(started.elapsed() < Duration::from_millis(250)); drop(stream); server.join().unwrap();
    }
}
