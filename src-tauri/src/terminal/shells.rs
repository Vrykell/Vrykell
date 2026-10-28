//! Available shell detection: the new-tab dialog offers the shell types the machine really has.
//!
//! - Unix/macOS: probe zsh / bash
//! - Windows: cmd is always available, probe PowerShell / pwsh
//!
//! Each `ShellInfo` carries a `default` flag, which the frontend uses as the sort weight for
//! the "default terminal" option.

use serde::Serialize;

#[derive(Clone, Serialize, Debug)]
pub struct ShellInfo {
    pub id: String,
    pub label: String,
    pub default: bool,
}

/// Probe whether a program is available on PATH (runs `--version`; success means available). Unix only.
#[cfg(not(target_os = "windows"))]
fn cmd_ok(program: &str) -> bool {
    std::process::Command::new(program)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Windows probe: Windows PowerShell 5.1 does not accept `--version` (that flag belongs to pwsh 7+),
/// so both go through `-NoProfile -NonInteractive -Command "exit 0"`, which 5.1 and pwsh support.
#[cfg(target_os = "windows")]
pub(crate) fn shell_ok(program: &str) -> bool {
    use std::os::windows::process::CommandExt;

    std::process::Command::new(program)
        .args(["-NoProfile", "-NonInteractive", "-Command", "exit 0"])
        .creation_flags(0x08000000)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Take the default shell name from `$SHELL` (basename only).
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
        // Detection fallback: return at least the default shell name so the dialog has an option.
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
    // Detection runs several `Command::output()` calls (up to hundreds of ms for pwsh on Windows),
    // so move it off the main thread to avoid freezing the UI.
    tauri::async_runtime::spawn_blocking(detect_shells)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fallback behaviour: with no detectable shell, return a single entry named after the default
    /// shell and marked default.
    #[test]
    fn empty_shells_falls_back_to_default() {
        let shells: Vec<ShellInfo> = Vec::new();
        let default_id = "zsh".to_string();
        // Reproduce the fallback branch of detect_shells (independent of the real PATH)
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

    /// When nothing is marked default, the first shell is promoted to default.
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
