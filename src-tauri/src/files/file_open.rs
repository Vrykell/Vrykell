//! file_open — file open policy for the file panel (originally implemented in src/lib/fileOpen.ts).
//!
//! Pure policy (shell quoting / extension / template resolution / command construction /
//! editor availability fallback) lives in Rust; the frontend keeps only localStorage config
//! reads/writes, openPath (system default app) and ptyWrite (writing the command into the
//! terminal) as side effects. This keeps the injectable availability check and the fallback
//! chain from needing multiple IPC round trips.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Template sentinel: open with the system default application
const SYSTEM_DEFAULT: &str = "__system__";

/// Fallback chain when no editor is available (configured editor first, system default app last)
const FALLBACK_EDITORS: [&str; 3] = ["vim", "nano", "vi"];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOpenConfig {
    pub default_editor: String,
    pub templates: HashMap<String, String>,
    #[serde(default)]
    pub shell: Option<String>,
}

/// Result of the file_open command: terminal carries the final command line, system means the
/// system default application.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "via", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FileOpenResult {
    Terminal {
        editor: String,
        command: String,
        fell_back: bool,
    },
    System {
        degraded: bool,
    },
}

// ── Command construction ──

/// POSIX shell single-quote quoting
fn shell_quote(p: &str) -> String {
    format!("'{}'", p.replace('\'', "'\\''"))
}

/// Lowercase extension (empty when there is no dot or for dot-prefixed hidden files)
fn ext_of(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or("");
    match base.rfind('.') {
        Some(dot) if dot > 0 => base[dot + 1..].to_lowercase(),
        _ => String::new(),
    }
}

enum Target {
    System,
    Command(String),
}

/// Resolve the open method by extension
fn resolve_target(path: &str, cfg: &FileOpenConfig) -> Target {
    let tpl = cfg
        .templates
        .get(&ext_of(path))
        .cloned()
        .unwrap_or_else(|| cfg.default_editor.clone());
    if tpl == SYSTEM_DEFAULT {
        Target::System
    } else {
        Target::Command(tpl)
    }
}

/// Template → full command line (substitute {file} when present, otherwise append the quoted path)
fn build_command(template: &str, path: &str, shell: Option<&str>) -> Result<String, String> {
    if path.chars().any(char::is_control) {
        return Err("Files with control characters cannot be opened in a terminal.".into());
    }
    let quoted = match shell {
        Some("cmd") => {
            if path.contains(['"', '%', '!']) {
                return Err("This path cannot be represented safely in the selected shell.".into());
            }
            format!("\"{path}\"")
        }
        Some("powershell" | "pwsh") => format!("'{}'", path.replace('\'', "''")),
        _ => shell_quote(path),
    };
    if template.contains("{file}") {
        Ok(template.replace("{file}", &quoted))
    } else {
        Ok(format!("{} {}", template, quoted))
    }
}

/// Primary command name of the template (first token), used for availability detection
fn template_bin(template: &str) -> String {
    template
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string()
}

// ── Availability detection and fallback ──

/// Pick the first available editor; returns None when none is available. check is injectable
/// for tests.
fn pick_editor<F>(preferred: &str, check: F) -> Result<Option<String>, String>
where
    F: Fn(&str) -> Result<bool, String>,
{
    let mut seen = HashSet::new();
    let mut candidates: Vec<String> = Vec::new();
    for c in std::iter::once(preferred.to_string())
        .chain(FALLBACK_EDITORS.iter().map(|s| s.to_string()))
    {
        if !c.is_empty() && seen.insert(c.clone()) {
            candidates.push(c);
        }
    }
    for c in candidates {
        if check(&c)? {
            return Ok(Some(c));
        }
    }
    Ok(None)
}

