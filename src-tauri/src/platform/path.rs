//! 远端（POSIX）路径语义。
//!
//! 远端主机的路径规则与宿主平台无关：在 Windows 上 `std::path::Path` 会把 `/home/user`
//! 判成相对路径、`join` 会插入反斜杠、`is_absolute` 会返回 false。因此远端路径的
//! 「绝对/相对判断、拼接、取父目录、取文件名、规范化」一律走这里，不要用 std::path。

/// 是否绝对路径（POSIX：以 `/` 开头）。
pub fn is_absolute(path: &str) -> bool {
    path.starts_with('/')
}

/// 规范化：折叠重复分隔符、去掉 `.` 与结尾 `/`，处理 `..`（不会越过根）。
pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return "/".to_string();
    }
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    format!("/{}", parts.join("/"))
}

/// 拼接目录与名称（目录为根时不会产生 `//`）。
pub fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        return if name.starts_with('/') { name.to_string() } else { format!("/{name}") };
    }
    let base = dir.trim_end_matches('/');
    if base.is_empty() {
        return format!("/{name}");
    }
    format!("{base}/{name}")
}

/// 父目录；根目录或空路径返回 None。
pub fn parent(path: &str) -> Option<String> {
    let normalized = normalize(path);
    if normalized == "/" {
        return None;
    }
    let cut = normalized.rfind('/')?;
    if cut == 0 {
        return Some("/".to_string());
    }
    Some(normalized[..cut].to_string())
}

/// 文件名（末段）；根目录或空路径返回 None。
pub fn file_name(path: &str) -> Option<String> {
    let normalized = normalize(path);
    if normalized == "/" {
        return None;
    }
    normalized.rsplit('/').next().map(|name| name.to_string())
}

/// 从「目录 + 文件名」的列表结果里取出文件名。
/// ssh2 的便捷 readdir 会用宿主平台的分隔符拼路径（Windows 上是 `\`），这里按请求的目录
/// 前缀剥离，兼容两种分隔符后再取末段。
pub fn name_from_listing(listed: &str, dir: &str) -> Option<String> {
    let base = dir.trim_end_matches('/');
    let stripped = listed
        .strip_prefix(base)
        .unwrap_or(listed)
        .trim_start_matches(['/', '\\']);
    if stripped.is_empty() {
        None
    } else {
        Some(stripped.to_string())
    }
}

/// 判断 `child` 是否位于 `ancestor` 之内（含自身）。
pub fn is_within(child: &str, ancestor: &str) -> bool {
    let child = normalize(child);
    let ancestor = normalize(ancestor);
    if child == ancestor {
        return true;
    }
    let prefix = if ancestor == "/" { "/".to_string() } else { format!("{ancestor}/") };
    child.starts_with(&prefix)
}

/// A file name that stays inside its directory on a remote (POSIX) host: exactly one component,
/// no separators and no dot segments. Mirrors the local rename/create guard so a remote file
/// operation can never place a name outside the directory the user pointed at.
pub fn is_safe_component(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')
}

/// 在目录内生成带序号的安全名：`name (1).ext`、`Documents (1)`（序号在扩展名前）。
/// `exists` 由调用方提供（本地磁盘 / 远端 stat）。
pub fn numbered_name<F: Fn(&str) -> bool>(name: &str, exists: F) -> String {
    let (stem, extension) = split_extension(name);
    for index in 1..10_000u32 {
        let candidate = match &extension {
            Some(ext) => format!("{stem} ({index}).{ext}"),
            None => format!("{stem} ({index})"),
        };
        if !exists(&candidate) {
            return candidate;
        }
    }
    let fallback = uuid::Uuid::new_v4();
    match &extension {
        Some(ext) => format!("{stem} ({fallback}).{ext}"),
        None => format!("{stem} ({fallback})"),
    }
}

pub fn available_name<F: Fn(&str) -> bool>(name: &str, exists: F) -> String {
    if exists(name) { numbered_name(name, exists) } else { name.to_string() }
}

/// 拆出「主干 + 扩展名」（无扩展名时扩展名为 None，点开头的隐藏文件整体视为主干）。
pub fn split_extension(name: &str) -> (String, Option<String>) {
    match name.rfind('.') {
        Some(index) if index > 0 && index < name.len() - 1 => {
            (name[..index].to_string(), Some(name[index + 1..].to_string()))
        }
        _ => (name.to_string(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn available_transfer_names_keep_the_original_until_it_is_occupied() {
        for name in ["Documents", "project-folder", "report.txt", ".config", "folder.with.dots", "資料"] {
            assert_eq!(available_name(name, |_| false), name);
        }
        assert_eq!(available_name("Documents", |candidate| candidate == "Documents"), "Documents (1)");
        assert_eq!(available_name("report.txt", |candidate| ["report.txt", "report (1).txt"].contains(&candidate)), "report (2).txt");
        assert_eq!(numbered_name("Documents", |_| false), "Documents (1)");
    }

    #[test]
    fn absolute_check_follows_posix_rules() {
        assert!(is_absolute("/home/user"));
        assert!(is_absolute("/"));
        assert!(!is_absolute("home/user"));
        assert!(!is_absolute("C:/Users"));
    }

    #[test]
    fn join_never_uses_backslashes() {
        assert_eq!(join("/home/user", "docs"), "/home/user/docs");
        assert_eq!(join("/home/user/", "docs"), "/home/user/docs");
        assert_eq!(join("/", "docs"), "/docs");
        assert_eq!(join("", "docs"), "/docs");
        // Windows 宿主上也必须是 POSIX 结果
        assert!(!join("/home/user", "docs").contains('\\'));
    }

    #[test]
    fn parent_and_file_name_handle_root_and_nested_paths() {
        assert_eq!(parent("/home/user/a.txt").as_deref(), Some("/home/user"));
        assert_eq!(parent("/home").as_deref(), Some("/"));
        assert_eq!(parent("/"), None);
        assert_eq!(file_name("/home/user/a.txt").as_deref(), Some("a.txt"));
        assert_eq!(file_name("/home/user/").as_deref(), Some("user"));
        assert_eq!(file_name("/"), None);
    }

    #[test]
    fn normalize_collapses_trailing_and_redundant_separators() {
        assert_eq!(normalize("/home//user/"), "/home/user");
        assert_eq!(normalize("/home/user/../docs"), "/home/docs");
        assert_eq!(normalize("/.."), "/");
        assert_eq!(normalize(""), "/");
    }

    #[test]
    fn safe_components_exclude_dot_segments_and_separators() {
        assert!(is_safe_component("notes.txt"));
        assert!(is_safe_component("a b"));
        assert!(!is_safe_component(""));
        assert!(!is_safe_component("."));
        assert!(!is_safe_component(".."));
        assert!(!is_safe_component("../x"));
        assert!(!is_safe_component("a/b"));
        assert!(!is_safe_component("a\\b"));
    }

    #[test]
    fn numbered_name_inserts_index_before_extension() {
        assert_eq!(numbered_name("notes.txt", |_| false), "notes (1).txt");
        assert_eq!(numbered_name("notes.txt", |name| name == "notes (1).txt"), "notes (2).txt");
        assert_eq!(numbered_name("Documents", |_| false), "Documents (1)");
        assert_eq!(numbered_name(".bashrc", |_| false), ".bashrc (1)");
        assert_eq!(split_extension("archive.tar.gz"), ("archive.tar".to_string(), Some("gz".to_string())));
    }
}
