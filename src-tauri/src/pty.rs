use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<HashMap<String, PtySession>>);

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: String,
}

#[cfg(test)]
struct TestSession {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn Child + Send + Sync>,
}

#[cfg(test)]
fn spawn_shell(cols: u16, rows: u16, cwd: Option<String>) -> Result<TestSession, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new_default_prog();
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    Ok(TestSession { reader, writer, _child: child })
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new_default_prog();
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    state.0.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        PtySession { master: pair.master, writer, child },
    );

    let tid = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = app.emit("pty-exit", PtyExit { id: tid.clone() });
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    if app.emit("pty-output", PtyOutput { id: tid.clone(), data }).is_err() {
                        break; // 窗口已关闭
                    }
                }
                Err(_) => break,
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("session not found")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("session not found")?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn pty_roundtrip_echoes_input() {
        let mut session = spawn_shell(80, 24, None).expect("spawn");
        session.writer.write_all(b"echo v2-pty-ok\n").unwrap();
        session.writer.flush().unwrap();
        let mut out = String::new();
        let mut buf = [0u8; 4096];
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !out.contains("v2-pty-ok") && std::time::Instant::now() < deadline {
            match session.reader.read(&mut buf) {
                Ok(n) if n > 0 => out.push_str(&String::from_utf8_lossy(&buf[..n])),
                _ => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
        assert!(out.contains("v2-pty-ok"), "no echo, got: {out:?}");
    }
}
