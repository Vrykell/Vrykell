use std::sync::{Arc, Mutex};

use crate::core::settings::SettingsManager;
use crate::pty::manager::PtyManager;

/// Shared application state managed by Tauri.
pub struct AppState {
    pub pty_manager: PtyManager,
    pub settings: SettingsManager,
}

impl AppState {
    pub fn new(
        pty_manager: PtyManager,
        settings: SettingsManager,
    ) -> Arc<Mutex<Self>> {
        Arc::new(Mutex::new(Self {
            pty_manager,
            settings,
        }))
    }
}
