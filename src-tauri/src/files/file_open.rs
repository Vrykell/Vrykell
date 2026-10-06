//! file_open — 文件面板的文件打开策略（原 src/lib/fileOpen.ts 的下沉）。
//!
//! 纯策略（shell 引用 / 扩展名 / 模板解析 / 命令构造 / 编辑器可用性降级）
//! 收在 Rust，前端只保留 localStorage 配置读写、openPath（系统默认应用）与
//! ptyWrite（把命令写进终端）两个副作用。这样可注入 check 的可用性检测、
//! 降级链不再往返多次 IPC。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// 模板特殊值：用系统默认应用打开
const SYSTEM_DEFAULT: &str = "__system__";

/// 编辑器不可用时的降级链（配置的编辑器优先，系统默认应用兜底）
const FALLBACK_EDITORS: [&str; 3] = ["vim", "nano", "vi"];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOpenConfig {
    pub default_editor: String,
    pub templates: HashMap<String, String>,
}

/// file_open 命令的返回：terminal 附带最终命令行，system 表示走系统默认应用。
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "via", rename_all = "camelCase")]
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

// ── 命令构造 ──

/// POSIX shell 单引号引用
fn shell_quote(p: &str) -> String {
    format!("'{}'", p.replace('\'', "'\\''"))
}

/// 取小写扩展名（无点或点开头隐藏文件返回空串）
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

/// 按扩展名解析打开方式
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

/// 模板 → 完整命令行（有 {file} 替换，无则追加引用路径）
fn build_command(template: &str, path: &str) -> String {
    let quoted = shell_quote(path);
    if template.contains("{file}") {
        template.replace("{file}", &quoted)
    } else {
        format!("{} {}", template, quoted)
    }
}

/// 模板的主命令名（第一个 token），用于可用性检测
fn template_bin(template: &str) -> String {
    template
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string()
}

// ── 可用性检测与降级 ──

/// 选出第一个可用的编辑器；都不可用返回 None。check 可注入便于测试。
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

/// 打开文件的核心策略（同步实现，命令层用 spawn_blocking 包裹）。
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
            // 模板主命令可用 → 原样执行（保留参数/占位符）
            if !bin.is_empty() && check(&bin)? {
                return Ok(FileOpenResult::Terminal {
                    editor: bin,
                    command: build_command(&template, path),
                    fell_back: false,
                });
            }
            // 不可用 → 降级链（配置的编辑器 → vim → nano → vi）
            let preferred = if bin.is_empty() {
                cfg.default_editor.clone()
            } else {
                bin.clone()
            };
            match pick_editor(&preferred, &check)? {
                Some(editor) => Ok(FileOpenResult::Terminal {
                    command: build_command(&editor, path),
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
    // which_cmd_sync 会 spawn 登录 shell 解析 PATH，阻塞；放到阻塞线程池避免卡事件循环。
    tauri::async_runtime::spawn_blocking(move || {
        file_open_sync(&path, &cfg, |c| crate::files::fs::which_cmd_sync(c.to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 用系统「打开方式」对话框打开文件：Windows 弹 OpenAs_RunDLL 选择器，
/// macOS 在 Finder 中显示该文件（右键即可选应用），Linux 退回默认应用。
/// 仅发起，不等待用户选择（spawn 后立即返回）。
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
        // Linux 无统一「打开方式」对话框，退回默认应用打开
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

    fn cfg_with(default_editor: &str, templates: &[(&str, &str)]) -> FileOpenConfig {
        FileOpenConfig {
            default_editor: default_editor.to_string(),
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
        assert_eq!(build_command("vim", "/tmp/a b.txt"), "vim '/tmp/a b.txt'");
        assert_eq!(
            build_command("code --reuse-window {file}", "/tmp/a.txt"),
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
