use std::ffi::c_void;

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        window: *mut c_void,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> i32;
}

/// Suppress the native compositor stroke while preserving rounded window corners.
pub fn hide_border(window: &tauri::WebviewWindow) {
    let Ok(handle) = window.hwnd() else { return };
    const BORDER_COLOR: u32 = 34;
    const COLOR_NONE: u32 = 0xfffffffe;
    // The value is a four-byte color sentinel and remains alive for the synchronous call.
    let result = unsafe {
        DwmSetWindowAttribute(
            handle.0 as *mut c_void,
            BORDER_COLOR,
            (&COLOR_NONE as *const u32).cast(),
            4,
        )
    };
    crate::diagnostics::record(
        "window-border-configured",
        serde_json::json!({ "success": result >= 0, "result": result }),
    )
    .ok();
}
