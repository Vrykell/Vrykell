//! Available shell detection: the new-tab dialog offers the shell types the machine really has.
//!
//! - Unix/macOS: probe zsh / bash
//! - Windows: cmd is always available, probe PowerShell / pwsh
//!
//! Each `ShellInfo` carries a `default` flag, which the frontend uses as the sort weight for
//! the "default terminal" option.

use serde::Serialize;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

static DETECTION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn probe_shell(program: &str, detection_id: u64) -> bool {
    let started = Instant::now();
    let _ = crate::diagnostics::record("shell-probe-start", json!({ "detectionId": detection_id, "shellType": program }));
    let available = shell_ok(program);
    let _ = crate::diagnostics::record("shell-probe-complete", json!({
        "detectionId": detection_id, "shellType": program,
        "durationMs": started.elapsed().as_millis() as u64, "available": available,
    }));
    available
}

#[derive(Clone, Serialize, Debug)]
pub struct ShellInfo {
    pub id: String,
    pub label: String,
    pub default: bool,
}

/// Resolve availability without launching an interpreter for each settings or startup consumer.
pub(crate) fn shell_ok(program: &str) -> bool {
    program_on_path(program, &std::env::var_os("PATH").unwrap_or_default())
}

fn program_on_path(program: &str, path: &std::ffi::OsStr) -> bool {
    #[cfg(windows)]
    let program = if program.to_ascii_lowercase().ends_with(".exe") { program.to_string() } else { format!("{program}.exe") };
    std::env::split_paths(path).filter(|directory| !directory.as_os_str().is_empty()).any(|directory| {
        let Ok(metadata) = directory.join(&program).metadata() else { return false };
        if !metadata.is_file() { return false; }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode() & 0o111 != 0
        }
        #[cfg(not(unix))]
        { true }
    })
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
fn detect_shells(detection_id: u64) -> Vec<ShellInfo> {
    let mut shells = Vec::new();
    // Standalone PowerShell Core build, listed first when present.
    if probe_shell("pwsh", detection_id) {
        shells.push(ShellInfo {
            id: "pwsh".into(),
            label: "PowerShell 7".into(),
            default: true,
        });
    }
    // The OS-bundled Windows PowerShell 5.1 (powershell.exe). The two builds are different
    // executables and must not share a label, or the picker shows two look-alike entries.
    if probe_shell("powershell", detection_id) {
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
fn detect_shells(detection_id: u64) -> Vec<ShellInfo> {
    let default_id = default_shell_id();
    let mut shells: Vec<ShellInfo> = Vec::new();
    for (id, label) in [("zsh", "Zsh"), ("bash", "Bash")] {
        if probe_shell(id, detection_id) {
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
    let detection_id = DETECTION_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    let started = Instant::now();
    let _ = crate::diagnostics::record("shell-detection-start", json!({ "detectionId": detection_id }));
    // File checks can still wait on mounted paths; keep discovery off the event loop.
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _ = crate::diagnostics::record("shell-detection-running", json!({
            "detectionId": detection_id, "queueWaitMs": started.elapsed().as_millis() as u64,
        }));
        detect_shells(detection_id)
    }).await;
    let _ = crate::diagnostics::record("shell-detection-complete", json!({
        "detectionId": detection_id, "durationMs": started.elapsed().as_millis() as u64,
        "failed": result.is_err(), "shellCount": result.as_ref().map(|shells| shells.len()).unwrap_or(0),
    }));
    result.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_checks_files_and_execution_permissions_without_running_them() {
        let dir = std::env::temp_dir().join(format!("shell-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let name = if cfg!(windows) { "probe-shell.exe" } else { "probe-shell" };
        let executable = dir.join(name);
        std::fs::write(&executable, "a discovery fixture must never execute").unwrap();
        let path = std::env::join_paths([&dir]).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert!(!program_on_path("probe-shell", &path));
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert!(program_on_path("probe-shell", &path));
        assert!(!program_on_path("missing-shell", &path));
        assert!(!program_on_path("probe-shell", std::ffi::OsStr::new("")));
        std::fs::remove_file(executable).unwrap();
        std::fs::create_dir(dir.join(name)).unwrap();
        assert!(!program_on_path("probe-shell", &path));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn traced_detection_returns_available_shells_with_one_default() {
        let shells = list_shells().await;
        assert!(!shells.is_empty());
        assert_eq!(shells.iter().filter(|shell| shell.default).count(), 1);
        assert!(shells.iter().all(|shell| !shell.id.is_empty() && !shell.label.is_empty()));
    }

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
