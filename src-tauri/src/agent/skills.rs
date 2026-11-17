//! skills — folder-based skill system (aligned with the Agent Skills open specification and
//! mainstream product implementations).
//!
//! Each skill is a directory containing a required `SKILL.md` (YAML frontmatter: name/description/
//! allowed-tools plus the Markdown body) and optional `scripts/`, `references/`, `assets/` and similar.
//! Skills live under `~/.vrykell/skills/<name>/`; the index (source, trust, enabled state, content
//! hash) is stored in `~/.vrykell/skill-index.json`.
//!
//! Security model:
//!   1. Directory name sanitization, zip size/file-count limits, zip-slip traversal prevention,
//!      hidden files and symbolic links skipped;
//!   2. Atomic install (copy to a temporary directory, hash verification, rename commit) with
//!      rollback on failure;
//!   3. Content-hash change detection (flagged as "modified" in listings to deter tampering);
//!   4. Path traversal protection for file reads plus a 2MB preview limit;
//!   5. Trust levels: untrusted skills never enter the agent context; script execution still passes
//!      through the agent permission gate and is never bypassed.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// ── Public types ──

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    /// Absolute path of the skill directory
    pub dir: String,
    /// Relative paths of auxiliary files in the directory (scripts/references/assets and similar, excluding SKILL.md)
    pub files: Vec<String>,
    /// Whether the skill contains executable scripts (a scripts/ directory or common script extensions)
    pub has_scripts: bool,
    /// Tools allowed by the frontmatter (allowed-tools); may be empty
    pub allowed_tools: String,
    /// Source: built-in / installed by AI / import path
    pub source: String,
    /// Whether the skill is trusted
    pub trusted: bool,
    /// Whether the skill is enabled
    pub enabled: bool,
    /// Content hash differs from install time (files were modified)
    pub modified: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub name: String,
    pub description: String,
    /// SKILL.md body (full instructions)
    pub prompt: String,
    pub dir: String,
    pub files: Vec<String>,
    pub has_scripts: bool,
    pub allowed_tools: String,
    pub source: String,
    pub trusted: bool,
    pub enabled: bool,
    pub modified: bool,
}

// ── Paths / index sidecar ──

fn skills_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".vrykell")
        .join("skills")
}

fn index_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".vrykell")
        .join("skill-index.json")
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct SkillRecord {
    source: String,
    trusted: bool,
    enabled: bool,
    content_hash: String,
}

#[derive(Serialize, Deserialize, Default)]
struct SkillIndex {
    map: HashMap<String, SkillRecord>,
}

fn load_index() -> HashMap<String, SkillRecord> {
    std::fs::read_to_string(index_path())
        .ok()
        .and_then(|s| serde_json::from_str::<SkillIndex>(&s).ok())
        .map(|s| s.map)
        .unwrap_or_default()
}

fn save_index(map: &HashMap<String, SkillRecord>) {
    let json = serde_json::to_string(&SkillIndex { map: map.clone() }).unwrap_or_default();
    let _ = std::fs::write(index_path(), json);
}

fn record_of(name: &str) -> SkillRecord {
    load_index().get(name).cloned().unwrap_or_default()
}

fn upsert_record(name: &str, patch: impl FnOnce(SkillRecord) -> SkillRecord) {
    let mut map = load_index();
    let rec = patch(map.get(name).cloned().unwrap_or_default());
    map.insert(name.to_string(), rec);
    save_index(&map);
}

fn remove_record(name: &str) {
    let mut map = load_index();
    if map.remove(name).is_some() {
        save_index(&map);
    }
}

/// Skill name → directory name: strip path separators and control characters, falling back to "skill".
fn sanitize_name(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
        .collect();
    if s.is_empty() {
        "skill".to_string()
    } else {
        s
    }
}

// ── SKILL.md parsing ──

fn split_frontmatter(content: &str) -> (String, String) {
    if !content.starts_with("---") {
        return (String::new(), content.to_string());
    }
    let after = content[3..].trim_start_matches(['\r', '\n']);
    match after.find("\n---") {
        Some(pos) => {
            let front = after[..pos].to_string();
            let body = after[pos + 4..].trim_start_matches(['\r', '\n']).to_string();
            (front, body)
        }
        None => (after.to_string(), String::new()),
    }
}

