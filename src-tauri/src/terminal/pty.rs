use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::terminal::{debug, shell_integration};
use crate::terminal::io_window::{OutputStats, ReaderWindow};
use crate::terminal::scan::{ScanEvent, StreamScanner};

/// How long a normal close waits for a session to exit before it is force-killed.
const CLOSE_DEADLINE: std::time::Duration = std::time::Duration::from_millis(2000);
/// The whole process-wide sweep (page reload, app exit) shares this budget.
const CLOSE_ALL_DEADLINE: std::time::Duration = std::time::Duration::from_millis(500);
/// Natural exits should already be reaped; this only guards a stale wait.
const REAP_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1000);

/// A poisoned lock must never stop process cleanup halfway: the child still has to be
/// terminated even when another thread panicked while holding the session state.
fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Streaming UTF-8 decoder: buffers incomplete multi-byte sequences across read boundaries.
pub struct StreamDecoder {
    tail: Vec<u8>,
}

impl StreamDecoder {
    pub fn new() -> Self {
        Self { tail: Vec::new() }
    }

    /// Feeds new bytes in and returns the prefix that decodes completely; an incomplete tail stays buffered.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.tail.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.tail) {
                Ok(s) => {
                    out.push_str(s);
                    self.tail.clear();
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    out.push_str(&String::from_utf8_lossy(&self.tail[..valid]));
                    match e.error_len() {
                        // Invalid bytes: drop n bytes and substitute U+FFFD, then continue (more may follow)
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.tail.drain(..valid + bad);
                        }
                        // The tail is a valid but incomplete multi-byte prefix: keep it for next time
                        None => {
                            self.tail.drain(..valid);
                            break;
                        }
                    }
                }
            }
        }
        out
    }
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    /// The PTY stdin writer has its own lock. A write blocks whenever the
    /// foreground program stops reading stdin, and that must never hold the
    /// session lock: resize/close/kill would queue behind it and freeze the UI.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
    input_pending: Arc<AtomicBool>,
    input_epoch: Arc<AtomicU64>,
    /// Set by the close path so the reader coordinator stops even when its reader
    /// handle stays open after the process tree was terminated.
    closed: Arc<AtomicBool>,
}

fn session_has_exited(session: &Arc<Mutex<PtySession>>) -> bool {
    lock_unpoisoned(session).child.try_wait().ok().flatten().is_some()
}

#[derive(Default)]
pub struct PtyState(pub Mutex<HashMap<String, Arc<Mutex<PtySession>>>>);

/// Wait for a child without ever blocking past `timeout`; a stopped foreground
/// program must not hold a close command, the startup sweep or the app exit open.
fn wait_child_bounded(child: &mut dyn Child, timeout: std::time::Duration) -> Option<i32> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.exit_code() as i32),
            Ok(None) => {
                if std::time::Instant::now() >= deadline { return None; }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(_) => return None,
        }
    }
}

/// Terminate a child and make sure it is reaped; used when a spawn cannot be
/// completed and no session owns the handles yet.
fn kill_child_and_reap(child: &mut dyn Child) {
    kill_child_tree(child);
    if wait_child_bounded(child, CLOSE_ALL_DEADLINE).is_none() {
        force_kill_child(child);
        let _ = wait_child_bounded(child, CLOSE_ALL_DEADLINE);
    }
}

/// Last resort for a session that ignored the graceful signals.
#[cfg(unix)]
fn force_kill_child(child: &mut dyn Child) {
    if let Some(pid) = child.process_id() {
        unsafe { libc::kill(pid as i32, libc::SIGKILL); }
    }
}

#[cfg(not(unix))]
fn force_kill_child(child: &mut dyn Child) {
    let _ = child.kill();
}

/// Closing the pane must reach the foreground job as well, not only the shell:
/// without it a program that ignores the shell's hangup keeps the PTY alive.
#[cfg(unix)]
fn signal_foreground_close(session: &PtySession) {
    let Some(fd) = session.master.as_raw_fd() else { return };
    let pgid = unsafe { libc::tcgetpgrp(fd) };
    if pgid <= 0 || Some(pgid as u32) == session.child.process_id() { return; }
    unsafe {
        libc::kill(-pgid, libc::SIGHUP);
        libc::kill(-pgid, libc::SIGTERM);
    }
}

/// Escalation for a foreground job that ignored the graceful signals.
#[cfg(unix)]
fn force_kill_foreground(session: &PtySession) {
    let Some(fd) = session.master.as_raw_fd() else { return };
    let pgid = unsafe { libc::tcgetpgrp(fd) };
    if pgid > 0 {
        unsafe { libc::kill(-pgid, libc::SIGKILL); }
    }
}

#[cfg(not(unix))]
fn force_kill_foreground(_session: &PtySession) {}

fn begin_session_close(state: &mut PtySession) {
    state.closed.store(true, Ordering::Release);
    #[cfg(unix)]
    signal_foreground_close(state);
    kill_child_tree(&mut *state.child);
}

fn force_session_close(state: &mut PtySession) {
    force_kill_foreground(state);
    force_kill_child(&mut *state.child);
}

/// Terminate one session and reap it within `deadline`.
fn close_session(session: &Arc<Mutex<PtySession>>, deadline: std::time::Instant) {
    let mut state = lock_unpoisoned(session);
    begin_session_close(&mut state);
    // Leave time to reap a child that ignores the graceful signals.
    let grace = deadline.saturating_duration_since(std::time::Instant::now()) / 2;
    if wait_child_bounded(&mut *state.child, grace).is_some() {
        return;
    }
    force_session_close(&mut state);
    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
    let _ = wait_child_bounded(&mut *state.child, remaining);
}

/// Remove one session by id and close it. Used when the output channel is gone:
/// a session that can no longer reach a window must not be left running.
fn close_session_by_id(app: &AppHandle, id: &str) {
    let session = lock_unpoisoned(&app.state::<PtyState>().0).remove(id);
    if let Some(session) = session {
        close_session(&session, std::time::Instant::now() + CLOSE_DEADLINE);
    }
    lock_unpoisoned(&app.state::<KillState>().0).remove(id);
}

/// Terminate a batch of sessions within one shared deadline.
fn close_sessions(sessions: Vec<Arc<Mutex<PtySession>>>, deadline: std::time::Instant) {
    // Signal the entire batch before waiting so one slow child cannot starve the others.
    for session in &sessions {
        begin_session_close(&mut lock_unpoisoned(session));
    }
    let graceful_deadline = std::time::Instant::now()
        + deadline.saturating_duration_since(std::time::Instant::now()) / 2;
    wait_sessions_bounded(&sessions, graceful_deadline);
    for session in &sessions {
        let mut state = lock_unpoisoned(session);
        if !matches!(state.child.try_wait(), Ok(Some(_))) { force_session_close(&mut state); }
    }
    wait_sessions_bounded(&sessions, deadline);
}

