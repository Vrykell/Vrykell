//! Shell completion: bounded, read-only candidate discovery for the composer.
//!
//! Path-shaped input is resolved by the frontend through the owning file channel, so this
//! module only serves command words and parameters. PowerShell keeps one resident helper per
//! executable: the first use pays process startup, later queries answer in milliseconds. The
//! helper reads bounded base64 JSON lines from standard input, treats the request as data,
//! and never writes to the live terminal. bash/zsh keep short-lived children because their
//! startup is cheap.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

const MAX_CANDIDATES: usize = 80;
const MAX_TEXT_BYTES: usize = 4096;
const MAX_CWD_BYTES: usize = 4096;
const MAX_SHELL_BYTES: usize = 64;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_HELPER_LINE: usize = 96 * 1024;
const CACHE_TTL: Duration = Duration::from_secs(20);
const CACHE_ENTRIES: usize = 64;
const HELPER_IDLE: Duration = Duration::from_secs(180);
const HELPER_TIMEOUT: Duration = Duration::from_millis(2500);
const ONE_SHOT_TIMEOUT: Duration = Duration::from_millis(2500);

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ShellCompletion {
    text: String,
    cursor: usize,
}

/// Resident helper for PowerShell: one child per executable, queried over line-delimited
/// base64 JSON. Every request re-applies the reported working directory.
const HELPER_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
    $located = $true
    if ($request.cwd) {
      try { Set-Location -LiteralPath ([string]$request.cwd) -ErrorAction Stop } catch { $located = $false }
    }
    if (-not $located) {
      $payload = '[]'
    } else {
      $inputText = [string]$request.text
      $result = TabExpansion2 -inputScript $inputText -cursorColumn ([int]$request.cursor)
      $items = @($result.CompletionMatches |
        Where-Object { $_.ResultType -notin @('ProviderItem', 'ProviderContainer') } |
        Select-Object -First 80 |
        ForEach-Object {
          $value = $inputText.Substring(0, $result.ReplacementIndex) + $_.CompletionText + $inputText.Substring($result.ReplacementIndex + $result.ReplacementLength)
          @{ text = $value; cursor = ($result.ReplacementIndex + $_.CompletionText.Length) }
        })
      $payload = ConvertTo-Json -InputObject $items -Compress -Depth 3
    }
  } catch {
    $payload = '[]'
  }
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)))
  [Console]::Out.Flush()
}
"#;

/// Short-lived PowerShell fallback used when the resident helper cannot start.
const ONE_SHOT_POWER_SHELL: &str = r#"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $line=$env:VRY_COMPLETION_TEXT; $cursor=[int]$env:VRY_COMPLETION_CURSOR; $result=TabExpansion2 -inputScript $line -cursorColumn $cursor; $items=@($result.CompletionMatches | Where-Object { $_.ResultType -notin @('ProviderItem','ProviderContainer') } | Select-Object -First 80 | ForEach-Object { $value=$line.Substring(0,$result.ReplacementIndex)+$_.CompletionText+$line.Substring($result.ReplacementIndex+$result.ReplacementLength); @{text=$value;cursor=($result.ReplacementIndex+$_.CompletionText.Length)} }); ConvertTo-Json -InputObject $items -Compress -Depth 3"#;

#[derive(Default)]
pub struct CompletionState {
    runtime: Mutex<CompletionRuntime>,
}

#[derive(Default)]
struct CompletionRuntime {
    helpers: HashMap<&'static str, Helper>,
    cache: Vec<CachedCompletion>,
}

struct Helper {
    /// Kept only so `kill_on_drop(true)` reaps the resident process when it leaves the map.
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    last_used: Instant,
}

struct CachedCompletion {
    program: &'static str,
    cwd: Option<String>,
    text: String,
    cursor: usize,
    created: Instant,
    candidates: Vec<ShellCompletion>,
}

enum ResidentError {
    Unavailable,
    Query,
}

impl CompletionState {
    /// Drop idle helpers and expired candidates. Called by `shell_complete`, `warm_shell_completion`
    /// and a periodic task so an unused helper does not keep a shell process alive.
    pub async fn prune(&self) {
        let mut runtime = self.runtime.lock().await;
        prune(&mut runtime);
    }

    /// Best-effort cleanup for application exit; the child also exits when its stdin closes.
    pub fn close_sync(&self) {
        if let Ok(mut runtime) = self.runtime.try_lock() {
            runtime.helpers.clear();
        }
    }
}

fn safe_query(text: &str, cursor: usize) -> bool {
    !text.is_empty() && text.len() <= MAX_TEXT_BYTES && cursor <= text.encode_utf16().count()
        && text.chars().all(|character| character.is_ascii_alphanumeric() || " -_./\\:".contains(character))
}

