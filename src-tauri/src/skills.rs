//! skills — 文件夹式技能系统（对齐 Agent Skills 开放规范 + 主流产品实现）。
//!
//! 每个技能是一个目录，含必需的 `SKILL.md`（YAML frontmatter：name/description/allowed-tools
//! + Markdown 正文），可选的 `scripts/`、`references/`、`assets/`。技能统一放在
//! `~/.vrykell/skills/<name>/`，索引（来源/信任/启停/内容哈希）存 `~/.vrykell/skill-index.json`。
//!
//! 安全模型：
//!   1. 目录名净化、zip 大小/文件数上限、zip-slip 防穿越、跳过隐藏文件/符号链接；
//!   2. 原子安装（临时目录复制 + 哈希校验 + rename 提交）+ 失败回滚；
//!   3. 内容哈希变更检测（列表标「已修改」防篡改）；
//!   4. 文件读取防路径穿越 + 2MB 预览上限；
//!   5. 信任分级：未信任技能不进 agent 上下文；脚本执行仍走 agent 权限门，不绕过。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// ── 对外类型 ──

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    /// 技能目录绝对路径
    pub dir: String,
    /// 目录内辅助文件相对路径（含 scripts/references/assets 等，不含 SKILL.md）
    pub files: Vec<String>,
    /// 是否含可执行脚本（scripts/ 目录或常见脚本扩展名）
    pub has_scripts: bool,
    /// frontmatter 声明的允许工具（allowed-tools），可能为空
    pub allowed_tools: String,
    /// 来源：内置 / AI 安装 / 导入路径
    pub source: String,
    /// 是否已信任
    pub trusted: bool,
    /// 是否启用
    pub enabled: bool,
    /// 内容哈希与安装时不一致（文件被改动过）
    pub modified: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub name: String,
    pub description: String,
    /// SKILL.md 正文（完整指令）
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

// ── 路径 / 索引 sidecar ──

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

/// 技能名 → 目录名：去掉路径分隔符/控制字符，兜底 "skill"。
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

// ── SKILL.md 解析 ──

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

// ── 脚本判定 / 文件树 / 哈希 ──

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

/// 整个技能目录的确定性哈希（相对路径 + 内容），用于变更检测。
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

// ── 目录复制（原子 + 校验） ──

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
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("复制文件失败：{e}"))?;
        }
    }
    Ok(())
}

/// 原子安装：复制到临时目录 → 哈希校验 → 替换目标。
fn copy_dir_atomic(src: &Path, dst: &Path) -> Result<(), String> {
    let src_hash = compute_dir_hash(src);
    let tmp = dst.with_extension(format!("tmp-{}", std::process::id()));
    if tmp.exists() {
        std::fs::remove_dir_all(&tmp).map_err(|e| format!("清理临时目录失败：{e}"))?;
    }
    copy_dir_recursive(src, &tmp)?;
    let tmp_hash = compute_dir_hash(&tmp);
    if tmp_hash != src_hash {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err("安装内容与源不一致，已中止".to_string());
    }
    if dst.exists() {
        std::fs::remove_dir_all(dst).map_err(|e| format!("覆盖旧技能失败：{e}"))?;
    }
    std::fs::rename(&tmp, dst).map_err(|e| format!("提交技能失败：{e}"))?;
    Ok(())
}

/// 读取一个技能目录 → SkillMeta。
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
    // 导入默认：未信任、启用，记录来源与哈希
    upsert_record(&name, |_r| SkillRecord {
        source: source.to_string(),
        trusted: false,
        enabled: true,
        content_hash: compute_dir_hash(&dst),
    });
    read_skill_meta(&dst).ok_or_else(|| "导入后读取技能失败".to_string())
}

// ── zip 解压（限额 + 防穿越） ──

const MAX_EXTRACTED_SIZE: u64 = 100 * 1024 * 1024;
const MAX_FILES_COUNT: usize = 2000;

fn extract_zip(path: &Path, dst: &Path) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("打开压缩包失败：{e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("解析压缩包失败：{e}"))?;
    let mut total_size = 0u64;
    let mut file_count = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("读取压缩包条目失败：{e}"))?;
        let out_path = match entry.enclosed_name() {
            Some(p) => dst.join(p),
            None => continue, // zip-slip 路径被 enclosed_name 拒绝
        };
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败：{e}"))?;
        } else {
            file_count += 1;
            if file_count > MAX_FILES_COUNT {
                return Err("压缩包文件数超限".to_string());
            }
            total_size += entry.size();
            if total_size > MAX_EXTRACTED_SIZE {
                return Err("压缩包解压体积超限".to_string());
            }
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
            }
            let mut outfile = std::fs::File::create(&out_path).map_err(|e| format!("写出文件失败：{e}"))?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| format!("解压失败：{e}"))?;
        }
    }
    Ok(())
}

// ── 标准技能预置 ──

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
    // 目录已存在（旧版升级）：为内置技能回填来源/信任，避免显示「来源未知」
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

// ── Tauri 命令 ──

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

/// 设置技能的信任/启停状态。
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

/// 读取技能目录内的一个文件（防路径穿越 + 2MB 上限），供详情预览。
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

/// 安装/更新一个技能（agent 替用户安装，写入最小技能目录）。
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
        trusted: true, // 用户明确要求安装，默认信任
        enabled: true,
        content_hash: compute_dir_hash(&dir),
    });
    read_skill_meta(&dir).ok_or_else(|| "写入后读取技能失败".to_string())
}

/// 导入技能：文件夹（递归 SKILL.md）/ zip 压缩包 / 单个 Markdown。
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

/// 某个技能路径/文本对应的信任信息。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillTrustInfo {
    pub name: String,
    pub trusted: bool,
    pub enabled: bool,
}

/// 判断一个路径或命令文本是否引用了某个技能目录，返回其信任信息。
/// 用于 agent 侧：读取/运行未信任技能的文件/脚本前弹「信任此技能」确认。
#[tauri::command]
pub async fn find_skill_reference(text: String) -> Option<SkillTrustInfo> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let root = skills_dir();
    // 1) 作为路径：canonicalize 后是否落在技能根内
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
    // 2) 文本中是否含技能目录路径
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
