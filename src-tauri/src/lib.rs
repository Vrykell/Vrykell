// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ai;
mod commands;
mod db;
mod fs;
mod file_open;
mod pty;
mod scan;
mod shell_integration;
mod shells;
mod ssh;

use db::HistoryState;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let history_db = db::HistoryDb::open().expect("failed to open history db");
    // 启动即把上次异常退出（崩溃/强杀）遗留的 active 会话归档，避免脏 active 数据。
    // 正常退出已在 RunEvent::Exit 归档，这里幂等兜底。
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let _ = history_db.archive_all_active_sessions(now);
    let history_state = HistoryState(Mutex::new(history_db));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .manage(history_state)
        .manage(ai::AiConfig::load())
        .manage(pty::KillState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            ai::set_ai_key,
            ai::clear_ai_key,
            ai::set_ai_base_url,
            ai::set_ai_model,
            ai::get_ai_config,
            ai::ai_stream,
            pty::pty_spawn,
            shells::list_shells,
            ssh::ssh_connections_list,
            ssh::ssh_connection_save,
            ssh::ssh_connection_delete,
            ssh::ssh_connection_touch,
            ssh::ssh_test,
            ssh::ssh_list,
            ssh::ssh_download,
            ssh::ssh_rename,
            ssh::ssh_delete,
            ssh::ssh_upload,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_kill_foreground,
            fs::fs_list,
            fs::fs_roots,
            fs::fs_home,
            fs::fs_rename,
            fs::fs_delete,
            fs::which_cmd,
            file_open::file_open,
            file_open::file_open_with,
            commands::search::search_files,
            commands::search::search_history,
            commands::search::get_search_context,
            commands::search::record_history,
            commands::search::history_stats,
            commands::search::clear_history,
            commands::search::search_blocks,
            commands::search::search_sessions,
            commands::session::create_session,
            commands::session::archive_session,
            commands::session::restore_session,
            commands::session::update_session_title,
            commands::session::update_session_cwd,
            commands::session::update_session_payload,
            commands::session::get_session,
            commands::session::delete_session,
            commands::session::record_block,
            commands::session::set_block_collapsed,
            commands::session::append_chat_message,
            commands::session::list_chat_messages,
            commands::session::list_sessions,
            commands::session::get_session_blocks,
            commands::group::groups_list,
            commands::group::group_create,
            commands::group::group_rename,
            commands::group::group_set_collapsed,
            commands::group::group_delete,
            commands::group::group_delete_with_sessions,
            commands::group::groups_reorder,
            commands::group::session_set_group,
            commands::group::sessions_reorder,
            commands::group::group_restore,
            commands::group::group_archive,
            commands::workspace::add_workspace,
            commands::workspace::remove_workspace,
            commands::workspace::list_workspaces,
            commands::download::downloads_list,
            commands::download::downloads_clear,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // 应用退出时把仍在活跃状态的会话标记为历史，避免遗留脏 active 数据
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<HistoryState>() {
                if let Ok(db) = state.0.lock() {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let _ = db.archive_all_active_sessions(now);
                }
            }
        }
    });
}
