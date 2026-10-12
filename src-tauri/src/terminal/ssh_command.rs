use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Default, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SshOptions {
    pub identity_file: Option<String>,
    pub jump_host: Option<String>,
    pub server_alive_interval: Option<u32>,
    pub shell_integration: Option<bool>,
    /// `-L` specifications, e.g. `8080:localhost:80`.
    pub local_forwards: Option<Vec<String>>,
    /// `-R` specifications, forwarded from the remote side.
    pub remote_forwards: Option<Vec<String>>,
    /// `-D` specifications: a local SOCKS port.
    pub dynamic_forwards: Option<Vec<String>>,
    /// Retry the connection after an unexpected drop. Handled by the terminal session, kept here
    /// so it persists with the rest of the connection options.
    pub auto_reconnect: Option<bool>,
    /// `strict` (default) trusts only recorded hosts; `ask` lets the ssh client prompt in the
    /// terminal when the fingerprint is unknown, used when the preflight could not run.
    pub host_key_policy: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub host_key_type: Option<String>,
    #[serde(flatten)]
    pub options: SshOptions,
}

pub fn validate_ssh_host(host: &str) -> Result<(), String> {
    if host.is_empty() || host.starts_with('-') || host.chars().any(char::is_whitespace) {
        return Err("SSH 主机不能为空、包含空白或以 - 开头".into());
    }
    Ok(())
}

pub fn validate_options(options: &SshOptions) -> Result<(), String> {
    if options.server_alive_interval.is_some_and(|value| value > 3600) {
        return Err("保活间隔不能超过 3600 秒".into());
    }
    if options.identity_file.as_ref().is_some_and(|value| value.chars().any(char::is_control)) {
        return Err("私钥路径不能包含控制字符".into());
    }
    if let Some(jump) = &options.jump_host {
        let pattern = regex::Regex::new(r"^(?:[\w.-]+@)?(?:\[[0-9a-fA-F:]+\]|[\w.][\w.-]*)(?::([0-9]{1,5}))?$").unwrap();
        for destination in jump.split(',') {
            let captures = pattern.captures(destination).ok_or("跳板机格式不正确")?;
            if captures.get(1).is_some_and(|value| value.as_str().parse::<u16>().map_or(true, |port| port == 0)) {
                return Err("跳板机端口需为 1-65535".into());
            }
        }
    }
    for spec in options.local_forwards.iter().flatten().chain(options.remote_forwards.iter().flatten()) {
        if !valid_forward(spec, true) {
            return Err("Invalid port forward (example: 8080:localhost:80)".into());
        }
    }
    for spec in options.dynamic_forwards.iter().flatten() {
        if !valid_forward(spec, false) {
            return Err("Invalid dynamic forward (example: 1080)".into());
        }
    }
    Ok(())
}

/// A forward destination: `[bind:]port:host:hostport` for a static forward, `[bind:]port` for a
/// dynamic one. The pattern is anchored and bracket-aware, so a spec can never be read as another
/// client option, and every numeric field must be a usable port.
pub(crate) fn valid_forward(spec: &str, with_host: bool) -> bool {
    const HOST: &str = r"(?:\[[0-9a-fA-F:]+\]|[\w.][\w.-]*)";
    static STATIC: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static DYNAMIC: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = if with_host {
        STATIC.get_or_init(|| {
            regex::Regex::new(&format!(r"^(?:{HOST}:)?([0-9]{{1,5}}):{HOST}:([0-9]{{1,5}})$")).expect("valid forward pattern")
        })
    } else {
        DYNAMIC.get_or_init(|| {
            regex::Regex::new(&format!(r"^(?:{HOST}:)?([0-9]{{1,5}})$")).expect("valid dynamic forward pattern")
        })
    };
    pattern.captures(spec).is_some_and(|captures| {
        captures.iter().skip(1).flatten().all(|port| {
            port.as_str().parse::<u16>().ok().is_some_and(|port| port > 0)
        })
    })
}

