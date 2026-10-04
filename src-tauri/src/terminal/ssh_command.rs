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
    Ok(())
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
    if target.options.jump_host.is_some() { verified[1] = "StrictHostKeyChecking=ask".into(); }
    command.args(verified);
    command.args(["-o", "ConnectTimeout=15", "-o", "ServerAliveCountMax=3"]);
    command.args(["-o".to_string(), format!("ServerAliveInterval={}", target.options.server_alive_interval.unwrap_or(30))]);
    if let Some(identity) = &target.options.identity_file {
        let path = Path::new(identity);
        if !path.is_file() { return Err("指定的 SSH 私钥文件不存在".into()); }
        command.arg("-i"); command.arg(path); command.args(["-o", "IdentitiesOnly=yes"]);
    }
    if let Some(jump) = &target.options.jump_host { command.args(["-J", jump]); }
    command.args(ssh_args(&target.host, target.user.as_deref(), target.port));
    if target.options.shell_integration.unwrap_or(true) {
        if let Some(remote) = remote_command { command.arg(remote); }
    }
    Ok(command)
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
    fn missing_explicit_identity_is_an_error() {
        let target: SshTarget = serde_json::from_value(serde_json::json!({"host":"server", "identityFile":"/missing/private/key"})).unwrap();
        assert!(build_ssh_command(&target, None).is_err());
    }
}
