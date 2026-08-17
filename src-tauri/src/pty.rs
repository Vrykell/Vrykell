use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::shell_integration;
use crate::scan::{ScanEvent, StreamScanner};

/// 流式 UTF-8 解码器：跨 read 边界缓冲不完整的多字节序列。
pub struct StreamDecoder {
    tail: Vec<u8>,
}

impl StreamDecoder {
    pub fn new() -> Self {
        Self { tail: Vec::new() }
    }

    /// 喂入新字节，返回可完整解码的字符串前缀；不完整尾部留存。
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
                        // 非法字节：丢 n 字节补 U+FFFD，继续循环（可能还有）
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.tail.drain(..valid + bad);
                        }
                        // 尾部是合法但不完整的多字节前缀：留存等下次
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
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<HashMap<String, Arc<Mutex<PtySession>>>>);

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    events: Vec<ScanEvent>,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: String,
}

#[cfg(test)]
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

/// SSH 连接目标（新建 SSH 终端标签页时由前端传入）。
#[derive(Clone, Deserialize, Debug)]
pub struct SshTarget {
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
}

/// 构造 ssh 命令行参数（不含程序名）。纯函数，便于单测。
pub fn ssh_args(host: &str, user: Option<&str>, port: Option<u16>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(p) = port {
        args.push("-p".to_string());
        args.push(p.to_string());
    }
    let target = match user {
        Some(u) if !u.is_empty() => format!("{u}@{host}"),
        _ => host.to_string(),
    };
    args.push(target);
    args
}

/// 按用户选择的 shell / ssh 目标构建启动命令，并注入 OSC 133 shell integration。
fn build_shell_cmd(
    cwd: Option<String>,
    shell: Option<String>,
    ssh: Option<SshTarget>,
) -> Result<CommandBuilder, String> {
    // 1. SSH 连接：直接跑 `ssh [-p port] [user@]host`
    if let Some(target) = ssh {
        let mut cmd = CommandBuilder::new("ssh");
        for arg in ssh_args(&target.host, target.user.as_deref(), target.port) {
            cmd.arg(arg);
        }
        if let Some(d) = cwd { cmd.cwd(d); }
        return Ok(cmd);
    }

    let integ_dir = shell_integration::integration_dir().ok();
    let requested = shell.as_deref().unwrap_or_default();

    // 2. 显式选择 shell：zsh/bash 注入集成脚本；powershell/pwsh/cmd 无集成，走 classic 回退
    match requested {
        "zsh" => {
            let mut cmd = CommandBuilder::new("zsh");
            if let Some(ref dir) = integ_dir {
                cmd.env("ZDOTDIR", dir.join("zsh").to_string_lossy().to_string());
            }
            if let Some(d) = cwd { cmd.cwd(d); }
            return Ok(cmd);
        }
        "bash" => {
            let mut cmd = CommandBuilder::new("bash");
            if let Some(ref dir) = integ_dir {
                cmd.arg("--rcfile");
                cmd.arg(dir.join("bash/rc").to_string_lossy().replace('\\', "/"));
            }
            if let Some(d) = cwd { cmd.cwd(d); }
            return Ok(cmd);
        }
        "powershell" | "pwsh" => {
            let mut cmd = CommandBuilder::new(if requested == "pwsh" { "pwsh" } else { "powershell" });
            if let Some(d) = cwd { cmd.cwd(d); }
            return Ok(cmd);
        }
        "cmd" => {
            let mut cmd = CommandBuilder::new("cmd");
            if let Some(d) = cwd { cmd.cwd(d); }
            return Ok(cmd);
        }
        _ => {}
    }

    // 3. 未显式选择：沿用 $SHELL 探测（向后兼容）
    let shell_env = std::env::var("SHELL").unwrap_or_default();
    if let Some(ref dir) = integ_dir {
        if shell_env.contains("zsh") {
            let mut cmd = CommandBuilder::new(&shell_env);
            cmd.env("ZDOTDIR", dir.join("zsh").to_string_lossy().to_string());
            if let Some(d) = cwd { cmd.cwd(d); }
            return Ok(cmd);
        }
        // SHELL 指向 bash（Unix / Git Bash 启动），或 Windows 上探测到的 Git Bash
        let bash = if shell_env.contains("bash") { Some(shell_env.clone()) } else { find_git_bash() };
        if let Some(bash) = bash {
            let mut cmd = CommandBuilder::new(&bash);
            cmd.arg("--rcfile");
            // Git Bash（MSYS2）可识别 C:/... 正斜杠路径，反斜杠会被当转义
            cmd.arg(dir.join("bash/rc").to_string_lossy().replace('\\', "/"));
            if let Some(d) = cwd { cmd.cwd(d); }
            return Ok(cmd);
        }
    }
    // 兜底：不做 shell integration
    let mut cmd = CommandBuilder::new_default_prog();
    if let Some(d) = cwd { cmd.cwd(d); }
    Ok(cmd)
}

