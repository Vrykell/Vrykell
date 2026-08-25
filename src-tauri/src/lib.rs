// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod agent;
mod commands;
mod db;
mod files;
mod remote;
mod terminal;
mod theme;

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
        .manage(terminal::pty::PtyState::default())
        .manage(history_state)
        .manage(agent::ai::AiConfig::load())
        .manage(theme::ThemeState::load())
        .manage(agent::ai::LlmStreamState::default())
        .manage(terminal::pty::KillState::default())
        .manage(agent::mcp::McpState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            agent::ai::set_ai_key,
            agent::ai::clear_ai_key,
            agent::ai::set_ai_base_url,
            agent::ai::set_ai_model,
            agent::ai::get_ai_config,
            agent::ai::ai_stream,
            agent::ai::set_ai_provider,
            agent::ai::set_ai_models,
            agent::ai::set_active_model,
            agent::ai::set_provider_key,
            agent::ai::clear_provider_key,
            agent::ai::set_tavily_key,
            agent::ai::clear_tavily_key,
            agent::ai::tavily_search,
            agent::ai::llm_stream,
            agent::ai::llm_abort,
            theme::get_theme_config,
            theme::set_theme_config,
            theme::get_theme_path,
            theme::theme_export,
            theme::theme_import,
            theme::read_image_data_url,
            agent::web::web_search,
            agent::web::web_fetch,
            agent::web::web_crawl,
            agent::web::fetch_skill_registry,
            agent::skills::list_skills,
            agent::skills::get_skill,
            agent::skills::set_skill_state,
            agent::skills::read_skill_file,
            agent::skills::find_skill_reference,
            agent::skills::remove_skill,
            agent::skills::install_skill_md,
            agent::skills::import_skills_from_path,
            agent::memory::get_memory,
            agent::memory::set_memory,
            agent::memory::get_memory_journal,
            agent::memory::append_memory_journal,
            agent::agents::list_agents,
            agent::agents::save_agent,
            agent::agents::remove_agent,
            agent::agents::get_agent,
            agent::schedules::list_schedules,
            agent::schedules::save_schedule,
            agent::schedules::remove_schedule,
            agent::schedules::mark_schedule_run,
            agent::mcp::mcp_get_servers,
            agent::mcp::mcp_save_server,
            agent::mcp::mcp_remove_server,
            agent::mcp::mcp_toggle_server,
            agent::mcp::mcp_connect,
            agent::mcp::mcp_disconnect,
            agent::mcp::mcp_list_all_tools,
            agent::mcp::mcp_call_tool,
            terminal::pty::pty_spawn,
            terminal::shells::list_shells,
            remote::ssh::ssh_connections_list,
            remote::ssh::ssh_connection_save,
            remote::ssh::ssh_connection_delete,
            remote::ssh::ssh_connection_touch,
            remote::ssh::ssh_test,
            remote::ssh::ssh_list,
            remote::ssh::ssh_download,
            remote::ssh::ssh_rename,
            remote::ssh::ssh_delete,
            remote::ssh::ssh_upload,
            terminal::pty::pty_write,
            terminal::pty::pty_resize,
            terminal::pty::pty_close,
            terminal::pty::pty_kill_foreground,
            files::fs::fs_list,
            files::fs::fs_roots,
            files::fs::fs_home,
            files::fs::fs_rename,
            files::fs::fs_delete,
            files::fs::which_cmd,
            files::fs::read_file_text,
            files::fs::write_file_text,
            files::fs::edit_file_text,
            files::fs::fs_search,
            files::fs::save_attachment,
            files::fs::read_attachment,
            files::fs::import_attachment,
            files::file_open::file_open,
            files::file_open::file_open_with,
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
            commands::session::delete_chat_message,
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
