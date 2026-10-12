//! Read host aliases from the user's SSH config file.
//!
//! A deliberately small subset is understood: `Host` blocks with `HostName`, `User`, `Port`,
//! `IdentityFile` and `ProxyJump`. Blocks whose patterns are all wildcards are skipped because
//! they describe defaults rather than one host, and no secret is ever read out of the file.

use serde::Serialize;
use std::path::PathBuf;

/// One importable host alias. Only non-secret fields are carried.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigEntry {
    pub name: String,
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub jump_host: Option<String>,
    pub local_forwards: Vec<String>,
    pub remote_forwards: Vec<String>,
    pub dynamic_forwards: Vec<String>,
}

/// Host aliases declared in the user's SSH config file, ready to be turned into connections.
#[tauri::command]
pub fn ssh_config_candidates() -> Result<Vec<SshConfigEntry>, String> {
    read_ssh_config()
}

/// A single `Host` block while parsing.
#[derive(Default)]
struct Block {
    patterns: Vec<String>,
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
    proxy_jump: Option<String>,
    local_forwards: Vec<String>,
    remote_forwards: Vec<String>,
    dynamic_forwards: Vec<String>,
}

/// Path of the user's SSH config file.
pub fn ssh_config_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("config"))
        .ok_or_else(|| "Cannot locate the SSH configuration directory".into())
}

/// Read the config file; a missing file yields no candidates instead of an error.
pub fn read_ssh_config() -> Result<Vec<SshConfigEntry>, String> {
    let path = ssh_config_path()?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(parse_ssh_config(&text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("Failed to read SSH configuration: {error}")),
    }
}

/// Parse the subset described above. Within a block the first value of a key wins, matching the
/// behaviour of the SSH client.
pub fn parse_ssh_config(text: &str) -> Vec<SshConfigEntry> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut current = Some(Block { patterns: vec!["*".into()], ..Block::default() });

    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let (keyword, value) = split_keyword(line);
        if keyword.eq_ignore_ascii_case("host") {
            if let Some(block) = current.take() {
                blocks.push(block);
            }
            current = Some(Block {
                patterns: value.split_whitespace().map(str::to_owned).collect(),
                ..Block::default()
            });
            continue;
        }
        // Conditional blocks cannot be resolved without a live connection. Do not apply their
        // options to the previous host; resume only at the next Host declaration.
        if keyword.eq_ignore_ascii_case("match") {
            if let Some(block) = current.take() { blocks.push(block); }
            continue;
        }
        let Some(block) = current.as_mut() else { continue };
        match keyword.to_ascii_lowercase().as_str() {
            "hostname" if block.host_name.is_none() => block.host_name = non_empty(unquote(value)),
            "user" if block.user.is_none() => block.user = non_empty(unquote(value)),
            "port" if block.port.is_none() => block.port = value.trim().parse().ok(),
            "identityfile" if block.identity_file.is_none() => {
                block.identity_file = resolve_identity(&unquote(value));
            }
            "proxyjump" if block.proxy_jump.is_none() => {
                let jump = unquote(value);
                block.proxy_jump = if jump.eq_ignore_ascii_case("none") { Some("none".into()) } else { non_empty(jump) };
            },
            // Forwards repeat, and only specs the connection validator accepts are kept: the
            // import must never produce a profile that cannot be saved.
            "localforward" => push_forward(&mut block.local_forwards, &unquote(value), true),
            "remoteforward" => push_forward(&mut block.remote_forwards, &unquote(value), true),
            "dynamicforward" => push_forward(&mut block.dynamic_forwards, &unquote(value), false),
            _ => {}
        }
    }
    if let Some(block) = current.take() {
        blocks.push(block);
    }

    let mut entries = Vec::new();
    for block in &blocks {
        for pattern in block.patterns.iter().filter(|pattern| !is_wildcard(pattern)) {
            if entries.iter().any(|entry: &SshConfigEntry| entry.name == *pattern) { continue; }
            let mut entry = SshConfigEntry {
                name: pattern.clone(), host: pattern.clone(), user: None, port: None,
                identity_file: None, jump_host: None, local_forwards: Vec::new(),
                remote_forwards: Vec::new(), dynamic_forwards: Vec::new(),
            };
            let mut host_name = None;
            for source in blocks.iter().filter(|source| matches_host(&source.patterns, pattern)) {
                if host_name.is_none() { host_name = source.host_name.clone(); }
                if entry.user.is_none() { entry.user = source.user.clone(); }
                if entry.port.is_none() { entry.port = source.port; }
                if entry.identity_file.is_none() { entry.identity_file = source.identity_file.clone(); }
                if entry.jump_host.is_none() { entry.jump_host = source.proxy_jump.clone(); }
                entry.local_forwards.extend(source.local_forwards.iter().cloned());
                entry.remote_forwards.extend(source.remote_forwards.iter().cloned());
                entry.dynamic_forwards.extend(source.dynamic_forwards.iter().cloned());
            }
            entry.host = host_name.unwrap_or_else(|| pattern.clone());
            entries.push(entry);
        }
    }
    entries
}

