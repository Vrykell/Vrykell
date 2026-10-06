//! Linux clipboard: hold the file payload with `wl-copy` (Wayland) or `xclip` (X11).

use super::encoding::{self, ClipMode};
use std::io::Write;
use std::process::{Command, Stdio};

/// The MIME type for the current operation. GNOME's type encodes copy vs cut; the generic URI
/// list has no place to express "cut", so a cut uses the GNOME type.
fn mime_for(mode: ClipMode) -> &'static str {
    match mode {
        ClipMode::Copy => "text/uri-list",
        ClipMode::Cut => "x-special/gnome-copied-files",
    }
}

/// Spawn the clipboard owner and feed it the payload. The owner keeps running to serve the
/// selection, so we hand it the bytes and let the child live on.
fn spawn_holder(tool: &str, mime: &str, payload: &str) -> Result<(), String> {
    let args: Vec<&str> = if tool == "wl-copy" {
        vec!["--type", mime]
    } else {
        vec!["-selection", "clipboard", "-t", mime]
    };
    let mut child = Command::new(tool)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 {tool} 失败：{error}"))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| format!("无法写入 {tool}"))?
        .write_all(payload.as_bytes())
        .map_err(|error| format!("写入 {tool} 失败：{error}"))?;
    Ok(())
}

pub fn write(paths: &[String], mode: ClipMode) -> Result<(), String> {
    let payload = match mode {
        ClipMode::Cut => encoding::linux_gnome_copied_files(paths, mode),
        ClipMode::Copy => encoding::linux_uri_list(paths),
    };
    let mime = mime_for(mode);
    let mut last_error = String::new();
    for tool in ["wl-copy", "xclip"] {
        match spawn_holder(tool, mime, &payload) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error,
        }
    }
    Err(if last_error.is_empty() {
        "未找到 wl-copy 或 xclip，无法写入系统剪贴板".to_string()
    } else {
        last_error
    })
}

pub fn read() -> Vec<String> {
    for tool in ["wl-paste", "xclip"] {
        let output = if tool == "wl-paste" {
            Command::new(tool).args(["--no-newline", "--type", "text/uri-list"]).output()
        } else {
            Command::new(tool).args(["-selection", "clipboard", "-o", "-t", "text/uri-list"]).output()
        };
        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }
        if let Ok(text) = String::from_utf8(output.stdout) {
            return encoding::parse_uri_list(&text);
        }
    }
    Vec::new()
}
