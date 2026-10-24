//! Tauri 命令层：按领域拆分，避免单一 god module。
//! 每个子模块只暴露 `#[tauri::command]`，数据访问一律走 `crate::db`。

pub mod clipboard;
pub mod conversation;
pub mod history_page;
pub mod download;
pub mod group;
pub mod git;
pub mod editor;
pub mod search;
pub mod command_history;
pub mod session;
pub mod workspace;