/// Apply simple positive and negated host patterns while preserving first-value precedence.
fn matches_host(patterns: &[String], alias: &str) -> bool {
    let mut positive = false;
    for pattern in patterns {
        let (negative, pattern) = match pattern.strip_prefix('!') {
            Some(pattern) => (true, pattern),
            None => (false, pattern.as_str()),
        };
        let escaped = regex::escape(pattern).replace(r"\*", ".*").replace(r"\?", ".");
        if regex::Regex::new(&format!("^{escaped}$")).is_ok_and(|pattern| pattern.is_match(alias)) {
            if negative { return false; }
            positive = true;
        }
    }
    positive
}

/// Split a `Keyword value` or `Keyword=value` line.
fn split_keyword(line: &str) -> (&str, &str) {
    match line.find(|c: char| c.is_whitespace() || c == '=') {
        Some(index) => (
            &line[..index],
            line[index..].trim_start_matches(|c: char| c.is_whitespace() || c == '='),
        ),
        None => (line, ""),
    }
}

/// Remove one layer of matching quotes.
fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    let bytes = trimmed.as_bytes();
    if trimmed.len() >= 2
        && ((bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\''))
    {
        return trimmed[1..trimmed.len() - 1].to_owned();
    }
    trimmed.to_owned()
}

/// Keep a forward spec only when the connection validator accepts it, so an imported profile
/// always passes validation.
fn push_forward(into: &mut Vec<String>, spec: &str, with_host: bool) {
    let normalized = if with_host { spec.split_whitespace().collect::<Vec<_>>().join(":") } else { spec.to_owned() };
    if crate::terminal::ssh_command::valid_forward(&normalized, with_host) {
        into.push(normalized);
    }
}

fn non_empty(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// A pattern that describes defaults rather than one host.
fn is_wildcard(pattern: &str) -> bool {
    pattern.is_empty()
        || pattern.starts_with('!')
        || pattern.contains('*')
        || pattern.contains('?')
}

/// Resolve a private-key path. Token-bearing values (`%d`, `%h`) cannot be resolved outside a
/// live connection, so they are dropped instead of being stored broken.
fn resolve_identity(value: &str) -> Option<String> {
    if value.is_empty() || value.contains('%') {
        return None;
    }
    match value.strip_prefix("~/") {
        Some(rest) => dirs::home_dir().map(|home| home.join(rest).to_string_lossy().into_owned()),
        None => Some(value.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_host_blocks_and_skips_wildcards() {
        let text = "\
Host web\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\n  IdentityFile /keys/web\n  ProxyJump bastion\n\
  LocalForward 8080 localhost:80\n  DynamicForward 1080\n  LocalForward broken-spec\n\
Host *\n  ServerAliveInterval 30\n\
Host db1 db2\n  HostName db.internal\n";
        let entries = parse_ssh_config(text);
        assert_eq!(entries.len(), 3);
        assert_eq!(
            entries[0],
            SshConfigEntry {
                name: "web".into(),
                host: "10.0.0.5".into(),
                user: Some("deploy".into()),
                port: Some(2222),
                identity_file: Some("/keys/web".into()),
                jump_host: Some("bastion".into()),
                // The unusable spec is dropped rather than imported as a broken profile.
                local_forwards: vec!["8080:localhost:80".into()],
                remote_forwards: Vec::new(),
                dynamic_forwards: vec!["1080".into()],
            }
        );
        assert_eq!(entries[1].name, "db1");
        assert_eq!(entries[2].name, "db2");
        assert_eq!(entries[2].host, "db.internal");
    }

    #[test]
    fn first_value_wins_and_unresolvable_key_tokens_are_dropped() {
        let text = "Host alias\n  User first\n  User second\n  IdentityFile %d/key\n";
        let entries = parse_ssh_config(text);
        assert_eq!(entries[0].user.as_deref(), Some("first"));
        assert_eq!(entries[0].identity_file, None);
        // Without a HostName the alias itself is the address.
        assert_eq!(entries[0].host, "alias");
    }

    #[test]
    fn merges_defaults_deduplicates_aliases_and_skips_conditional_options() {
        let text = "User global\nHost web\n HostName web.internal\nMatch exec test\n User conditional\nHost web\n Port 2222\nHost * !db\n IdentityFile /keys/default\nHost db\n HostName db.internal\n";
        let entries = parse_ssh_config(text);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].user.as_deref(), Some("global"));
        assert_eq!(entries[0].port, Some(2222));
        assert_eq!(entries[0].identity_file.as_deref(), Some("/keys/default"));
        assert_eq!(entries[1].identity_file, None);
    }

    #[test]
    fn explicit_no_jump_blocks_later_defaults_and_survives_import() {
        let entries = parse_ssh_config("Host direct\n HostName direct.internal\n ProxyJump none\n ProxyJump ignored\nHost *\n ProxyJump bastion\n");
        assert_eq!(entries[0].jump_host.as_deref(), Some("none"));
        let target: crate::terminal::ssh_command::SshTarget = serde_json::from_value(serde_json::json!({
            "host": entries[0].host, "jumpHost": entries[0].jump_host
        })).unwrap();
        let command = crate::terminal::ssh_command::build_ssh_command(&target, None).unwrap();
        let args: Vec<_> = command.get_argv().iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|pair| pair == ["-J", "none"]));
    }

    #[test]
    fn accepts_key_value_pairs_quotes_and_comments() {
        let text = "Host quoted\n  HostName=\"example.com\" # trailing\n  User=root\n";
        let entries = parse_ssh_config(text);
        assert_eq!(entries[0].host, "example.com");
        assert_eq!(entries[0].user.as_deref(), Some("root"));
    }
}