/// Core file open policy (synchronous; the command layer wraps it in spawn_blocking).
fn file_open_sync<F>(
    path: &str,
    cfg: &FileOpenConfig,
    check: F,
) -> Result<FileOpenResult, String>
where
    F: Fn(&str) -> Result<bool, String>,
{
    match resolve_target(path, cfg) {
        Target::System => Ok(FileOpenResult::System { degraded: false }),
        Target::Command(template) => {
            let bin = template_bin(&template);
            // Template binary available → run as-is (keep arguments/placeholders)
            if !bin.is_empty() && check(&bin)? {
                return Ok(FileOpenResult::Terminal {
                    editor: bin,
                    command: build_command(&template, path, cfg.shell.as_deref())?,
                    fell_back: false,
                });
            }
            // Unavailable → fallback chain (configured editor → vim → nano → vi)
            let preferred = if bin.is_empty() {
                cfg.default_editor.clone()
            } else {
                bin.clone()
            };
            match pick_editor(&preferred, &check)? {
                Some(editor) => Ok(FileOpenResult::Terminal {
                    command: build_command(&editor, path, cfg.shell.as_deref())?,
                    editor: editor.clone(),
                    fell_back: editor != bin,
                }),
                None => Ok(FileOpenResult::System { degraded: true }),
            }
        }
    }
}