fn wait_sessions_bounded(sessions: &[Arc<Mutex<PtySession>>], deadline: std::time::Instant) {
    loop {
        let mut all_exited = true;
        for session in sessions {
            let exited = matches!(lock_unpoisoned(session).child.try_wait(), Ok(Some(_)));
            all_exited &= exited;
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if all_exited || remaining.is_zero() { return; }
        std::thread::sleep(remaining.min(std::time::Duration::from_millis(10)));
    }
}

/// Close every session owned by this process. Called on webview page loads and on
/// app exit, where the frontend can no longer reach the old session ids.
pub fn close_all_sessions<R: tauri::Runtime>(app: &AppHandle<R>) {
    let sessions: Vec<Arc<Mutex<PtySession>>> = {
        let state = app.state::<PtyState>();
        let mut map = lock_unpoisoned(&state.0);
        map.drain().map(|(_, session)| session).collect()
    };
    if debug::enabled() && !sessions.is_empty() {
        debug::write("close-all", format!("sessions={}", sessions.len()));
    }
    close_sessions(sessions, std::time::Instant::now() + CLOSE_ALL_DEADLINE);
    lock_unpoisoned(&app.state::<KillState>().0).clear();
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    events: Vec<ScanEvent>,
    #[serde(rename = "inputEpoch")]
    input_epoch: u64,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: String,
    /// Child exit code, so a session can tell a clean remote exit from a dropped connection.
    code: Option<i32>,
}

/// Messages from the read thread to the main loop (Windows has no poll, so a channel plus recv_timeout drives the idle-timeout flush).
enum ReadMsg {
    Data(Vec<u8>),
    End(&'static str),
}

#[cfg(test)]
#[allow(dead_code)] // master/child are only read by Unix tests; keep the struct complete on Windows
struct TestSession {
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
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
    Ok(TestSession { master: pair.master, reader, writer, child })
}

pub use super::ssh_command::SshTarget;
#[cfg(test)]
use super::ssh_command::{ssh_args, verified_ssh_options};

/// Builds the launch command for the selected shell or SSH target and injects OSC 133 shell integration.
fn build_shell_cmd(
    cwd: Option<String>,
    shell: Option<String>,
    ssh: Option<SshTarget>,
    open_mode: Option<String>,
) -> Result<CommandBuilder, String> {
    // 1. SSH connection: `ssh -t [-p port] [user@]host [<remote injected command>]`
    //    -t forces a TTY; block mode appends the remote injected command (OSC 133 shell integration,
    //    the safest variant, falling back to classic mode when injection fails); classic injects nothing (plain interaction).
    if let Some(target) = ssh {
        let remote = (open_mode.as_deref() != Some("classic")).then(shell_integration::ssh_remote_command);
        return super::ssh_command::build_ssh_command_in_directory(&target, remote.as_deref(), cwd.as_deref());
    }

    let integ_dir = shell_integration::integration_dir().ok();
    let requested = shell.as_deref().unwrap_or_default();

    // 2. Explicit shell: zsh/bash/powershell get the integration script injected; cmd has no integration and falls back to classic
    match requested {
        "zsh" => {
            let mut cmd = CommandBuilder::new("zsh");
            if let Some(ref dir) = integ_dir {
                cmd.env("ZDOTDIR", dir.join("zsh").to_string_lossy().to_string());
            }
            set_shell_open_mode(&mut cmd, open_mode.as_deref());
            if let Some(d) = cwd { cmd.cwd(d); }
            return Ok(cmd);
        }
        "bash" => {
            let mut cmd = CommandBuilder::new("bash");
            if let Some(ref dir) = integ_dir {
                cmd.arg("--rcfile");
                cmd.arg(dir.join("bash/rc").to_string_lossy().replace('\\', "/"));
            }
            set_shell_open_mode(&mut cmd, open_mode.as_deref());
            if let Some(d) = cwd { cmd.cwd(d); }
            return Ok(cmd);
        }
        "powershell" | "pwsh" => {
            let prog = if requested == "pwsh" { "pwsh" } else { "powershell" };
            return Ok(powershell_command(prog, &integ_dir, cwd, open_mode.as_deref()));
        }
        "cmd" => {
            return Ok(cmd_command(cwd));
        }
        _ => {}
    }

    // 3. No explicit choice: Windows prefers pwsh, then powershell, then cmd (no bundled Unix shell default anymore);
    //    Unix keeps probing $SHELL.
    #[cfg(target_os = "windows")]
    {
        match default_windows_shell() {
            "cmd" => return Ok(cmd_command(cwd)),
            prog => return Ok(powershell_command(prog, &integ_dir, cwd, open_mode.as_deref())),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell_env = std::env::var("SHELL").unwrap_or_default();
        if let Some(ref dir) = integ_dir {
            if shell_env.contains("zsh") {
                let mut cmd = CommandBuilder::new(&shell_env);
                cmd.env("ZDOTDIR", dir.join("zsh").to_string_lossy().to_string());
                set_shell_open_mode(&mut cmd, open_mode.as_deref());
                if let Some(d) = cwd { cmd.cwd(d); }
                return Ok(cmd);
            }
            if shell_env.contains("bash") {
                let mut cmd = CommandBuilder::new(&shell_env);
                cmd.arg("--rcfile");
                cmd.arg(dir.join("bash/rc").to_string_lossy().replace('\\', "/"));
                set_shell_open_mode(&mut cmd, open_mode.as_deref());
                if let Some(d) = cwd { cmd.cwd(d); }
                return Ok(cmd);
            }
        }
        // Fallback: no shell integration
        let mut cmd = CommandBuilder::new_default_prog();
        if let Some(d) = cwd { cmd.cwd(d); }
        Ok(cmd)
    }
}

/// Builds the PowerShell / pwsh launch command (injects the OSC 133 integration script).
fn powershell_command(
    prog: &str,
    integ_dir: &Option<std::path::PathBuf>,
    cwd: Option<String>,
    open_mode: Option<&str>,
) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(prog);
    if let Some(dir) = integ_dir {
        cmd.arg("-NoLogo");
        cmd.arg("-NoExit");
        cmd.arg("-File");
        cmd.arg(dir.join("powershell").join("profile.ps1").to_string_lossy().to_string());
    }
    set_shell_open_mode(&mut cmd, open_mode);
    if let Some(d) = cwd { cmd.cwd(d); }
    cmd
}

fn set_shell_open_mode(cmd: &mut CommandBuilder, open_mode: Option<&str>) {
    cmd.env("VRYKELL_BLOCK_MODE", if open_mode == Some("block") { "1" } else { "0" });
}

/// Builds the cmd launch command (no integration).
fn cmd_command(cwd: Option<String>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("cmd");
    if let Some(d) = cwd { cmd.cwd(d); }
    cmd
}

/// Adds common user bin directories to the PTY child's PATH.
///
/// A GUI app (launched from the desktop) inherits only the system default PATH
/// (/usr/bin:/bin:/usr/sbin:/sbin) without user tool directories such as /usr/local/bin
/// (package manager or manual installs); running CLI tools in the terminal ends in
/// command not found, and .zshrc dependencies such as `npm config get prefix` fail too.
/// Existing directories precede the system PATH (as a seed; .zshrc still decides the final PATH).
fn merge_user_bin_paths(cmd: &mut CommandBuilder) {
    merge_inherited_bin_paths(cmd, std::env::var_os("PATH").unwrap_or_default());
}

fn merge_inherited_bin_paths(cmd: &mut CommandBuilder, current: std::ffi::OsString) {
    // `PATH` uses `:` on Unix and `;` on Windows.  Splitting/joining it by
    // hand silently turns Windows drive letters into separate entries and
    // can make the selected shell (especially `pwsh`) impossible to spawn.
    let mut merged: Vec<PathBuf> = Vec::new();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let push = |dir: PathBuf,
                require_directory: bool,
                merged: &mut Vec<PathBuf>,
                seen: &mut std::collections::HashSet<PathBuf>| {
        if dir.as_os_str().is_empty()
            || (require_directory && !dir.is_dir())
            || seen.contains(&path_identity(&dir))
        {
            return;
        }
        seen.insert(path_identity(&dir));
        merged.push(dir);
    };

    #[cfg(unix)]
    {
        let home = dirs::home_dir().unwrap_or_default();
        for dir in [
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            home.join(".local/bin"),
            home.join(".cargo/bin"),
        ] {
            push(dir, true, &mut merged, &mut seen);
        }
    }

    // Keep inherited entries even when a directory has disappeared since the
    // process started.  Dropping them would change the user's shell PATH.
    for dir in std::env::split_paths(&current) {
        push(dir, false, &mut merged, &mut seen);
    }
    #[cfg(windows)]
    for value in registered_windows_paths() {
        for directory in std::env::split_paths(&value) {
            push(directory, false, &mut merged, &mut seen);
        }
    }

    // `join_paths` applies the platform separator and preserves Windows drive
    // letters.  Fall back to the original value if an unusual entry cannot be
    // joined rather than replacing PATH with an empty value.
    let path = std::env::join_paths(merged).unwrap_or(current);
    cmd.env("PATH", path);
}

#[cfg(windows)]
fn registered_windows_paths() -> Vec<std::ffi::OsString> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};
    let mut result = Vec::new();
    let value: Vec<u16> = "Path\0".encode_utf16().collect();
    for (root, path) in [(HKEY_LOCAL_MACHINE, "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"), (HKEY_CURRENT_USER, "Environment")] {
        let subkey: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let mut bytes = 0u32;
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
        unsafe {
            if RegGetValueW(root, subkey.as_ptr(), value.as_ptr(), flags, std::ptr::null_mut(), std::ptr::null_mut(), &mut bytes) != 0 || bytes > 1_048_576 { continue; }
            let mut buffer = vec![0u16; bytes as usize / 2 + 1];
            if RegGetValueW(root, subkey.as_ptr(), value.as_ptr(), flags, std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut bytes) != 0 { continue; }
            let length = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
            result.push(std::ffi::OsString::from_wide(&buffer[..length]));
        }
    }
    result
}

fn path_identity(directory: &std::path::Path) -> PathBuf {
    #[cfg(windows)]
    { PathBuf::from(directory.to_string_lossy().to_lowercase()) }
    #[cfg(not(windows))]
    { directory.to_path_buf() }
}

/// GUI launches may inherit an empty or dumb TERM, which breaks terminal capability checks.
/// Provide xterm-256color and truecolor defaults while preserving other explicit values.
fn merge_term_env(cmd: &mut CommandBuilder) {
    if std::env::var("TERM")
        .map(|value| value.trim().is_empty() || value.eq_ignore_ascii_case("dumb"))
        .unwrap_or(true)
    {
        cmd.env("TERM", "xterm-256color");
    }
    if std::env::var("COLORTERM").map(|v| v.is_empty()).unwrap_or(true) {
        cmd.env("COLORTERM", "truecolor");
    }
}

/// Fallback UTF-8 locale for a GUI-launched shell, which inherits no `LANG`/`LC_*` at all.
/// `en_US.UTF-8` always exists on macOS; other Unix systems use `C.UTF-8`, guaranteed to be
/// available in a UTF-8 form.
#[cfg(target_os = "macos")]
const DEFAULT_UTF8_LOCALE: &str = "en_US.UTF-8";
#[cfg(all(unix, not(target_os = "macos")))]
const DEFAULT_UTF8_LOCALE: &str = "C.UTF-8";

/// Whether a locale value requests UTF-8 character handling.
#[cfg(unix)]
fn is_utf8_locale(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    lowered.contains("utf-8") || lowered.contains("utf8")
}

/// Locale variables (name, value) to inject into the child, given the inherited values.
///
/// A GUI-launched process has no `LANG`/`LC_*`, so locale-aware full-screen programs fall back to
/// the C locale: they read a UTF-8 stream as latin1 and paint the C1 high byte of every multibyte
/// character as `~X` (the garbled CJK seen in their UI), while byte-through programs look fine.
/// When any inherited variable already requests UTF-8 this is a no-op; otherwise `LC_CTYPE` is
/// supplied so only the character-encoding category changes, not `LC_MESSAGES` (message language).
#[cfg(unix)]
fn locale_overrides(lc_all: Option<&str>, lc_ctype: Option<&str>, lang: Option<&str>) -> Vec<(&'static str, &'static str)> {
    let configured_utf8 = [lc_all, lc_ctype, lang]
        .into_iter()
        .flatten()
        .any(|value| !value.is_empty() && is_utf8_locale(value));
    if configured_utf8 {
        return Vec::new();
    }
    let mut overrides = vec![("LC_CTYPE", DEFAULT_UTF8_LOCALE)];
    // Also fill an empty LANG (the GUI case) for programs that only consult it; an explicit
    // non-UTF-8 LANG keeps its message language and gets its encoding fixed via LC_CTYPE alone.
    if lang.map(|value| value.is_empty()).unwrap_or(true) {
        overrides.push(("LANG", DEFAULT_UTF8_LOCALE));
    }
    overrides
}