fn yaml_field(front: &str, key: &str) -> String {
    let prefix = format!("{key}:");
    for line in front.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix(&prefix) {
            let v = v.trim().trim_matches('"').trim_matches('\'').trim();
            if !v.is_empty() {
                return v.to_string();
            }
        }
    }
    String::new()
}

fn parse_skill_md(content: &str) -> (String, String, String, String) {
    let (front, body) = split_frontmatter(content);
    (
        yaml_field(&front, "name"),
        yaml_field(&front, "description"),
        body.trim().to_string(),
        yaml_field(&front, "allowed-tools"),
    )
}

// ── Script detection / file tree / hashing ──

fn is_script_path(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    let in_scripts = lower.starts_with("scripts/");
    let ext = [".py", ".sh", ".bash", ".js", ".ts", ".mjs", ".cjs", ".rb", ".pl", ".ps1", ".fish", ".zsh"];
    in_scripts || ext.iter().any(|e| lower.ends_with(e))
}

fn list_skill_files(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk_files(dir, dir, 0, &mut out);
    out.sort();
    out.truncate(200);
    out
}

fn walk_files(base: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
    if depth > 3 || out.len() >= 200 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if let Ok(md) = std::fs::symlink_metadata(&p) {
            if md.file_type().is_symlink() {
                continue;
            }
        }
        if p.is_dir() {
            walk_files(base, &p, depth + 1, out);
        } else if let Ok(rel) = p.strip_prefix(base) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            if !rel.eq_ignore_ascii_case("skill.md") {
                out.push(rel);
            }
        }
    }
}

fn collect_hash_paths(base: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if let Ok(md) = std::fs::symlink_metadata(&p) {
            if md.file_type().is_symlink() {
                continue;
            }
        }
        if p.is_dir() {
            collect_hash_paths(base, &p, out);
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// Deterministic hash of the whole skill directory (relative paths plus contents) for change detection.
fn compute_dir_hash(dir: &Path) -> String {
    let mut paths = Vec::new();
    collect_hash_paths(dir, dir, &mut paths);
    paths.sort();
    let mut hasher = Sha256::new();
    for rel in paths {
        if let Ok(bytes) = std::fs::read(dir.join(&rel)) {
            hasher.update(rel.as_bytes());
            hasher.update([0]);
            hasher.update(&bytes);
            hasher.update([0]);
        }
    }
    format!("{:x}", hasher.finalize())
}

// ── Directory copy (atomic + verified) ──

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建技能目录失败：{e}"))?;
    for e in std::fs::read_dir(src).map_err(|e| format!("读取源目录失败：{e}"))? {
        let e = e.map_err(|e| format!("读取源目录失败：{e}"))?;
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let from = e.path();
        let to = dst.join(e.file_name());
        let kind = e.file_type().map_err(|error| error.to_string())?;
        // Match hash traversal: linked content is excluded from installed skills.
        if kind.is_symlink() { continue; }
        if kind.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if kind.is_file() {
            std::fs::copy(&from, &to).map_err(|e| format!("复制文件失败：{e}"))?;
        } else {
            return Err("Only regular skill files can be imported.".into());
        }
    }
    Ok(())
}

/// Stage and verify independently before replacing the installed directory.
fn copy_dir_atomic(src: &Path, dst: &Path) -> Result<(), String> {
    let src_hash = compute_dir_hash(src);
    let tmp = dst.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    if let Err(error) = copy_dir_recursive(src, &tmp) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(error);
    }
    let tmp_hash = compute_dir_hash(&tmp);
    if tmp_hash != src_hash {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err("安装内容与源不一致，已中止".to_string());
    }
    commit_skill_dir(&tmp, dst, |from, to| std::fs::rename(from, to))
}

