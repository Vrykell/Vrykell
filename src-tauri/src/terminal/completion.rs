use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncReadExt;

#[derive(Serialize, Deserialize, Debug)]
pub struct ShellCompletion {
    text: String,
    cursor: usize,
}

fn safe_query(text: &str, cursor: usize) -> bool {
    !text.is_empty() && text.len() <= 4096 && cursor <= text.encode_utf16().count()
        && text.chars().all(|character| character.is_ascii_alphanumeric() || " -_./\\:".contains(character))
}

#[tauri::command]
pub async fn shell_complete(shell: Option<String>, cwd: Option<String>, text: String, cursor: usize) -> Result<Vec<ShellCompletion>, String> {
    if !safe_query(&text, cursor) { return Ok(Vec::new()); }
    let shell = shell.unwrap_or_else(|| {
        #[cfg(target_os = "windows")]
        { super::pty::default_windows_shell().to_string() }
        #[cfg(not(target_os = "windows"))]
        { std::env::var("SHELL").ok().and_then(|path| path.rsplit('/').next().map(str::to_string)).unwrap_or_else(|| "bash".to_string()) }
    });
    let mut command = match shell.as_str() {
        "powershell" | "pwsh" | "cmd" => {
            let mut command = tokio::process::Command::new(if shell == "cmd" { "powershell" } else { &shell });
            let script = r#"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $line=$env:VRY_COMPLETION_TEXT; $cursor=[int]$env:VRY_COMPLETION_CURSOR; $result=TabExpansion2 -inputScript $line -cursorColumn $cursor; $items=@($result.CompletionMatches | Where-Object { $_.ResultType -notin @('ProviderItem','ProviderContainer') } | Select-Object -First 80 | ForEach-Object { $value=$line.Substring(0,$result.ReplacementIndex)+$_.CompletionText+$line.Substring($result.ReplacementIndex+$result.ReplacementLength); @{text=$value;cursor=($result.ReplacementIndex+$_.CompletionText.Length)} }); ConvertTo-Json -InputObject $items -Compress -Depth 3"#;
            command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]);
            command
        }
        "bash" | "zsh" => {
            if text.contains(' ') { return Ok(Vec::new()); }
            let mut command = tokio::process::Command::new(&shell);
            if shell == "bash" {
                command.args(["--noprofile", "--norc", "-c", "compgen -A command -- \"$VRY_COMPLETION_TEXT\" | head -n 80"]);
            } else {
                command.args(["-f", "-c", "print -rl -- ${(k)commands} ${(k)builtins} | LC_ALL=C sort -u | LC_ALL=C awk -v prefix=\"$VRY_COMPLETION_TEXT\" 'index($0,prefix)==1 {print; count++; if(count==80) exit}'"]);
            }
            command
        }
        _ => return Ok(Vec::new()),
    };
    if let Some(directory) = cwd {
        if !std::path::Path::new(&directory).is_absolute() { return Err("Completion directory must be absolute".to_string()); }
        command.current_dir(directory);
    }
    command.env("VRY_COMPLETION_TEXT", &text).env("VRY_COMPLETION_CURSOR", cursor.to_string())
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let output = tokio::time::timeout(std::time::Duration::from_millis(2500), async {
        let stdout = child.stdout.take().ok_or("Completion output unavailable")?;
        let mut bytes = Vec::new();
        stdout.take(65537).read_to_end(&mut bytes).await.map_err(|error| error.to_string())?;
        if bytes.len() > 65536 { let _ = child.kill().await; return Err("Completion output exceeds limit".to_string()); }
        let status = child.wait().await.map_err(|error| error.to_string())?;
        if !status.success() { return Err("Shell completion unavailable".to_string()); }
        Ok(bytes)
    }).await.map_err(|_| "Shell completion timed out".to_string())??;
    if shell == "bash" || shell == "zsh" {
        return Ok(String::from_utf8_lossy(&output).lines().filter(|line| !line.is_empty()).take(80)
            .map(|line| ShellCompletion { text: line.to_string(), cursor: line.encode_utf16().count() }).collect());
    }
    let candidates: Vec<ShellCompletion> = serde_json::from_slice(&output).map_err(|error| error.to_string())?;
    Ok(candidates.into_iter().filter(|candidate| candidate.text.len() <= 8192 && candidate.cursor <= candidate.text.encode_utf16().count()).take(80).collect())
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
        assert!(shell_complete(Some("arbitrary-program".to_string()), None, "a".to_string(), 1).await.unwrap().is_empty());
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn reads_native_parameter_candidates_without_submitting_a_command() {
        let text = "Get-ChildItem -Pa".to_string();
        let candidates = shell_complete(Some("powershell".to_string()), None, text.clone(), text.len()).await.unwrap();
        assert!(candidates.iter().any(|candidate| candidate.text == "Get-ChildItem -Path"));
    }
}