fn resolve_shell(shell: Option<String>) -> String {
    shell.unwrap_or_else(|| {
        #[cfg(target_os = "windows")]
        { super::pty::default_windows_shell().to_string() }
        #[cfg(not(target_os = "windows"))]
        { std::env::var("SHELL").ok().and_then(|path| path.rsplit('/').next().map(str::to_string)).unwrap_or_else(|| "bash".to_string()) }
    })
}

fn completion_program(shell: &str) -> Option<&'static str> {
    match shell {
        "powershell" | "cmd" => Some("powershell"),
        "pwsh" => Some("pwsh"),
        "bash" => Some("bash"),
        "zsh" => Some("zsh"),
        _ => None,
    }
}

fn is_powershell(program: &str) -> bool {
    program == "powershell" || program == "pwsh"
}

fn prune(runtime: &mut CompletionRuntime) {
    let now = Instant::now();
    runtime.cache.retain(|entry| now.saturating_duration_since(entry.created) < CACHE_TTL);
    runtime.helpers.retain(|_, helper| now.saturating_duration_since(helper.last_used) < HELPER_IDLE);
}

fn cached(runtime: &CompletionRuntime, program: &'static str, cwd: Option<&str>, text: &str, cursor: usize) -> Option<Vec<ShellCompletion>> {
    let now = Instant::now();
    runtime.cache.iter().rev()
        .find(|entry| entry.program == program && entry.cwd.as_deref() == cwd && entry.text == text
            && entry.cursor == cursor && now.saturating_duration_since(entry.created) < CACHE_TTL)
        .map(|entry| entry.candidates.clone())
}

fn remember(runtime: &mut CompletionRuntime, program: &'static str, cwd: Option<String>, text: String, cursor: usize, candidates: &[ShellCompletion]) {
    if candidates.is_empty() { return; }
    runtime.cache.push(CachedCompletion { program, cwd, text, cursor, created: Instant::now(), candidates: candidates.to_vec() });
    while runtime.cache.len() > CACHE_ENTRIES {
        runtime.cache.remove(0);
    }
}

fn bounded(candidates: Vec<ShellCompletion>) -> Vec<ShellCompletion> {
    candidates.into_iter()
        .filter(|candidate| candidate.text.len() <= 8192 && candidate.cursor <= candidate.text.encode_utf16().count())
        .take(MAX_CANDIDATES)
        .collect()
}

fn spawn_helper(program: &'static str) -> Result<Helper, String> {
    let mut command = Command::new(program);
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", HELPER_SCRIPT])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdin = child.stdin.take().ok_or("Completion input unavailable")?;
    let stdout = child.stdout.take().ok_or("Completion output unavailable")?;
    Ok(Helper { child, stdin, stdout: BufReader::new(stdout), last_used: Instant::now() })
}

async fn helper_exchange(helper: &mut Helper, request: &serde_json::Value) -> Result<Vec<ShellCompletion>, String> {
    let line = serde_json::to_vec(request).map_err(|error| error.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(line);
    helper.stdin.write_all(encoded.as_bytes()).await.map_err(|error| error.to_string())?;
    helper.stdin.write_all(b"\n").await.map_err(|error| error.to_string())?;
    helper.stdin.flush().await.map_err(|error| error.to_string())?;
    let operation = async {
        let mut buffer = Vec::new();
        let count = (&mut helper.stdout).take(MAX_HELPER_LINE as u64 + 1).read_until(b'\n', &mut buffer).await.map_err(|error| error.to_string())?;
        if count == 0 { return Err("The completion helper closed its connection.".to_string()); }
        if count > MAX_HELPER_LINE { return Err("The completion response exceeds its size limit.".to_string()); }
        let encoded = std::str::from_utf8(&buffer).map_err(|error| error.to_string())?.trim();
        let decoded = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|error| error.to_string())?;
        let candidates: Vec<ShellCompletion> = serde_json::from_slice(&decoded).map_err(|error| error.to_string())?;
        Ok(bounded(candidates))
    };
    let result = tokio::time::timeout(HELPER_TIMEOUT, operation).await.map_err(|_| "The completion helper timed out.".to_string())?;
    helper.last_used = Instant::now();
    result
}

