use portable_pty::{native_pty_system, CommandBuilder, Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::session::{SessionInfo, SessionOptions, SessionStore, SessionType};
use crate::terminal_parser::{TerminalEvent, TerminalParser};

/// Payload emitted from Rust to frontend for PTY output.
/// Events are pre-parsed escape sequences — the frontend no longer parses raw bytes.
#[derive(Clone, serde::Serialize)]
pub struct PtyOutputPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub events: Vec<TerminalEvent>,
}

/// Payload for PTY exit event
#[derive(Clone, serde::Serialize)]
pub struct PtyExitPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

/// Payload for session created event
#[derive(Clone, serde::Serialize)]
pub struct SessionCreatedPayload {
    pub session: SessionInfo,
}

/// Payload for session closed event
#[derive(Clone, serde::Serialize)]
pub struct SessionClosedPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

/// Payload for title change event
#[derive(Clone, serde::Serialize)]
pub struct TitleChangePayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub title: String,
}

/// Managed PTY session — metadata + shared child + stdin writer + master for resize
struct ManagedSession {
    info: SessionInfo,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    writer: Box<dyn Write + Send>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
}

/// PTY Manager — spawns shells, routes I/O, manages lifecycle.
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, ManagedSession>>>,
    store: Arc<Mutex<SessionStore>>,
}

impl PtyManager {
    pub fn new(store: Arc<Mutex<SessionStore>>) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            store,
        }
    }

    /// Create a new local PTY session. Spawns a shell process.
    pub fn create_session(
        &self,
        opts: SessionOptions,
        app_handle: AppHandle,
    ) -> Result<SessionInfo, String> {
        let store = self.store.lock().map_err(|e| e.to_string())?;
        let count = store.list().len();

        if count >= 20 {
            return Err("Maximum 20 concurrent sessions reached".into());
        }
        drop(store);

        // Resolve shell
        let shell = opts
            .shell
            .or_else(|| std::env::var("SHELL").ok())
            .unwrap_or_else(|| {
                if cfg!(target_os = "windows") {
                    "powershell.exe".into()
                } else {
                    "/bin/zsh".into()
                }
            });

        // Resolve cwd
        let cwd = opts
            .cwd
            .or_else(|| std::env::var("HOME").ok())
            .or_else(|| {
                #[cfg(not(target_os = "windows"))]
                {
                    std::env::var("HOME")
                        .or_else(|_| std::env::var("USERPROFILE"))
                        .ok()
                }
                #[cfg(target_os = "windows")]
                {
                    std::env::var("USERPROFILE").ok()
                }
            })
            .unwrap_or_else(|| "/".into());

        let cols = opts.cols.unwrap_or(80);
        let rows = opts.rows.unwrap_or(24);

        // Build the command
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&cwd);

        // Set TERM environment
        cmd.env("TERM", "xterm-256color");

        // Spawn PTY
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        drop(pair.slave); // master is all we need, but we must move master before drop

        // Build session info
        let mut store = self.store.lock().map_err(|e| e.to_string())?;
        let id = format!(
            "local-{}-{}",
            store.list().len() + 1,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );

        let session = SessionInfo {
            id: id.clone(),
            session_type: SessionType::Local,
            title: shell
                .split('/')
                .last()
                .unwrap_or(&shell)
                .to_string(),
            cwd: Some(cwd),
            shell: Some(shell),
            cols,
            rows,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            host: None,
            username: None,
        };

        store.add(session.clone());
        drop(store);

        // Wrap child in Arc<Mutex<>> for shared access
        let child_arc = Arc::new(Mutex::new(child));

        // Get reader for stdout/stderr and writer for stdin
        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;
        let writer = pair.master.take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        // Keep master for resize operations
        let master: Box<dyn MasterPty + Send> = pair.master;
        let master_arc: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(master));

        // Store session with writer and master
        {
            let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
            sessions.insert(id.clone(), ManagedSession {
                info: session.clone(),
                child: child_arc.clone(),
                writer,
                master: master_arc.clone(),
            });
        }

        // Start read loop for PTY output
        let sid = id.clone();
        let handle = app_handle.clone();
        let session_store = self.store.clone();
        let session_map = self.sessions.clone();
        let thread_child = child_arc.clone();

        std::thread::spawn(move || {
            let mut read_buf = [0u8; 4096];
            let mut parser = TerminalParser::new();
            loop {
                match reader.read(&mut read_buf) {
                    Ok(0) => {
                        let exit_code = thread_child.lock().ok()
                            .and_then(|mut c| c.try_wait().ok().flatten())
                            .map(|s| s.exit_code())
                            .unwrap_or(0) as i32;
                        let _ = handle.emit("pty:exit", PtyExitPayload {
                            session_id: sid.clone(), exit_code,
                        });
                        if let Ok(mut s) = session_store.lock() { s.remove(&sid); }
                        let _ = session_map.lock().map(|mut s| s.remove(&sid));
                        break;
                    }
                    Ok(n) => {
                        parser.push(&read_buf[..n]);
                        let events = parser.take_events();
                        if events.is_empty() { continue; }
                        for ev in &events {
                            if let TerminalEvent::OscTitle(ref title) = ev {
                                let _ = handle.emit("pty:title-change", TitleChangePayload {
                                    session_id: sid.clone(), title: title.clone(),
                                });
                                if let Ok(mut s) = session_store.lock() { s.update_title(&sid, title); }
                            }
                        }
                        // Split large event batches to avoid hitting Tauri IPC size limits.
                        // Claude TUI renders can produce 500+ events per frame; sending them
                        // all in one JSON array risks truncation.
                        for chunk in events.chunks(128) {
                            let _ = handle.emit("pty:output", PtyOutputPayload {
                                session_id: sid.clone(),
                                events: chunk.to_vec(),
                            });
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(session)
    }

    /// Write data to a session's stdin via PTY master writer.
    pub fn write_to_session(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.get_mut(id) {
            session.writer.write_all(data.as_bytes())
                .map_err(|e| format!("Write failed: {}", e))?;
            Ok(())
        } else {
            Err(format!("Session {} not found", id))
        }
    }

    /// Resize a session's PTY using the stored master.
    pub fn resize_session(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.get(id) {
            let master = session.master.lock().map_err(|e| e.to_string())?;
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Resize failed: {}", e))?;

            // Update stored metadata
            drop(master);
            drop(sessions);
            if let Ok(mut store) = self.store.lock() {
                if let Some(mut info) = store.get(id).cloned() {
                    info.cols = cols;
                    info.rows = rows;
                    store.remove(id);
                    store.add(info);
                }
            }
            Ok(())
        } else {
            Err(format!("Session {} not found", id))
        }
    }

    /// Close a session — kill the child process.
    pub fn close_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.remove(id) {
            // Killing the child will cause the read loop to get EOF and clean up
            drop(session);
            Ok(())
        } else {
            Err(format!("Session {} not found", id))
        }
    }

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.store.lock()
            .map(|s| s.list())
            .unwrap_or_default()
    }
}


