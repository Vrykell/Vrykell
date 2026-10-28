//! Tauri command layer: split by domain to avoid a single god module.
//! Each submodule exposes only `#[tauri::command]`; all data access goes through `crate::db`.

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
