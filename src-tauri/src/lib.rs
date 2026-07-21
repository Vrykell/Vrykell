#![allow(dead_code)] // Phase 1-4 placeholders

mod commands;
mod pty;
mod session;

use commands::AppState;
use session::SessionStore;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(Mutex::new(SessionStore::new()));
    let pty_manager = pty::PtyManager::new(store);

    let state = Arc::new(Mutex::new(AppState { pty_manager }));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::create_pty,
            commands::write_pty,
            commands::resize_pty,
            commands::close_pty,
            commands::list_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
