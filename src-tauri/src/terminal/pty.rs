use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::terminal::shell_integration;
use crate::terminal::scan::{ScanEvent, StreamScanner};

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

/// read 线程 → 主循环的消息（Windows 无 poll，用 channel + recv_timeout 做空闲超时冲刷）。
enum ReadMsg {
    Data(Vec<u8>),
    End,
}

#[cfg(test)]
#[allow(dead_code)] // master/child 只被 unix 用例读取，Windows 下保持结构完整
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

/// 校验 SSH 目标主机：host 以 `-` 开头会被 ssh 解析为命令行选项
/// （如 `-oProxyCommand=…`），必须拒绝，防止参数注入。
fn validate_ssh_host(host: &str) -> Result<(), String> {
    if host.is_empty() {
        return Err("SSH 主机不能为空".to_string());
    }
    if host.starts_with('-') {
        return Err("SSH 主机名不能以 - 开头（会被解析为命令行选项）".to_string());
    }
    if host.chars().any(char::is_whitespace) {
        return Err("SSH 主机名不能包含空白字符".to_string());
    }
    Ok(())
}

/// 按用户选择的 shell / ssh 目标构建启动命令，并注入 OSC 133 shell integration。
fn build_shell_cmd(
    cwd: Option<String>,
    shell: Option<String>,
    ssh: Option<SshTarget>,
    open_mode: Option<String>,
) -> Result<CommandBuilder, String> {
    // 1. SSH 连接：`ssh -t [-p port] [user@]host [<远端注入命令>]`
    //    -t 强制分配 TTY；打开模式为 block 时附加远端注入命令（OSC 133 shell integration，
    //    安全性最高版本，注入失败自动回退经典模式）；classic 则不注入（传统交互）。
    if let Some(target) = ssh {
        validate_ssh_host(&target.host)?;
        let mut cmd = CommandBuilder::new("ssh");
        cmd.arg("-t");
        for arg in ssh_args(&target.host, target.user.as_deref(), target.port) {
            cmd.arg(arg);
        }
        if open_mode.as_deref() != Some("classic") {
            cmd.arg(shell_integration::ssh_remote_command());
        }
        if let Some(d) = cwd { cmd.cwd(d); }
        return Ok(cmd);
    }

    let integ_dir = shell_integration::integration_dir().ok();
    let requested = shell.as_deref().unwrap_or_default();

    // 2. 显式选择 shell：zsh/bash/powershell 注入集成脚本；cmd 无集成，走 classic 回退
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
            let prog = if requested == "pwsh" { "pwsh" } else { "powershell" };
            return Ok(powershell_command(prog, &integ_dir, cwd));
        }
        "cmd" => {
            return Ok(cmd_command(cwd));
        }
        _ => {}
    }

    // 3. 未显式选择：Windows 默认 pwsh → powershell → cmd（不再默认 Git Bash/MINGW64）；
    //    Unix 沿用 $SHELL 探测。
    #[cfg(target_os = "windows")]
    {
        match default_windows_shell() {
            "cmd" => return Ok(cmd_command(cwd)),
            prog => return Ok(powershell_command(prog, &integ_dir, cwd)),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell_env = std::env::var("SHELL").unwrap_or_default();
        if let Some(ref dir) = integ_dir {
            if shell_env.contains("zsh") {
                let mut cmd = CommandBuilder::new(&shell_env);
                cmd.env("ZDOTDIR", dir.join("zsh").to_string_lossy().to_string());
                if let Some(d) = cwd { cmd.cwd(d); }
                return Ok(cmd);
            }
            if shell_env.contains("bash") {
                let mut cmd = CommandBuilder::new(&shell_env);
                cmd.arg("--rcfile");
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
}

/// 构造 PowerShell / pwsh 启动命令（注入 OSC 133 集成脚本）。
fn powershell_command(prog: &str, integ_dir: &Option<std::path::PathBuf>, cwd: Option<String>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(prog);
    if let Some(dir) = integ_dir {
        cmd.arg("-NoLogo");
        cmd.arg("-NoExit");
        cmd.arg("-File");
        cmd.arg(dir.join("powershell").join("profile.ps1").to_string_lossy().to_string());
    }
    if let Some(d) = cwd { cmd.cwd(d); }
    cmd
}

/// 构造 cmd 启动命令（无集成）。
fn cmd_command(cwd: Option<String>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("cmd");
    if let Some(d) = cwd { cmd.cwd(d); }
    cmd
}

/// 把常见用户 bin 目录补进 PTY 子进程的 PATH。
///
/// GUI 应用（Finder/Dock 启动）的 PATH 只有系统默认值
/// （/usr/bin:/bin:/usr/sbin:/sbin），不含 /usr/local/bin（brew/手动安装）
/// 等用户工具目录 —— 终端里跑 opencode/claude/node 等会 command not found，
/// 且用户 .zshrc 里 `npm config get prefix` 这类依赖也会失败。
/// 已存在的目录排在系统 PATH 前面（作为种子，最终 PATH 仍由 .zshrc 决定）。
fn merge_user_bin_paths(cmd: &mut CommandBuilder) {
    // `PATH` uses `:` on Unix and `;` on Windows.  Splitting/joining it by
    // hand silently turns Windows drive letters into separate entries and
    // can make the selected shell (especially `pwsh`) impossible to spawn.
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut merged: Vec<PathBuf> = Vec::new();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let push = |dir: PathBuf,
                require_directory: bool,
                merged: &mut Vec<PathBuf>,
                seen: &mut std::collections::HashSet<PathBuf>| {
        if dir.as_os_str().is_empty()
            || (require_directory && !dir.is_dir())
            || seen.contains(&dir)
        {
            return;
        }
        seen.insert(dir.clone());
        merged.push(dir);
    };

    // GUI launches on Unix often omit these user directories.  Windows keeps
    // its normal PATH intact; only the cross-platform path serialization is
    // needed there to keep shell discovery and spawning reliable.
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

    // `join_paths` applies the platform separator and preserves Windows drive
    // letters.  Fall back to the original value if an unusual entry cannot be
    // joined rather than replacing PATH with an empty value.
    let path = std::env::join_paths(merged).unwrap_or(current);
    cmd.env("PATH", path);
}

/// GUI（Finder/Dock 启动）的 TERM 通常为空 —— zsh 会退化为 dumb、依赖终端
/// 能力检测的 TUI（claude 等 truecolor 全屏应用）会因检测失败挂起/黑屏。
/// 统一补上 xterm-256color + truecolor（用户已显式设置的优先，不改动）。
fn merge_term_env(cmd: &mut CommandBuilder) {
    if std::env::var("TERM").map(|v| v.is_empty()).unwrap_or(true) {
        cmd.env("TERM", "xterm-256color");
    }
    if std::env::var("COLORTERM").map(|v| v.is_empty()).unwrap_or(true) {
        cmd.env("COLORTERM", "truecolor");
    }
}

/// Windows 默认 shell：pwsh → powershell → cmd（进程内缓存，避免每次建终端都 spawn 探测）。
#[cfg(target_os = "windows")]
fn default_windows_shell() -> &'static str {
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

#[tauri::command]
// 参数镜像前端 IPC 调用契约（pty_spawn 逐字段传参），折叠结构体需同步改前端
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
    ssh: Option<SshTarget>,
    open_mode: Option<String>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = build_shell_cmd(cwd, shell, ssh, open_mode)?;
    // GUI 启动 PATH 缺用户 bin（/usr/local/bin 等），补进子进程（ssh 分支也顺带受益）
    merge_user_bin_paths(&mut cmd);
    // GUI 启动 TERM 为空 → TUI 应用（claude 等）能力检测失败会挂起，补 xterm-256color
    merge_term_env(&mut cmd);
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
        // 阻塞 read 放独立线程；主循环用 recv_timeout 实现「空闲超时冲刷」。
        // 否则最后一段输出（如 cmd/PowerShell 的提示符）会卡在 pending 里，
        // 直到下一次输入/输出才 flush（Windows 上没有 poll，这里统一用 channel）。
        let (tx, rx) = std::sync::mpsc::channel::<ReadMsg>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        let _ = tx.send(ReadMsg::End);
                        break;
                    }
                    Ok(n) => {
                        let _ = tx.send(ReadMsg::Data(buf[..n].to_vec()));
                    }
                }
            }
        });

        let mut decoder = StreamDecoder::new();
        let mut scanner = StreamScanner::new();
        // 输出合批：把高频 read 事件聚成窗口再 emit，避免大输出时 IPC + React 风暴。
        // 冲刷时机：累积达到阈值 / 距上次冲刷超过 FLUSH_INTERVAL / 空闲超时 / 读到 EOF 或出错。
        // pending 存扫描后的结构化事件，pending_bytes 追踪原始负载字节数作阈值依据。
        let mut pending: Vec<ScanEvent> = Vec::new();
        let mut pending_bytes = 0usize;
        let mut last_flush = std::time::Instant::now();
        loop {
            match rx.recv_timeout(FLUSH_INTERVAL) {
                Ok(ReadMsg::Data(bytes)) => {
                    let data = decoder.push(&bytes);
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
                // EOF / 出错 / 读线程意外断开：冲刷剩余，收敛会话
                Ok(ReadMsg::End) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    if !pending.is_empty() {
                        flush_output(&app, &tid, &mut pending, &mut pending_bytes);
                    }
                    let _ = app.emit("pty-exit", PtyExit { id: tid.clone() });
                    reap_session(&app, &tid);
                    break;
                }
                // 空闲超时（FLUSH_INTERVAL 内无新数据）：冲刷 pending 尾巴，让最后一段输出及时上屏
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        flush_output(&app, &tid, &mut pending, &mut pending_bytes);
                        last_flush = std::time::Instant::now();
                    }
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
    // Windows 控制台 Enter 是 CR(0x0D)；\n(0x0A) 是 Ctrl+J，PSReadLine/cmd 都不当回车，
    // 前端命令发送统一用 \n，这里归一化成 CR，否则 PowerShell 等收不到回车、命令无响应。
    #[cfg(windows)]
    let data = normalize_enter(&data);
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

/// Windows：把换行统一成 CR（Enter）。\n 是 Ctrl+J，PSReadLine/cmd 都不认。
#[cfg(windows)]
fn normalize_enter(data: &str) -> String {
    data.replace("\r\n", "\r").replace('\n', "\r")
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
        // 从表里移除后拿独占 Arc，kill 后必须 wait 回收子进程，否则成为僵尸进程。
        // Windows 上连带终结整棵进程树，避免前台应用成为孤儿继续运行。
        let mut s = session.lock().map_err(|e| e.to_string())?;
        kill_child_tree(&mut *s.child);
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

/// 结束子进程；Windows 上只 TerminateProcess 根 shell 会留下孤儿前台应用，
/// 因此先按进程树整棵终结，再补一发 child.kill() 兜底（根进程已在树内，幂等）。
fn kill_child_tree(child: &mut dyn Child) {
    #[cfg(windows)]
    if let Some(pid) = child.process_id() {
        let _ = terminate_process_tree(pid, true);
    }
    let _ = child.kill();
}

/// Windows「结束」首击：向 PTY 输入写入 ETX(0x03)。ConPTY 的输入状态机
/// 会把 0x03 转成 Ctrl+C 按键（keydown+keyup），由 console host 触发
/// CTRL_C 处理，等价于用户按下 Ctrl+C——与前端「发送 Ctrl+C」按钮走同一条
/// writer 路径（见 src/terminal/TerminalView.tsx 的 sendCtrlC）。
#[cfg(windows)]
fn send_ctrl_c(writer: &mut dyn Write) -> Result<(), String> {
    writer.write_all(b"\x03").map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

/// Windows 强杀：终结以 root_pid 为根的进程树。
/// ConPTY 下前台应用是 shell 的后代进程，portable-pty 的 child.kill() 只
/// TerminateProcess 根进程，会留下孤儿应用；这里用 Toolhelp 快照收集后代，
/// 从最深的子进程开始逐个 TerminateProcess。
/// `include_root=false` 时保留根进程（shell）本身——用于「结束前台应用」：
/// 只杀前台应用子树，外层 shell 存活并在前台退出后重新给出提示符。
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

    // 快照进程表，构建 ppid -> children 映射
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

    // BFS 收集要杀的进程（root 及全部后代，或仅 root 的后代）；反转后从最深先杀，
    // 避免父进程先死导致子进程被系统重新挂到别的父进程下而漏杀。
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
            continue; // 防御：绝不杀自己
        }
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        if handle.is_null() {
            continue; // 已退出或无权限：尽力而为
        }
        unsafe { TerminateProcess(handle, 1) };
        unsafe { CloseHandle(handle) };
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

/// 结束 PTY 前台应用（结束按钮）。升级式：首次 SIGTERM（Windows 上为 Ctrl+C），
/// 窗口内再点升级 SIGKILL（Windows 上为终结整棵进程树）。
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
    let mut session = session.lock().map_err(|e| e.to_string())?;

    let now = std::time::Instant::now();
    let escalate = {
        let mut attempts = kill.0.lock().map_err(|e| e.to_string())?;
        let esc = should_escalate(attempts.get(&id).map(|t| now.duration_since(*t)));
        attempts.insert(id, now);
        esc
    };

    kill_foreground_impl(&mut session, escalate)?;
    Ok(if escalate { "kill" } else { "term" }.to_string())
}

/// 平台相关的「结束前台应用」实现：Unix 用信号打到前台进程组。
#[cfg(unix)]
fn kill_foreground_impl(session: &mut PtySession, escalate: bool) -> Result<(), String> {
    let sig = if escalate { libc::SIGKILL } else { libc::SIGTERM };
    signal_fg_process_group(&*session.master, session.child.process_id(), sig)
}

/// 平台相关的「结束前台应用」实现：Windows 首击发 Ctrl+C（等价用户按键），
/// 再击强杀整棵进程树（只杀 shell 会留下孤儿前台应用）。
#[cfg(windows)]
fn kill_foreground_impl(session: &mut PtySession, escalate: bool) -> Result<(), String> {
    if escalate {
        match session.child.process_id() {
            // 只杀前台应用子树，保留外层 shell（前台退出后 shell 重新给提示符）
            Some(pid) => terminate_process_tree(pid, false),
            None => session.child.kill().map_err(|e| e.to_string()),
        }
    } else {
        send_ctrl_c(&mut *session.writer)
    }
}

/// 平台相关的「结束前台应用」实现：其它平台暂无信号机制。
#[cfg(not(any(unix, windows)))]
fn kill_foreground_impl(_session: &mut PtySession, _escalate: bool) -> Result<(), String> {
    Err("当前平台不支持信号结束，请用 Ctrl+C".into())
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

    /// Windows：命令发送的 \n 要归一化成 CR（Enter），否则 PSReadLine/cmd 不认。
    #[cfg(windows)]
    #[test]
    fn normalize_enter_converts_newlines_to_cr() {
        assert_eq!(super::normalize_enter("echo hi\n"), "echo hi\r");
        assert_eq!(super::normalize_enter("a\r\nb\n"), "a\rb\r");
        assert_eq!(super::normalize_enter("no-newline"), "no-newline");
    }

    /// GUI 启动缺用户 bin 目录：合并后 /usr/local/bin 必须存在且去重。
    #[cfg(unix)]
    #[test]
    fn merge_user_bin_paths_adds_local_bin_and_dedups() {
        let mut cmd = CommandBuilder::new("zsh");
        // 模拟 GUI 最小 PATH（Finder/Dock 启动的应用只有系统默认值）
        std::env::set_var("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        merge_user_bin_paths(&mut cmd);
        let path = cmd.get_env("PATH").expect("PATH 被设置");
        let dirs: Vec<&str> = path.to_str().unwrap().split(':').collect();
        assert!(dirs.contains(&"/usr/local/bin"), "缺 /usr/local/bin: {path:?}");
        // 用户目录在最前，系统目录在后；无重复
        assert_eq!(dirs[0], "/usr/local/bin");
        let mut seen = std::collections::HashSet::new();
        for d in &dirs {
            assert!(seen.insert(*d), "PATH 有重复: {d}");
        }
        // 继承的 PATH 不丢失
        assert!(dirs.contains(&"/usr/bin"));
    }

    /// Windows 的 PATH 必须保留盘符和 `;` 分隔符，否则 `pwsh` 无法被找到。
    #[cfg(windows)]
    #[test]
    fn merge_user_bin_paths_preserves_windows_path_entries() {
        let original = std::env::var_os("PATH");
        std::env::set_var("PATH", r"C:\Windows\System32;C:\Program Files\PowerShell\7");

        let mut cmd = CommandBuilder::new("pwsh");
        merge_user_bin_paths(&mut cmd);
        let path = cmd.get_env("PATH").expect("PATH 被设置");
        assert_eq!(
            path.to_str(),
            Some(r"C:\Windows\System32;C:\Program Files\PowerShell\7")
        );

        match original {
            Some(value) => std::env::set_var("PATH", value),
            None => std::env::remove_var("PATH"),
        }
    }

    /// GUI 启动 TERM 为空：补 xterm-256color + truecolor；已显式设置时不动。
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

    /// 快照进程表，返回 ppid 的直接子进程中可执行文件名包含 name_fragment 的 pid。
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

    /// 判断 pid 是否仍在运行（OpenProcess + GetExitCodeProcess == STILL_ACTIVE）。
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

    /// Windows：强杀必须连带终结 shell 的子孙进程（只杀 shell 会留下孤儿前台应用）。
    #[cfg(windows)]
    #[test]
    fn terminate_tree_kills_descendants() {
        use std::time::{Duration, Instant};

        // cmd -> ping 127.0.0.1 -n 30（约 30s），形成两代进程树
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

        // 等 ping 子进程出现
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

        // 根与后代都应在数秒内消失
        let deadline = Instant::now() + Duration::from_secs(5);
        while (pid_alive(shell_pid) || pid_alive(ping_pid)) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!pid_alive(shell_pid), "shell 仍在运行");
        assert!(!pid_alive(ping_pid), "ping 仍在运行");
        let _ = child.wait();
    }
}