async fn resident(runtime: &mut CompletionRuntime, program: &'static str, cwd: Option<&str>, text: &str, cursor: usize) -> Result<Vec<ShellCompletion>, ResidentError> {
    if !runtime.helpers.contains_key(program) {
        let helper = spawn_helper(program).map_err(|_| ResidentError::Unavailable)?;
        runtime.helpers.insert(program, helper);
    }
    let request = serde_json::json!({ "text": text, "cursor": cursor, "cwd": cwd });
    let outcome = {
        let helper = runtime.helpers.get_mut(program).ok_or(ResidentError::Unavailable)?;
        helper_exchange(helper, &request).await.map_err(|_| ResidentError::Query)
    };
    if outcome.is_err() {
        runtime.helpers.remove(program);
    }
    outcome
}

async fn one_shot(program: &'static str, cwd: Option<&str>, text: &str, cursor: usize, timeout: Duration) -> Result<Vec<ShellCompletion>, String> {
    let mut command = if is_powershell(program) {
        let mut command = Command::new(program);
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ONE_SHOT_POWER_SHELL]);
        command
    } else {
        if text.contains(' ') { return Ok(Vec::new()); }
        let mut command = Command::new(program);
        if program == "bash" {
            command.args(["--noprofile", "--norc", "-c", "compgen -A command -- \"$VRY_COMPLETION_TEXT\" | head -n 80"]);
        } else {
            command.args(["-f", "-c", "print -rl -- ${(k)commands} ${(k)builtins} | LC_ALL=C sort -u | LC_ALL=C awk -v prefix=\"$VRY_COMPLETION_TEXT\" 'index($0,prefix)==1 {print; count++; if(count==80) exit}'"]);
        }
        command
    };
    if let Some(directory) = cwd {
        command.current_dir(directory);
    }
    command.env("VRY_COMPLETION_TEXT", text).env("VRY_COMPLETION_CURSOR", cursor.to_string())
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let output = tokio::time::timeout(timeout, async {
        let stdout = child.stdout.take().ok_or("Completion output unavailable")?;
        let mut bytes = Vec::new();
        stdout.take(MAX_RESPONSE_BYTES as u64 + 1).read_to_end(&mut bytes).await.map_err(|error| error.to_string())?;
        if bytes.len() > MAX_RESPONSE_BYTES { let _ = child.kill().await; return Err("Completion output exceeds limit".to_string()); }
        let status = child.wait().await.map_err(|error| error.to_string())?;
        if !status.success() { return Err("Shell completion unavailable".to_string()); }
        Ok(bytes)
    }).await.map_err(|_| "Shell completion timed out".to_string())??;
    if is_powershell(program) {
        let candidates: Vec<ShellCompletion> = serde_json::from_slice(&output).map_err(|error| error.to_string())?;
        return Ok(bounded(candidates));
    }
    Ok(String::from_utf8_lossy(&output).lines().filter(|line| !line.is_empty()).take(MAX_CANDIDATES)
        .map(|line| ShellCompletion { text: line.to_string(), cursor: line.encode_utf16().count() }).collect())
}

async fn complete(state: &CompletionState, shell: Option<String>, cwd: Option<String>, text: String, cursor: usize) -> Result<Vec<ShellCompletion>, String> {
    if !safe_query(&text, cursor) { return Ok(Vec::new()); }
    let shell = resolve_shell(shell);
    if shell.len() > MAX_SHELL_BYTES { return Ok(Vec::new()); }
    let Some(program) = completion_program(&shell) else { return Ok(Vec::new()); };
    if let Some(directory) = &cwd {
        if directory.len() > MAX_CWD_BYTES || directory.chars().any(char::is_control) {
            return Err("Completion directory is not a bounded absolute path".to_string());
        }
        if !std::path::Path::new(directory).is_absolute() { return Err("Completion directory must be absolute".to_string()); }
    }
    let mut runtime = state.runtime.lock().await;
    prune(&mut runtime);
    if let Some(candidates) = cached(&runtime, program, cwd.as_deref(), &text, cursor) {
        return Ok(candidates);
    }
    let candidates = if is_powershell(program) {
        match resident(&mut runtime, program, cwd.as_deref(), &text, cursor).await {
            Ok(candidates) => candidates,
            Err(ResidentError::Unavailable) => one_shot(program, cwd.as_deref(), &text, cursor, ONE_SHOT_TIMEOUT).await?,
            Err(ResidentError::Query) => Vec::new(),
        }
    } else {
        one_shot(program, cwd.as_deref(), &text, cursor, ONE_SHOT_TIMEOUT).await?
    };
    remember(&mut runtime, program, cwd, text, cursor, &candidates);
    Ok(candidates)
}