#[tauri::command]
pub async fn file_open(path: String, cfg: FileOpenConfig) -> Result<FileOpenResult, String> {
    // which_cmd_sync spawns a login shell to resolve PATH and blocks; run it on the blocking
    // pool so the event loop stays responsive.
    tauri::async_runtime::spawn_blocking(move || {
        file_open_sync(&path, &cfg, |c| crate::files::fs::which_cmd_sync(c.to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open a file with the system "open with" dialog: Windows shows the OpenAs_RunDLL picker,
/// macOS reveals the file in Finder (right-click to choose an app), Linux falls back to the
/// default application. Fire and forget; does not wait for the user's choice (returns right
/// after spawning).
#[tauri::command]
pub fn file_open_with(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux has no unified "open with" dialog; fall back to the default application
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_use_the_selected_shell_and_refuse_terminal_controls() {
        assert_eq!(build_command("vim", "C:/it's $HOME.txt", Some("pwsh")).unwrap(), "vim 'C:/it''s $HOME.txt'");
        assert_eq!(build_command("vim", "D:/a b.txt", Some("cmd")).unwrap(), "vim \"D:/a b.txt\"");
        assert!(build_command("vim", "D:/%HOME%.txt", Some("cmd")).is_err());
        for control in ['\u{15}', '\r', '\n', '\u{1b}', '\u{7f}', '\u{9b}'] {
            let path = format!("/tmp/a{control}echo unsafe");
            assert!(build_command("vim", &path, None).is_err());
        }
        let result = FileOpenResult::Terminal { editor: "vim".into(), command: "vim x".into(), fell_back: true };
        assert_eq!(serde_json::to_value(result).unwrap()["fellBack"], true);
    }

    fn cfg_with(default_editor: &str, templates: &[(&str, &str)]) -> FileOpenConfig {
        FileOpenConfig {
            default_editor: default_editor.to_string(),
            shell: None,
            templates: templates
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    fn check<'a>(available: &'a [&'a str]) -> impl Fn(&str) -> Result<bool, String> + 'a {
        move |c| Ok(available.contains(&c))
    }

    fn all() -> impl Fn(&str) -> Result<bool, String> {
        |_| Ok(true)
    }

    fn none() -> impl Fn(&str) -> Result<bool, String> {
        |_| Ok(false)
    }

    #[test]
    fn shell_quote_wraps_and_escapes() {
        assert_eq!(shell_quote("/tmp/a.txt"), "'/tmp/a.txt'");
        assert_eq!(shell_quote("/tmp/my file.txt"), "'/tmp/my file.txt'");
        assert_eq!(shell_quote("/tmp/it's.txt"), "'/tmp/it'\\''s.txt'");
    }

    #[test]
    fn ext_of_lowercases_and_skips_dotfiles() {
        assert_eq!(ext_of("/a/b/Readme.MD"), "md");
        assert_eq!(ext_of("/a/Makefile"), "");
        assert_eq!(ext_of("/a/.zshrc"), "");
    }

    #[test]
    fn resolve_target_hits_template_defaults_and_system() {
        let cfg = cfg_with("vim", &[("md", "code")]);
        assert!(matches!(
            resolve_target("/a/x.md", &cfg),
            Target::Command(c) if c == "code"
        ));
        assert!(matches!(
            resolve_target("/a/x.rs", &cfg),
            Target::Command(c) if c == "vim"
        ));
        let sys = cfg_with("vim", &[("png", SYSTEM_DEFAULT)]);
        assert!(matches!(resolve_target("/a/x.png", &sys), Target::System));
    }

    #[test]
    fn build_command_appends_or_substitutes() {
        assert_eq!(build_command("vim", "/tmp/a b.txt", None).unwrap(), "vim '/tmp/a b.txt'");
        assert_eq!(
            build_command("code --reuse-window {file}", "/tmp/a.txt", None).unwrap(),
            "code --reuse-window '/tmp/a.txt'"
        );
    }

    #[test]
    fn pick_editor_prefers_first_available() {
        assert_eq!(pick_editor("vim", check(&["vim", "nano"])).unwrap(), Some("vim".into()));
        assert_eq!(pick_editor("vim", check(&["nano"])).unwrap(), Some("nano".into()));
        assert_eq!(pick_editor("code", check(&["vim"])).unwrap(), Some("vim".into()));
        assert_eq!(pick_editor("vim", check(&[])).unwrap(), None);
    }

    #[test]
    fn file_open_uses_available_bin_verbatim() {
        let cfg = cfg_with("vim", &[]);
        let r = file_open_sync("/tmp/a.md", &cfg, all()).unwrap();
        assert_eq!(
            r,
            FileOpenResult::Terminal {
                editor: "vim".into(),
                command: "vim '/tmp/a.md'".into(),
                fell_back: false,
            }
        );
    }

    #[test]
    fn file_open_preserves_placeholder_params() {
        let cfg = cfg_with("vim", &[("md", "code --goto {file}:1")]);
        let r = file_open_sync("/tmp/a.md", &cfg, all()).unwrap();
        assert_eq!(
            r,
            FileOpenResult::Terminal {
                editor: "code".into(),
                command: "code --goto '/tmp/a.md':1".into(),
                fell_back: false,
            }
        );
    }

    #[test]
    fn default_command_supports_parameters_and_file_placeholders() {
        let cfg = cfg_with("edit --wait {file}", &[]);
        assert_eq!(
            file_open_sync("/tmp/a b.txt", &cfg, all()).unwrap(),
            FileOpenResult::Terminal {
                editor: "edit".into(),
                command: "edit --wait '/tmp/a b.txt'".into(),
                fell_back: false,
            }
        );
    }

    #[test]
    fn default_system_command_skips_editor_detection() {
        let cfg = cfg_with(SYSTEM_DEFAULT, &[("md", "edit {file}")]);
        assert_eq!(
            file_open_sync("/tmp/a.txt", &cfg, |_| panic!("system open must skip detection")).unwrap(),
            FileOpenResult::System { degraded: false }
        );
        assert!(matches!(file_open_sync("/tmp/a.md", &cfg, all()).unwrap(), FileOpenResult::Terminal { .. }));
    }

    #[test]
    fn file_open_falls_back_when_bin_missing() {
        let cfg = cfg_with("vim", &[]);
        let r = file_open_sync("/tmp/a.txt", &cfg, check(&["nano"])).unwrap();
        assert_eq!(
            r,
            FileOpenResult::Terminal {
                editor: "nano".into(),
                command: "nano '/tmp/a.txt'".into(),
                fell_back: true,
            }
        );
    }

    #[test]
    fn file_open_degrades_to_system_when_nothing_available() {
        let cfg = cfg_with("vim", &[]);
        assert_eq!(
            file_open_sync("/tmp/a.txt", &cfg, none()).unwrap(),
            FileOpenResult::System { degraded: true }
        );
    }

    #[test]
    fn file_open_system_template_is_not_degraded() {
        let cfg = cfg_with("vim", &[("png", SYSTEM_DEFAULT)]);
        assert_eq!(
            file_open_sync("/tmp/a.png", &cfg, none()).unwrap(),
            FileOpenResult::System { degraded: false }
        );
    }
}
