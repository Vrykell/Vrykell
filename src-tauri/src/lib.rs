#![allow(dead_code)] // Phase 1-4 placeholders

mod app;
mod core;
mod pty;

use std::sync::{Arc, Mutex};
use tauri::Manager;

use app::commands;
use app::state::AppState;
use core::settings::SettingsManager;
use core::store::SessionStore;
use pty::manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(Mutex::new(SessionStore::new()));
    let pty_manager = PtyManager::new(store);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()
                .map_err(|e| e.to_string())?;
            let settings = SettingsManager::new(data_dir);
            let state = AppState::new(pty_manager, settings);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_pty,
            commands::write_pty,
            commands::resize_pty,
            commands::close_pty,
            commands::list_pty,
            commands::has_foreground_process,
            commands::exit_app,
            commands::load_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