fn commit_skill_dir(
    staged: &Path,
    destination: &Path,
    mut rename: impl FnMut(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let previous = destination.with_extension(format!("previous-{}", uuid::Uuid::new_v4()));
    let replacing = destination.exists();
    if replacing {
        rename(destination, &previous).map_err(|error| format!("Could not preserve the installed skill: {error}"))?;
    }
    if let Err(error) = rename(staged, destination) {
        if replacing {
            if let Err(restore_error) = rename(&previous, destination) {
                return Err(format!("Could not install the skill: {error}. The previous copy is preserved at {}: {restore_error}", previous.display()));
            }
        }
        return Err(format!("Could not install the skill: {error}"));
    }
    if replacing { let _ = std::fs::remove_dir_all(previous); }
    Ok(())
}

/// Read a skill directory into a SkillMeta.
fn read_skill_meta(dir: &Path) -> Option<SkillMeta> {
    let content = std::fs::read_to_string(dir.join("SKILL.md")).ok()?;
    let (name, description, _, allowed_tools) = parse_skill_md(&content);
    let fallback = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("skill")
        .to_string();
    let name = if name.trim().is_empty() { fallback } else { name.trim().to_string() };
    let files = list_skill_files(dir);
    let has_scripts = files.iter().any(|f| is_script_path(f));
    let rec = record_of(&name);
    let hash = compute_dir_hash(dir);
    let modified = !rec.content_hash.is_empty() && rec.content_hash != hash;
    Some(SkillMeta {
        name: name.clone(),
        description,
        dir: dir.to_string_lossy().to_string(),
        files,
        has_scripts,
        allowed_tools,
        source: rec.source.clone(),
        trusted: rec.trusted,
        enabled: rec.enabled,
        modified,
    })
}

fn collect_skill_roots(path: &Path, roots: &mut Vec<PathBuf>) {
    if !std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink()) {
        return;
    }
    if path.join("SKILL.md").is_file() {
        roots.push(path.to_path_buf());
        return;
    }
    if path.is_dir() {
        for e in std::fs::read_dir(path).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                collect_skill_roots(&p, roots);
            }
        }
    }
}

fn import_skill_dir(src: &Path, source: &str) -> Result<SkillMeta, String> {
    let content =
        std::fs::read_to_string(src.join("SKILL.md")).map_err(|e| format!("读取 SKILL.md 失败：{e}"))?;
    let (name, _, _, _) = parse_skill_md(&content);
    let fallback = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("skill")
        .to_string();
    let name = sanitize_name(if name.trim().is_empty() { &fallback } else { name.trim() });
    let dst = skills_dir().join(&name);
    copy_dir_atomic(src, &dst)?;
    // Import defaults: untrusted and enabled, with source and hash recorded
    upsert_record(&name, |_r| SkillRecord {
        source: source.to_string(),
        trusted: false,
        enabled: true,
        content_hash: compute_dir_hash(&dst),
    });
    read_skill_meta(&dst).ok_or_else(|| "导入后读取技能失败".to_string())
}

// ── Zip extraction (limits + traversal protection) ──

const MAX_EXTRACTED_SIZE: u64 = 100 * 1024 * 1024;
const MAX_FILES_COUNT: usize = 2000;

fn extract_zip(path: &Path, dst: &Path) -> Result<(), String> {
    use std::io::{Read, Write};
    let file = std::fs::File::open(path).map_err(|e| format!("打开压缩包失败：{e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("解析压缩包失败：{e}"))?;
    let mut total_size = 0u64;
    let mut file_count = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("读取压缩包条目失败：{e}"))?;
        let out_path = match entry.enclosed_name() {
            Some(p) => dst.join(p),
            None => continue, // zip-slip path rejected by enclosed_name
        };
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败：{e}"))?;
        } else {
            file_count += 1;
            if file_count > MAX_FILES_COUNT {
                return Err("压缩包文件数超限".to_string());
            }
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
            }
            let mut outfile = std::fs::File::create(&out_path).map_err(|e| format!("写出文件失败：{e}"))?;
            // Stream to disk while counting actual bytes: the size declared in the zip header is
            // untrusted (a zip bomb can overstate it), so enforce the limit on bytes actually written
            let mut buf = [0u8; 64 * 1024];
            loop {
                let n = entry.read(&mut buf).map_err(|e| format!("读取压缩包条目失败：{e}"))?;
                if n == 0 {
                    break;
                }
                total_size += n as u64;
                if total_size > MAX_EXTRACTED_SIZE {
                    return Err("压缩包解压体积超限".to_string());
                }
                outfile.write_all(&buf[..n]).map_err(|e| format!("写出文件失败：{e}"))?;
            }
        }
    }
    Ok(())
}