/// Supply a UTF-8 locale to the spawned shell when the inherited environment has none.
#[cfg(unix)]
fn merge_locale_env(cmd: &mut CommandBuilder) {
    let read = |key: &str| std::env::var(key).ok();
    for (key, value) in locale_overrides(read("LC_ALL").as_deref(), read("LC_CTYPE").as_deref(), read("LANG").as_deref()) {
        cmd.env(key, value);
    }
}

/// Windows default shell: pwsh -> powershell -> cmd (cached in-process, so every new terminal does not spawn a probe).
#[cfg(target_os = "windows")]
pub(crate) fn default_windows_shell() -> &'static str {
    use std::sync::OnceLock;
    static DEFAULT: OnceLock<&'static str> = OnceLock::new();
    DEFAULT.get_or_init(|| {
        for prog in ["pwsh", "powershell"] {
            if crate::terminal::shells::shell_ok(prog) {
                return prog;
            }
        }
        "cmd"
    })
}

/// Result of openpty + spawning the shell: a fresh session id plus the handles kept in the
/// session table.
type SpawnedPty = (
    String,
    Box<dyn MasterPty + Send>,
    Box<dyn Read + Send>,
    Box<dyn Write + Send>,
    Box<dyn Child + Send + Sync>,
);

/// Create a PTY session: openpty + spawn the shell + inject PATH/TERM.
/// Every step blocks (the Windows pseudo console can take hundreds of ms), so callers must run
/// it on a blocking thread rather than the main thread.
fn spawn_pty(
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
    ssh: Option<SshTarget>,
    open_mode: Option<String>,
) -> Result<SpawnedPty, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = build_shell_cmd(cwd, shell, ssh, open_mode)?;
    // The parent desktop terminal may export VTE_VERSION; its OSC 133 hooks conflict with ours.
    cmd.env_remove("VTE_VERSION");
    // A GUI launch inherits a PATH without the user bin directories (/usr/local/bin and
    // friends); merge them into the child (the ssh branch benefits too).
    merge_user_bin_paths(&mut cmd);
    // A GUI launch can also inherit an empty TERM, which makes a full-screen TUI fail its
    // capability probe and hang; default it to xterm-256color.
    merge_term_env(&mut cmd);
    // GUI launches carry no locale either: the C locale makes vim and friends render multibyte
    // text as garbage. Provide a UTF-8 locale when none is configured.
    #[cfg(unix)]
    merge_locale_env(&mut cmd);
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    // A failure between spawn and session registration must not leave a shell with
    // no handle: kill and reap it before reporting the error.
    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            kill_child_and_reap(&mut *child);
            return Err(error.to_string());
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            drop(reader);
            kill_child_and_reap(&mut *child);
            return Err(error.to_string());
        }
    };
    Ok((format!("pty-{}", Uuid::new_v4()), pair.master, reader, writer, child))
}

#[tauri::command]
// Parameters mirror the frontend IPC contract (pty_spawn passes every field), so folding them into a struct requires a matching frontend change
#[allow(clippy::too_many_arguments)]
pub async fn pty_spawn(
    state: State<'_, PtyState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
    ssh: Option<SshTarget>,
    open_mode: Option<String>,
) -> Result<String, String> {
    let debug_shell = shell.clone();
    let debug_ssh = ssh.is_some();
    let debug_open_mode = open_mode.clone();
    let debug_requested_shell = debug_shell.as_deref().map(shell_kind).unwrap_or("default");
    let debug_shell_env = std::env::var("SHELL")
        .ok()
        .map(|value| shell_kind(&value))
        .unwrap_or("unset");
    let debug_integration_available = shell_integration::integration_dir().is_ok();
    let debug_term = std::env::var("TERM")
        .ok()
        .filter(|value| !value.trim().is_empty() && !value.eq_ignore_ascii_case("dumb"))
        .unwrap_or_else(|| "xterm-256color".to_string());
    let debug_colorterm = std::env::var("COLORTERM").ok().filter(|value| !value.is_empty())
        .unwrap_or_else(|| "truecolor".to_string());
    let debug_vte_inherited = std::env::var("VTE_VERSION").is_ok();
    let debug_cwd_set = cwd.is_some();
    // Locale vars determine whether locale-aware full-screen programs render multibyte text.
    let debug_lang = std::env::var("LANG").ok().filter(|value| !value.is_empty()).unwrap_or_else(|| "unset".to_string());
    let debug_lc_ctype = std::env::var("LC_CTYPE").ok().filter(|value| !value.is_empty()).unwrap_or_else(|| "unset".to_string());

    // Creating the session is blocking: run it on a blocking thread, never on the main thread.
    let (id, master, mut reader, writer, child) =
        tauri::async_runtime::spawn_blocking(move || spawn_pty(cols, rows, cwd, shell, ssh, open_mode))
            .await
            .map_err(|e| e.to_string())??;
    let input_pending = Arc::new(AtomicBool::new(false));
    let input_epoch = Arc::new(AtomicU64::new(0));
    let closed = Arc::new(AtomicBool::new(false));
    if debug::enabled() {
        debug::write(
            "spawn",
            format!(
                "id={} cols={} rows={} requested_shell={} shell_env={} integration_available={} ssh={} open_mode={:?} cwd_set={} term={} colorterm={} vte_inherited={} lang={} lc_ctype={} vte_integration_disabled=true",
                id,
                cols,
                rows,
                debug_requested_shell,
                debug_shell_env,
                debug_integration_available,
                debug_ssh,
                debug_open_mode,
                debug_cwd_set,
                debug_term,
                debug_colorterm,
                debug_vte_inherited,
                debug_lang,
                debug_lc_ctype,
            ),
        );
    }
    lock_unpoisoned(&state.0).insert(
        id.clone(),
        Arc::new(Mutex::new(PtySession {
            master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            input_pending: input_pending.clone(),
            input_epoch: input_epoch.clone(),
            closed: closed.clone(),
        })),
    );

    let tid = id.clone();
    let closed_flag = closed;
    std::thread::spawn(move || {
        // The blocking read runs on its own thread; the main loop uses recv_timeout for the idle-timeout flush.
        // Otherwise the last burst of output (such as the cmd/PowerShell prompt) stays in pending
        // until the next input/output flushes it (Windows has no poll, so everything goes through one channel).
        let (tx, rx) = std::sync::mpsc::channel::<ReadMsg>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = tx.send(ReadMsg::End("eof"));
                        break;
                    }
                    Ok(n) => {
                        let _ = tx.send(ReadMsg::Data(buf[..n].to_vec()));
                    }
                    Err(_) => {
                        let _ = tx.send(ReadMsg::End("read-error"));
                        break;
                    }
                }
            }
        });

        let mut decoder = StreamDecoder::new();
        let mut scanner = StreamScanner::new();
        // Output batching: group high-frequency read events into a window before emitting, avoiding an IPC + React storm on large output.
        // Flush triggers: accumulated threshold / FLUSH_INTERVAL since the last flush / idle timeout / EOF or read error.
        // pending holds the scanned structured events; pending_bytes tracks the raw payload byte count as the threshold basis.
        let mut pending: Vec<ScanEvent> = Vec::new();
        let mut pending_bytes = 0usize;
        let mut batch = super::output_batch::OutputBatchWindow::new(std::time::Instant::now());
        let mut window = ReaderWindow::new(std::time::Instant::now());
        loop {
            // The close path removed this session: stop the coordinator even though a
            // detached descendant may keep the reader handle open indefinitely.
            if closed_flag.load(Ordering::Acquire) {
                if let Some(line) = window.finish(std::time::Instant::now(), &tid) {
                    debug::write("pty-io", line);
                }
                if debug::enabled() {
                    debug::write("reader-end", format!("id={} reason=closed", tid));
                }
                break;
            }
            match rx.recv_timeout(batch.wait_timeout(std::time::Instant::now())) {
                Ok(ReadMsg::Data(bytes)) => {
                    let now = std::time::Instant::now();
                    let data = decoder.push(&bytes);
                    window.read(now, bytes.len(), data.len());
                    if let Some(line) = window.take(now, &tid) {
                        debug::write("pty-io", line);
                    }
                    if data.is_empty() {
                        continue; // incomplete tail, wait for the next read
                    }
                    let events = scanner.push(&data);
                    advance_input_epoch(&input_epoch, &events);
                    if events.is_empty() {
                        continue; // all pending (lone ESC and the like)
                    }
                    pending_bytes += data.len();
                    pending.extend(events);
                    // Hold only the short input burst so an intermediate repaint is not exposed.
                    if input_pending.swap(false, Ordering::AcqRel) {
                        batch.input_response(now);
                        window.held();
                    }
                    if batch.should_flush(pending_bytes, now) {
                        if let Some(stats) = flush_output(&app, &tid, &mut pending, &mut pending_bytes) {
                            window.output(stats);
                        }
                        batch.flushed(std::time::Instant::now());
                    }
                }
                // EOF / error / read thread dropped unexpectedly: flush the rest and settle the session
                Ok(ReadMsg::End(reason)) => {
                    if let Some(stats) = flush_output(&app, &tid, &mut pending, &mut pending_bytes) {
                        window.output(stats);
                    }
                    if let Some(line) = window.finish(std::time::Instant::now(), &tid) {
                        debug::write("pty-io", line);
                    }
                    if debug::enabled() {
                        debug::write("reader-end", format!("id={} reason={}", tid, reason));
                    }
                    let code = reap_session(&app, &tid);
                    let _ = app.emit("pty-exit", PtyExit { id: tid.clone(), code });
                    break;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    if let Some(stats) = flush_output(&app, &tid, &mut pending, &mut pending_bytes) {
                        window.output(stats);
                    }
                    if let Some(line) = window.finish(std::time::Instant::now(), &tid) {
                        debug::write("pty-io", line);
                    }
                    if debug::enabled() {
                        debug::write("reader-end", format!("id={} reason=channel-closed", tid));
                    }
                    let code = reap_session(&app, &tid);
                    let _ = app.emit("pty-exit", PtyExit { id: tid.clone(), code });
                    break;
                }
                // Idle timeout (no new data within FLUSH_INTERVAL): flush the pending tail so the last output reaches the screen promptly
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    let now = std::time::Instant::now();
                    if !pending.is_empty() {
                        if let Some(stats) = flush_output(&app, &tid, &mut pending, &mut pending_bytes) {
                            window.output(stats);
                        }
                        batch.flushed(now);
                    }
                    if let Some(line) = window.take(now, &tid) {
                        debug::write("pty-io", line);
                    }
                    if let Some(line) = window.idle(now, &tid) {
                        debug::write("read-idle", line);
                    }
                    // A retained console handle can keep its reader open after the child exits,
                    // and a session removed elsewhere means this coordinator is the last owner.
                    let session = lock_unpoisoned(&app.state::<PtyState>().0).get(&tid).cloned();
                    if session.is_none() || session.as_ref().is_some_and(session_has_exited) {
                        let reason = if session.is_none() { "closed" } else { "child-exit" };
                        if debug::enabled() { debug::write("reader-end", format!("id={} reason={}", tid, reason)); }
                        let code = reap_session(&app, &tid);
                        let _ = app.emit("pty-exit", PtyExit { id: tid.clone(), code });
                        break;
                    }
                }
            }
        }
    });
    Ok(id)
}

