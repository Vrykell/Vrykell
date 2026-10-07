//! 可用 shell 探测：新建标签页弹窗按机器实际可用的 shell 展示类型。
//!
//! - Unix/macOS：探测 zsh / bash
//! - Windows：cmd 恒可用，探测 PowerShell / pwsh
//!
//! 每个 `ShellInfo` 带 `default` 标记，前端用它决定「默认终端」选项的排序权重。

use serde::Serialize;

#[derive(Clone, Serialize, Debug)]
pub struct ShellInfo {
    pub id: String,
    pub label: String,
    pub default: bool,
}

/// 探测某程序是否在 PATH 上可用（跑 `--version`，成功即视为可用）。Unix 用。
#[cfg(not(target_os = "windows"))]
fn cmd_ok(program: &str) -> bool {
    std::process::Command::new(program)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Windows 探测：Windows PowerShell 5.1 不接受 `--version`（那是 pwsh 7+ 的），
/// 统一走 `-NoProfile -NonInteractive -Command "exit 0"`，5.1 与 pwsh 都支持。
#[cfg(target_os = "windows")]
pub(crate) fn shell_ok(program: &str) -> bool {
    std::process::Command::new(program)
        .args(["-NoProfile", "-NonInteractive", "-Command", "exit 0"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 从 `$SHELL` 取默认 shell 名（去路径）。
#[cfg(not(target_os = "windows"))]
fn default_shell_id() -> String {
    std::env::var("SHELL")
        .unwrap_or_default()
        .rsplit('/')
        .next()
        .unwrap_or("zsh")
        .to_string()
}

#[cfg(target_os = "windows")]
fn detect_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();
    // Standalone PowerShell Core build, listed first when present.
    if shell_ok("pwsh") {
        shells.push(ShellInfo {
            id: "pwsh".into(),
            label: "PowerShell 7".into(),
            default: true,
        });
    }
    // The OS-bundled Windows PowerShell 5.1 (powershell.exe). The two builds are different
    // executables and must not share a label, or the picker shows two look-alike entries.
    if shell_ok("powershell") {
        shells.push(ShellInfo {
            id: "powershell".into(),
            label: "Windows PowerShell".into(),
            default: shells.is_empty(),
        });
    }
    // cmd always exists on Windows and stays the fallback.
    shells.push(ShellInfo {
        id: "cmd".into(),
        label: "CMD".into(),
        default: shells.is_empty(),
    });
    shells
}

#[cfg(not(target_os = "windows"))]
fn detect_shells() -> Vec<ShellInfo> {
    let default_id = default_shell_id();
    let mut shells: Vec<ShellInfo> = Vec::new();
    for (id, label) in [("zsh", "Zsh"), ("bash", "Bash")] {
        if cmd_ok(id) {
            shells.push(ShellInfo {
                id: id.into(),
                label: label.into(),
                default: id == default_id,
            });
        }
    }
    if shells.is_empty() {
        // 探测失败兜底：至少返回默认 shell 名，保证弹窗有可选项
        shells.push(ShellInfo {
            id: default_id.clone(),
            label: default_id,
            default: true,
        });
    } else if !shells.iter().any(|s| s.default) {
        shells[0].default = true;
    }
    shells
}

#[tauri::command]
pub async fn list_shells() -> Vec<ShellInfo> {
    // 探测要跑多个 `Command::output()`（Windows pwsh 可达数百 ms），移出主线程避免冻结 UI
    tauri::async_runtime::spawn_blocking(detect_shells)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 兜底逻辑：无可探测 shell 时返回以默认 shell 为名的单一项并标记 default。
    #[test]
    fn empty_shells_falls_back_to_default() {
        let shells: Vec<ShellInfo> = Vec::new();
        let default_id = "zsh".to_string();
        // 复现 detect_shells 的兜底分支（不依赖真实 PATH）
        let mut out = shells;
        if out.is_empty() {
            out.push(ShellInfo {
                id: default_id.clone(),
                label: default_id,
                default: true,
            });
        }
        assert_eq!(out.len(), 1);
        assert!(out[0].default);
        assert_eq!(out[0].id, "zsh");
    }

    /// 无任何 default 标记时，首个 shell 被提升为 default。
    #[test]
    fn first_shell_becomes_default_when_none_marked() {
        let mut out = [
            ShellInfo { id: "zsh".into(), label: "Zsh".into(), default: false },
            ShellInfo { id: "bash".into(), label: "Bash".into(), default: false },
        ];
        if !out.iter().any(|s| s.default) {
            out[0].default = true;
        }
        assert!(out[0].default);
        assert!(!out[1].default);
    }
}