async fn warm(state: &CompletionState, shell: Option<String>) -> Result<(), String> {
    let shell = resolve_shell(shell);
    if shell.len() > MAX_SHELL_BYTES { return Ok(()); }
    let Some(program) = completion_program(&shell) else { return Ok(()); };
    if !is_powershell(program) { return Ok(()); }
    let mut runtime = state.runtime.lock().await;
    prune(&mut runtime);
    if !runtime.helpers.contains_key(program) {
        runtime.helpers.insert(program, spawn_helper(program)?);
    }
    Ok(())
}

#[tauri::command]
pub async fn shell_complete(state: tauri::State<'_, CompletionState>, shell: Option<String>, cwd: Option<String>, text: String, cursor: usize) -> Result<Vec<ShellCompletion>, String> {
    complete(&state, shell, cwd, text, cursor).await
}

/// Start the resident PowerShell helper before the first Tab so its startup is off the critical path.
#[tauri::command]
pub async fn warm_shell_completion(state: tauri::State<'_, CompletionState>, shell: Option<String>) -> Result<(), String> {
    warm(&state, shell).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_are_data_and_never_accept_execution_syntax() {
        assert!(safe_query("Get-ChildItem -Pa", 17));
        for query in ["echo; calc", "$(calc)", "`calc`", "cat | sh", "echo > file", "echo\ncalc", "a\0b"] { assert!(!safe_query(query, 0)); }
        assert!(!safe_query("Get-Item", 99));
    }

    #[tokio::test]
    async fn unsupported_shells_never_start_an_arbitrary_program() {
        let candidates = complete(&CompletionState::default(), Some("arbitrary-program".to_string()), None, "a".to_string(), 1).await.unwrap();
        assert!(candidates.is_empty());
        let state = CompletionState::default();
        warm(&state, Some("arbitrary-program".to_string())).await.unwrap();
        assert!(state.runtime.lock().await.helpers.is_empty());
    }

    #[tokio::test]
    async fn rejects_relative_control_and_unbounded_directories() {
        let state = CompletionState::default();
        for directory in [
            "relative/dir".to_string(),
            "/tmp/line\nbreak".to_string(),
            format!("/{}", "a".repeat(MAX_CWD_BYTES)),
        ] {
            assert!(complete(&state, Some("bash".to_string()), Some(directory), "git".to_string(), 3).await.is_err());
        }
    }

    #[test]
    fn cache_only_reuses_the_same_shell_directory_text_and_cursor() {
        let mut runtime = CompletionRuntime::default();
        let candidates = vec![ShellCompletion { text: "git status".to_string(), cursor: 10 }];
        remember(&mut runtime, "bash", Some("/work".to_string()), "git".to_string(), 3, &candidates);
        assert_eq!(cached(&runtime, "bash", Some("/work"), "git", 3), Some(candidates.clone()));
        assert_eq!(cached(&runtime, "zsh", Some("/work"), "git", 3), None);
        assert_eq!(cached(&runtime, "bash", Some("/other"), "git", 3), None);
        assert_eq!(cached(&runtime, "bash", Some("/work"), "git", 2), None);
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn reads_native_parameter_candidates_without_submitting_a_command() {
        let text = "Get-ChildItem -Pa".to_string();
        let candidates = one_shot("powershell", None, &text, text.len(), Duration::from_secs(15)).await.unwrap();
        assert!(candidates.iter().any(|candidate| candidate.text == "Get-ChildItem -Path"));
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn resident_helper_answers_the_next_query_without_restarting() {
        let state = CompletionState::default();
        let first = complete(&state, Some("powershell".to_string()), None, "Get-ChildItem -Pa".to_string(), 17).await.unwrap();
        assert!(first.iter().any(|candidate| candidate.text == "Get-ChildItem -Path"));
        let before = state.runtime.lock().await.helpers.get("powershell").and_then(|helper| helper.child.id());
        assert!(before.is_some());
        let second = complete(&state, Some("powershell".to_string()), None, "Get-Chil".to_string(), 8).await.unwrap();
        assert!(second.iter().any(|candidate| candidate.text.starts_with("Get-ChildItem")));
        let after = state.runtime.lock().await.helpers.get("powershell").and_then(|helper| helper.child.id());
        assert_eq!(before, after);
        state.prune().await;
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn warming_starts_the_helper_before_the_first_query() {
        let state = CompletionState::default();
        warm(&state, Some("powershell".to_string())).await.unwrap();
        assert!(state.runtime.lock().await.helpers.contains_key("powershell"));
        let candidates = complete(&state, Some("powershell".to_string()), None, "Get-Chil".to_string(), 8).await.unwrap();
        assert!(candidates.iter().any(|candidate| candidate.text.starts_with("Get-ChildItem")));
        state.close_sync();
    }
}
