//! Terminal theme appearance persisted to `~/.vrykell/theme.json`.
//!
//! The frontend reads and writes through `get_theme_config` / `set_theme_config`; import and export use
//! `theme_import` / `theme_export` with paths chosen by the frontend file dialog.
//!
//! Shape:
//!   - `opacity`: application opacity (0.5..=1.0; 1 = fully opaque).
//!   - `backgroundImage`: absolute path to the terminal wallpaper (None means no image).
//!   - `vars`: CSS variable overrides (`--canvas`, `--xterm-bg`, etc.) for the terminal theme.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

/// Minimum application opacity (lower values make the content unreadable).
const MIN_OPACITY: f32 = 0.5;
/// Default application opacity (1 = fully opaque, no visual change).
const DEFAULT_OPACITY: f32 = 1.0;

pub struct ThemeState(pub Mutex<ThemeConfig>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    /// Independent built-in palette selections; absent values retain the original colors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dark_preset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light_preset: Option<String>,
    /// Blend desktop color into the outer navigation frame.
    #[serde(default = "default_desktop_tint")]
    pub desktop_tint: bool,
    /// Application opacity, 0.5..=1.0.
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    /// Absolute terminal wallpaper path; None means a solid background.
    #[serde(default)]
    pub background_image: Option<String>,
    /// CSS variable overrides for the theme appearance.
    #[serde(default)]
    pub vars: HashMap<String, String>,
}

fn default_opacity() -> f32 {
    DEFAULT_OPACITY
}

fn default_desktop_tint() -> bool {
    true
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            dark_preset: None,
            light_preset: None,
            desktop_tint: default_desktop_tint(),
            opacity: default_opacity(),
            background_image: None,
            vars: HashMap::new(),
        }
    }
}

impl ThemeConfig {
    /// Clamp invalid values (NaN, infinity or out-of-range opacity) so the frontend always gets a usable value.
    fn normalize(&mut self) {
        if !self.opacity.is_finite() || self.opacity < MIN_OPACITY {
            self.opacity = MIN_OPACITY;
        }
        if self.opacity > 1.0 {
            self.opacity = 1.0;
        }
    }
}

fn theme_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".vrykell")
        .join("theme.json")
}

impl ThemeState {
    /// Load from disk at startup and fall back to defaults when the file is missing or corrupt.
    pub fn load() -> Self {
        let mut cfg = std::fs::read_to_string(theme_path())
            .ok()
            .and_then(|s| serde_json::from_str::<ThemeConfig>(&s).ok())
            .unwrap_or_default();
        cfg.normalize();
        ThemeState(Mutex::new(cfg))
    }

    fn save(&self) {
        if let Ok(mut cfg) = self.0.lock() {
            cfg.normalize();
            if let Some(dir) = theme_path().parent() {
                let _ = std::fs::create_dir_all(dir);
                #[cfg(unix)]
                {
                    let _ = std::fs::set_permissions(dir, std::os::unix::fs::PermissionsExt::from_mode(0o700));
                }
            }
            if let Ok(s) = serde_json::to_string_pretty(&*cfg) {
                let _ = std::fs::write(theme_path(), s);
            }
        }
    }
}

/// Add a wallpaper file to the asset-protocol scope; the base scope is $APPDATA while wallpapers may live anywhere.
/// Only a wallpaper path explicitly set by the user is granted; the WebView cannot read arbitrary home files.
fn authorize_wallpaper(app: &tauri::AppHandle, path: Option<&str>) {
    if let Some(p) = path {
        if !p.trim().is_empty() {
            let _ = app.asset_protocol_scope().allow_file(p.trim());
        }
    }
}

#[tauri::command]
pub fn get_theme_config(state: State<'_, ThemeState>) -> ThemeConfig {
    state
        .0
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default()
}

/// Absolute theme-config path for the UI to display or open.
#[tauri::command]
pub fn get_theme_path() -> String {
    theme_path().to_string_lossy().to_string()
}

#[tauri::command]
pub fn set_theme_config(
    app: tauri::AppHandle,
    state: State<'_, ThemeState>,
    mut config: ThemeConfig,
) -> ThemeConfig {
    config.normalize();
    authorize_wallpaper(&app, config.background_image.as_deref());
    if let Ok(mut c) = state.0.lock() {
        *c = config.clone();
    }
    state.save();
    config
}

/// Export the current theme to a JSON path.
#[tauri::command]
pub fn theme_export(state: State<'_, ThemeState>, path: String) -> Result<(), String> {
    let mut cfg = state.0.lock().map(|c| c.clone()).unwrap_or_default();
    cfg.normalize();
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| format!("Failed to serialize the theme: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Failed to write the file: {e}"))
}