// ── Built-in standard skills ──

const STANDARD_SKILLS: &[(&str, &str, &str)] = &[
    (
        "写单元测试",
        "为新增或改动的函数编写并运行单元测试",
        "1. read_file 读源码，确认函数签名、边界条件与依赖。\n2. 用项目已有测试框架与目录结构新增或补充测试文件。\n3. 覆盖正常路径、边界输入、错误分支；不测外部依赖，必要时 mock。\n4. run_command 运行测试命令，确认全部通过后汇报。",
    ),
    (
        "代码审查",
        "审查改动，指出缺陷、安全隐患与可读性问题",
        "1. read_file 读源码，必要时 git diff 看改动范围。\n2. 检查正确性、边界与空值、并发与资源释放、错误处理。\n3. 检查安全隐患与性能热点；指出命名、结构、注释等可读性问题。\n4. 按严重程度分条输出，每条给出位置、问题与修复建议。",
    ),
    (
        "提交代码",
        "按规范生成提交信息并完成 git 提交",
        "1. git status / git diff 了解改动内容与范围。\n2. 生成规范提交信息，第一行用祈使句概括改动。\n3. 提交前确认没有密钥、日志、临时文件入库。\n4. 执行提交并汇报哈希与摘要。",
    ),
    (
        "编写文档",
        "为代码或接口撰写清晰的说明文档",
        "1. read_file 读源码，理解用途、入参与返回、示例用法。\n2. 写清用途、安装与运行方式、核心 API 或用法示例。\n3. 语言简洁，示例可运行；涉及命令给出具体命令。\n4. write_file 写入 README 或指定文档文件。",
    ),
    (
        "调试报错",
        "分析终端报错并定位修复",
        "1. 读取终端报错信息，定位文件、行号与错误类型。\n2. read_file 读相关源码，结合报错栈推断根因。\n3. 必要时 run_command 复现或加日志确认。\n4. edit_file 修复后重新运行验证，汇报根因与改动。",
    ),
];

fn ensure_standard_skills() {
    let dir = skills_dir();
    if !dir.exists() {
        for (name, desc, prompt) in STANDARD_SKILLS {
            let skill_dir = dir.join(sanitize_name(name));
            if std::fs::create_dir_all(&skill_dir).is_err() {
                continue;
            }
            let md = format!("---\nname: {name}\ndescription: {desc}\n---\n{prompt}\n");
            let _ = std::fs::write(skill_dir.join("SKILL.md"), md);
            upsert_record(name, |_| SkillRecord {
                source: "内置".to_string(),
                trusted: true,
                enabled: true,
                content_hash: compute_dir_hash(&skill_dir),
            });
        }
        return;
    }
    // Directory already exists (upgrade from an older version): backfill source and trust for built-in skills so they do not show "unknown source"
    for (name, _, _) in STANDARD_SKILLS {
        let rec = record_of(name);
        if rec.source.is_empty() {
            let d = dir.join(sanitize_name(name));
            if d.join("SKILL.md").is_file() {
                upsert_record(name, |_| SkillRecord {
                    source: "内置".to_string(),
                    trusted: true,
                    enabled: true,
                    content_hash: compute_dir_hash(&d),
                });
            }
        }
    }
}

// ── Tauri commands ──

