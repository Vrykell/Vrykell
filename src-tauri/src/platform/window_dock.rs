use std::{
    collections::BTreeMap,
    ffi::c_void,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    time::Duration,
};
use winapi::um::{processthreadsapi::GetCurrentProcessId, winuser::GetWindowThreadProcessId};

static NEXT_DOCK: AtomicU32 = AtomicU32::new(1);
static SETTLING: Mutex<BTreeMap<u32, SourceDock>> = Mutex::new(BTreeMap::new());

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        window: *mut c_void,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> i32;
    fn DwmGetWindowAttribute(
        window: *mut c_void,
        attribute: u32,
        value: *mut c_void,
        size: u32,
    ) -> i32;
}

pub(super) fn is_cloaked(handle: usize) -> bool {
    let mut value = 0u32;
    let status =
        unsafe { DwmGetWindowAttribute(handle as _, 14, (&mut value as *mut u32).cast(), 4) };
    status >= 0 && value != 0
}

pub(super) struct SourceDock {
    label: String,
    handle: usize,
    occluded: bool,
}

impl SourceDock {
    pub(super) fn new(label: &str, handle: usize) -> Self {
        Self {
            label: label.to_owned(),
            handle,
            occluded: false,
        }
    }

    pub(super) fn set_occluded(&mut self, occluded: bool) {
        if self.occluded == occluded {
            return;
        }
        let mut process = 0;
        if unsafe {
            GetWindowThreadProcessId(self.handle as _, &mut process) == 0
                || process != GetCurrentProcessId()
        } {
            return;
        }
        // Compositor visibility preserves the native move loop.
        let value = i32::from(occluded);
        if unsafe { DwmSetWindowAttribute(self.handle as _, 13, (&value as *const i32).cast(), 4) }
            >= 0
        {
            self.occluded = occluded;
        }
    }

    pub(super) fn retain_until_settled(self) -> Option<u32> {
        if !self.occluded {
            return None;
        }
        let id = NEXT_DOCK.fetch_add(1, Ordering::Relaxed);
        SETTLING.lock().ok()?.insert(id, self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(30)).await;
            release(id, |_| true);
        });
        Some(id)
    }
}

impl Drop for SourceDock {
    fn drop(&mut self) {
        self.set_occluded(false);
    }
}

fn release(id: u32, permitted: impl FnOnce(&SourceDock) -> bool) {
    let Ok(mut pending) = SETTLING.lock() else {
        return;
    };
    if pending.get(&id).is_some_and(permitted) {
        let source = pending.remove(&id);
        drop(pending);
        drop(source);
    }
}

pub(super) fn restore(label: &str, id: u32) {
    release(id, |source| source.label == label);
}

#[cfg(test)]
mod tests {
    use super::{is_cloaked, restore, SourceDock};
    use std::ptr::{null, null_mut};
    use winapi::{
        shared::windef::HWND,
        um::{libloaderapi::GetModuleHandleW, winuser::*},
    };

    #[test]
    #[ignore = "requires an interactive desktop"]
    fn native_window_stays_movable_and_restores_on_cancel_or_settlement() {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let window = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                class.as_ptr(),
                null(),
                WS_POPUP | WS_VISIBLE,
                60,
                60,
                30,
                30,
                null_mut(),
                null_mut(),
                GetModuleHandleW(null()),
                null_mut(),
            )
        };
        assert!(!window.is_null());
        struct TestWindow(HWND);
        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }
        let _window = TestWindow(window);
        let handle = window as usize;
        let mut source = SourceDock::new("main", handle);
        // Leaving a receiving strip must restore the same movable window on every visit.
        for (offset, over_strip) in [false, true, true, false, true, false, true, false].into_iter().enumerate() {
            source.set_occluded(over_strip);
            assert_eq!(is_cloaked(handle), over_strip);
            assert_ne!(unsafe { IsWindowVisible(window) }, 0);
            assert_ne!(
                unsafe {
                    SetWindowPos(
                        window,
                        null_mut(),
                        90 + offset as i32,
                        90,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                    )
                },
                0
            );
        }
        source.set_occluded(true);
        let token = source.retain_until_settled().expect("pending dock");
        restore("app-other", token);
        assert!(is_cloaked(handle));
        restore("main", token);
        assert!(!is_cloaked(handle));
    }
}