fn shell_kind(value: &str) -> &'static str {
    let name = value
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match name.as_str() {
        "bash" => "bash",
        "zsh" => "zsh",
        "fish" => "fish",
        "sh" | "dash" => "sh",
        "pwsh" => "pwsh",
        "powershell" => "powershell",
        "cmd" | "cmd.exe" => "cmd",
        _ => "custom",
    }
}

/// Flushes accumulated output (structured events); when emit fails (the window is gone) it also settles the session.
/// Returns what the batch carried, for the per-second window; `None` when there was nothing.
fn flush_output(
    app: &AppHandle,
    id: &str,
    pending: &mut Vec<ScanEvent>,
    pending_bytes: &mut usize,
) -> Option<OutputStats> {
    if pending.is_empty() {
        return None;
    }
    let mut stats = OutputStats::default();
    for event in pending.iter() {
        stats.events += 1;
        match event {
            ScanEvent::Data { text } => stats.data_bytes += text.len(),
            ScanEvent::Osc { .. } => stats.osc += 1,
            ScanEvent::AltEnter { .. } | ScanEvent::AltExit { .. } => stats.alt += 1,
        }
    }
    let events = std::mem::take(pending);
    *pending_bytes = 0;
    let session = lock_unpoisoned(&app.state::<PtyState>().0).get(id).cloned();
    let input_epoch = session.map(|session| lock_unpoisoned(&session).input_epoch.load(Ordering::Acquire)).unwrap_or(0);
    if app.emit("pty-output", PtyOutput { id: id.to_string(), events, input_epoch }).is_err() {
        // The window is gone: a session that can no longer reach any listener must be
        // terminated, not left running behind an id nobody owns.
        close_session_by_id(app, id);
    }
    Some(stats)
}

/** Invalidate pending paste chunks before output batching or webview delivery. */
fn advance_input_epoch(epoch: &AtomicU64, events: &[ScanEvent]) {
    if events.iter().any(|event| match event {
        ScanEvent::AltEnter { .. } | ScanEvent::AltExit { .. } => true,
        ScanEvent::Osc { code, .. } => matches!(code.as_str(), "133;A" | "133;C" | "133;D"),
        ScanEvent::Data { .. } => false,
    }) { epoch.fetch_add(1, Ordering::AcqRel); }
}

#[tauri::command]
pub fn pty_input_epoch(state: State<'_, PtyState>, id: String) -> Result<u64, String> {
    let session = lock_unpoisoned(&state.0).get(&id).cloned().ok_or("session not found")?;
    let epoch = lock_unpoisoned(&session).input_epoch.load(Ordering::Acquire);
    Ok(epoch)
}

