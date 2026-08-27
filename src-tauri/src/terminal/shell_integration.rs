//! Shell integration：向 zsh/bash 注入 OSC 133（Final Term 语义标记）。
//!
//! - `OSC 133 ; A` prompt 开始（precmd）
//! - `OSC 133 ; C` 命令输出开始（preexec）
//! - `OSC 133 ; D ; <exit>` 命令结束（precmd，带退出码）
//! - `OSC 133 ; E ; <base64>` 命令文本（preexec，自定义扩展，供历史/块头使用）
//! - `OSC 133 ; G ; <base64>` git 分支（precmd，自定义扩展）

use base64::Engine;
use std::fs;
use std::path::PathBuf;

const ZSH_RC: &str = r#"# vrykell shell integration (zsh)
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
[[ -f "$HOME/.zprofile" ]] && source "$HOME/.zprofile"
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"

__ait_precmd() {
  local ec=$?
  printf '\e]7;file://%s%s\a' "$HOST" "$PWD"
  printf '\e]133;D;%d\a' "$ec"
  printf '\e]133;A\a'
  local b=$(git branch --show-current 2>/dev/null) && [[ -n "$b" ]] && \
    printf '\e]133;G;%s\a' "$(printf %s "$b" | base64 | tr -d '\n')"
}
__ait_preexec() {
  printf '\e]133;E;%s\a' "$(printf %s "$1" | base64 | tr -d '\n')"
  printf '\e]133;C\a'
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
  printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"
  printf '\e]133;D;%d\a' "$ec"
  printf '\e]133;A\a'
  local b=$(git branch --show-current 2>/dev/null) && [[ -n "$b" ]] && \
    printf '\e]133;G;%s\a' "$(printf %s "$b" | base64 | tr -d '\n')"
  __ait_in_prompt=1
}
PROMPT_COMMAND="__ait_prompt_command${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
__ait_preexec() {
  [[ $__ait_in_prompt == 0 ]] && return
  [[ "$BASH_COMMAND" == __ait_* ]] && return
  __ait_in_prompt=0
  printf '\e]133;E;%s\a' "$(printf %s "$BASH_COMMAND" | base64 | tr -d '\n')"
  printf '\e]133;C\a'
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

    # OSC 133;G git branch
    $b = & git branch --show-current 2>$null
    if ($b) {
        $txt = ($b | Out-String).Trim()
        if ($txt) {
            $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($txt))
            Write-VrykellOsc "133;G" $b64
        }
    }

    "PS $($PWD.Path)> "
}

# Enter hook: emit 133;E (command) then 133;C (preexec)
if (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) {
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
        $esc = [char]27; $bel = [char]7
        $line = $null; $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
        $trimmed = $line.Trim()
        if ($trimmed.Length -gt 0) {
            $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($trimmed))
            Write-VrykellOsc "133;E" $b64
            Write-VrykellOsc "133;C" ""
        }
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
}

$global:LASTEXITCODE = $null
"#;

/// 集成脚本根目录（~/.vrykell/shell），每次启动重写保证脚本最新。
pub fn integration_dir() -> Result<PathBuf, String> {
    // 用 dirs::home_dir 而非 HOME 环境变量 —— Windows 原生环境没有 HOME，
    // 从 Git Bash 启动时 HOME 又是 MSYS 路径，都不适合作为 Windows 侧写盘位置。
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let dir = PathBuf::from(home).join(".vrykell").join("shell");
    fs::create_dir_all(dir.join("zsh")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("bash")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("powershell")).map_err(|e| e.to_string())?;
    fs::write(dir.join("zsh").join(".zshrc"), ZSH_RC).map_err(|e| e.to_string())?;
    fs::write(dir.join("bash").join("rc"), BASH_RC).map_err(|e| e.to_string())?;
    fs::write(dir.join("powershell").join("profile.ps1"), PS_RC).map_err(|e| e.to_string())?;
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
zsh) d=$(umask 077 && mktemp -d 2>/dev/null) && b64d '{zsh_b64}' > "$d/.zshrc" && ZDOTDIR=$d exec zsh -i 2>/dev/null;;
bash) f=$(umask 077 && mktemp 2>/dev/null) && b64d '{bash_b64}' > "$f" && exec bash --rcfile "$f" -i 2>/dev/null;;
esac
exec "${{SHELL:-sh}}" -i"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let ps = fs::read_to_string(dir.join("powershell/profile.ps1")).unwrap();
        assert!(ps.contains("133;A"));
        assert!(ps.contains("133;C"));
        assert!(ps.contains("133;D"));
        assert!(ps.contains("133;E"));
        assert!(ps.contains("133;G"));
        assert!(ps.contains("Set-PSReadLineKeyHandler"));
    }

    /// 真起一个 zsh 验证钩子发出 OSC 133 标记（zsh 只在 Unix 上可用）。
    #[cfg(unix)]
    #[test]
    fn zsh_emits_osc133_marks() {
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
        let mut cmd = portable_pty::CommandBuilder::new("/bin/zsh");
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
        let mut last_out = String::new();
        while Instant::now() < deadline {
            while let Ok(s) = rx.try_recv() {
                last_out = s.clone();
                saw_a |= s.contains("\u{1b}]133;A");
                saw_c |= s.contains("\u{1b}]133;C");
                saw_e |= s.contains("\u{1b}]133;E;");
            }
            if saw_a && !sent {
                sent = true;
                let _ = writer.write_all(b"echo v2psok\r");
                let _ = writer.flush();
            }
            if saw_a && saw_c && saw_e {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        let _ = child.kill();
        let _ = child.wait();
        assert!(saw_a, "未收到 133;A（prompt 未发 precmd）。输出片段：{last_out}");
        assert!(saw_c, "未收到 133;C（Enter 拦截未发 preexec）。输出片段：{last_out}");
        assert!(saw_e, "未收到 133;E（命令文本未发）。输出片段：{last_out}");
    }
}
