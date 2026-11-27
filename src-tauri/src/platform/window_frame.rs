//! Native window perimeter and pointer tracking for workspace tab moves.

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::ipc::Channel;

#[cfg(windows)]
#[path = "window_dock.rs"]
mod dock;

#[derive(Clone, PartialEq, serde::Serialize)]
pub struct DragPoint {
    x: f64,
    y: f64,
    // On platforms with native stacking information this contains the
    // workspace directly under the pointer, excluding the moving window.
    #[serde(skip_serializing_if = "Option::is_none")]
    over: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client: Option<DragClientPoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dock: Option<u32>,
}

#[derive(Clone, PartialEq, serde::Serialize)]
struct DragClientPoint { x: f64, y: f64 }

fn workspace_label(label: &str) -> bool {
    label == "main" || label.strip_prefix("app-").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.len() <= 64
            && suffix.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    })
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
static TRACKING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn restore_workspace_dock(window: tauri::WebviewWindow, dock: u32) {
    #[cfg(windows)]
    if workspace_label(window.label()) { dock::restore(window.label(), dock); }
    #[cfg(not(windows))]
    let _ = (window, dock);
}


#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
fn pressed_escape_during_drag(armed: &mut bool, held: bool) -> bool {
    if !held {
        *armed = true;
    }
    held && *armed
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
fn track_pointer(
    sender: Channel<DragPoint>,
    mut sample: impl FnMut() -> Option<(DragPoint, bool, bool)>,
) -> Option<DragPoint> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let mut previous = None;
    let mut escape_armed = false;
    while std::time::Instant::now() < deadline {
        let (point, pressed, escape_held) = sample()?;
        if pressed_escape_during_drag(&mut escape_armed, escape_held) {
            return None;
        }
        if !pressed {
            return Some(point);
        }
        if previous.as_ref() != Some(&point) {
            if sender.send(point.clone()).is_err() { return None; }
            previous = Some(point);
        }
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
    None
}

#[cfg(all(test, any(windows, target_os = "macos", target_os = "linux")))]
mod drag_tests {
    use super::pressed_escape_during_drag;

    #[test]
    fn a_key_held_before_start_does_not_cancel_the_drag() {
        let mut armed = false;
        assert!(!pressed_escape_during_drag(&mut armed, true));
        assert!(!pressed_escape_during_drag(&mut armed, true));
        assert!(!pressed_escape_during_drag(&mut armed, false));
        assert!(pressed_escape_during_drag(&mut armed, true));
    }
}

/// Native mouse sampling keeps the release location available outside the webview.
#[tauri::command]
pub async fn drag_workspace_window(
    window: tauri::WebviewWindow,
    move_window: bool,
    updates: Channel<DragPoint>,
    dockable: Option<bool>,
    excluded_window: Option<String>,
) -> Result<Option<DragPoint>, String> {
    if !workspace_label(window.label()) {
        return Err("Not a workspace window".into());
    }
    #[cfg(not(windows))]
    let _ = (dockable, &excluded_window);
    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    {
        struct Tracking;
        impl Drop for Tracking {
            fn drop(&mut self) { TRACKING.store(false, Ordering::Release); }
        }
        if TRACKING.swap(true, Ordering::AcqRel) { return Ok(None); }
        let tracking = Tracking;
        #[cfg(any(windows, target_os = "macos"))]
        let mut locate = pointer::locator(&window, move_window, dockable == Some(true), excluded_window.as_deref());
        #[cfg(windows)]
        let mut source_dock = if move_window && dockable == Some(true) {
            window.hwnd().ok().map(|handle| dock::SourceDock::new(window.label(), handle.0 as usize))
        } else { None };
        if move_window {
            window.start_dragging().map_err(|error| error.to_string())?;
        }
        return tauri::async_runtime::spawn_blocking(move || {
            let _tracking = tracking;
            #[cfg(target_os = "linux")]
            {
                let mut connection = pointer::Connection::open()?;
                track_pointer(updates, || connection.sample())
            }
            #[cfg(windows)]
            {
                let mut released = track_pointer(updates, || {
                    let point = locate()?;
                    let pressed = pointer::primary_pressed();
                    let escape = pointer::escape_pressed();
                    if let Some(source) = &mut source_dock {
                        source.set_occluded(point.client.is_some());
                    }
                    Some((point, pressed, escape))
                });
                if let (Some(point), Some(source)) = (released.as_mut(), source_dock) {
                    point.dock = source.retain_until_settled();
                }
                released
            }
            #[cfg(target_os = "macos")]
            track_pointer(updates, || Some((locate()?, pointer::primary_pressed(), pointer::escape_pressed())))
        }).await.map_err(|error| error.to_string());
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = updates;
        if move_window {
            window.start_dragging().map_err(|error| error.to_string())?;
        }
        Ok(None)
    }
}

#[cfg(target_os = "linux")]
mod pointer {
    use super::DragPoint;
    use libc::{c_char, c_int, c_uint, c_ulong, c_void};

    #[link(name = "X11")]
    extern "C" {
        fn XOpenDisplay(name: *const c_char) -> *mut c_void;
        fn XCloseDisplay(display: *mut c_void) -> c_int;
        fn XDefaultRootWindow(display: *mut c_void) -> c_ulong;
        fn XKeysymToKeycode(display: *mut c_void, keysym: c_ulong) -> u8;
        fn XQueryKeymap(display: *mut c_void, keys: *mut c_char) -> c_int;
        fn XQueryPointer(display: *mut c_void, window: c_ulong, root: *mut c_ulong, child: *mut c_ulong,
            x: *mut c_int, y: *mut c_int, local_x: *mut c_int, local_y: *mut c_int, mask: *mut c_uint) -> c_int;
    }

    pub struct Connection {
        display: *mut c_void,
        root: c_ulong,
        escape: usize,
    }

    impl Connection {
        pub fn open() -> Option<Self> {
            // A compositor that owns pointer capture keeps the native move and the
            // webview's captured events. Avoid querying a compatibility display there.
            if std::env::var_os("WAYLAND_DISPLAY").is_some()
                && std::env::var("GDK_BACKEND").as_deref() != Ok("x11") {
                return None;
            }
            let display = unsafe { XOpenDisplay(std::ptr::null()) };
            if display.is_null() { return None; }
            Some(Self {
                display,
                root: unsafe { XDefaultRootWindow(display) },
                escape: usize::from(unsafe { XKeysymToKeycode(display, 0xff1b) }),
            })
        }

        pub fn sample(&mut self) -> Option<(DragPoint, bool, bool)> {
            let (mut root, mut child, mut x, mut y, mut local_x, mut local_y, mut mask) = (0, 0, 0, 0, 0, 0, 0);
            let mut keys = [0 as c_char; 32];
            if unsafe { XQueryPointer(self.display, self.root, &mut root, &mut child, &mut x, &mut y, &mut local_x, &mut local_y, &mut mask) } == 0 {
                return None;
            }
            unsafe { XQueryKeymap(self.display, keys.as_mut_ptr()); }
            let escape = self.escape != 0 && (keys[self.escape / 8] as u8 & (1 << (self.escape % 8))) != 0;
            Some((DragPoint { x: f64::from(x), y: f64::from(y), over: None, client: None, dock: None }, (mask & (1 << 8)) != 0, escape))
        }
    }

    impl Drop for Connection {
        fn drop(&mut self) { unsafe { XCloseDisplay(self.display); } }
    }
}

#[cfg(windows)]
mod pointer {
    use super::{workspace_label, DragClientPoint, DragPoint};
    use tauri::Manager;
    use winapi::shared::windef::{HWND, POINT, RECT};
    use winapi::um::winuser::{
        GetAsyncKeyState, GetCursorPos, GetSystemMetrics, GetAncestor, GetClientRect, GetWindowRect,
        GetTopWindow, GetWindow, GetWindowLongW, IsIconic, IsWindowVisible,
        ScreenToClient, WindowFromPoint, GA_ROOT, GWL_EXSTYLE, GW_HWNDNEXT, WS_EX_TRANSPARENT,
        SM_SWAPBUTTON, VK_ESCAPE, VK_LBUTTON, VK_RBUTTON,
    };

    pub fn primary_pressed() -> bool {
        let key = unsafe { if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON } };
        unsafe { GetAsyncKeyState(key) < 0 }
    }

    pub fn escape_pressed() -> bool {
        unsafe { GetAsyncKeyState(VK_ESCAPE) < 0 }
    }

    fn strip_point(window: HWND, cursor: POINT, scale: f64) -> Option<DragClientPoint> {
        let mut local = cursor;
        unsafe {
            let mut bounds: RECT = std::mem::zeroed();
            if ScreenToClient(window, &mut local) == 0 || GetClientRect(window, &mut bounds) == 0
                || local.x < 0 || local.x >= bounds.right || local.y < 0 || f64::from(local.y) >= 38.0 * scale {
                return None;
            }
        }
        Some(DragClientPoint { x: f64::from(local.x) / scale, y: f64::from(local.y) / scale })
    }

    fn window_below_dragged_surface(surface: HWND, cursor: POINT) -> HWND {
        unsafe {
            let mut candidate = GetTopWindow(std::ptr::null_mut());
            while !candidate.is_null() {
                if candidate != surface && IsWindowVisible(candidate) != 0 && IsIconic(candidate) == 0
                    && (GetWindowLongW(candidate, GWL_EXSTYLE) as u32 & WS_EX_TRANSPARENT) == 0 {
                    let mut rect: RECT = std::mem::zeroed();
                    if GetWindowRect(candidate, &mut rect) != 0
                        && cursor.x >= rect.left && cursor.x < rect.right && cursor.y >= rect.top && cursor.y < rect.bottom
                        && !super::dock::is_cloaked(candidate as usize) { return candidate; }
                }
                candidate = GetWindow(candidate, GW_HWNDNEXT);
            }
            candidate
        }
    }

    pub fn locator(window: &tauri::WebviewWindow, moving_window: bool, dockable: bool, excluded_window: Option<&str>) -> impl FnMut() -> Option<DragPoint> + Send {
        let source = window.hwnd().ok().map(|handle| handle.0 as usize);
        let source_label = window.label().to_owned();
        let source_scale = window.scale_factor().ok().unwrap_or(1.0);
        let windows = window.app_handle().webview_windows();
        let excluded = excluded_window.filter(|label| label.starts_with("app-") && workspace_label(label))
            .and_then(|label| windows.get(label)).and_then(|window| window.hwnd().ok()).map(|handle| handle.0 as usize);
        let peers: Vec<_> = windows.into_iter()
            .filter(|(label, _)| (!moving_window || dockable) && label != window.label() && Some(label.as_str()) != excluded_window && workspace_label(label))
            .filter_map(|(label, window)| {
                let handle = window.hwnd().ok()?;
                let scale = window.scale_factor().ok().unwrap_or(1.0);
                Some((handle.0 as usize, label, scale))
            })
            .collect();
        move || {
            let mut cursor = POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut cursor) } == 0 { return None; }
            let hit = if moving_window && peers.is_empty() { None } else {
                let mut hovered = unsafe { GetAncestor(WindowFromPoint(cursor), GA_ROOT) };
                let ignores_pointer = unsafe { GetWindowLongW(hovered, GWL_EXSTYLE) as u32 & WS_EX_TRANSPARENT != 0 };
                if ignores_pointer || excluded == Some(hovered as usize) || moving_window && source == Some(hovered as usize) {
                    hovered = window_below_dragged_surface(hovered, cursor);
                }
                if !moving_window && source == Some(hovered as usize) {
                    strip_point(hovered, cursor, source_scale).map(|point| (source_label.clone(), point))
                } else {
                    peers.iter().find(|(handle, _, _)| *handle == hovered as usize)
                        .and_then(|(_, label, scale)| strip_point(hovered, cursor, *scale).map(|point| (label.clone(), point)))
                }
            };
            let (over, client) = hit.map(|(label, point)| (label, Some(point))).unwrap_or_default();
            Some(DragPoint { x: f64::from(cursor.x), y: f64::from(cursor.y), over: Some(over), client, dock: None })
        }
    }
}