pub fn verified_ssh_options(key_type: Option<&str>, known_hosts: &Path) -> Result<Vec<String>, String> {
    let path = known_hosts.to_string_lossy().replace('\\', "/");
    let mut options = vec!["-o".into(), "StrictHostKeyChecking=yes".into(), "-o".into(), format!("UserKnownHostsFile=\"{path}\"")];
    if let Some(key_type) = key_type {
        let algorithms = match key_type {
            "ed25519" => "ssh-ed25519",
            "rsa" => "rsa-sha2-512,rsa-sha2-256",
            "ecdsa256" => "ecdsa-sha2-nistp256",
            "ecdsa384" => "ecdsa-sha2-nistp384",
            "ecdsa521" => "ecdsa-sha2-nistp521",
            _ => return Err("不支持的 SSH 主机密钥类型".into()),
        };
        options.extend(["-o".into(), format!("HostKeyAlgorithms={algorithms}")]);
    }
    Ok(options)
}

pub fn ssh_args(host: &str, user: Option<&str>, port: Option<u16>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(port) = port { args.extend(["-p".into(), port.to_string()]); }
    args.push(user.filter(|value| !value.is_empty()).map_or_else(|| host.to_owned(), |value| format!("{value}@{host}")));
    args
}

pub fn build_ssh_command(target: &SshTarget, remote_command: Option<&str>) -> Result<CommandBuilder, String> {
    validate_ssh_host(&target.host)?;
    validate_options(&target.options)?;
    if target.user.as_ref().is_some_and(|value| value.starts_with('-') || value.chars().any(char::is_whitespace)) {
        return Err("SSH 账户格式不正确".into());
    }
    if target.port == Some(0) { return Err("SSH 端口不能为 0".into()); }
    let known_hosts = dirs::home_dir().ok_or("无法定位 SSH 信任记录目录")?.join(".ssh").join("known_hosts");
    let mut command = CommandBuilder::new("ssh");
    command.arg("-tt");
    let mut verified = verified_ssh_options(target.host_key_type.as_deref(), &known_hosts)?;
    // Hop hosts are verified by the client because a direct preflight cannot reach the destination.
    // The same relaxation applies when the preflight itself was unavailable: the client still
    // verifies recorded hosts and only asks about unknown fingerprints.
    if target.options.jump_host.is_some() || target.options.host_key_policy.as_deref() == Some("ask") {
        verified[1] = "StrictHostKeyChecking=ask".into();
    }
    command.args(verified);
    // Keepalive: two missed probes (~30s) end the client, so a silently dropped
    // connection is reported instead of waiting for the next user input.
    command.args(["-o", "ConnectTimeout=15", "-o", "ServerAliveCountMax=2"]);
    command.args(["-o".to_string(), format!("ServerAliveInterval={}", target.options.server_alive_interval.unwrap_or(15))]);
    if let Some(identity) = &target.options.identity_file {
        let path = Path::new(identity);
        if !path.is_file() { return Err("指定的 SSH 私钥文件不存在".into()); }
        command.arg("-i"); command.arg(path); command.args(["-o", "IdentitiesOnly=yes"]);
    }
    if let Some(jump) = &target.options.jump_host {
        command.args(["-J", if jump.eq_ignore_ascii_case("none") { "none" } else { jump }]);
    }
    for spec in target.options.local_forwards.iter().flatten() {
        command.arg("-L");
        command.arg(spec.as_str());
    }
    for spec in target.options.remote_forwards.iter().flatten() {
        command.arg("-R");
        command.arg(spec.as_str());
    }
    for spec in target.options.dynamic_forwards.iter().flatten() {
        command.arg("-D");
        command.arg(spec.as_str());
    }
    command.args(ssh_args(&target.host, target.user.as_deref(), target.port));
    if target.options.shell_integration.unwrap_or(true) {
        if let Some(remote) = remote_command { command.arg(remote); }
    }
    Ok(command)
}

