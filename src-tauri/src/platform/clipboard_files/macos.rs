//! macOS clipboard: hand the file aliases to the system pasteboard through AppleScript.
//!
//! Writing the raw `public.file-url` / `NSFilenamesPboardType` flavours would need direct
//! NSPasteboard access; routing through the system instead lets AppKit build those flavours for
//! us (the byte-level formats stay defined and tested in `encoding`).

use super::encoding::{self, ClipMode};
use std::process::Command;

/// AppleScript string literal with the two characters that need escaping.
fn script_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn write(paths: &[String], mode: ClipMode) -> Result<(), String> {
    // A cut is not representable on the pasteboard, so it falls back to a copy of the aliases.
    let _ = (encoding::macos_file_url(&paths[0]), mode);
    let aliases: Vec<String> = paths
        .iter()
        .map(|path| format!("POSIX file \"{}\"", script_literal(path)))
        .collect();
    let script = format!("set the clipboard to {{{}}}", aliases.join(", "));
    let status = Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|error| format!("启动 osascript 失败：{error}"))?;
    if !status.success() {
        return Err("写入 macOS 剪贴板失败".to_string());
    }
    Ok(())
}