/// Windows 上探测 Git Bash 安装位置（SHELL 环境变量通常不存在）。
#[cfg(target_os = "windows")]
fn find_git_bash() -> Option<String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            candidates.push(std::path::PathBuf::from(&base).join(r"Git\bin\bash.exe"));
            candidates.push(std::path::PathBuf::from(&base).join(r"Programs\Git\bin\bash.exe"));
        }
    }
    candidates
        .into_iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
}

#[cfg(not(target_os = "windows"))]
fn find_git_bash() -> Option<String> {
    None
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
    ssh: Option<SshTarget>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    // Unix 上留一个 master fd 用于 read 线程的 poll 超时冲刷（见下方 flush 逻辑）
    #[cfg(unix)]
    let master_fd = pair.master.as_raw_fd();
    let cmd = build_shell_cmd(cwd, shell, ssh)?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = format!("pty-{}", Uuid::new_v4());
    state.0.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        Arc::new(Mutex::new(PtySession { master: pair.master, writer, child })),
    );

    let tid = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut decoder = StreamDecoder::new();
        let mut scanner = StreamScanner::new();
        // 输出合批：把高频 read 事件聚成窗口再 emit，避免大输出时 IPC + React 风暴。
        // 冲刷时机：累积达到阈值 / 距上次冲刷超过 FLUSH_INTERVAL / 读到 EOF 或出错。
        // pending 存扫描后的结构化事件，pending_bytes 追踪原始负载字节数作阈值依据。
        let mut pending: Vec<ScanEvent> = Vec::new();
        let mut pending_bytes = 0usize;
        let mut last_flush = std::time::Instant::now();
        loop {
            // Unix：先 poll master fd，超时（FLUSH_INTERVAL 内无新数据）时冲刷 pending 尾巴，
            // 否则阻塞 read 会让最后一段输出卡住直到下一条输出才出现。
            #[cfg(unix)]
            {
                let should_flush_tail = match master_fd {
                    Some(fd) => {
                        let mut pfd = libc::pollfd { fd, events: libc::POLLIN, revents: 0 };
                        let rc = unsafe { libc::poll(&mut pfd, 1, FLUSH_INTERVAL.as_millis() as i32) };
                        // 超时（无新数据）或对端挂起 → 冲刷尾巴；POLLIN 表示有数据，交给下面 read
                        rc == 0 || (rc > 0 && (pfd.revents & libc::POLLIN) == 0)
                    }
                    None => false,
                };
                if should_flush_tail && !pending.is_empty() {
                    flush_output(&app, &tid, &mut pending, &mut pending_bytes);
                    last_flush = std::time::Instant::now();
                }
            }

            match reader.read(&mut buf) {
                Ok(0) => {
                    if !pending.is_empty() {
                        flush_output(&app, &tid, &mut pending, &mut pending_bytes);
                    }
                    let _ = app.emit("pty-exit", PtyExit { id: tid.clone() });
                    reap_session(&app, &tid);
                    break;
                }
                Ok(n) => {
                    let data = decoder.push(&buf[..n]);
                    if data.is_empty() {
                        continue; // 不完整尾部，等下次 read
                    }
                    let events = scanner.push(&data);
                    if events.is_empty() {
                        continue; // 全是 pending（孤立 ESC 等）
                    }
                    pending_bytes += data.len();
                    pending.extend(events);
                    if pending_bytes >= FLUSH_BYTES || last_flush.elapsed() >= FLUSH_INTERVAL {
                        flush_output(&app, &tid, &mut pending, &mut pending_bytes);
                        last_flush = std::time::Instant::now();
                    }
                }
                Err(_) => {
                    if !pending.is_empty() {
                        flush_output(&app, &tid, &mut pending, &mut pending_bytes);
                    }
                    reap_session(&app, &tid);
                    break;
                }
            }
        }
    });
    Ok(id)
}

