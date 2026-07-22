#![allow(dead_code)] // Phase 1-4 placeholders

mod commands;
mod pty;
mod session;
mod settings;

use commands::AppState;
use session::SessionStore;
use settings::SettingsManager;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(Mutex::new(SessionStore::new()));
    let pty_manager = pty::PtyManager::new(store);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()
                .map_err(|e| e.to_string())?;
            let settings = SettingsManager::new(data_dir);
            let state = Arc::new(Mutex::new(AppState {
                pty_manager,
                settings,
            }));
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_pty,
            commands::write_pty,
            commands::resize_pty,
            commands::close_pty,
            commands::list_pty,
            commands::load_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
