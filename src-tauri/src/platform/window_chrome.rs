//! Window frame chrome for the native compositor.
//!
//! The desktop window is undecorated and transparent: the application paints its own surface,
//! and anything it leaves translucent shows the desktop (wallpapers, shader effects). Keeping
//! the native frame for the compositor drop shadow would inset the client area by one pixel,
//! and on a transparent window that pixel ring and the frame's rounded corner areas have no
//! surface to draw on, so the desktop leaks through around the frame. The window therefore
//! runs without the native frame (`shadow: false`): the webview covers the whole window and
//! its content is clipped by the rounded corners the window explicitly asks for.
//!
//! The border the compositor paints along the window edge uses the shared neutral gray border
//! through [`apply_window_frame`]; the frontend resolves that color from the theme. The
//! `DWMWA_COLOR_NONE` sentinel is not used: some Windows builds render it as a dark fallback
//! line instead of removing the border.

#[cfg(windows)]
use std::ffi::c_void;

#[cfg(windows)]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        window: *mut c_void,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> i32;
}

/// Parse `#rgb`, `#rrggbb`, `rgb(r, g, b)` or `rgba(r, g, b, a)` into a `0x00BBGGRR`
/// color value. Unsupported input is rejected so the caller keeps the previous color.
fn parse_border_color(value: &str) -> Option<u32> {
    let text = value.trim();
    let (r, g, b) = if let Some(hex) = text.strip_prefix('#') {
        // Only ASCII hex digits keep the byte slices on character boundaries.
        if !hex.is_ascii() {
            return None;
        }
        let expanded: String = match hex.len() {
            3 => hex.chars().flat_map(|c| [c, c]).collect(),
            6 => hex.to_string(),
            _ => return None,
        };
        (
            u8::from_str_radix(&expanded[0..2], 16).ok()?,
            u8::from_str_radix(&expanded[2..4], 16).ok()?,
            u8::from_str_radix(&expanded[4..6], 16).ok()?,
        )
    } else {
        let (name, rest) = text.split_once('(')?;
        if !matches!(name.trim(), "rgb" | "rgba") {
            return None;
        }
        let inner = rest.strip_suffix(')')?;
        let mut parts = inner.split(',').map(str::trim);
        let channel = |part: Option<&str>| part?.parse::<u8>().ok();
        (
            channel(parts.next())?,
            channel(parts.next())?,
            channel(parts.next())?,
        )
    };
    Some(u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16))
}

#[cfg(windows)]
fn apply_frame(window: &tauri::WebviewWindow, color: u32) -> Result<(), String> {
    let handle = window.hwnd().map_err(|error| error.to_string())?;
    const BORDER_COLOR: u32 = 34;
    const WINDOW_CORNER_PREFERENCE: u32 = 33;
    const CORNER_ROUND: u32 = 2;
    // The values are four-byte sentinels and stay alive for the synchronous calls.
    let border = unsafe {
        DwmSetWindowAttribute(
            handle.0 as *mut c_void,
            BORDER_COLOR,
            (&color as *const u32).cast(),
            4,
        )
    };
    // The window content covers the whole window (see the module docs), which costs the
    // automatic corner rounding of an undecorated window, so it is requested explicitly.
    let corners = unsafe {
        DwmSetWindowAttribute(
            handle.0 as *mut c_void,
            WINDOW_CORNER_PREFERENCE,
            (&CORNER_ROUND as *const u32).cast(),
            4,
        )
    };
    crate::diagnostics::record(
        "window-frame-configured",
        serde_json::json!({
            "windowLabel": window.label(),
            "color": color,
            "borderResult": border,
            "cornerResult": corners,
        }),
    )
    .ok();
    if border >= 0 && corners >= 0 {
        Ok(())
    } else {
        Err(format!(
            "window frame update failed: border {border}, corners {corners}"
        ))
    }
}

#[cfg(not(windows))]
fn apply_frame(_window: &tauri::WebviewWindow, _color: u32) -> Result<(), String> {
    Ok(())
}

/// Paint the native window border in the given CSS color and round the window corners.
#[tauri::command]
pub fn apply_window_frame(window: tauri::WebviewWindow, color: String) -> Result<(), String> {
    let Some(value) = parse_border_color(&color) else {
        return Err(format!("unsupported window border color: {color}"));
    };
    apply_frame(&window, value)
}

#[cfg(test)]
mod tests {
    use super::parse_border_color;

    #[test]
    fn parses_hex_and_functional_colors_into_colorref() {
        assert_eq!(parse_border_color("#303030"), Some(0x00303030));
        assert_eq!(parse_border_color(" #F5F5F5 "), Some(0x00F5F5F5));
        assert_eq!(parse_border_color("#abc"), Some(0x00CCBBAA));
        assert_eq!(parse_border_color("rgb(48, 48, 48)"), Some(0x00303030));
        assert_eq!(parse_border_color("rgba(255, 128, 0, 0.5)"), Some(0x000080FF));
    }

    #[test]
    fn keeps_the_previous_color_for_unsupported_input() {
        for value in ["", "transparent", "none", "#12345", "#xyzxyz", "#一", "rgb(48, 48)", "hsl(0, 0%, 50%)", "rgb(300, 0, 0)"] {
            assert_eq!(parse_border_color(value), None, "{value} must be rejected");
        }
    }
}