#[tauri::command]
pub async fn list_skills() -> Result<Vec<SkillMeta>, String> {
    ensure_standard_skills();
    let dir = skills_dir();
    let mut out = Vec::new();
    if dir.is_dir() {
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() && p.join("SKILL.md").is_file() {
                if let Some(m) = read_skill_meta(&p) {
                    out.push(m);
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub async fn get_skill(name: String) -> Result<SkillDetail, String> {
    ensure_standard_skills();
    let dir = skills_dir().join(sanitize_name(&name));
    let md = dir.join("SKILL.md");
    if !md.is_file() {
        return Err(format!("未找到技能「{name}」"));
    }
    let content = std::fs::read_to_string(&md).map_err(|e| format!("读取 SKILL.md 失败：{e}"))?;
    let (n, description, prompt, allowed_tools) = parse_skill_md(&content);
    let fallback = dir
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("skill")
        .to_string();
    let name = if n.trim().is_empty() { fallback } else { n.trim().to_string() };
    let files = list_skill_files(&dir);
    let has_scripts = files.iter().any(|f| is_script_path(f));
    let rec = record_of(&name);
    let hash = compute_dir_hash(&dir);
    let modified = !rec.content_hash.is_empty() && rec.content_hash != hash;
    Ok(SkillDetail {
        name: name.clone(),
        description,
        prompt,
        dir: dir.to_string_lossy().to_string(),
        files,
        has_scripts,
        allowed_tools,
        source: rec.source.clone(),
        trusted: rec.trusted,
        enabled: rec.enabled,
        modified,
    })
}

/// Set a skill's trust and enabled state.
#[tauri::command]
pub async fn set_skill_state(
    name: String,
    trusted: Option<bool>,
    enabled: Option<bool>,
) -> Result<(), String> {
    let n = sanitize_name(&name);
    let dir = skills_dir().join(&n);
    if !dir.join("SKILL.md").is_file() {
        return Err(format!("未找到技能「{name}」"));
    }
    upsert_record(&n, |r| {
        let mut rec = r;
        if let Some(t) = trusted {
            rec.trusted = t;
        }
        if let Some(e) = enabled {
            rec.enabled = e;
        }
        rec
    });
    Ok(())
}

/// Read a file inside a skill directory (path traversal protection plus a 2MB limit) for the detail preview.
#[tauri::command]
pub async fn read_skill_file(name: String, relative_path: String) -> Result<String, String> {
    let root = skills_dir().join(sanitize_name(&name));
    let rel = relative_path.trim().trim_start_matches('/').trim_start_matches('\\');
    if rel.is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    let file = root.join(rel);
    let canonical_root = std::fs::canonicalize(&root).map_err(|_| "技能目录不存在".to_string())?;
    let canonical_file = std::fs::canonicalize(&file).map_err(|_| "文件不存在".to_string())?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err("非法路径".to_string());
    }
    let size = std::fs::metadata(&canonical_file)
        .map_err(|e| format!("读取文件信息失败：{e}"))?
        .len();
    if size > 2 * 1024 * 1024 {
        return Err("文件过大，超过 2MB 预览上限".to_string());
    }
    let bytes = std::fs::read(&canonical_file).map_err(|e| format!("读取文件失败：{e}"))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub async fn remove_skill(name: String) -> Result<(), String> {
    let dir = skills_dir().join(sanitize_name(&name));
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("删除技能失败：{e}"))?;
    }
    remove_record(&sanitize_name(&name));
    Ok(())
}

/// Install or update a skill (installed by the agent on the user's behalf, writing a minimal skill directory).
#[tauri::command]
pub async fn install_skill_md(
    name: String,
    description: String,
    prompt: String,
) -> Result<SkillMeta, String> {
    if name.trim().is_empty() {
        return Err("技能名不能为空".to_string());
    }
    let folder = sanitize_name(&name);
    let dir = skills_dir().join(&folder);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建技能目录失败：{e}"))?;
    let md = format!("---\nname: {folder}\ndescription: {}\n---\n{}\n", description.trim(), prompt.trim());
    std::fs::write(dir.join("SKILL.md"), md).map_err(|e| format!("写入 SKILL.md 失败：{e}"))?;
    upsert_record(&folder, |_| SkillRecord {
        source: "AI 安装".to_string(),
        trusted: true, // the user explicitly asked for the install, so trust it by default
        enabled: true,
        content_hash: compute_dir_hash(&dir),
    });
    read_skill_meta(&dir).ok_or_else(|| "写入后读取技能失败".to_string())
}

/// Import skills: a folder (searching recursively for SKILL.md), a zip archive, or a single Markdown file.
#[tauri::command]
pub async fn import_skills_from_path(path: String) -> Result<Vec<SkillMeta>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let p = Path::new(trimmed);
    let mut imported: Vec<SkillMeta> = Vec::new();

    if p.is_dir() {
        let mut roots = Vec::new();
        collect_skill_roots(p, &mut roots);
        for r in &roots {
            imported.push(import_skill_dir(r, trimmed)?);
        }
    } else if p.is_file()
        && p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("zip"))
            .unwrap_or(false)
    {
        let tmp = std::env::temp_dir().join(format!("vrykell-skill-import-{}", std::process::id()));
        extract_zip(p, &tmp)?;
        let mut roots = Vec::new();
        collect_skill_roots(&tmp, &mut roots);
        for r in &roots {
            imported.push(import_skill_dir(r, trimmed)?);
        }
        let _ = std::fs::remove_dir_all(&tmp);
    } else if p.is_file() {
        let content = std::fs::read_to_string(p).map_err(|e| format!("读取文件失败：{e}"))?;
        let (name, _, _, _) = parse_skill_md(&content);
        let fallback = p
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("skill")
            .to_string();
        let name = sanitize_name(if name.trim().is_empty() { &fallback } else { name.trim() });
        let dst = skills_dir().join(&name);
        std::fs::create_dir_all(&dst).map_err(|e| format!("创建技能目录失败：{e}"))?;
        std::fs::copy(p, dst.join("SKILL.md")).map_err(|e| format!("复制 SKILL.md 失败：{e}"))?;
        upsert_record(&name, |_| SkillRecord {
            source: trimmed.to_string(),
            trusted: false,
            enabled: true,
            content_hash: compute_dir_hash(&dst),
        });
        imported.push(read_skill_meta(&dst).ok_or_else(|| "导入后读取技能失败".to_string())?);
    }

    if imported.is_empty() {
        return Err("未在所给路径中找到可导入的技能".to_string());
    }
    Ok(imported)
}

