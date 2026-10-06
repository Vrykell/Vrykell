//! Windows clipboard: CF_HDROP carries the file list, "Preferred DropEffect" the copy/cut intent.

use super::encoding::{self, ClipMode};
use std::ptr::{null_mut, copy_nonoverlapping};
use winapi::ctypes::c_void;
use winapi::um::shellapi::{DragQueryFileW, HDROP};
use winapi::um::winbase::{GlobalAlloc, GlobalFree, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use winapi::um::winuser::{
    CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData, CF_HDROP,
};

/// Null-terminated UTF-16 copy of an ASCII format name.
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Copy `bytes` into a fresh movable global block. On success the block is owned by the caller,
/// and once handed to `SetClipboardData` its ownership passes to the clipboard.
unsafe fn global_from_bytes(bytes: &[u8]) -> Result<*mut c_void, String> {
    let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
    if handle.is_null() {
        return Err("分配剪贴板内存失败".to_string());
    }
    let target = GlobalLock(handle);
    if target.is_null() {
        GlobalFree(handle);
        return Err("锁定剪贴板内存失败".to_string());
    }
    copy_nonoverlapping(bytes.as_ptr(), target as *mut u8, bytes.len());
    GlobalUnlock(handle);
    Ok(handle)
}

pub fn write(paths: &[String], mode: ClipMode) -> Result<(), String> {
    let hdrop = encoding::windows_hdrop(paths);
    let effect = encoding::windows_preferred_drop_effect(mode);
    unsafe {
        if OpenClipboard(null_mut()) == 0 {
            return Err("打开剪贴板失败".to_string());
        }
        let result = set_formats(&hdrop, &effect);
        CloseClipboard();
        result
    }
}

unsafe fn set_formats(hdrop: &[u8], effect: &[u8]) -> Result<(), String> {
    if EmptyClipboard() == 0 {
        return Err("清空剪贴板失败".to_string());
    }
    let files = global_from_bytes(hdrop)?;
    if SetClipboardData(CF_HDROP, files).is_null() {
        GlobalFree(files);
        return Err("写入剪贴板文件失败".to_string());
    }
    let format = RegisterClipboardFormatW(wide("Preferred DropEffect").as_ptr());
    let drop_effect = global_from_bytes(effect)?;
    if SetClipboardData(format, drop_effect).is_null() {
        GlobalFree(drop_effect);
        return Err("写入剪贴板拖拽效果失败".to_string());
    }
    Ok(())
}

pub fn read() -> Vec<String> {
    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP) == 0 || OpenClipboard(null_mut()) == 0 {
            return Vec::new();
        }
        let handle = GetClipboardData(CF_HDROP);
        let mut paths = Vec::new();
        if !handle.is_null() {
            let drop = handle as HDROP;
            // Pass 0xFFFFFFFF to ask for the file count, then read each name one by one.
            let count = DragQueryFileW(drop, 0xFFFF_FFFF, null_mut(), 0);
            for index in 0..count {
                let length = DragQueryFileW(drop, index, null_mut(), 0);
                if length == 0 {
                    continue;
                }
                let mut buffer = vec![0u16; length as usize + 1];
                let written = DragQueryFileW(drop, index, buffer.as_mut_ptr(), length + 1);
                buffer.truncate(written as usize);
                if let Ok(path) = String::from_utf16(&buffer) {
                    paths.push(path);
                }
            }
        }
        CloseClipboard();
        paths
    }
}
