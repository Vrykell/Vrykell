//! Resolve bounded routes and carry nested encrypted connections over local socket pairs.

use crate::db::{HistoryDb, SshConnection};
use crate::terminal::ssh_command::{validate_options, SshOptions};
use ssh2::Session;
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
pub(crate) struct ResolvedJumps(pub Vec<SshConnection>);

impl std::fmt::Debug for ResolvedJumps {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("ResolvedJumps").field("count", &self.0.len()).finish()
    }
}

impl HistoryDb {
    pub(crate) fn resolve_ssh_route(&self, options: &mut SshOptions, owner: Option<&str>) -> Result<(), String> {
        fn visit(db: &HistoryDb, options: &SshOptions, seen: &mut Vec<String>, route: &mut Vec<SshConnection>) -> Result<(), String> {
            validate_options(options)?;
            if let Some(id) = &options.jump_connection_id {
                if seen.contains(id) { return Err("Jump connections cannot form a cycle".into()); }
                if seen.len() >= 9 { return Err("Up to 8 jump hosts are supported".into()); }
                seen.push(id.clone());
                let mut hop = db.get_ssh_connection_unresolved(id).map_err(|_| "Saved jump connection is unavailable")?;
                visit(db, &hop.options, seen, route)?;
                hop.options.resolved_jumps = ResolvedJumps::default();
                route.push(hop);
                seen.pop();
            } else if let Some(jumps) = options.jump_host.as_deref().filter(|value| !value.eq_ignore_ascii_case("none")) {
                let aliases = super::ssh_config::read_ssh_config()?;
                for address in jumps.split(',') {
                    let (explicit_user, address) = address.split_once('@').map_or((None, address), |(user, host)| (Some(user), host));
                    let (host, port) = if address.starts_with('[') {
                        let end = address.find(']').ok_or("Invalid jump address")?;
                        (&address[1..end], address[end + 1..].strip_prefix(':').and_then(|port| port.parse::<u16>().ok()))
                    } else {
                        address.rsplit_once(':').map_or((address, None), |(host, port)| (host, port.parse::<u16>().ok()))
                    };
                    let alias = aliases.iter().find(|alias| alias.name == host);
                    let user = explicit_user.map(str::to_owned).or_else(|| alias.and_then(|alias| alias.user.clone()))
                        .or_else(|| std::env::var("USER").ok()).or_else(|| std::env::var("USERNAME").ok()).unwrap_or_default();
                    let mut hop: SshConnection = serde_json::from_value(serde_json::json!({
                        "id": "", "name": host, "host": alias.map_or(host, |alias| &alias.host),
                        "port": port.or_else(|| alias.and_then(|alias| alias.port)), "user": user, "authMethod": "key",
                        "identityFile": alias.and_then(|alias| alias.identity_file.clone()), "proxyId": "none"
                    })).map_err(|error| error.to_string())?;
                    if route.is_empty() { hop.options.proxy_id = options.proxy_id.clone(); }
                    route.push(hop);
                }
            }
            if route.len() > 8 { return Err("Up to 8 jump hosts are supported".into()); }
            Ok(())
        }
        let mut seen: Vec<String> = owner.into_iter().map(str::to_owned).collect();
        let mut route = Vec::new();
        visit(self, options, &mut seen, &mut route)?;
        if route.iter().skip(1).any(|hop| hop.options.proxy_id.as_deref().is_some_and(|id| id != "none")) {
            return Err("Configure the proxy on the first jump connection".into());
        }
        if !route.is_empty() && options.proxy_id.as_deref().is_some_and(|id| id != "none") && options.jump_connection_id.is_some() {
            return Err("Configure the proxy on the first jump connection".into());
        }
        options.resolved_jumps = ResolvedJumps(route);
        Ok(())
    }
}

/// The final session owns this handle; dropping its last channel cancels the relay as well.
pub(super) struct TunnelSocket {
    socket: TcpStream,
    stop: Arc<AtomicBool>,
}

impl Drop for TunnelSocket {
    fn drop(&mut self) { self.stop.store(true, Ordering::Release); }
}

#[cfg(windows)]
impl std::os::windows::io::AsRawSocket for TunnelSocket {
    fn as_raw_socket(&self) -> std::os::windows::io::RawSocket {
        std::os::windows::io::AsRawSocket::as_raw_socket(&self.socket)
    }
}

#[cfg(unix)]
impl std::os::fd::AsRawFd for TunnelSocket {
    fn as_raw_fd(&self) -> std::os::fd::RawFd { std::os::fd::AsRawFd::as_raw_fd(&self.socket) }
}

fn socket_pair() -> Result<(TcpStream, TcpStream), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;
    let socket = TcpStream::connect_timeout(&listener.local_addr().map_err(|error| error.to_string())?, Duration::from_secs(2)).map_err(|error| error.to_string())?;
    let expected = socket.local_addr().map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match listener.accept() {
            Ok((peer, address)) if address == expected => return Ok((socket, peer)),
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {},
            Err(error) => return Err(error.to_string()),
        }
        if Instant::now() >= deadline { return Err("Local tunnel connection timed out".into()); }
        std::thread::sleep(Duration::from_millis(1));
    }
}