/// Import a theme from a JSON path, save it and return the new config.
#[tauri::command]
pub fn theme_import(
    app: tauri::AppHandle,
    state: State<'_, ThemeState>,
    path: String,
) -> Result<ThemeConfig, String> {
    let s = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read the file: {e}"))?;
    let mut cfg: ThemeConfig =
        serde_json::from_str(&s).map_err(|e| format!("Failed to parse the theme (not valid theme JSON): {e}"))?;
    cfg.normalize();
    authorize_wallpaper(&app, cfg.background_image.as_deref());
    if let Ok(mut c) = state.0.lock() {
        *c = cfg.clone();
    }
    state.save();
    Ok(cfg)
}

/// Read a local image as a data URL; the Tauri webview cannot load local paths directly through CSS url().
/// Synchronous implementation, run inside spawn_blocking.
fn read_image_data_url_sync(path: String) -> Result<String, String> {
    use base64::Engine;
    const MAX_BYTES: u64 = 20 * 1024 * 1024; // 20 MB limit
    let meta = std::fs::metadata(&path).map_err(|e| format!("Failed to read the image: {e}"))?;
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "The image exceeds the 20 MB limit ({} MB)",
            meta.len() / 1024 / 1024
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read the image: {e}"))?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    let mime = match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        _ => "image/png",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

#[tauri::command]
pub async fn read_image_data_url(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_image_data_url_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_clamps_opacity() {
        let mut cfg = ThemeConfig {
            desktop_tint: true,
            opacity: 1.5,
            background_image: None,
            vars: HashMap::new(),
            ..ThemeConfig::default()
        };
        cfg.normalize();
        assert_eq!(cfg.opacity, 1.0);

        cfg.opacity = -0.2;
        cfg.normalize();
        assert_eq!(cfg.opacity, MIN_OPACITY);

        cfg.opacity = f32::NAN;
        cfg.normalize();
        assert_eq!(cfg.opacity, MIN_OPACITY);

        // Positive values below the floor are raised too: the UI must stay readable.
        cfg.opacity = 0.3;
        cfg.normalize();
        assert_eq!(cfg.opacity, MIN_OPACITY);

        cfg.opacity = 0.5;
        cfg.normalize();
        assert_eq!(cfg.opacity, 0.5);
    }

    #[test]
    fn theme_json_roundtrip_camel_case() {
        let cfg = ThemeConfig {
            desktop_tint: false,
            opacity: 0.8,
            background_image: Some("/tmp/bg.png".to_string()),
            vars: HashMap::from([("--canvas".to_string(), "#101010".to_string())]),
            dark_preset: Some("nord-dark".to_string()),
            light_preset: Some("nord-light".to_string()),
        };
        let s = serde_json::to_string(&cfg).unwrap();
        // camelCase serialization: backgroundImage
        assert!(s.contains("\"backgroundImage\":\"/tmp/bg.png\""));
        let back: ThemeConfig = serde_json::from_str(&s).unwrap();
        assert!(!back.desktop_tint);
        assert_eq!(back.dark_preset.as_deref(), Some("nord-dark"));
        assert_eq!(back.light_preset.as_deref(), Some("nord-light"));
        assert_eq!(back.background_image.as_deref(), Some("/tmp/bg.png"));
        assert_eq!(back.vars.get("--canvas").map(String::as_str), Some("#101010"));
    }

    #[test]
    fn older_themes_enable_desktop_color_by_default() {
        let cfg: ThemeConfig = serde_json::from_str(r#"{"opacity":1.0,"vars":{}}"#).unwrap();
        assert!(cfg.desktop_tint);
    }

    #[test]
    fn read_image_data_url_encodes_png_bytes() {
        let dir = std::env::temp_dir();
        let path = dir.join("vrykell_test_bg.png");
        std::fs::write(&path, b"fakeimage").unwrap();
        let url = read_image_data_url_sync(path.to_string_lossy().to_string()).unwrap();
        // Base64 for "fakeimage".
        assert_eq!(url, "data:image/png;base64,ZmFrZWltYWdl");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_image_data_url_detects_mime_from_extension() {
        let dir = std::env::temp_dir();
        for (name, mime) in [
            ("vrykell_test_bg.jpeg", "image/jpeg"),
            ("vrykell_test_bg.JPG", "image/jpeg"),
            ("vrykell_test_bg.avif", "image/avif"),
        ] {
            let path = dir.join(name);
            std::fs::write(&path, b"x").unwrap();
            let url = read_image_data_url_sync(path.to_string_lossy().to_string()).unwrap();
            assert!(url.starts_with(&format!("data:{mime};base64,")), "{name}: {url}");
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    fn read_image_data_url_rejects_missing_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("vrykell_test_bg_missing.png");
        assert!(read_image_data_url_sync(path.to_string_lossy().to_string()).is_err());
    }
}
