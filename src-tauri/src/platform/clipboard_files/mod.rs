//! System file clipboard: put real file paths on the OS pasteboard for each desktop platform.
//!
//! `encoding` builds the platform payloads as pure bytes; the per-OS submodules own the calls
//! that actually touch the clipboard. Keeping the split means the fiddly byte layouts are
//! unit-testable on any host, while only the thin OS layer is platform-gated.

pub mod encoding;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use encoding::ClipMode;

/// Put `paths` on the system clipboard with a copy/cut intent.
pub fn write_files(paths: &[String], mode: ClipMode) -> Result<(), String> {
    if paths.is_empty() {
        return Err("没有可写入剪贴板的文件".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        windows::write(paths, mode)
    }
    #[cfg(target_os = "macos")]
    {
        macos::write(paths, mode)
    }
    #[cfg(target_os = "linux")]
    {
        linux::write(paths, mode)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = mode;
        Err("当前平台不支持系统文件剪贴板".to_string())
    }
}