pub fn build_ssh_command_in_directory(
    target: &SshTarget,
    remote_command: Option<&str>,
    cwd: Option<&str>,
) -> Result<CommandBuilder, String> {
    let Some(cwd) = cwd.filter(|cwd| !cwd.is_empty()) else {
        return build_ssh_command(target, remote_command);
    };
    if cwd.chars().any(char::is_control) {
        return Err("远程工作目录不能包含控制字符".into());
    }
    let quoted_cwd = format!("'{}'", cwd.replace('\'', "'\\''"));
    let command = if target.options.shell_integration.unwrap_or(true) {
        match remote_command {
            Some(remote) => format!("cd {quoted_cwd} || exit\n{remote}"),
            None => format!("cd {quoted_cwd} || exit; exec \"${{SHELL:-sh}}\" -i"),
        }
    } else {
        format!("cd {quoted_cwd} || exit; exec \"${{SHELL:-sh}}\" -i")
    };
    let mut target = target.clone();
    target.options.shell_integration = Some(true);
    build_ssh_command(&target, Some(&command))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn advanced_options_are_preserved_and_validated() {
        let target: SshTarget = serde_json::from_value(serde_json::json!({"host":"server", "jumpHost":"user@jump:2222", "serverAliveInterval":45, "shellIntegration":false})).unwrap();
        let command = build_ssh_command(&target, Some("shell-hook")).unwrap();
        let args: Vec<_> = command.get_argv().iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|pair| pair == ["-J", "user@jump:2222"]));
        assert!(args.contains(&"ServerAliveInterval=45".into()));
        assert!(!args.contains(&"shell-hook".into()));
        assert!(validate_options(&SshOptions { jump_host: Some("-oProxyCommand=x".into()), ..Default::default() }).is_err());
        assert!(validate_options(&SshOptions { server_alive_interval: Some(3601), ..Default::default() }).is_err());
    }
    #[test]
    fn host_key_policy_ask_relaxes_only_unknown_fingerprints() {
        let relaxed: SshTarget = serde_json::from_value(serde_json::json!({"host":"server","hostKeyPolicy":"ask"})).unwrap();
        let args: Vec<_> = build_ssh_command(&relaxed, None).unwrap().get_argv().iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"StrictHostKeyChecking=ask".into()));
        let strict: SshTarget = serde_json::from_value(serde_json::json!({"host":"server"})).unwrap();
        let args: Vec<_> = build_ssh_command(&strict, None).unwrap().get_argv().iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"StrictHostKeyChecking=yes".into()));
    }
    #[test]
    fn missing_explicit_identity_is_an_error() {
        let target: SshTarget = serde_json::from_value(serde_json::json!({"host":"server", "identityFile":"/missing/private/key"})).unwrap();
        assert!(build_ssh_command(&target, None).is_err());
    }

    #[test]
    fn forwards_reach_the_client_and_bad_specs_are_rejected() {
        let target: SshTarget = serde_json::from_value(serde_json::json!({
            "host": "server",
            "localForwards": ["8080:localhost:80", "127.0.0.1:9000:db:5432"],
            "remoteForwards": ["5000:localhost:5000"],
            "dynamicForwards": ["1080"]
        }))
        .unwrap();
        let args: Vec<_> = build_ssh_command(&target, None).unwrap().get_argv().iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|pair| pair == ["-L", "8080:localhost:80"]));
        assert!(args.windows(2).any(|pair| pair == ["-L", "127.0.0.1:9000:db:5432"]));
        assert!(args.windows(2).any(|pair| pair == ["-R", "5000:localhost:5000"]));
        assert!(args.windows(2).any(|pair| pair == ["-D", "1080"]));

        for bad in ["-oProxyCommand=x", "-:8080:localhost:80", "8080:localhost", "0:localhost:80", "99999:localhost:80", "8080:localhost:80 extra"] {
            let options = SshOptions { local_forwards: Some(vec![bad.into()]), ..Default::default() };
            assert!(validate_options(&options).is_err(), "{bad} should be rejected");
        }
        assert!(validate_options(&SshOptions { dynamic_forwards: Some(vec!["70000".into()]), ..Default::default() }).is_err());
        assert!(validate_options(&SshOptions { dynamic_forwards: Some(vec!["1080".into(), "[::]:1081".into(), "[2001:db8::1]:1082".into()]), ..Default::default() }).is_ok());
    }

    #[test]
    fn restored_remote_directory_is_quoted_and_starts_an_interactive_shell() {
        let target: SshTarget = serde_json::from_value(serde_json::json!({"host":"server", "shellIntegration":false})).unwrap();
        let args: Vec<_> = build_ssh_command_in_directory(&target, None, Some("/remote/a user's project"))
            .unwrap().get_argv().iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        let remote = args.last().unwrap();
        assert!(remote.starts_with("cd '/remote/a user'\\''s project' || exit;"));
        assert!(remote.contains("exec \"${SHELL:-sh}\" -i"));
    }
}
