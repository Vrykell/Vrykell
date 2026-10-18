use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuStatus {
    supported: bool,
    available: bool,
    enabled: bool,
    /// A registration that still points at an older package or executable; enabling refreshes it.
    #[serde(default)]
    stale: bool,
    certificate_trusted: bool,
    certificate_thumbprint: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ContextMenuAction {
    Enable,
    Disable,
    Trust,
    Untrust,
}

#[cfg(windows)]
fn manage(app: &tauri::AppHandle, action: &str) -> Result<ContextMenuStatus, String> {
    use std::os::windows::process::CommandExt;
    let resources = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("windows-context-menu");
    #[cfg(debug_assertions)]
    let resources = if resources.join("manage.ps1").is_file() {
        resources
    } else {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("windows-context-menu")
    };
    let assets = if resources.join("Vrykell.ContextMenu.msix").is_file() {
        resources.clone()
    } else {
        resources.join("generated")
    };
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    crate::diagnostics::record(
        "context-menu-management-start",
        serde_json::json!({ "action": action }),
    )
    .ok();
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(resources.join("manage.ps1"))
        .args(["-Action", action, "-AssetDirectory"])
        .arg(assets)
        .arg("-Executable")
        .arg(executable)
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| {
            crate::diagnostics::record(
                "context-menu-management",
                serde_json::json!({ "action": action, "success": false, "stage": "spawn" }),
            )
            .ok();
            e.to_string()
        })?;
    crate::diagnostics::record(
        "context-menu-management",
        serde_json::json!({
            "action": action, "success": output.status.success()
        }),
    )
    .ok();
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Invalid context menu status: {e}"))
}

#[cfg(not(windows))]
fn manage(_app: &tauri::AppHandle, action: &str) -> Result<ContextMenuStatus, String> {
    if action == "status" {
        Ok(ContextMenuStatus::default())
    } else {
        Err("The modern context menu requires Windows 11.".into())
    }
}

#[tauri::command]
pub async fn context_menu_status(app: tauri::AppHandle) -> Result<ContextMenuStatus, String> {
    tauri::async_runtime::spawn_blocking(move || manage(&app, "status"))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn context_menu_manage(
    app: tauri::AppHandle,
    action: ContextMenuAction,
) -> Result<ContextMenuStatus, String> {
    let name = match action {
        ContextMenuAction::Enable => "enable",
        ContextMenuAction::Disable => "disable",
        ContextMenuAction::Trust => "trust",
        ContextMenuAction::Untrust => "untrust",
    };
    tauri::async_runtime::spawn_blocking(move || manage(&app, name))
        .await
        .map_err(|e| e.to_string())?
}

fn directory_argument(
    args: impl Iterator<Item = OsString>,
) -> Result<Option<String>, String> {
    let mut args = args.skip(1);
    while let Some(arg) = args.next() {
        if arg != "--open-directory" {
            continue;
        }
        let path = args
            .next()
            .map(std::path::PathBuf::from)
            .ok_or("Missing directory argument.")?;
        if !path.is_absolute() || !path.is_dir() {
            return Err("The requested directory is unavailable.".into());
        }
        return path
            .into_os_string()
            .into_string()
            .map(Some)
            .map_err(|_| "Invalid directory encoding.".into());
    }
    Ok(None)
}

#[tauri::command]
pub fn shell_launch_directory() -> Result<Option<String>, String> {
    let result = directory_argument(std::env::args_os());
    crate::diagnostics::record("context-menu-launch", serde_json::json!({
        "requested": result.as_ref().map(|p| p.is_some()).unwrap_or(true), "success": result.is_ok()
    })).ok();
    result
}

/// Directories requested by a launch that was redirected to this already-running window.
///
/// The queue is the single source of truth: the frontend drains it when `shell-launch-forwarded`
/// arrives, and the startup drain also picks up a request that landed before the webview could
/// listen. Whoever takes an entry first is the only one to open it.
#[derive(Default)]
pub struct ForwardedLaunchDirectories(std::sync::Mutex<Vec<String>>);

impl ForwardedLaunchDirectories {
    fn push(&self, directory: String) {
        if let Ok(mut directories) = self.0.lock() {
            directories.push(directory);
        }
    }

    fn take(&self) -> Vec<String> {
        match self.0.lock() {
            Ok(mut directories) => std::mem::take(&mut *directories),
            Err(_) => Vec::new(),
        }
    }
}

/// Handles a second application launch that the single-instance plugin redirected here: the window
/// comes to the front, and a `--open-directory` request waits in the queue for the frontend.
pub fn handle_secondary_launch(app: &AppHandle, args: Vec<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let directory = directory_argument(args.into_iter().map(OsString::from));
    let requested = directory
        .as_ref()
        .map(|value| value.is_some())
        .unwrap_or(true);
    let queued = match directory {
        Ok(Some(directory)) => match app.try_state::<ForwardedLaunchDirectories>() {
            Some(pending) => {
                pending.push(directory);
                true
            }
            None => false,
        },
        Ok(None) | Err(_) => false,
    };
    if queued {
        let _ = app.emit("shell-launch-forwarded", ());
    }
    crate::diagnostics::record(
        "context-menu-forward",
        serde_json::json!({ "requested": requested, "success": queued || !requested }),
    )
    .ok();
}

/// Drains directories forwarded to this window; the frontend opens one terminal tab per entry.
#[tauri::command]
pub fn shell_take_forwarded_directories(
    state: tauri::State<'_, ForwardedLaunchDirectories>,
) -> Vec<String> {
    state.take()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> impl Iterator<Item = std::ffi::OsString> {
        values
            .iter()
            .map(std::ffi::OsString::from)
            .collect::<Vec<_>>()
            .into_iter()
    }
    #[test]
    fn normal_launch_has_no_directory() {
        assert_eq!(directory_argument(args(&["app", "--other"])).unwrap(), None);
    }
    #[test]
    fn rejects_missing_or_relative_directory() {
        assert!(directory_argument(args(&["app", "--open-directory"])).is_err());
        assert!(directory_argument(args(&["app", "--open-directory", "."])).is_err());
    }
    #[test]
    fn preserves_existing_absolute_directory() {
        let path = std::env::temp_dir();
        let path = path.to_str().unwrap();
        assert_eq!(
            directory_argument(args(&["app", "--open-directory", path])).unwrap(),
            Some(path.into())
        );
    }
    #[test]
    fn forwarded_directories_drain_in_arrival_order() {
        let pending = ForwardedLaunchDirectories::default();
        pending.push("C:\\first".into());
        pending.push("C:\\second".into());
        assert_eq!(pending.take(), ["C:\\first", "C:\\second"]);
        assert!(pending.take().is_empty());
    }
}