/// 输出合批窗口：距上次冲刷超过该时长即 flush（即使数据量未达阈值）
const FLUSH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(16);
/// 输出合批阈值：累积达到该字节数立即 flush，避免单条 IPC 消息过大
const FLUSH_BYTES: usize = 32 * 1024;

/// 冲刷累积输出（结构化事件）；emit 失败（窗口已关闭）时顺手收敛会话。
fn flush_output(
    app: &AppHandle,
    id: &str,
    pending: &mut Vec<ScanEvent>,
    pending_bytes: &mut usize,
) {
    if pending.is_empty() {
        return;
    }
    let events = std::mem::take(pending);
    *pending_bytes = 0;
    if app.emit("pty-output", PtyOutput { id: id.to_string(), events }).is_err() {
        // 窗口已关闭：清掉 session，避免残留
        reap_session(app, id);
    }
}

#[tauri::command]
pub async fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    // 只从全局表取 Arc 句柄，不持锁做 IO——写 PTY 可能因前台进程不读 stdin 而阻塞，
    // 若持全局锁会冻结其它会话的 resize/signal/close。
    let session = {
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        sessions.get(&id).cloned().ok_or("session not found")?
    };
    // write_all/flush 是阻塞 IO，放 blocking 线程，只锁本会话，不占主线程
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = session.lock().map_err(|e| e.to_string())?;
        s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let session = {
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        sessions.get(&id).cloned().ok_or("session not found")?
    };
    let session = session.lock().map_err(|e| e.to_string())?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>, kill: State<'_, KillState>, id: String) -> Result<(), String> {
    let session = {
        let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
        sessions.remove(&id)
    };
    if let Some(session) = session {
        // 从表里移除后拿独占 Arc，kill 后必须 wait 回收子进程，否则成为僵尸进程
        let mut s = session.lock().map_err(|e| e.to_string())?;
        let _ = s.child.kill();
        let _ = s.child.wait();
    }
    // 同步清理「结束升级」状态，避免长时间使用后无限增长
    if let Ok(mut attempts) = kill.0.lock() {
        attempts.remove(&id);
    }
    Ok(())
}

/// 会话退出后的收敛：从状态表移除并 wait 回收子进程，释放 master/writer fd。
/// 由读线程在读到 EOF 或出错时调用。
fn reap_session(app: &AppHandle, id: &str) {
    let session = app
        .state::<PtyState>()
        .0
        .lock()
        .ok()
        .and_then(|mut m| m.remove(id));
    if let Some(session) = session {
        if let Ok(mut s) = session.lock() {
            let _ = s.child.wait();
        }
    }
    // 同步清理该会话的「结束升级」状态，避免长时间使用后无限增长
    if let Ok(mut kill) = app.state::<KillState>().0.lock() {
        kill.remove(id);
    }
}

/// 允许发送的信号白名单（防止前端传任意信号乱杀无关进程）
#[cfg(unix)]
const ALLOWED_SIGNALS: [i32; 3] = [libc::SIGINT, libc::SIGTERM, libc::SIGKILL];

/// 给 PTY 前台进程组发信号（结束按钮的「强」路径）。
/// 防护：前台进程组 == shell 自身（即没有应用在跑）时拒绝，避免误杀 shell。
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

/// 升级式结束的窗口：首次点击后，该时长内再点升级为 SIGKILL。
const ESCALATE_WINDOW: std::time::Duration = std::time::Duration::from_secs(3);

/// 每会话「上次结束尝试」时间，升级逻辑收口到 Rust（跨窗口重载保持）。
#[derive(Default)]
pub struct KillState(pub Mutex<HashMap<String, std::time::Instant>>);