#[tauri::command]
pub async fn pty_write(state: State<'_, PtyState>, id: String, data: String, expected_epoch: Option<u64>) -> Result<(), String> {
    // On the Windows console Enter is CR (0x0D); \n (0x0A) is Ctrl+J, which PSReadLine/cmd do not treat as Return.
    // The frontend sends commands with \n, so normalize it to CR here; otherwise PowerShell and the like never receive Return and the command does nothing.
    #[cfg(windows)]
    let data = normalize_enter(&data);
    let data_len = data.len();
    if debug::enabled() {
        debug::write("write-start", format!("id={} bytes={}", id, data_len));
    }
    // Take only the Arc handle from the global table and never hold the lock during IO - writing to the PTY
    // can block when the foreground process does not read stdin, and holding the global lock would freeze resize/signal/close for other sessions.
    let session = {
        let sessions = lock_unpoisoned(&state.0);
        sessions.get(&id).cloned().ok_or("session not found")?
    };
    // Blocking IO: run it on a blocking thread, and take only the writer lock.
    let log_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = write_session_guarded(&session, data.as_bytes(), expected_epoch);
        if debug::enabled() {
            debug::write(
                "write-complete",
                format!("id={} bytes={} ok={}", log_id, data_len, result.is_ok()),
            );
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write to a session's stdin. It takes **only the writer lock**: `write_all` blocks whenever
/// the foreground program stops reading stdin, and the session lock has to stay free for
/// pty_resize / pty_close / pty_kill_foreground. Sharing one lock queues those behind a stuck
/// write, and while they run on the main thread the whole UI freezes with them - the stop
/// button included, so force-quitting the app becomes the only way out.
#[cfg(test)]
fn write_session(session: &Arc<Mutex<PtySession>>, data: &[u8]) -> Result<(), String> {
    write_session_guarded(session, data, None)
}

fn write_session_guarded(session: &Arc<Mutex<PtySession>>, data: &[u8], expected_epoch: Option<u64>) -> Result<(), String> {
    let (writer, input_pending, input_epoch, closed) = {
        let state = lock_unpoisoned(session);
        (state.writer.clone(), state.input_pending.clone(), state.input_epoch.clone(), state.closed.clone())
    };
    input_pending.store(true, Ordering::Release);
    let mut writer = lock_unpoisoned(&writer);
    write_guarded_input(&mut **writer, data, &input_epoch, &closed, expected_epoch)
}

fn write_guarded_input(writer: &mut dyn Write, data: &[u8], input_epoch: &AtomicU64, closed: &AtomicBool, expected_epoch: Option<u64>) -> Result<(), String> {
    let valid = || expected_epoch.is_none_or(|expected| input_epoch.load(Ordering::Acquire) == expected && !closed.load(Ordering::Acquire));
    if !valid() { return Err("terminal input target changed".into()); }
    if expected_epoch.is_none() {
        return writer.write_all(data).and_then(|()| writer.flush()).map_err(|e| e.to_string());
    }
    let mut offset = 0;
    while offset < data.len() {
        if !valid() { return Err("terminal input target changed".into()); }
        let limit = (offset + 128).min(data.len());
        // Keep an execution key separate from preceding text so an exit during a partial
        // text write cannot carry the following newline in the same native operation.
        let end = if matches!(data[offset], b'\r' | b'\n') { offset + 1 }
            else { data[offset..limit].iter().position(|byte| matches!(byte, b'\r' | b'\n')).map_or(limit, |index| offset + index) };
        let written = writer.write(&data[offset..end]).map_err(|error| error.to_string())?;
        if written == 0 { return Err("terminal input writer made no progress".into()); }
        offset += written;
        std::thread::yield_now();
    }
    if !valid() { return Err("terminal input target changed".into()); }
    writer.flush().map_err(|error| error.to_string())
}

/// Windows: normalize newlines to CR (Enter). \n is Ctrl+J, which PSReadLine/cmd do not accept.
#[cfg(windows)]
fn normalize_enter(data: &str) -> String {
    data.replace("\r\n", "\r").replace('\n', "\r")
}

#[tauri::command]
pub async fn pty_resize(state: State<'_, PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    if debug::enabled() {
        debug::write("resize", format!("id={} cols={} rows={}", id, cols, rows));
    }
    let session = {
        let sessions = lock_unpoisoned(&state.0);
        sessions.get(&id).cloned().ok_or("session not found")?
    };
    // Resizing the pseudo console can block on its own: run it on a blocking thread so the
    // main thread (the UI) never waits.
    tauri::async_runtime::spawn_blocking(move || resize_session(&session, cols, rows))
        .await
        .map_err(|e| e.to_string())?
}

/// Resize a session's PTY. It takes only the session lock and never touches the writer, so a
/// stuck write cannot delay it.
fn resize_session(session: &Arc<Mutex<PtySession>>, cols: u16, rows: u16) -> Result<(), String> {
    let state = lock_unpoisoned(session);
    state
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_close(state: State<'_, PtyState>, kill: State<'_, KillState>, id: String) -> Result<(), String> {
    // Keep the session in the table until it is really closed: a failure before the
    // kill must leave a reachable handle, not an unreachable running child.
    let session = lock_unpoisoned(&state.0).get(&id).cloned();
    // Killing, waiting and the escalation all block: run them on a blocking thread,
    // never on the main thread. `close_session` also terminates the process tree on
    // Windows and signals the foreground group on Unix.
    if let Some(session) = session {
        tauri::async_runtime::spawn_blocking(move || {
            close_session(&session, std::time::Instant::now() + CLOSE_DEADLINE);
        })
        .await
        .map_err(|e| e.to_string())?;
        lock_unpoisoned(&state.0).remove(&id);
    }
    // Clear the "kill escalation" state in step so it cannot grow without bound during long use
    lock_unpoisoned(&kill.0).remove(&id);
    Ok(())
}

/// Close every session at once. The page-load hook and the frontend startup call
/// this so a reload cannot leave the previous page's PTYs running invisibly.
#[tauri::command]
pub async fn pty_close_all(state: State<'_, PtyState>, kill: State<'_, KillState>) -> Result<usize, String> {
    let sessions: Vec<Arc<Mutex<PtySession>>> = {
        let mut map = lock_unpoisoned(&state.0);
        map.drain().map(|(_, session)| session).collect()
    };
    let count = sessions.len();
    if !sessions.is_empty() {
        tauri::async_runtime::spawn_blocking(move || {
            close_sessions(sessions, std::time::Instant::now() + CLOSE_ALL_DEADLINE);
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    lock_unpoisoned(&kill.0).clear();
    Ok(count)
}

/// Tauri page lifecycle hook: reloading the main webview keeps this process alive,
/// so the sessions of the page that is going away have to be terminated here.
pub fn lifecycle_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("terminal-lifecycle")
        .on_page_load(|webview, payload| {
            if webview.label() != "main" || payload.event() != tauri::webview::PageLoadEvent::Started {
                return;
            }
            debug::write("page-load", format!("label={} event=started", webview.label()));
            close_all_sessions(webview.app_handle());
        })
        .build()
}

/// Settles a session after it exits: removes it from the state table, reaps the child and releases the master/writer fds.
/// Called by the read thread on EOF or read error; the wait is bounded so a leftover handle cannot stall the close.
/// Returns the child exit code so the session can tell a clean exit from a dropped connection.
fn reap_session(app: &AppHandle, id: &str) -> Option<i32> {
    let session = lock_unpoisoned(&app.state::<PtyState>().0).remove(id);
    let mut code = None;
    if let Some(session) = session {
        let mut state = lock_unpoisoned(&session);
        state.closed.store(true, Ordering::Release);
        code = wait_child_bounded(&mut *state.child, REAP_TIMEOUT);
        if code.is_none() {
            // The child is gone from the table but not reaped: force it so no zombie
            // or stopped process keeps the session alive.
            force_kill_foreground(&state);
            force_kill_child(&mut *state.child);
            let _ = wait_child_bounded(&mut *state.child, CLOSE_ALL_DEADLINE);
        }
    }
    // Clear this session's "kill escalation" state in step so it cannot grow without bound during long use
    lock_unpoisoned(&app.state::<KillState>().0).remove(id);
    code
}

/// Allowlist of signals that may be sent (prevents the frontend from killing unrelated processes with arbitrary signals)
#[cfg(unix)]
const ALLOWED_SIGNALS: [i32; 3] = [libc::SIGINT, libc::SIGTERM, libc::SIGKILL];

/// Sends a signal to the PTY foreground process group (the "force" path of the stop button).
/// Guard: refuse when the foreground process group is the shell itself (no app is running), so the shell is never killed by mistake.
#[cfg(unix)]
fn signal_fg_process_group(
    master: &dyn MasterPty,
    shell_pid: Option<u32>,
    sig: i32,
) -> Result<(), String> {
    if !ALLOWED_SIGNALS.contains(&sig) {
        return Err(format!("signal {sig} not allowed"));
    }
    let fd = master.as_raw_fd().ok_or("pty master fd unavailable")?;
    let pgid = unsafe { libc::tcgetpgrp(fd) };
    if pgid <= 0 {
        return Err("no foreground process group".into());
    }
    if shell_pid.is_some_and(|p| p == pgid as u32) {
        return Err("前台是 shell 本身，没有运行中的应用".into());
    }
    if unsafe { libc::kill(-pgid, sig) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

/// Terminates the child; on Windows terminating only the root shell leaves the foreground app orphaned,
/// so the whole process tree goes first and a child.kill() follows as a fallback (the root is already in the tree, making this idempotent).
/// On Unix SIGTERM follows SIGHUP: a shell that ignores the hangup signal can still be terminated.
fn kill_child_tree(child: &mut dyn Child) {
    #[cfg(windows)]
    if let Some(pid) = child.process_id() {
        let _ = terminate_process_tree(pid, true);
    }
    #[cfg(unix)]
    if let Some(pid) = child.process_id() {
        unsafe {
            libc::kill(pid as i32, libc::SIGHUP);
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    // The portable child helper owns a separate grace wait on Unix. This caller already
    // owns the deadline, so invoking that helper would spend the batch budget per child.
    #[cfg(not(unix))]
    let _ = child.kill();
}

/// Windows first press of "stop": write ETX (0x03) to the PTY input. The ConPTY input state machine
/// turns 0x03 into a Ctrl+C key press (keydown+keyup), and the console host raises
/// CTRL_C, exactly as if the user pressed Ctrl+C - the same writer path the frontend
/// "send Ctrl+C" button uses (see sendCtrlC in src/terminal/TerminalView.tsx).
#[cfg(windows)]
fn send_ctrl_c(writer: &mut dyn Write) -> Result<(), String> {
    writer.write_all(b"\x03").map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

/// Windows force kill: terminate the process tree rooted at root_pid.
/// Under ConPTY the foreground app is a descendant of the shell, and portable-pty's child.kill() only
/// calls TerminateProcess on the root, leaving the app orphaned; this collects descendants from a Toolhelp
/// snapshot and calls TerminateProcess on each, starting from the deepest child.
/// With `include_root=false` the root process (the shell) is kept - used by "stop foreground app":
/// only the foreground app subtree dies, the outer shell survives and shows its prompt again once the foreground exits.
#[cfg(windows)]
fn terminate_process_tree(root_pid: u32, include_root: bool) -> Result<(), String> {
    use std::collections::{HashMap, VecDeque};
    use winapi::shared::minwindef::DWORD;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::{OpenProcess, TerminateProcess};
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use winapi::um::winnt::PROCESS_TERMINATE;

    // Snapshot the process table and build the ppid -> children map
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot.is_null() {
        return Err(format!(
            "CreateToolhelp32Snapshot 失败: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as DWORD;
    let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) };
    while ok != 0 {
        children
            .entry(entry.th32ParentProcessID)
            .or_default()
            .push(entry.th32ProcessID);
        ok = unsafe { Process32NextW(snapshot, &mut entry) };
    }
    unsafe { CloseHandle(snapshot) };

    // BFS collects the processes to kill (root and all descendants, or only root's descendants); iterating in reverse kills the deepest first,
    // so a parent dying first cannot let the system reparent its children elsewhere and escape the kill.
    let mut pids = Vec::new();
    let mut queue: VecDeque<u32> = VecDeque::new();
    if include_root {
        queue.push_back(root_pid);
    } else if let Some(kids) = children.get(&root_pid) {
        queue.extend(kids.iter().copied());
    }
    while let Some(pid) = queue.pop_front() {
        pids.push(pid);
        if let Some(kids) = children.get(&pid) {
            queue.extend(kids.iter().copied());
        }
    }

    let self_pid = std::process::id();
    for &pid in pids.iter().rev() {
        if pid == self_pid {
            continue; // Guard: never kill ourselves
        }
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        if handle.is_null() {
            continue; // Already exited or access denied: best effort
        }
        unsafe { TerminateProcess(handle, 1) };
        unsafe { CloseHandle(handle) };
    }
    Ok(())
}

/// Escalating-stop window: a second press within this duration after the first escalates to SIGKILL.
const ESCALATE_WINDOW: std::time::Duration = std::time::Duration::from_secs(3);

/// Per-session "last stop attempt" time; escalation lives in Rust so it survives a window reload.
#[derive(Default)]
pub struct KillState(pub Mutex<HashMap<String, std::time::Instant>>);

fn should_escalate(elapsed_since_last: Option<std::time::Duration>) -> bool {
    match elapsed_since_last {
        Some(d) => d < ESCALATE_WINDOW,
        None => false,
    }
}

/// Stops the PTY foreground app (the stop button). Escalating: the first press sends SIGTERM (Ctrl+C on Windows),
/// a second press within the window escalates to SIGKILL (terminating the whole process tree on Windows).
/// Returns the level used ("term" / "kill") so the frontend can switch the button label.
#[tauri::command]
pub async fn pty_kill_foreground(
    state: State<'_, PtyState>,
    kill: State<'_, KillState>,
    id: String,
) -> Result<String, String> {
    let session = {
        let sessions = lock_unpoisoned(&state.0);
        sessions.get(&id).cloned().ok_or("session not found")?
    };

    let now = std::time::Instant::now();
    let escalate = {
        let mut attempts = lock_unpoisoned(&kill.0);
        let esc = should_escalate(attempts.get(&id).map(|t| now.duration_since(*t)));
        attempts.insert(id, now);
        esc
    };

    // Signaling, terminating the process tree and writing Ctrl+C can all block: run them on a
    // blocking thread so the main thread (the UI) never waits - otherwise the stop button itself
    // wedges and force-quitting the app becomes the only way out.
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = lock_unpoisoned(&session);
        kill_foreground_impl(&mut session, escalate)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(if escalate { "kill" } else { "term" }.to_string())
}

/// Platform-specific "stop foreground app" implementation: on Unix a signal goes to the foreground process group.
#[cfg(unix)]
fn kill_foreground_impl(session: &mut PtySession, escalate: bool) -> Result<(), String> {
    let sig = if escalate { libc::SIGKILL } else { libc::SIGTERM };
    signal_fg_process_group(&*session.master, session.child.process_id(), sig)
}

/// How long the first press of the stop button waits for the write channel. Ctrl+C is input
/// written to stdin, so it cannot be delivered while a stuck write holds that channel. On
/// timeout we report an actionable error instead of hanging the button forever; pressing again
/// inside the escalation window goes straight to the tree kill, which is the only way left to
/// end an app that has stopped reading its input.
#[cfg(windows)]
const CTRL_C_WRITER_WAIT: std::time::Duration = std::time::Duration::from_millis(1000);

/// Send Ctrl+C once the write channel is free; report an actionable error when it stays busy for
/// longer than `CTRL_C_WRITER_WAIT`.
#[cfg(windows)]
fn send_ctrl_c_when_writable(session: &PtySession) -> Result<(), String> {
    let deadline = std::time::Instant::now() + CTRL_C_WRITER_WAIT;
    loop {
        if let Ok(mut writer) = session.writer.try_lock() {
            return send_ctrl_c(&mut **writer);
        }
        if std::time::Instant::now() >= deadline {
            return Err("前台应用未读取输入，Ctrl+C 送不进去；再点一次「结束」可强杀".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

/// Platform-specific "stop foreground app" implementation: on Windows the first press sends Ctrl+C (equivalent to a user key press),
/// a second press force-kills the whole process tree (killing only the shell leaves the foreground app orphaned).
#[cfg(windows)]
fn kill_foreground_impl(session: &mut PtySession, escalate: bool) -> Result<(), String> {
    if escalate {
        match session.child.process_id() {
            // Kill only the foreground app subtree and keep the outer shell (it shows a prompt again once the foreground exits)
            Some(pid) => terminate_process_tree(pid, false),
            None => session.child.kill().map_err(|e| e.to_string()),
        }
    } else {
        send_ctrl_c_when_writable(session)
    }
}

/// Platform-specific "stop foreground app" implementation: other platforms have no signal mechanism yet.
#[cfg(not(any(unix, windows)))]
fn kill_foreground_impl(_session: &mut PtySession, _escalate: bool) -> Result<(), String> {
    Err("当前平台不支持信号结束，请用 Ctrl+C".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_epoch_tracks_foreground_boundaries_before_output_delivery() {
        let epoch = AtomicU64::new(0);
        let mut scanner = StreamScanner::new();
        advance_input_epoch(&epoch, &scanner.push("ordinary output\x1b[?2004h"));
        assert_eq!(epoch.load(Ordering::Acquire), 0);
        advance_input_epoch(&epoch, &scanner.push("\x1b]133;"));
        assert_eq!(epoch.load(Ordering::Acquire), 0);
        for (expected, boundary) in ["C\x07", "\x1b]133;D;0\x07", "\x1b]133;A\x07", "\x1b[?1049h", "\x1b[?1049l"].iter().enumerate() {
            advance_input_epoch(&epoch, &scanner.push(boundary));
            assert_eq!(epoch.load(Ordering::Acquire), expected as u64 + 1);
        }
    }

    #[test]
    fn guarded_paste_rejects_stale_or_closed_targets_without_writing() {
        let epoch = AtomicU64::new(2); let closed = AtomicBool::new(false);
        let mut bytes = Vec::new();
        assert!(write_guarded_input(&mut bytes, b"unintended command\r", &epoch, &closed, Some(1)).is_err());
        assert!(bytes.is_empty());
        closed.store(true, Ordering::Release);
        assert!(write_guarded_input(&mut bytes, b"unintended command\r", &epoch, &closed, Some(2)).is_err());
        assert!(bytes.is_empty());
        closed.store(false, Ordering::Release);
        write_guarded_input(&mut bytes, b"intentional input", &epoch, &closed, Some(2)).unwrap();
        assert_eq!(bytes, b"intentional input");
    }

    #[test]
    fn guarded_paste_stops_after_a_partial_write_when_the_foreground_exits() {
        struct ChangingWriter<'a> { epoch: &'a AtomicU64, bytes: Vec<u8>, writes: usize }
        impl Write for ChangingWriter<'_> {
            fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
                let count = data.len().min(3);
                self.bytes.extend_from_slice(&data[..count]); self.writes += 1;
                self.epoch.fetch_add(1, Ordering::AcqRel);
                Ok(count)
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let epoch = AtomicU64::new(5); let closed = AtomicBool::new(false);
        let mut writer = ChangingWriter { epoch: &epoch, bytes: Vec::new(), writes: 0 };
        let result = write_guarded_input(&mut writer, b"payload\runintended command\r", &epoch, &closed, Some(5));
        assert_eq!(result.unwrap_err(), "terminal input target changed");
        assert_eq!(writer.bytes, b"pay"); assert_eq!(writer.writes, 1);
    }

    #[test]
    fn guarded_paste_never_combines_a_newline_with_preceding_text() {
        #[derive(Default)]
        struct RecordingWriter(Vec<Vec<u8>>);
        impl Write for RecordingWriter {
            fn write(&mut self, data: &[u8]) -> std::io::Result<usize> { self.0.push(data.to_vec()); Ok(data.len()) }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let mut writer = RecordingWriter::default();
        write_guarded_input(&mut writer, b"first\r\nsecond\n", &AtomicU64::new(0), &AtomicBool::new(false), Some(0)).unwrap();
        assert_eq!(writer.0, vec![b"first".to_vec(), b"\r".to_vec(), b"\n".to_vec(), b"second".to_vec(), b"\n".to_vec()]);
    }
    use std::io::{Read, Write};

    #[test]
    fn ssh_args_builds_target_and_port() {
        assert_eq!(ssh_args("example.com", None, None), vec!["example.com"]);
        assert_eq!(
            ssh_args("example.com", Some("root"), Some(22)),
            vec!["-p", "22", "root@example.com"]
        );
        assert_eq!(
            ssh_args("host", Some(""), Some(2222)),
            vec!["-p", "2222", "host"]
        );
        assert_eq!(
            ssh_args("host", Some("deploy"), None),
            vec!["deploy@host"]
        );
    }

    #[test]
    fn ssh_cli_uses_verified_trust_and_algorithm() {
        let path = std::path::Path::new("C:/Users/Test User/.ssh/known_hosts");
        let options = verified_ssh_options(Some("ed25519"), path).unwrap();
        assert!(options.contains(&"StrictHostKeyChecking=yes".into()));
        assert!(options.contains(&"HostKeyAlgorithms=ssh-ed25519".into()));
        assert!(options.contains(&"UserKnownHostsFile=\"C:/Users/Test User/.ssh/known_hosts\"".into()));
        assert!(verified_ssh_options(Some("unknown"), path).is_err());
        assert!(verified_ssh_options(Some("rsa"), path).unwrap().contains(&"HostKeyAlgorithms=rsa-sha2-512,rsa-sha2-256".into()));
        assert!(verified_ssh_options(None, path).unwrap().contains(&"StrictHostKeyChecking=yes".into()));
    }

    #[test]
    fn escalate_within_window_and_not() {
        assert!(!should_escalate(None)); // first press
        assert!(should_escalate(Some(std::time::Duration::from_secs(2)))); // within 3s
        assert!(!should_escalate(Some(std::time::Duration::from_secs(4)))); // past the window
    }

    /// Windows: \n sent with a command must normalize to CR (Enter), which PSReadLine/cmd require.
    #[cfg(windows)]
    #[test]
    fn normalize_enter_converts_newlines_to_cr() {
        assert_eq!(super::normalize_enter("echo hi\n"), "echo hi\r");
        assert_eq!(super::normalize_enter("a\r\nb\n"), "a\rb\r");
        assert_eq!(super::normalize_enter("no-newline"), "no-newline");
    }

    /// Existing local tool directories precede inherited paths without duplicates.
    #[cfg(unix)]
    #[test]
    fn merge_user_bin_paths_adds_local_bin_and_dedups() {
        let mut cmd = CommandBuilder::new("zsh");
        merge_inherited_bin_paths(&mut cmd, "/usr/bin:/bin:/usr/sbin:/sbin:/usr/bin".into());
        let path = cmd.get_env("PATH").expect("PATH is set");
        let dirs: Vec<&str> = path.to_str().unwrap().split(':').collect();
        if std::path::Path::new("/usr/local/bin").is_dir() {
            assert_eq!(dirs[0], "/usr/local/bin");
        } else {
            assert!(!dirs.contains(&"/usr/local/bin"));
        }
        let mut seen = std::collections::HashSet::new();
        for d in &dirs {
            assert!(seen.insert(*d), "Duplicate PATH entry: {d}");
        }
        // Preserve the inherited system directories in their original order.
        assert!(dirs.ends_with(&["/usr/bin", "/bin", "/usr/sbin", "/sbin"]));
    }

    #[cfg(windows)]
    #[test]
    fn merge_user_bin_paths_preserves_windows_path_entries() {
        let mut cmd = CommandBuilder::new("pwsh");
        merge_inherited_bin_paths(&mut cmd, r"C:\Windows\System32;C:\Program Files\PowerShell\7".into());
        let path = cmd.get_env("PATH").expect("PATH is set");
        let entries: Vec<_> = std::env::split_paths(path).collect();
        assert_eq!(&entries[..2], &[PathBuf::from(r"C:\Windows\System32"), PathBuf::from(r"C:\Program Files\PowerShell\7")]);
        for registered in registered_windows_paths() {
            for directory in std::env::split_paths(&registered).filter(|directory| !directory.as_os_str().is_empty()) {
                assert!(entries.iter().any(|entry| path_identity(entry) == path_identity(&directory)));
            }
        }
        let unique: std::collections::HashSet<_> = entries.iter().map(|entry| path_identity(entry)).collect();
        assert_eq!(entries.len(), unique.len());

    }

    /// GUI launch with an empty TERM: fill in xterm-256color + truecolor; explicit values are left alone.
    #[test]
    fn merge_term_env_fills_empty_and_keeps_explicit() {
        std::env::remove_var("TERM");
        std::env::remove_var("COLORTERM");
        let mut cmd = CommandBuilder::new("zsh");
        merge_term_env(&mut cmd);
        assert_eq!(cmd.get_env("TERM").unwrap().to_str().unwrap(), "xterm-256color");
        assert_eq!(cmd.get_env("COLORTERM").unwrap().to_str().unwrap(), "truecolor");

        std::env::set_var("TERM", "screen-256color");
        std::env::set_var("COLORTERM", "24bit");
        let mut cmd2 = CommandBuilder::new("zsh");
        merge_term_env(&mut cmd2);
        assert_eq!(cmd2.get_env("TERM").unwrap().to_str().unwrap(), "screen-256color");
        assert_eq!(cmd2.get_env("COLORTERM").unwrap().to_str().unwrap(), "24bit");
    }

    /// A GUI launch has no locale: fill LC_CTYPE (and LANG when empty) with UTF-8; a configured
    /// UTF-8 environment is left alone.
    #[cfg(unix)]
    #[test]
    fn locale_overrides_fill_utf8_when_missing_and_keep_existing() {
        assert_eq!(
            locale_overrides(None, None, None),
            vec![("LC_CTYPE", DEFAULT_UTF8_LOCALE), ("LANG", DEFAULT_UTF8_LOCALE)]
        );
        assert_eq!(
            locale_overrides(None, None, Some("")),
            vec![("LC_CTYPE", DEFAULT_UTF8_LOCALE), ("LANG", DEFAULT_UTF8_LOCALE)]
        );
        // An explicit non-UTF-8 LANG keeps its message language; only the encoding is corrected.
        assert_eq!(locale_overrides(None, Some("C"), Some("C")), vec![("LC_CTYPE", DEFAULT_UTF8_LOCALE)]);
        // No injection when any variable already requests UTF-8.
        assert!(locale_overrides(Some("zh_CN.UTF-8"), None, None).is_empty());
        assert!(locale_overrides(None, Some("UTF-8"), None).is_empty());
        assert!(locale_overrides(None, None, Some("en_US.UTF-8")).is_empty());
    }

    /// The injected variables really land on the spawned CommandBuilder.
    #[cfg(unix)]
    #[test]
    fn locale_overrides_apply_to_command_builder() {
        let mut cmd = CommandBuilder::new("zsh");
        for (key, value) in locale_overrides(Some("C"), Some("C"), Some("C")) {
            cmd.env(key, value);
        }
        assert_eq!(cmd.get_env("LC_CTYPE").unwrap().to_str().unwrap(), DEFAULT_UTF8_LOCALE);
    }

    /// A multi-byte UTF-8 character split across a read boundary must not produce U+FFFD.
    #[test]
    fn utf8_split_across_reads_is_buffered() {
        // U+4E2D = E4 B8 AD. Simulated arrival in two parts: E4 | B8 AD
        let mut decoder = super::StreamDecoder::new();
        assert_eq!(decoder.push(&[0xE4]), "");           // incomplete -> no output
        assert_eq!(decoder.push(&[0xB8, 0xAD]), "中");   // completed -> output
        assert_eq!(decoder.push(b"hello"), "hello");     // ASCII passes straight through
        // Invalid bytes degrade to the replacement character (no panic)
        assert_eq!(decoder.push(&[0xFF, 0xFE]), "��");
    }

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

    /// `spawn_pty` is the single entry point for creating a session (now run on a blocking
    /// thread): confirm it yields a usable session.
    #[test]
    fn spawn_pty_produces_a_live_session() {
        let (id, master, mut reader, mut writer, mut child) =
            spawn_pty(80, 24, None, None, None, None).expect("spawn_pty");
        assert!(id.starts_with("pty-"), "unexpected id: {id}");

        writer.write_all(b"echo spawn-pty-ok\n").expect("write");
        writer.flush().expect("flush");
        let mut out = String::new();
        let mut buf = [0u8; 4096];
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !out.contains("spawn-pty-ok") && std::time::Instant::now() < deadline {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => out.push_str(&String::from_utf8_lossy(&buf[..n])),
                _ => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
        kill_child_tree(&mut *child);
        let _ = child.wait();
        drop(master);
        assert!(out.contains("spawn-pty-ok"), "no echo, got: {out:?}");
    }

    /// Closing must terminate and reap the child even though the close path keeps the
    /// session reachable until the kill happened, and it must flag the session as closed.
    #[test]
    fn close_session_terminates_and_reaps_child() {
        let (_id, master, reader, writer, child) =
            spawn_pty(80, 24, None, None, None, None).expect("spawn_pty");
        let closed = Arc::new(AtomicBool::new(false));
        let session = Arc::new(Mutex::new(PtySession {
            master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            input_pending: Arc::new(AtomicBool::new(false)),
            input_epoch: Arc::new(AtomicU64::new(0)),
            closed: closed.clone(),
        }));
        drop(reader);
        close_session(&session, std::time::Instant::now() + std::time::Duration::from_secs(5));
        assert!(closed.load(Ordering::Acquire), "close_session must mark the session closed");
        let mut state = lock_unpoisoned(&session);
        assert!(state.child.try_wait().ok().flatten().is_some(), "child must be reaped after close");
    }

    #[cfg(unix)]
    #[test]
    fn close_session_reaps_a_child_that_ignores_graceful_signals() {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("openpty");
        let mut command = CommandBuilder::new("sh");
        command.args(["-c", "trap '' HUP TERM; printf ready; exec sleep 30"]);
        let child = pair.slave.spawn_command(command).expect("spawn");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("reader");
        let mut ready = [0; 5];
        reader.read_exact(&mut ready).expect("child readiness");
        assert_eq!(&ready, b"ready");
        let writer = pair.master.take_writer().expect("writer");
        let session = Arc::new(Mutex::new(PtySession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            input_pending: Arc::new(AtomicBool::new(false)),
            input_epoch: Arc::new(AtomicU64::new(0)),
            closed: Arc::new(AtomicBool::new(false)),
        }));
        close_session(&session, std::time::Instant::now() + std::time::Duration::from_secs(2));
        assert!(lock_unpoisoned(&session).child.try_wait().unwrap().is_some(), "forced child must be reaped within the close budget");
    }

    /// The process-wide sweep must terminate every session in the batch.
    #[test]
    fn close_sessions_terminates_every_child() {
        let mut sessions = Vec::new();
        let mut refs = Vec::new();
        for _ in 0..2 {
            let (_id, master, reader, writer, child) =
                spawn_pty(80, 24, None, None, None, None).expect("spawn_pty");
            drop(reader);
            let session = Arc::new(Mutex::new(PtySession {
                master,
                writer: Arc::new(Mutex::new(writer)),
                child,
                input_pending: Arc::new(AtomicBool::new(false)),
                input_epoch: Arc::new(AtomicU64::new(0)),
                closed: Arc::new(AtomicBool::new(false)),
            }));
            refs.push(session.clone());
            sessions.push(session);
        }
        close_sessions(sessions, std::time::Instant::now() + std::time::Duration::from_secs(5));
        for session in &refs {
            let mut state = lock_unpoisoned(session);
            assert!(state.closed.load(Ordering::Acquire), "sweep must flag the session closed");
            let status = state.child.try_wait();
            assert!(matches!(status, Ok(Some(_))), "every child must be reaped: pid={:?}, status={status:?}", state.child.process_id());
        }
    }

    #[cfg(unix)]
    #[test]
    fn close_sessions_escalates_the_entire_batch_before_its_deadline() {
        let mut sessions = Vec::new();
        for _ in 0..2 {
            let pair = native_pty_system()
                .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("openpty");
            let mut command = CommandBuilder::new("sh");
            command.args(["-c", "trap '' HUP TERM; printf ready; exec sleep 30"]);
            let child = pair.slave.spawn_command(command).expect("spawn");
            drop(pair.slave);
            let mut reader = pair.master.try_clone_reader().expect("reader");
            let mut ready = [0; 5]; reader.read_exact(&mut ready).expect("child readiness");
            assert_eq!(&ready, b"ready");
            let writer = pair.master.take_writer().expect("writer");
            sessions.push(Arc::new(Mutex::new(PtySession {
                master: pair.master, writer: Arc::new(Mutex::new(writer)), child,
                input_pending: Arc::new(AtomicBool::new(false)), input_epoch: Arc::new(AtomicU64::new(0)), closed: Arc::new(AtomicBool::new(false)),
            })));
        }
        let started = std::time::Instant::now();
        close_sessions(sessions.clone(), started + std::time::Duration::from_millis(500));
        assert!(started.elapsed() < std::time::Duration::from_secs(2), "batch close must remain bounded");
        for session in sessions {
            let mut state = lock_unpoisoned(&session);
            let status = state.child.try_wait();
            assert!(matches!(status, Ok(Some(_))), "every forced child must be reaped: pid={:?}, status={status:?}", state.child.process_id());
        }
    }

    /// With no UTF-8 locale in the test process (the GUI-launch situation), the spawned shell must
    /// really receive the injected UTF-8 LC_CTYPE.
    #[cfg(unix)]
    #[test]
    fn spawn_pty_injects_utf8_locale_when_missing() {
        let inherited_utf8 = ["LC_ALL", "LC_CTYPE", "LANG"]
            .iter()
            .filter_map(|key| std::env::var(key).ok())
            .any(|value| !value.is_empty() && is_utf8_locale(&value));
        if inherited_utf8 {
            return; // The design is a no-op here, so there is nothing to assert.
        }
        let (id, master, mut reader, mut writer, mut child) =
            spawn_pty(80, 24, None, None, None, None).expect("spawn_pty");
        assert!(id.starts_with("pty-"), "unexpected id: {id}");
        writer.write_all(b"printf 'LOC:%s|%s\\n' \"$LC_CTYPE\" \"$LANG\"\n").expect("write");
        writer.flush().expect("flush");
        let expected = format!("LOC:{DEFAULT_UTF8_LOCALE}|");
        let mut out = String::new();
        let mut buf = [0u8; 4096];
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !out.contains(&expected) && std::time::Instant::now() < deadline {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => out.push_str(&String::from_utf8_lossy(&buf[..n])),
                _ => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
        kill_child_tree(&mut *child);
        let _ = child.wait();
        drop(master);
        assert!(out.contains(&expected), "child locale not injected, got: {out:?}");
    }

    /// A long-lived child used by the blocked-writer test.
    fn non_reading_command() -> CommandBuilder {
        #[cfg(windows)]
        {
            let mut cmd = CommandBuilder::new("cmd");
            cmd.args(["/c", "ping", "-n", "15", "127.0.0.1"]);
            cmd
        }
        #[cfg(not(windows))]
        {
            let mut cmd = CommandBuilder::new("sleep");
            cmd.arg("15");
            cmd
        }
    }

    /// A blocked writer must leave the session lock available for resize, close and signals.
    /// Synchronize the writer explicitly: terminal input buffers can discard excess input
    /// instead of blocking, so a large payload alone does not establish this precondition.
    #[test]
    fn session_lock_stays_free_while_a_write_is_stuck() {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("openpty");
        let child = pair.slave.spawn_command(non_reading_command()).expect("spawn");
        drop(pair.slave);
        struct BlockedWriter {
            entered: std::sync::mpsc::Sender<()>,
            release: std::sync::mpsc::Receiver<()>,
        }
        impl Write for BlockedWriter {
            fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
                self.entered.send(()).map_err(std::io::Error::other)?;
                self.release.recv().map_err(std::io::Error::other)?;
                Ok(data.len())
            }

            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let (entered, waiting) = std::sync::mpsc::channel();
        let (release, resume) = std::sync::mpsc::channel();
        let writer: Box<dyn Write + Send> = Box::new(BlockedWriter { entered, release: resume });
        let session = Arc::new(Mutex::new(PtySession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            input_pending: Arc::new(AtomicBool::new(false)),
            input_epoch: Arc::new(AtomicU64::new(0)),
            closed: Arc::new(AtomicBool::new(false)),
        }));

        let pumping = {
            let session = session.clone();
            std::thread::spawn(move || write_session(&session, b"blocked input"))
        };
        waiting.recv_timeout(std::time::Duration::from_secs(3)).expect("writer must start");
        assert!(!pumping.is_finished(), "writer must remain blocked until released");

        // The wait is measured by timing the session lock that those three commands take.
        let (tx, rx) = std::sync::mpsc::channel();
        {
            let session = session.clone();
            std::thread::spawn(move || {
                let started = std::time::Instant::now();
                let _guard = session.lock();
                let _ = tx.send(started.elapsed());
            });
        }
        let probe_started = std::time::Instant::now();
        let waited = rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or_else(|_| {
            panic!("session lock not free within 3s: a stuck write is holding it")
        });

        assert!(
            waited < std::time::Duration::from_millis(250),
            "session lock waited {waited:?} (probe took {:?}), still queued behind a stuck write",
            probe_started.elapsed()
        );
        release.send(()).expect("release writer");
        pumping.join().expect("writer thread").expect("write succeeds after release");
        close_session(&session, std::time::Instant::now() + std::time::Duration::from_secs(5));
    }

    #[cfg(unix)]
    fn fg_pgid(session: &TestSession) -> i32 {
        unsafe { libc::tcgetpgrp(session.master.as_raw_fd().unwrap()) }
    }

    /// Refuse to signal while only the shell is running (never kill the shell itself)
    #[cfg(unix)]
    #[test]
    fn signal_fg_rejects_when_only_shell_running() {
        let session = spawn_shell(80, 24, None).expect("spawn");
        std::thread::sleep(std::time::Duration::from_millis(300));
        let err = signal_fg_process_group(&*session.master, session.child.process_id(), libc::SIGTERM)
            .expect_err("should refuse when fg is the shell itself");
        assert!(err.contains("shell"), "unexpected: {err}");
        drop(session);
    }

    /// Signals outside the allowlist are rejected outright
    #[cfg(unix)]
    #[test]
    fn signal_fg_rejects_disallowed_signal() {
        let session = spawn_shell(80, 24, None).expect("spawn");
        let err = signal_fg_process_group(&*session.master, None, libc::SIGSTOP)
            .expect_err("SIGSTOP not allowed");
        assert!(err.contains("not allowed"), "unexpected: {err}");
    }

    /// SIGTERM kills a foreground app that ignores Ctrl+C while the shell itself survives
    #[cfg(unix)]
    #[test]
    fn signal_fg_term_kills_foreground_app_shell_survives() {
        // Job control (tcsetpgrp switching the foreground process group) needs an interactive shell;
        // new_default_prog's non-interactive sh never switches, so the foreground stays the shell
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
            .unwrap();
        let mut cmd = CommandBuilder::new("bash");
        cmd.arg("-i");
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string()).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string()).unwrap();
        let writer = pair.master.take_writer().map_err(|e| e.to_string()).unwrap();
        let mut session = TestSession { master: pair.master, reader, writer, child };
        let shell_pid = session.child.process_id().expect("shell pid");
        // sleep exits even without a SIGINT handler; the point here is that the signal reaches the foreground process group, not the shell
        session.writer.write_all(b"sleep 30\n").unwrap();
        session.writer.flush().unwrap();

        // Wait for the foreground process group to switch to sleep
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while fg_pgid(&session) == shell_pid as i32 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_ne!(fg_pgid(&session), shell_pid as i32, "sleep never became fg");

        signal_fg_process_group(&*session.master, Some(shell_pid), libc::SIGTERM).expect("sigterm");

        // The foreground switches back to the shell, and the shell can still run commands
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while fg_pgid(&session) != shell_pid as i32 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(fg_pgid(&session), shell_pid as i32, "shell did not regain fg");

        session.writer.write_all(b"echo shell-alive\n").unwrap();
        session.writer.flush().unwrap();
        let mut out = String::new();
        let mut buf = [0u8; 4096];
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !out.contains("shell-alive") && std::time::Instant::now() < deadline {
            match session.reader.read(&mut buf) {
                Ok(n) if n > 0 => out.push_str(&String::from_utf8_lossy(&buf[..n])),
                _ => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
        assert!(out.contains("shell-alive"), "shell died, got: {out:?}");
    }

    /// Snapshots the process table and returns the pid of a direct child of ppid whose executable name contains name_fragment.
    #[cfg(windows)]
    fn find_descendant_pid(ppid: u32, name_fragment: &str) -> Option<u32> {
        use winapi::shared::minwindef::DWORD;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::tlhelp32::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };

        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot.is_null() {
            return None;
        }
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as DWORD;
        let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) };
        let mut found = None;
        while ok != 0 {
            if entry.th32ParentProcessID == ppid {
                let name = String::from_utf16_lossy(&entry.szExeFile);
                if name.to_lowercase().contains(name_fragment) {
                    found = Some(entry.th32ProcessID);
                    break;
                }
            }
            ok = unsafe { Process32NextW(snapshot, &mut entry) };
        }
        unsafe { CloseHandle(snapshot) };
        found
    }

    /// Whether pid is still running (OpenProcess + GetExitCodeProcess == STILL_ACTIVE).
    #[cfg(windows)]
    fn pid_alive(pid: u32) -> bool {
        use winapi::shared::minwindef::DWORD;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::minwinbase::STILL_ACTIVE;
        use winapi::um::processthreadsapi::{GetExitCodeProcess, OpenProcess};
        use winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION;

        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return false;
        }
        let mut code: DWORD = 0;
        let alive = unsafe { GetExitCodeProcess(handle, &mut code) } != 0 && code == STILL_ACTIVE;
        unsafe { CloseHandle(handle) };
        alive
    }

    /// Windows: a force kill must take the shell's descendants with it (killing only the shell leaves the foreground app orphaned).
    #[cfg(windows)]
    #[test]
    fn terminate_tree_kills_descendants() {
        use std::time::{Duration, Instant};

        // cmd -> ping 127.0.0.1 -n 30 (about 30s), forming a two-generation process tree
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
            .unwrap();
        let mut cmd = CommandBuilder::new("cmd");
        cmd.arg("/c");
        cmd.arg("ping");
        cmd.arg("127.0.0.1");
        cmd.arg("-n");
        cmd.arg("30");
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string()).unwrap();
        drop(pair.slave);
        let shell_pid = child.process_id().expect("shell pid");

        // Wait for the ping child to appear
        let deadline = Instant::now() + Duration::from_secs(10);
        let ping_pid = loop {
            if let Some(pid) = find_descendant_pid(shell_pid, "ping") {
                break pid;
            }
            if Instant::now() >= deadline {
                panic!("ping 子进程未在 10s 内出现");
            }
            std::thread::sleep(Duration::from_millis(50));
        };

        terminate_process_tree(shell_pid, true).expect("terminate tree");

        // Both the root and the descendants should be gone within seconds
        let deadline = Instant::now() + Duration::from_secs(5);
        while (pid_alive(shell_pid) || pid_alive(ping_pid)) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!pid_alive(shell_pid), "shell 仍在运行");
        assert!(!pid_alive(ping_pid), "ping 仍在运行");
        let _ = child.wait();
    }
}

#[cfg(all(test, windows))]
mod cmd_interaction_tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn detects_child_exit_while_the_terminal_handles_are_still_open() {
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut command = CommandBuilder::new("cmd.exe");
        command.args(["/d", "/c", "exit", "7"]);
        let child = pair.slave.spawn_command(command).unwrap();
        let writer = pair.master.take_writer().unwrap();
        let session = Arc::new(Mutex::new(PtySession { master: pair.master, writer: Arc::new(Mutex::new(writer)), child, input_pending: Arc::new(AtomicBool::new(false)), input_epoch: Arc::new(AtomicU64::new(0)), closed: Arc::new(AtomicBool::new(false)) }));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !session_has_exited(&session) && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(session_has_exited(&session));
    }

    #[test]
    fn cmd_accepts_commands_and_returns_output() {
        let pair = portable_pty::native_pty_system().openpty(portable_pty::PtySize {
            rows: 24, cols: 80, pixel_width: 0, pixel_height: 0,
        }).unwrap();
        let mut command = cmd_command(None);
        command.arg("/d");
        command.arg("/q");
        command.env("VRYKELL_TEST_TOKEN", "verified");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = [0u8; 4096];
            while let Ok(count) = reader.read(&mut bytes) {
                if count == 0 || send.send(bytes[..count].to_vec()).is_err() { break; }
            }
        });
        writer.write_all(b"echo VRYKELL_CMD_OUTPUT_%VRYKELL_TEST_TOKEN%\r\n").unwrap();
        writer.flush().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut output = String::new();
        while std::time::Instant::now() < deadline {
            if let Ok(bytes) = receive.recv_timeout(std::time::Duration::from_millis(250)) {
                output.push_str(&String::from_utf8_lossy(&bytes));
                if output.contains("VRYKELL_CMD_OUTPUT_verified") { break; }
            }
        }
        let _ = child.kill();
        assert!(output.contains("VRYKELL_CMD_OUTPUT_verified"), "Command output missing: {output}");
    }
}
