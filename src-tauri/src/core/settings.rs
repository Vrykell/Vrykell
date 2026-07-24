use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Mirrors shared/types.ts AppSettings (minimal Phase 1 subset).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub terminal: TerminalSettings,
    pub appearance: AppearanceSettings,
    pub rich_content: RichContentSettings,
    pub ai: AISettings,
    pub ssh: SSHSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    pub font_size: u32,
    pub font_family: String,
    pub cursor_style: String,
    pub cursor_blink: bool,
    pub scrollback: u32,
    pub bell_sound: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
    pub opacity: f64,
    pub blur: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RichContentSettings {
    pub enable_latex: bool,
    pub enable_markdown: bool,
    pub enable_code_highlight: bool,
    pub enable_auto_detect: bool,
    pub max_decorations: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AISettings {
    pub api_key: String,
    pub model: String,
    pub max_context_lines: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SSHSettings {
    pub saved_connections: Vec<serde_json::Value>,
    pub default_username: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            terminal: TerminalSettings {
                font_size: 14,
                font_family: "Menlo, 'DejaVu Sans Mono', 'Courier New', monospace".into(),
                cursor_style: "block".into(),
                cursor_blink: true,
                scrollback: 10000,
                bell_sound: false,
            },
            appearance: AppearanceSettings {
                theme: "dark".into(),
                opacity: 1.0,
                blur: false,
            },
            rich_content: RichContentSettings {
                enable_latex: true,
                enable_markdown: true,
                enable_code_highlight: true,
                enable_auto_detect: true,
                max_decorations: 200,
            },
            ai: AISettings {
                api_key: "".into(),
                model: "claude-sonnet-5-20251001".into(),
                max_context_lines: 200,
            },
            ssh: SSHSettings {
                saved_connections: vec![],
                default_username: "".into(),
            },
        }
    }
}

pub struct SettingsManager {
    path: PathBuf,
}

impl SettingsManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join("settings.json"),
        }
    }

    pub fn load(&self) -> Result<AppSettings, String> {
        if !self.path.exists() {
            return Ok(AppSettings::default());
        }
        let text = fs::read_to_string(&self.path).map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse settings: {}", e))
    }

    pub fn save(&self, settings: &AppSettings) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create settings dir: {}", e))?;
        }
        let text = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        fs::write(&self.path, text).map_err(|e| format!("Failed to write settings: {}", e))
    }
}
