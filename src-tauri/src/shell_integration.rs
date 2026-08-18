//! Shell integration：向 zsh/bash 注入 OSC 133（Final Term 语义标记）。
//!
//! - `OSC 133 ; A` prompt 开始（precmd）
//! - `OSC 133 ; C` 命令输出开始（preexec）
//! - `OSC 133 ; D ; <exit>` 命令结束（precmd，带退出码）
//! - `OSC 133 ; E ; <base64>` 命令文本（preexec，自定义扩展，供历史/块头使用）
//! - `OSC 133 ; G ; <base64>` git 分支（precmd，自定义扩展）

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

/// 集成脚本根目录（~/.vrykell/shell），每次启动重写保证脚本最新。
pub fn integration_dir() -> Result<PathBuf, String> {
    // 用 dirs::home_dir 而非 HOME 环境变量 —— Windows 原生环境没有 HOME，
    // 从 Git Bash 启动时 HOME 又是 MSYS 路径，都不适合作为 Windows 侧写盘位置。
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let dir = PathBuf::from(home).join(".vrykell").join("shell");
    fs::create_dir_all(dir.join("zsh")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("bash")).map_err(|e| e.to_string())?;
    fs::write(dir.join("zsh").join(".zshrc"), ZSH_RC).map_err(|e| e.to_string())?;
    fs::write(dir.join("bash").join("rc"), BASH_RC).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }

    /// 真起一个 zsh 验证钩子发出 OSC 133 标记。
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
}
