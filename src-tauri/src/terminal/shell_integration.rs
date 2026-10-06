//! Shell integration：向 zsh/bash 注入 OSC 133（Final Term 语义标记）。
//!
//! - `OSC 133 ; A` prompt 开始（precmd）
//! - `OSC 133 ; C` 命令输出开始（preexec）
//! - `OSC 133 ; D ; <exit>` 命令结束（precmd，带退出码）
//! - `OSC 133 ; E ; <base64>` 命令文本（preexec，自定义扩展，供历史/块头使用）
//! - `OSC 133 ; G ; <base64>` git 分支（precmd，自定义扩展）

use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};

const ZSH_RC: &str = r#"# vrykell shell integration (zsh)
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
[[ -f "$HOME/.zprofile" ]] && source "$HOME/.zprofile"
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"

__ait_precmd() {
  local ec=$?
  if [[ "${VRYKELL_BLOCK_MODE:-0}" == "1" ]]; then
    PROMPT=''
    RPROMPT=''
    PROMPT2=''
  fi
  printf '\e]7;file://%s%s\a' "$HOST" "$PWD"
  printf '\e]133;D;%d\a' "$ec"
  printf '\e]133;A\a'
  local b=$(git branch --show-current 2>/dev/null) && [[ -n "$b" ]] && \
    printf '\e]133;G;%s\a' "$(printf %s "$b" | base64 | tr -d '\n')"
  printf '\e]133;B\a'
}
__ait_preexec() {
  printf '\e]133;E;%s\a' "$(printf %s "$1" | base64 | tr -d '\n')"
  printf '\e]133;C\a'
  # Each command block starts with an independent terminal screen origin.
  if [[ "${VRYKELL_BLOCK_MODE:-0}" == "1" ]]; then printf '\e[H\e[2J'; fi
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __ait_precmd
add-zsh-hook preexec __ait_preexec
"#;

const BASH_RC: &str = r#"# vrykell shell integration (bash)
[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"

__ait_in_prompt=0
__ait_prompt_command() {
  local ec=$?
  __ait_in_prompt=0
  printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"
  if [[ "${VRYKELL_BLOCK_MODE:-0}" == "1" || "$PS1" != *"133;A"* ]]; then
    printf '\e]133;D;%d\a' "$ec"
    printf '\e]133;A\a'
  fi
  local b=$(git branch --show-current 2>/dev/null) && [[ -n "$b" ]] && \
    printf '\e]133;G;%s\a' "$(printf %s "$b" | base64 | tr -d '\n')"
}
__ait_mark_prompt_ready() {
  if [[ "${VRYKELL_BLOCK_MODE:-0}" == "1" ]]; then
    PS1=''
    PS2=''
  fi
  __ait_in_prompt=1
  printf '\e]133;B\a'
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=(__ait_prompt_command "${PROMPT_COMMAND[@]}" __ait_mark_prompt_ready)
else
  PROMPT_COMMAND="__ait_prompt_command${PROMPT_COMMAND:+;$PROMPT_COMMAND};__ait_mark_prompt_ready"
fi
__ait_preexec() {
  [[ $__ait_in_prompt == 0 ]] && return
  __ait_in_prompt=0
  local __ait_history_line=$(HISTTIMEFORMAT= history 1)
  local __ait_command=${__ait_history_line##*  }
  [[ -n "$__ait_command" ]] || __ait_command="$BASH_COMMAND"
  printf '\e]133;E;%s\a' "$(printf %s "$__ait_command" | base64 | tr -d '\n')"
  printf '\e]133;C\a'
  # Reset the shared PTY screen so earlier authentication text cannot be repainted.
  if [[ "${VRYKELL_BLOCK_MODE:-0}" == "1" ]]; then printf '\e[H\e[2J'; fi
}
trap '__ait_preexec' DEBUG
"#;

/// PowerShell 集成：`prompt` 函数做 precmd（133;D/A/G + OSC 7），
/// PSReadLine 拦 Enter 做 preexec（133;E/C）。裸 REPL 会照常进入 block 交互模式。
/// 注意：脚本必须纯 ASCII —— PowerShell 5.1 无 BOM 时按 ANSI 读 .ps1，
/// 中文字节在中文区域被当 GBK 解析会吞掉换行、破坏脚本。
const PS_RC: &str = r#"# vrykell shell integration (PowerShell / pwsh)

function Write-VrykellOsc {
    param([string]$Code, [string]$Payload)
    [Console]::Out.Write([char]27 + "]" + $Code + ";" + $Payload + [char]7)
}

function prompt {
    $esc = [char]27; $bel = [char]7

    if ($env:VRYKELL_BLOCK_MODE -eq '1') {
        # An empty string makes the host fall back to its default prompt.
        $promptText = ' '
    } else {
        $promptText = "PS $($PWD.Path)> "
    }

    # exit code of the previous command (LASTEXITCODE for native commands)
    $ec = 0
    if ($null -ne $global:LASTEXITCODE) { $ec = [int]$global:LASTEXITCODE }
    $global:LASTEXITCODE = $null

    # OSC 7 cwd (backslash -> slash, leading / for file://host/C:/...)
    $p = ($PWD.Path -replace '\\','/').TrimEnd('/')
    if ($p -eq '') { $p = '/' }
    if (-not $p.StartsWith('/')) { $p = '/' + $p }
    Write-VrykellOsc "7" "file://$env:COMPUTERNAME$p"

    Write-VrykellOsc "133;D" "$ec"
    Write-VrykellOsc "133;A" ""

    # Cache the branch lookup per directory; spawning git on every prompt makes
    # short commands feel sluggish, especially on Windows file systems.
    if ($script:__vrykell_git_cwd -ne $PWD.Path) {
        $script:__vrykell_git_cwd = $PWD.Path
        $script:__vrykell_git_branch = (& git branch --show-current 2>$null | Out-String).Trim()
        # The lookup is an implementation detail and must not become the next
        # prompt's command status (git returns 128 outside a repository).
        $global:LASTEXITCODE = $null
    }
    if ($script:__vrykell_git_branch) {
        $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script:__vrykell_git_branch))
        Write-VrykellOsc "133;G" $b64
    }

    # The prompt-end marker follows initialization and is rendered with the prompt.
    $promptText + $esc + ']133;B' + $bel
}

# Finish line-editor repainting before marking command output as started.
if (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) {
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
        $esc = [char]27; $bel = [char]7
        $line = $null; $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
        $trimmed = $line.Trim()
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
        if ($trimmed.Length -gt 0) {
            $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($trimmed))
            Write-VrykellOsc "133;E" $b64
            Write-VrykellOsc "133;C" ""
            if ($env:VRYKELL_BLOCK_MODE -eq '1') {
                [Console]::Out.Write([char]27 + '[H' + [char]27 + '[2J')
            }
        }
    }
}