/// Trust information for a skill path or text reference.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillTrustInfo {
    pub name: String,
    pub trusted: bool,
    pub enabled: bool,
}

/// Determine whether a path or command text references a skill directory and return its trust information.
/// Used by the agent to confirm trust before reading or running files/scripts from an untrusted skill.
#[tauri::command]
pub async fn find_skill_reference(text: String) -> Option<SkillTrustInfo> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let root = skills_dir();
    // 1) As a path: whether the canonicalized form falls inside the skills root
    if let Ok(canon) = std::fs::canonicalize(Path::new(t)) {
        if let Ok(root_canon) = std::fs::canonicalize(&root) {
            if let Ok(rel) = canon.strip_prefix(&root_canon) {
                if let Some(name) = rel.components().next().and_then(|c| c.as_os_str().to_str()) {
                    let rec = record_of(name);
                    return Some(SkillTrustInfo {
                        name: name.to_string(),
                        trusted: rec.trusted,
                        enabled: rec.enabled,
                    });
                }
            }
        }
    }
    // 2) Whether the text contains a skill directory path
    if root.is_dir() {
        for e in std::fs::read_dir(&root).into_iter().flatten().flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let dir_str = p.to_string_lossy().to_string();
            if t.contains(&dir_str)
                || t.contains(&format!("skills/{name}"))
                || t.contains(&format!("skills\\{name}"))
            {
                let rec = record_of(&name);
                return Some(SkillTrustInfo {
                    name,
                    trusted: rec.trusted,
                    enabled: rec.enabled,
                });
            }
        }
    }
    None
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_import_extracts_safe_files_and_rejects_parent_paths() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("skill-archive-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("skill.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("sample/SKILL.md", options).unwrap();
        writer.write_all(b"---\nname: sample\n---\nDescription").unwrap();
        writer.start_file("../escaped.txt", options).unwrap();
        writer.write_all(b"must stay inside the destination").unwrap();
        writer.finish().unwrap();
        let destination = root.join("extracted");
        extract_zip(&archive, &destination).unwrap();
        assert_eq!(std::fs::read_to_string(destination.join("sample/SKILL.md")).unwrap(), "---\nname: sample\n---\nDescription");
        assert!(!root.join("escaped.txt").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_import_rejects_content_exceeding_the_extraction_limit() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("skill-archive-limit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("skill.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        writer.start_file("oversized.txt", options).unwrap();
        let chunk = [0u8; 1024 * 1024];
        for _ in 0..=MAX_EXTRACTED_SIZE / chunk.len() as u64 {
            writer.write_all(&chunk).unwrap();
        }
        writer.finish().unwrap();
        assert!(extract_zip(&archive, &root.join("extracted")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_skill_commit_restores_the_previous_installation() {
        let root = std::env::temp_dir().join(format!("skill-commit-{}", uuid::Uuid::new_v4()));
        let installed = root.join("installed");
        let staged = root.join("staged");
        std::fs::create_dir_all(&installed).unwrap();
        std::fs::create_dir(&staged).unwrap();
        std::fs::write(installed.join("SKILL.md"), "old").unwrap();
        std::fs::write(staged.join("SKILL.md"), "new").unwrap();
        let result = commit_skill_dir(&staged, &installed, |from, to| {
            if from == staged { return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "fixture")); }
            std::fs::rename(from, to)
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(installed.join("SKILL.md")).unwrap(), "old");
        assert_eq!(std::fs::read_to_string(staged.join("SKILL.md")).unwrap(), "new");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recursive_copy_matches_the_hashed_files() {
        let root = std::env::temp_dir().join(format!("skill-copy-{}", uuid::Uuid::new_v4()));
        let source = root.join("source");
        let destination = root.join("destination");
        std::fs::create_dir_all(source.join("scripts")).unwrap();
        std::fs::write(source.join("SKILL.md"), "---\nname: sample\n---\nDescription").unwrap();
        std::fs::write(source.join("scripts/run.sh"), "echo safe").unwrap();
        std::fs::write(source.join(".ignored"), "ignored").unwrap();
        copy_dir_recursive(&source, &destination).unwrap();
        assert_eq!(compute_dir_hash(&source), compute_dir_hash(&destination));
        assert!(!destination.join(".ignored").exists());
        assert_eq!(std::fs::read_to_string(destination.join("scripts/run.sh")).unwrap(), "echo safe");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn linked_directories_are_excluded_from_discovery_and_copy() {
        let root = std::env::temp_dir().join(format!("skill-links-{}", uuid::Uuid::new_v4()));
        let source = root.join("source");
        let destination = root.join("destination");
        std::fs::create_dir_all(source.join("nested")).unwrap();
        std::fs::write(source.join("nested/SKILL.md"), "---\nname: sample\n---\nDescription").unwrap();
        std::os::unix::fs::symlink(&source, source.join("loop")).unwrap();
        std::os::unix::fs::symlink(source.join("nested"), source.join("alias")).unwrap();
        let mut roots = Vec::new();
        collect_skill_roots(&source, &mut roots);
        assert_eq!(roots, vec![source.join("nested")]);
        copy_dir_recursive(&source, &destination).unwrap();
        assert!(!destination.join("loop").exists());
        assert!(!destination.join("alias").exists());
        assert_eq!(compute_dir_hash(&source), compute_dir_hash(&destination));
        std::fs::remove_dir_all(root).unwrap();
    }


    #[test]
    fn split_frontmatter_works() {
        let md = "---\nname: 写单测\ndescription: 描述\n---\n正文内容";
        let (front, body) = split_frontmatter(md);
        assert_eq!(front, "name: 写单测\ndescription: 描述");
        assert_eq!(body, "正文内容");
    }

    #[test]
    fn parse_skill_md_reads_fields() {
        let md = "---\nname: 写单测\ndescription: 为代码写测试\nallowed-tools: Bash(git:*) Read\n---\n第一步\n第二步";
        let (name, desc, prompt, allowed) = parse_skill_md(md);
        assert_eq!(name, "写单测");
        assert_eq!(desc, "为代码写测试");
        assert_eq!(prompt, "第一步\n第二步");
        assert_eq!(allowed, "Bash(git:*) Read");
    }

    #[test]
    fn sanitize_name_strips_separators() {
        assert_eq!(sanitize_name("  a/b\\c  "), "abc");
        assert_eq!(sanitize_name("   "), "skill");
    }

    #[test]
    fn is_script_path_detects_scripts() {
        assert!(is_script_path("scripts/run.py"));
        assert!(is_script_path("tools/check.sh"));
        assert!(!is_script_path("references/REFERENCE.md"));
        assert!(!is_script_path("assets/template.txt"));
    }


}