#[cfg(target_os = "macos")]
mod pointer {
    use super::DragPoint;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
        fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
    }

    pub fn primary_pressed() -> bool {
        unsafe { CGEventSourceButtonState(0, 0) }
    }

    pub fn escape_pressed() -> bool {
        unsafe { CGEventSourceKeyState(0, 53) }
    }

    pub fn locator(window: &tauri::WebviewWindow, _moving_window: bool, _dockable: bool, _excluded_window: Option<&str>) -> impl FnMut() -> Option<DragPoint> + Send {
        let window = window.clone();
        move || window.cursor_position().ok().map(|point| DragPoint { x: point.x, y: point.y, over: None, client: None, dock: None })
    }
}

/// Let the compositor paint the active or inactive outline and native corners.
#[tauri::command]
pub fn apply_window_frame(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::c_void;
        #[link(name = "dwmapi")]
        extern "system" {
            fn DwmSetWindowAttribute(window: *mut c_void, attribute: u32, value: *const c_void, size: u32) -> i32;
        }
        let handle = window.hwnd().map_err(|error| error.to_string())?.0 as *mut c_void;
        const BORDER_COLOR: u32 = 34;
        const COLOR_DEFAULT: u32 = 0xffffffff;
        const CORNER_PREFERENCE: u32 = 33;
        const CORNER_ROUND: u32 = 2;
        let corners = unsafe {
            DwmSetWindowAttribute(handle, CORNER_PREFERENCE, (&CORNER_ROUND as *const u32).cast(), 4)
        };
        let border = unsafe {
            DwmSetWindowAttribute(handle, BORDER_COLOR, (&COLOR_DEFAULT as *const u32).cast(), 4)
        };
        if border < 0 || corners < 0 { return Err(format!("Native frame unavailable: {border}, {corners}")); }
    }
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}