$global:LASTEXITCODE = $null
"#;

// Publish complete scripts without truncating a file another terminal is loading.
fn write_script(path: &Path, script: &str) -> Result<(), String> {
    if fs::read(path).ok().as_deref() == Some(script.as_bytes()) {
        return Ok(());
    }
    let temporary = path.with_file_name(format!(".script-{}.tmp", uuid::Uuid::new_v4()));
    let result = fs::write(&temporary, script).and_then(|_| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

/// Keep the shared integration scripts current when a terminal starts.
pub fn integration_dir() -> Result<PathBuf, String> {
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    // 用 dirs::home_dir 而非 HOME 环境变量 —— Windows 原生环境没有 HOME，
    // 从 Git Bash 启动时 HOME 又是 MSYS 路径，都不适合作为 Windows 侧写盘位置。
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let dir = home.join(".vrykell").join("shell");
    fs::create_dir_all(dir.join("zsh")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("bash")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("powershell")).map_err(|e| e.to_string())?;
    write_script(&dir.join("zsh").join(".zshrc"), ZSH_RC)?;
    write_script(&dir.join("bash").join("rc"), BASH_RC)?;
    write_script(&dir.join("powershell").join("profile.ps1"), PS_RC)?;
    Ok(dir)
}

/// SSH 远端 shell integration 注入命令（安全性最高版本）。
///
/// 作为 `ssh -t host '<此命令>'` 的远程命令执行。安全设计：
///   1. 脚本内容是编译进二进制的静态常量（ZSH_RC/BASH_RC），base64 编码传递，
///      不拼接任何远端数据 → 远端无法通过环境/变量影响注入内容；
///   2. 传输防篡改由 SSH 加密 + 主机密钥校验（OpenSSH TOFU 确认）保证；
///   3. 远端解码用 `umask 077` + `mktemp` 随机临时文件（防符号链接/目录穿越），
///      仅当前用户可读写；解码失败静默回退，不污染终端；
///   4. 按远端 shell 类型（zsh/bash）分支注入，其余环境 `exec "$SHELL" -i`
///      走经典模式 —— 注入失败也保证交互 shell 可用，不破坏连接。
pub fn ssh_remote_command() -> String {
    let zsh_b64 = base64::engine::general_purpose::STANDARD.encode(ZSH_RC);
    let bash_b64 = base64::engine::general_purpose::STANDARD.encode(BASH_RC);
    // base64 字符集为 [A-Za-z0-9+/=]，不含单引号/美元符，外层单引号包裹安全。
    format!(
        r#"b64d() {{ printf %s "$1" | base64 -d 2>/dev/null || printf %s "$1" | base64 -D 2>/dev/null; }}
case ${{SHELL##*/}} in
zsh) d=$(umask 077 && mktemp -d 2>/dev/null) && b64d '{zsh_b64}' > "$d/.zshrc" && VRYKELL_BLOCK_MODE=1 ZDOTDIR=$d exec zsh -i;;
bash) f=$(umask 077 && mktemp 2>/dev/null) && b64d '{bash_b64}' > "$f" && VRYKELL_BLOCK_MODE=1 exec bash --rcfile "$f" -i;;
esac
exec "${{SHELL:-sh}}" -i"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_wrapper_runs_commands_and_preserves_stderr() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        #[cfg(windows)]
        let bash = Path::new("C:/Program Files/Git/usr/bin/bash.exe");
        #[cfg(not(windows))]
        let bash = Path::new("/bin/bash");
        if !bash.is_file() { return; }

        let dir = std::env::temp_dir().join(format!("vrykell-remote-shell-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("ssh-block-visible.txt"), "fixture").unwrap();
        fs::write(dir.join(".bashrc"), "").unwrap();
        let mut command = Command::new(bash);
        command.args(["--noprofile", "--norc", "-c", &ssh_remote_command()]);
        command.current_dir(&dir).env("HOME", &dir).env("SHELL", "/bin/bash");
        command.env("PATH", "/usr/bin:/bin").env("TERM", "xterm-256color");
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = command.spawn().unwrap();
        child.stdin.take().unwrap().write_all(b"ls\npwd\nprintf 'stderr-visible\\n' >&2\nexit\n").unwrap();
        let output = child.wait_with_output().unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(stdout.contains("ssh-block-visible.txt"), "ls output was lost: {stdout}");
        assert!(stdout.contains("133;C"), "preexec markers were lost: {stdout}");
        assert!(stdout.contains("133;D;0"), "completion markers were lost: {stdout}");
        assert!(stderr.contains("stderr-visible"), "remote command errors were hidden: {stderr}");
    }

    #[test]
    fn ssh_remote_command_contains_safe_wrapper_and_decodable_scripts() {
        let cmd = ssh_remote_command();
        // 外层包装：按 shell 分支 + 兜底 exec（经典回退）
        assert!(cmd.contains("SHELL##*/"));
        assert!(cmd.contains("zsh)"));
        assert!(cmd.contains("bash)"));
        assert!(cmd.contains("exec \"${SHELL:-sh}\" -i"));
        // 安全细节：umask 077 + mktemp + 双 base64 实现 + 静默失败
        assert!(cmd.contains("umask 077"));
        assert!(cmd.contains("mktemp"));
        assert!(cmd.contains("base64 -d"));
        assert!(cmd.contains("base64 -D"));
        assert!(cmd.contains("2>/dev/null"));
        // 无单引号冲突面：外层用单引号包裹 base64，内容不得含单引号
        for (label, b64) in [("zsh", extract_b64(&cmd, "zsh")), ("bash", extract_b64(&cmd, "bash"))] {
            assert!(!b64.contains('\''), "{label} base64 不应含单引号");
            // 解码回原脚本：与本地注入脚本同源（含 OSC 133 标记）
            use base64::Engine;
            let script = String::from_utf8(
                base64::engine::general_purpose::STANDARD.decode(&b64).unwrap(),
            )
            .unwrap();
            assert!(script.contains("133;A"));
            assert!(script.contains("133;C"));
            // 提示符结束标记：文件打开等延后命令依赖它判断行编辑器已就绪
            assert!(script.contains("133;B"));
        }
    }

    /// 从远程命令中提取对应 shell 分支的 base64（测试辅助）。
    fn extract_b64(cmd: &str, shell: &str) -> String {
        let marker = format!("{shell})");
        let start = cmd.find(&marker).expect("分支存在");
        let q1 = cmd[start..].find('\'').expect("分支含 b64") + start + 1;
        let q2 = cmd[q1..].find('\'').expect("b64 闭合") + q1;
        cmd[q1..q2].to_string()
    }

    #[test]
    fn script_updates_never_expose_partial_contents() {
        use std::sync::{Arc, Barrier, atomic::{AtomicBool, Ordering}};
        let dir = std::env::temp_dir().join(format!("vrykell-script-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("profile.ps1");
        let first = "first script\n".repeat(1024);
        let second = "second script\n".repeat(1024);
        write_script(&path, &first).unwrap();
        let running = Arc::new(AtomicBool::new(true));
        let barrier = Arc::new(Barrier::new(2));
        std::thread::scope(|scope| {
            let reader_running = running.clone();
            let reader_barrier = barrier.clone();
            let path = &path;
            let first = &first;
            let second = &second;
            let reader = scope.spawn(move || {
                reader_barrier.wait();
                let mut reads = 0;
                loop {
                    let script = fs::read_to_string(path).unwrap();
                    assert!(script == *first || script == *second);
                    reads += 1;
                    if !reader_running.load(Ordering::Acquire) || reads >= 4096 { break; }
                }
                reads
            });
            // Start the reader before publishing alternating script versions.
            barrier.wait();
            for i in 0..32 { write_script(path, if i % 2 == 0 { second } else { first }).unwrap(); }
            running.store(false, Ordering::Release);
            assert!(reader.join().unwrap() > 0);
        });
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_terminal_starts_read_complete_scripts() {
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let threads: Vec<_> = (0..8).map(|_| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                for _ in 0..16 {
                    let dir = integration_dir().unwrap();
                    for (path, script) in [("zsh/.zshrc", ZSH_RC), ("bash/rc", BASH_RC), ("powershell/profile.ps1", PS_RC)] {
                        assert_eq!(fs::read_to_string(dir.join(path)).unwrap(), script);
                    }
                }
            })
        }).collect();
        for thread in threads { thread.join().unwrap(); }
    }

    #[test]
    fn writes_integration_scripts() {
        let dir = integration_dir().unwrap();
        let zsh = fs::read_to_string(dir.join("zsh/.zshrc")).unwrap();
        assert!(zsh.contains("133;A"));
        assert!(zsh.contains("133;C"));
        assert!(zsh.contains("133;D;"));
        assert!(zsh.contains("133;E;"));
        assert!(zsh.contains("133;G;"));
        assert!(zsh.contains("7;file://"));
        assert!(zsh.contains("source \"$HOME/.zshrc\""));
        let bash = fs::read_to_string(dir.join("bash/rc")).unwrap();
        assert!(bash.contains("133;A"));
        assert!(bash.contains("133;G;"));
        assert!(bash.contains("7;file://"));
        assert!(bash.contains("PROMPT_COMMAND"));
        assert!(bash.contains("__ait_mark_prompt_ready"));
        let ps = fs::read_to_string(dir.join("powershell/profile.ps1")).unwrap();
        assert!(ps.contains("133;A"));
        assert!(ps.contains("133;C"));
        assert!(ps.contains("133;D"));
        assert!(ps.contains("133;E"));
        assert!(ps.contains("133;G"));
        assert!(ps.contains("Set-PSReadLineKeyHandler"));
        // Prompt-end marker: delayed commands (file open) wait for it before typing.
        assert!(zsh.contains("133;B"));
        assert!(bash.contains("133;B"));
        assert!(ps.contains("133;B"));
    }

    #[test]
    fn bash_prompt_commands_are_not_reported_as_user_commands() {
        let ready = BASH_RC.find("__ait_mark_prompt_ready").unwrap();
        let prompt = BASH_RC.find("__ait_prompt_command()").unwrap();
        let reset = BASH_RC.find("  __ait_in_prompt=0\n  printf").unwrap();
        assert!(prompt < reset && reset < ready);
        assert!(BASH_RC.contains("PROMPT_COMMAND=\"__ait_prompt_command"));
        assert!(BASH_RC.contains("history 1"));
    }

    #[cfg(unix)]
    #[test]
    fn bash_prompt_hooks_full_chain_only_reports_user_commands() {
        use std::io::{Read, Write};

        let bash_available = std::process::Command::new("sh")
            .args(["-c", "command -v bash"])
            .output()
            .ok()
            .is_some_and(|output| output.status.success());
        if !bash_available {
            eprintln!("Skipping Bash prompt hook simulation: bash is not installed");
            return;
        }

        let dir = integration_dir().unwrap();
        let test_home = std::path::Path::new("/tmp/vrykell-shell-test-home-hooks");
        let _ = fs::create_dir_all(test_home);
        fs::write(
            test_home.join(".bashrc"),
            r#"[ -f /etc/bashrc ] && . /etc/bashrc
shopt -s expand_aliases
alias ls='ls --color=auto'
HISTTIMEFORMAT='%F %T '
"#,
        )
        .unwrap();

        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = portable_pty::CommandBuilder::new("bash");
        cmd.arg("--rcfile");
        cmd.arg(dir.join("bash").join("rc").to_string_lossy().to_string());
        cmd.arg("-i");
        cmd.env("HOME", "/tmp/vrykell-shell-test-home-hooks");
        cmd.env("VTE_VERSION", "7200");
        cmd.env("TERM", "xterm");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"ls\nexit\n").unwrap();
        writer.flush().unwrap();

        let mut output = Vec::new();
        let _ = reader.read_to_end(&mut output);
        let _ = child.wait();
        let output = String::from_utf8_lossy(&output);
        let prompt_st = output.matches("\u{1b}]133;A\u{1b}\\").count();
        let prompt_bel = output.matches("\u{1b}]133;A\u{07}").count();
        assert_eq!(prompt_st + prompt_bel, 2, "one prompt marker per shell prompt");

        let commands = output
            .split("\u{1b}]133;E;")
            .skip(1)
            .filter_map(|chunk| chunk.split('\u{07}').next())
            .filter_map(|payload| {
                base64::engine::general_purpose::STANDARD
                    .decode(payload)
                    .ok()
                    .and_then(|bytes| String::from_utf8(bytes).ok())
            })
            .collect::<Vec<_>>();
        assert_eq!(commands, ["ls", "exit"]);
    }

    #[test]
    fn powershell_prompt_does_not_leak_git_exit_status() {
        let lookup = "__vrykell_git_branch = (& git branch --show-current 2>$null | Out-String).Trim()";
        let reset = "$global:LASTEXITCODE = $null";
        assert!(PS_RC.contains(lookup));
        assert!(PS_RC.matches(reset).count() >= 2);
        assert!(PS_RC.contains("$script:__vrykell_git_cwd -ne $PWD.Path"));
    }

    /// 真起一个 zsh 验证钩子发出 OSC 133 标记（zsh 只在 Unix 上可用）。
    #[cfg(unix)]
    #[test]
    fn zsh_emits_osc133_marks() {
        // Keep the integration test meaningful on minimal Linux images without zsh.
        let zsh_path = std::process::Command::new("sh")
            .args(["-c", "command -v zsh"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .filter(|path| !path.is_empty());
        if zsh_path.is_none() {
            eprintln!("Skipping zsh integration test: zsh is not installed");
            return;
        }
        let dir = integration_dir().unwrap();
        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = portable_pty::CommandBuilder::new(zsh_path.expect("zsh path checked above"));
        cmd.env("ZDOTDIR", dir.join("zsh").to_string_lossy().to_string());
        cmd.env("HOST", "testhost");
        let _child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"true\n").unwrap();
        writer.flush().unwrap();

        let start = std::time::Instant::now();
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        while start.elapsed() < std::time::Duration::from_secs(10) {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    out.extend_from_slice(&buf[..n]);
                    let s = String::from_utf8_lossy(&out);
                    if s.contains("\u{1b}]133;A") && s.contains("\u{1b}]133;C")
                        && s.contains("\u{1b}]133;D;0") && s.contains("\u{1b}]133;E;")
                        && s.contains("\u{1b}]7;file://")
                    {
                        return; // 成功
                    }
                }
                Err(_) => break,
            }
        }
        panic!(
            "未集齐 OSC 标记，输出：{}",
            String::from_utf8_lossy(&out)
        );
    }

    /// Windows：真起一个 PowerShell 验证集成脚本发出 OSC 133 标记。
    #[cfg(target_os = "windows")]
    #[test]
    fn powershell_emits_osc133_marks() {
        check_powershell_integration(false);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn powershell_block_mode_does_not_repaint_the_default_prompt() {
        check_powershell_integration(true);
    }

    #[cfg(target_os = "windows")]
    fn check_powershell_integration(block_mode: bool) {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let dir = integration_dir().unwrap();
        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = portable_pty::CommandBuilder::new("powershell");
        cmd.env("VRYKELL_BLOCK_MODE", if block_mode { "1" } else { "0" });
        cmd.arg("-NoLogo");
        cmd.arg("-NoExit");
        cmd.arg("-File");
        cmd.arg(dir.join("powershell").join("profile.ps1").to_string_lossy().to_string());
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();

        // 后台线程持续读取输出（读是阻塞的，放线程里避免测试卡死）
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let mut out = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        out.extend_from_slice(&buf[..n]);
                        let _ = tx.send(String::from_utf8_lossy(&out).to_string());
                    }
                }
            }
        });

        let deadline = Instant::now() + Duration::from_secs(15);
        let (mut saw_a, mut saw_c, mut saw_e, mut sent) = (false, false, false, false);
        let mut saw_git_status_leak = false;
        let mut last_out = String::new();
        while Instant::now() < deadline {
            while let Ok(s) = rx.try_recv() {
                last_out = s.clone();
                saw_a |= s.contains("\u{1b}]133;A");
                saw_c |= s.contains("\u{1b}]133;C");
                saw_e |= s.contains("\u{1b}]133;E;");
                saw_git_status_leak |= s.contains("\u{1b}]133;D;128");
            }
            if saw_a && !sent {
                sent = true;
                let _ = writer.write_all(b"echo v2psok\r");
                let _ = writer.flush();
            }
            if saw_a && saw_c && saw_e && last_out.matches("\u{1b}]133;A").count() >= 2 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        let _ = child.kill();
        let _ = child.wait();
        assert!(!saw_git_status_leak, "PowerShell prompt leaked git exit code 128: {last_out}");
        assert!(saw_a, "未收到 133;A（prompt 未发 precmd）。输出片段：{last_out}");
        assert!(saw_c, "未收到 133;C（Enter 拦截未发 preexec）。输出片段：{last_out}");
        assert!(saw_e, "未收到 133;E（命令文本未发）。输出片段：{last_out}");
        assert!(last_out.matches("\u{1b}]133;A").count() >= 2, "Command did not finish: {last_out}");
        if block_mode {
            assert!(!last_out.contains("PS>"), "Default prompt leaked into block mode: {last_out:?}");
            assert!(last_out.contains("v2psok"), "Command output missing: {last_out:?}");
        }
    }
}