pub(super) fn tunnel(session: Session, host: &str, port: u16) -> Result<TunnelSocket, String> {
    let channel = session.channel_direct_tcpip(host.trim_start_matches('[').trim_end_matches(']'), port, None)
        .map_err(|error| format!("Jump host rejected the connection to the next server: {error}"))?;
    let (socket, peer) = socket_pair()?;
    socket.set_read_timeout(Some(Duration::from_secs(15))).map_err(|error| error.to_string())?;
    socket.set_write_timeout(Some(Duration::from_secs(15))).map_err(|error| error.to_string())?;
    socket.set_nodelay(true).map_err(|error| error.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    session.set_blocking(false);
    std::thread::Builder::new().name("ssh-route-relay".into()).spawn(move || {
        let _ = super::forwarding::bridge(peer, channel, worker_stop);
        drop(session);
    }).map_err(|error| error.to_string())?;
    Ok(TunnelSocket { socket, stop })
}

fn quoted(value: &str) -> Result<String, String> {
    if value.chars().any(char::is_control) { return Err("Connection configuration cannot contain control characters".into()); }
    Ok(format!("\"{}\"", value.replace('\\', "/").replace('"', "\\\"")))
}

pub(crate) struct LaunchConfig(PathBuf);

pub(crate) fn hop_alias(path: &Path, index: usize) -> String {
    format!("route-hop-{index}-{}", path.file_stem().unwrap_or_default().to_string_lossy())
}

impl LaunchConfig {
    pub(crate) fn create(options: &mut SshOptions) -> Result<Option<Self>, String> {
        if options.jump_connection_id.is_none() { return Ok(None); }
        if options.resolved_jumps.0.is_empty() { return Err("Saved jump connection is unavailable".into()); }
        let home = dirs::home_dir().ok_or("Home directory is unavailable")?;
        let path = std::env::temp_dir().join(format!("ssh-route-{}.conf", uuid::Uuid::new_v4()));
        let mut text = String::new();
        for (index, hop) in options.resolved_jumps.0.iter().enumerate() {
            crate::terminal::ssh_command::validate_ssh_host(&hop.host)?;
            if hop.user.is_empty() || hop.user.starts_with('-') || hop.user.chars().any(char::is_whitespace) { return Err("Enter a username for each saved jump connection".into()); }
            text.push_str(&format!("Host {}\n HostName {}\n User {}\n Port {}\n StrictHostKeyChecking ask\n UserKnownHostsFile {}\n ConnectTimeout 15\n ServerAliveInterval 15\n ProxyJump none\n ClearAllForwardings yes\n", hop_alias(&path, index), quoted(hop.host.trim_start_matches('[').trim_end_matches(']'))?, quoted(&hop.user)?, hop.port.unwrap_or(22), quoted(&super::ssh::known_hosts_path()?.to_string_lossy())?));
            if let Some(identity) = &hop.options.identity_file {
                if !Path::new(identity).is_file() { return Err("The jump connection private key does not exist".into()); }
                text.push_str(&format!(" IdentityFile {}\n IdentitiesOnly yes\n", quoted(identity)?));
            }
            match hop.options.authentication_mode.as_deref().unwrap_or(&hop.auth_method) {
                "ask" | "password" => text.push_str(" PreferredAuthentications keyboard-interactive,password\n PubkeyAuthentication no\n"),
                "agent" => text.push_str(" PreferredAuthentications publickey\n IdentityFile none\n"),
                _ => {},
            }
            let proxy = if index == 0 { crate::ssh_proxy::command_option(hop.options.proxy_id.as_deref(), &hop.host)? } else { None };
            text.push_str(&format!(" {}\n", proxy.as_deref().unwrap_or("ProxyCommand none")));
        }
        let user_config = home.join(".ssh/config");
        if user_config.exists() { text.push_str(&format!("Host *\n Include {}\n", quoted(&user_config.to_string_lossy())?)); }
        let mut open = std::fs::OpenOptions::new();
        open.write(true).create_new(true);
        #[cfg(unix)]
        { use std::os::unix::fs::OpenOptionsExt; open.mode(0o600); }
        let mut file = open.open(&path).map_err(|error| error.to_string())?;
        let config = Self(path.clone());
        file.write_all(text.as_bytes()).map_err(|error| error.to_string())?;
        options.config_file = Some(path);
        Ok(Some(config))
    }
}

impl Drop for LaunchConfig {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, jump: Option<&str>) -> SshConnection {
        serde_json::from_value(serde_json::json!({"id": id, "name": id, "host": format!("{id}.test"), "user": format!("{id}-user"),
            "authMethod": "agent", "authenticationMode": "agent", "proxyId": "none", "jumpConnectionId": jump})).unwrap()
    }

    #[test]
    fn saved_routes_preserve_order_and_independent_authentication_without_serializing_credentials() {
        let db = HistoryDb::open_in_memory();
        db.save_ssh_connection(&profile("first", None)).unwrap();
        db.save_ssh_connection(&profile("second", Some("first"))).unwrap();
        db.save_ssh_connection(&profile("target", Some("second"))).unwrap();
        let target = db.get_ssh_connection("target").unwrap();
        let hops = &target.options.resolved_jumps.0;
        assert_eq!(hops.iter().map(|hop| hop.id.as_str()).collect::<Vec<_>>(), ["first", "second"]);
        assert_eq!(hops[0].user, "first-user");
        assert_eq!(hops[1].user, "second-user");
        let serialized = serde_json::to_string(&target).unwrap();
        assert!(serialized.contains("jumpConnectionId"));
        assert!(!serialized.contains("first-user"));
        assert!(!serialized.contains("resolvedJumps"));
    }

    #[test]
    fn invalid_routes_fail_before_overwriting_saved_profiles() {
        let db = HistoryDb::open_in_memory();
        db.save_ssh_connection(&profile("first", None)).unwrap();
        db.save_ssh_connection(&profile("second", Some("first"))).unwrap();
        assert!(db.save_ssh_connection(&profile("first", Some("second"))).unwrap_err().contains("cycle"));
        assert!(db.save_ssh_connection(&profile("self", Some("self"))).unwrap_err().contains("cycle"));
        assert!(db.save_ssh_connection(&profile("missing", Some("deleted"))).unwrap_err().contains("unavailable"));
        assert!(db.get_ssh_connection("first").unwrap().options.jump_connection_id.is_none());
        db.conn().execute("DELETE FROM ssh_connections WHERE id = ?1", ["first"]).unwrap();
        assert!(db.get_ssh_connection("second").unwrap_err().contains("unavailable"));
    }

    #[test]
    fn routes_have_a_depth_limit_and_explicit_none_stays_direct() {
        let db = HistoryDb::open_in_memory();
        let mut previous = None;
        for index in 0..9 {
            let id = format!("hop-{index}");
            db.save_ssh_connection(&profile(&id, previous.as_deref())).unwrap();
            previous = Some(id);
        }
        assert!(db.save_ssh_connection(&profile("too-deep", previous.as_deref())).unwrap_err().contains("8 jump"));
        let mut options = SshOptions { jump_host: Some("none".into()), ..Default::default() };
        db.resolve_ssh_route(&mut options, None).unwrap();
        assert!(options.resolved_jumps.0.is_empty());
        options.jump_host = Some("user@[::1]:2222,other@internal:2200".into());
        db.resolve_ssh_route(&mut options, None).unwrap();
        assert_eq!(options.resolved_jumps.0[0].host, "::1");
        assert_eq!(options.resolved_jumps.0[0].port, Some(2222));
        assert_eq!(options.resolved_jumps.0[1].user, "other");
    }

    #[test]
    fn launch_configuration_is_private_temporary_and_keeps_hop_auth_separate() {
        let db = HistoryDb::open_in_memory();
        db.save_ssh_connection(&profile("first", None)).unwrap();
        let mut options = SshOptions { jump_connection_id: Some("first".into()), proxy_id: Some("none".into()), ..Default::default() };
        db.resolve_ssh_route(&mut options, None).unwrap();
        let config = LaunchConfig::create(&mut options).unwrap().unwrap();
        let path = config.0.clone();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("HostName \"first.test\""));
        assert!(text.contains("User \"first-user\""));
        assert!(text.contains("IdentityFile none"));
        assert!(text.contains("ProxyCommand none"));
        let target = crate::terminal::ssh_command::SshTarget { host: "target.test".into(), user: Some("target-user".into()), port: None, host_key_type: None, options };
        let command = crate::terminal::ssh_command::build_ssh_command(&target, None).unwrap();
        let args: Vec<_> = command.get_argv().iter().map(|argument| argument.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|pair| pair[0] == "-J" && pair[1] == hop_alias(&path, 0)));
        assert!(args.windows(2).any(|pair| pair[0] == "-F" && Path::new(&pair[1]) == path));
        assert!(args.contains(&"target-user@target.test".into()));
        drop(config);
        assert!(!path.exists());
        assert!(quoted("bad\nHost *").is_err());
    }

    #[test]
    fn local_socket_pair_carries_data_and_drop_requests_relay_cancellation() {
        use std::io::Read;
        let (mut client, mut peer) = socket_pair().unwrap();
        // Accepted sockets can inherit the listener's nonblocking mode.
        peer.set_nonblocking(false).unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        client.write_all(b"encrypted transport").unwrap();
        let mut received = [0; 19];
        peer.read_exact(&mut received).unwrap();
        assert_eq!(&received, b"encrypted transport");
        let stop = Arc::new(AtomicBool::new(false));
        drop(TunnelSocket { socket: client, stop: stop.clone() });
        assert!(stop.load(Ordering::Acquire));
    }
}
