//! memory — agent 长期记忆：FACT（持久知识）+ JOURNAL（带时间戳的流水）。
//!   - `~/.vrykell/memory.md`        ：FACT，agent 用 memory 工具 update 重写（= 记忆整理）
//!   - `~/.vrykell/memory-journal.md`：JOURNAL，按行追加（时间戳 + 文本）
//! 每次对话把 FACT 与最近若干条 JOURNAL 注入系统提示词。

use std::path::PathBuf;

fn fact_path() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".vrykell").join("memory.md")
}

fn journal_path() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".vrykell").join("memory-journal.md")
}

fn ensure_dir(p: &std::path::Path) -> Result<(), String> {
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn get_memory() -> Result<String, String> {
    let p = fact_path();
    if !p.is_file() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&p).map_err(|e| format!("读取记忆失败：{e}"))
}

#[tauri::command]
pub fn set_memory(content: String) -> Result<(), String> {
    let p = fact_path();
    ensure_dir(&p)?;
    std::fs::write(&p, content).map_err(|e| format!("写入记忆失败：{e}"))
}

#[tauri::command]
pub fn get_memory_journal() -> Result<String, String> {
    let p = journal_path();
    if !p.is_file() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&p).map_err(|e| format!("读取流水失败：{e}"))
}

#[tauri::command]
pub fn append_memory_journal(text: String) -> Result<(), String> {
    let p = journal_path();
    ensure_dir(&p)?;
    let t = text.trim();
    if t.is_empty() {
        return Err("内容不能为空".to_string());
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&p)
        .map_err(|e| format!("打开流水失败：{e}"))?;
    writeln!(f, "[{ts}] {t}").map_err(|e| format!("写入流水失败：{e}"))?;
    Ok(())
}
