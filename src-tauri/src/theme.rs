//! 终端主题外观配置 —— 持久化到 `~/.vrykell/theme.json`。
//!
//! 前端通过 `get_theme_config` / `set_theme_config` 读写；主题导入导出走
//! `theme_import` / `theme_export`（由前端 file dialog 提供路径）。
//!
//! 结构：
//!   - `opacity`：终端背景不透明度（0.05..=1.0，1 = 完全不透明）。
//!   - `backgroundImage`：终端背景图片绝对路径（None = 无图片）。
//!   - `vars`：CSS 变量覆盖表（`--canvas` / `--xterm-bg` 等），用于调整终端主题外观。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

/// 终端背景最小不透明度（再低文字几乎不可读）。
const MIN_OPACITY: f32 = 0.05;
/// 默认不透明度（1 = 完全不透明，无视觉变化）。
const DEFAULT_OPACITY: f32 = 1.0;

pub struct ThemeState(pub Mutex<ThemeConfig>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    /// 终端背景不透明度 0.05..=1.0。
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    /// 终端背景图片绝对路径；None = 纯色背景。
    #[serde(default)]
    pub background_image: Option<String>,
    /// CSS 变量覆盖表（主题外观）。
    #[serde(default)]
    pub vars: HashMap<String, String>,
}

fn default_opacity() -> f32 {
    DEFAULT_OPACITY
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            opacity: default_opacity(),
            background_image: None,
            vars: HashMap::new(),
        }
    }
}

impl ThemeConfig {
    /// 夹紧非法值（NaN/Inf/越界不透明度），保证前端拿到的值始终可用。
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
    /// 启动时从磁盘加载（文件缺失/损坏时回退默认）。
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

/// 把壁纸文件加入 asset 协议访问范围（scope 已收窄到 $APPDATA，壁纸可能在任何目录）。
/// 只有用户明确设置过的壁纸路径才会被授权，WebView 无法读取任意家目录文件。
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

/// 主题配置文件绝对路径（供 UI 展示 / 打开）。
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

/// 导出当前主题到指定 JSON 文件路径。
#[tauri::command]
pub fn theme_export(state: State<'_, ThemeState>, path: String) -> Result<(), String> {
    let mut cfg = state.0.lock().map(|c| c.clone()).unwrap_or_default();
    cfg.normalize();
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| format!("序列化主题失败：{e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("写入文件失败：{e}"))
}

/// 从指定 JSON 文件导入主题并保存、返回新配置。
#[tauri::command]
pub fn theme_import(
    app: tauri::AppHandle,
    state: State<'_, ThemeState>,
    path: String,
) -> Result<ThemeConfig, String> {
    let s = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败：{e}"))?;
    let mut cfg: ThemeConfig =
        serde_json::from_str(&s).map_err(|e| format!("解析主题失败（不是有效的主题 JSON）：{e}"))?;
    cfg.normalize();
    authorize_wallpaper(&app, cfg.background_image.as_deref());
    if let Ok(mut c) = state.0.lock() {
        *c = cfg.clone();
    }
    state.save();
    Ok(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_clamps_opacity() {
        let mut cfg = ThemeConfig {
            opacity: 1.5,
            background_image: None,
            vars: HashMap::new(),
        };
        cfg.normalize();
        assert_eq!(cfg.opacity, 1.0);

        cfg.opacity = -0.2;
        cfg.normalize();
        assert_eq!(cfg.opacity, MIN_OPACITY);

        cfg.opacity = f32::NAN;
        cfg.normalize();
        assert_eq!(cfg.opacity, MIN_OPACITY);

        cfg.opacity = 0.5;
        cfg.normalize();
        assert_eq!(cfg.opacity, 0.5);
    }

    #[test]
    fn theme_json_roundtrip_camel_case() {
        let cfg = ThemeConfig {
            opacity: 0.8,
            background_image: Some("/tmp/bg.png".to_string()),
            vars: HashMap::from([("--canvas".to_string(), "#101010".to_string())]),
        };
        let s = serde_json::to_string(&cfg).unwrap();
        // camelCase 序列化：backgroundImage
        assert!(s.contains("\"backgroundImage\":\"/tmp/bg.png\""));
        let back: ThemeConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(back.background_image.as_deref(), Some("/tmp/bg.png"));
        assert_eq!(back.vars.get("--canvas").map(String::as_str), Some("#101010"));
    }
}
