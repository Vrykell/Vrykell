// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod agent;
mod commands;
mod db;
mod files;
mod platform;
mod redact;
mod remote;
mod secret;
mod terminal;
mod theme;
mod diagnostics;

use db::HistoryState;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    configure_keyboard_input();
    // 打开失败降级为内存库（历史功能不可用），而不是启动即崩溃
    let history_db = match db::HistoryDb::open() {
        Ok(db) => db,
        Err(e) => {
            eprintln!("[vrykell] 打开历史数据库失败，已降级为内存模式：{e}");
            db::HistoryDb::open_in_memory()
        }
    };
    // 不再归档 active 会话：active = 「上次打开未关闭的标签」，启动时由前端恢复；
    // 仅用户显式关闭标签时才归档为历史（archive_session）。
    let history_state = HistoryState(Mutex::new(history_db));

    let app = tauri::Builder::default()
        // Single instance first: a second launch is detected here and handed to the running window.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            platform::context_menu::handle_secondary_launch(app, args);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        .manage(terminal::pty::PtyState::default())
        .manage(history_state)
        .manage(agent::ai::AiConfig::load())
        .manage(theme::ThemeState::load())
        .manage(agent::ai::LlmStreamState::default())
        .manage(terminal::pty::KillState::default())
        .manage(platform::context_menu::ForwardedLaunchDirectories::default())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                for (label, tool) in window.app_handle().webview_windows() {
                    if label.starts_with("tool-") {
                        let _ = tool.destroy();
                    }
                }
            }
        })
        .manage(agent::mcp::McpState::default())
        .manage(agent::permissions::ToolPolicy::default())
        .manage(files::grants::PathGrants::load())
        .manage(agent::acp::AcpRuntime::default())
        // Paths the operating system delivers (a drop onto the window) are the one gesture the page
        // cannot fake, so they are recorded here for the read commands to accept.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window
                    .state::<files::grants::PathGrants>()
                    .grant(paths.iter().map(std::path::PathBuf::from));
            }
        })
        // asset 协议 scope 已收窄：启动时把已保存的壁纸文件动态授权
        .setup(|app| {
            if let Err(error) = terminal::debug::initialize(app.handle()) {
                eprintln!("[terminal-debug] log initialization failed: {error}");
            }
            // 上次会话残留的可回退删除暂存项：补送入系统回收站（后台执行，不阻塞启动）
            std::thread::spawn(files::fs::sweep_undo_dir);
            if let Some(cfg) = app.try_state::<theme::ThemeState>() {
                let path = cfg.0.lock().ok().map(|c| c.background_image.clone());
                if let Some(Some(p)) = path {
                    if !p.trim().is_empty() {
                        let _ = app.asset_protocol_scope().allow_file(p.trim());
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::command_history::command_history_record,
            commands::command_history::command_history_list,
            commands::command_history::command_history_mutate,
            commands::command_history::command_history_preferences,
            commands::command_history::command_history_save_preferences,
            commands::command_history::command_history_context,
            platform::context_menu::context_menu_status,
            platform::context_menu::context_menu_manage,
            platform::context_menu::shell_launch_directory,
            platform::context_menu::shell_take_forwarded_directories,
            platform::window_chrome::apply_window_frame,
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
            agent::ai::provider_key_hint,
            agent::ai::provider_key_reveal,
            agent::ai::provider_fetch_models,
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
            agent::skills::market_github_list,
            agent::skills::market_github_install,
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
            agent::permissions::authorize_tool_call,
            agent::permissions::approve_tool_call,
            agent::permissions::tool_policy_get,
            agent::permissions::tool_policy_set_level,
            agent::permissions::tool_policy_clear_session_grants,
            terminal::pty::pty_spawn,
            diagnostics::diagnostics_set_auto_save,
            diagnostics::diagnostics_export,
            diagnostics::diagnostics_log_directory,
            terminal::debug::terminal_debug_set,
            terminal::debug::terminal_debug_status,
            terminal::debug::terminal_debug_record,
            terminal::debug::terminal_debug_records,
            terminal::debug::terminal_debug_log_path,
            terminal::shells::list_shells,
            remote::ssh_config::ssh_config_candidates,
            remote::ssh::ssh_connections_list,
            remote::ssh::ssh_connection_save,
            remote::ssh::ssh_connection_delete,
            remote::ssh::ssh_connection_touch,
            remote::ssh::ssh_test,
            remote::ssh::ssh_system_status,
            remote::network::ssh_network_probe,
            remote::ssh::ssh_authenticate_session,
            remote::ssh::ssh_forget_session_auth,
            remote::ssh::ssh_host_key_info,
            remote::ssh::ssh_trust_host_key,
            remote::ssh::ssh_list,
            remote::ssh::ssh_stat,
            remote::ssh::ssh_search,
            remote::ssh::ssh_search_cancel,
            remote::ssh::ssh_download,
            remote::ssh::ssh_rename,
            remote::ssh::ssh_create_file,
            remote::ssh::ssh_create_dir,
            remote::ssh::ssh_move,
            remote::ssh::ssh_copy,
            remote::ssh::ssh_stage_delete,
            remote::ssh::ssh_restore_staged,
            remote::ssh::ssh_purge_staged,
            remote::ssh::ssh_upload,
            terminal::pty::pty_write,
            terminal::pty::pty_resize,
            terminal::pty::pty_close,
            terminal::pty::pty_kill_foreground,
            files::fs::fs_list,
            files::fs::fs_roots,
            files::fs::fs_disks,
            files::fs::fs_home,
            files::fs::fs_stat,
            files::fs::fs_rename,
            files::fs::fs_create_file,
            files::fs::fs_create_dir,
            files::fs::fs_copy,
            files::fs::fs_move,
            files::fs::fs_stage_delete,
            files::fs::fs_restore_staged,
            files::fs::fs_purge_staged,
            files::fs::which_cmd,
            files::fs::read_file_text,
            files::fs::write_file_text,
            files::fs::edit_file_text,
            files::fs::fs_search,
            files::fs::save_attachment,
            files::fs::read_attachment,
            files::fs::import_attachment,
            files::grants::pick_path,
            agent::acp::acp_handshake,
            agent::acp::acp_harnesses,
            agent::acp::acp_harness_save,
            agent::acp::acp_open,
            agent::acp::acp_prompt,
            agent::acp::acp_cancel,
            agent::acp::acp_close,
            agent::acp::acp_answer_permission,
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
            commands::conversation::list_conversations,
            commands::conversation::save_conversation,
            commands::conversation::append_conversation_message,
            commands::conversation::list_conversation_messages,
            commands::conversation::delete_conversation,
            commands::conversation::delete_conversation_message,
            commands::session::archive_session,
            commands::session::restore_session,
            commands::session::update_session_title,
            commands::session::update_session_cwd,
            commands::session::update_session_payload,
            commands::session::get_session,
            commands::session::delete_session,
            commands::session::record_block,
            commands::session::append_chat_message,
            commands::session::list_chat_messages,
            commands::session::delete_chat_message,
            commands::session::list_sessions,
            commands::session::get_session_blocks,
            commands::group::groups_list,
            commands::group::groups_apply_plan,
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
            remote::transfer::transfers_clear,
            remote::transfer::transfers_list,
            remote::transfer::transfers_control,
            remote::transfer::transfers_delete,
            commands::download::downloads_list,
            commands::download::downloads_clear,
            commands::download::downloads_delete,
            commands::download::downloads_discard,
            commands::clipboard::clipboard_write_files,
            commands::clipboard::clipboard_read_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 退出时不再归档 active 会话：保留「上次打开未关闭的标签」供下次启动恢复。
    app.run(|_app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Err(error) = diagnostics::flush_logs() { eprintln!("[diagnostics] {error}"); }
        }
    });
}

#[cfg(target_os = "macos")]
fn configure_keyboard_input() {
    use objc2_foundation::{NSString, NSUserDefaults};
    // These preferences belong to this application, so terminal keys repeat normally.
    let defaults = NSUserDefaults::standardUserDefaults();
    for key in [
        "ApplePressAndHoldEnabled",
        "WebAutomaticSpellingCorrectionEnabled",
        "WebAutomaticTextReplacementEnabled",
    ] {
        defaults.setBool_forKey(false, &NSString::from_str(key));
    }
}