fn should_escalate(elapsed_since_last: Option<std::time::Duration>) -> bool {
    match elapsed_since_last {
        Some(d) => d < ESCALATE_WINDOW,
        None => false,
    }
}

/// 结束 PTY 前台应用（结束按钮）。升级式：首次 SIGTERM，窗口内再点升级 SIGKILL。
/// 返回本次级别（"term" / "kill"），前端据此切换按钮文案。
#[tauri::command]
pub fn pty_kill_foreground(
    state: State<'_, PtyState>,
    kill: State<'_, KillState>,
    id: String,
) -> Result<String, String> {
    let session = {
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        sessions.get(&id).cloned().ok_or("session not found")?
    };
    let session = session.lock().map_err(|e| e.to_string())?;

    let now = std::time::Instant::now();
    let escalate = {
        let mut attempts = kill.0.lock().map_err(|e| e.to_string())?;
        let esc = should_escalate(attempts.get(&id).map(|t| now.duration_since(*t)));
        attempts.insert(id, now);
        esc
    };

    #[cfg(unix)]
    {
        let sig = if escalate { libc::SIGKILL } else { libc::SIGTERM };
        signal_fg_process_group(&*session.master, session.child.process_id(), sig)?;
    }
    #[cfg(not(unix))]
    {
        let _ = escalate;
        return Err("当前平台不支持信号结束，请用 Ctrl+C".into());
    }
    Ok(if escalate { "kill" } else { "term" }.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn escalate_within_window_and_not() {
        assert!(!should_escalate(None)); // 首次
        assert!(should_escalate(Some(std::time::Duration::from_secs(2)))); // 3s 内
        assert!(!should_escalate(Some(std::time::Duration::from_secs(4)))); // 超窗口
    }

    /// 多字节 UTF-8 字符跨 read 边界不应产生 U+FFFD。
    #[test]
    fn utf8_split_across_reads_is_buffered() {
        // "中" = E4 B8 AD。模拟分两次到达：E4 | B8 AD
        let mut decoder = super::StreamDecoder::new();
        assert_eq!(decoder.push(&[0xE4]), "");           // 不完整 → 不输出
        assert_eq!(decoder.push(&[0xB8, 0xAD]), "中");   // 补齐 → 输出
        assert_eq!(decoder.push(b"hello"), "hello");     // ASCII 直出
        // 非法字节降级为替换符（不 panic）
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

    #[cfg(unix)]
    fn fg_pgid(session: &TestSession) -> i32 {
        unsafe { libc::tcgetpgrp(session.master.as_raw_fd().unwrap()) }
    }

    /// 只有 shell 在跑时拒绝发信号（防止误杀 shell 自己）
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

    /// 白名单外的信号直接拒绝
    #[cfg(unix)]
    #[test]
    fn signal_fg_rejects_disallowed_signal() {
        let session = spawn_shell(80, 24, None).expect("spawn");
        let err = signal_fg_process_group(&*session.master, None, libc::SIGSTOP)
            .expect_err("SIGSTOP not allowed");
        assert!(err.contains("not allowed"), "unexpected: {err}");
    }

    /// SIGTERM 能杀掉忽略 Ctrl+C 的前台应用，且 shell 本体存活
    #[cfg(unix)]
    #[test]
    fn signal_fg_term_kills_foreground_app_shell_survives() {
        // 需要交互式 shell 才有作业控制（tcsetpgrp 切前台进程组）；
        // new_default_prog 的非交互 sh 不切，fg 永远是 shell
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
        // sleep 无 SIGINT 处理器也会退，这里重点是验证「发到前台进程组而非 shell」
        session.writer.write_all(b"sleep 30\n").unwrap();
        session.writer.flush().unwrap();

        // 等前台进程组切到 sleep
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while fg_pgid(&session) == shell_pid as i32 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_ne!(fg_pgid(&session), shell_pid as i32, "sleep never became fg");

        signal_fg_process_group(&*session.master, Some(shell_pid), libc::SIGTERM).expect("sigterm");

        // 前台切回 shell，且 shell 还能执行命令
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
}
