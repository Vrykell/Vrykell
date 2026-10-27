//! acp — the client half of the Agent Client Protocol (protocol version 1).
//!
//! An agent is a program that speaks one JSON-RPC 2.0 message per line over stdio
//! (agentclientprotocol.com). This module owns the parts that must not live in the page: the
//! subprocess, the framing, request correlation, and the answers to the requests an agent sends
//! *back* to us.
//!
//! Deliberate choices, in line with `docs/zh/security-model.md`:
//!
//!   * what we advertise is what we can gate, so `initialize` claims almost nothing until the
//!     file-system handlers exist (they arrive with the approval work);
//!   * a request we cannot answer is answered with an error, never ignored — an agent waiting
//!     forever is worse than an agent told no;
//!   * a permission request is decided by a handler we own, so the local approval chain (levels,
//!     shape grants, deadlines) can sit behind it without the agent knowing.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

/// Protocol major version this client speaks.
pub const PROTOCOL_VERSION: u64 = 1;

/// The first request of a connection also pays for the program's start-up — and for `npx` presets,
/// a one-time package download — so it gets a much longer budget than the rest.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(180);

/// Creating a session may load the agent's own configuration; the handshake already paid for the
/// program's start-up, so this only has to be generous.
const SESSION_TIMEOUT: Duration = Duration::from_secs(120);

/// Switching a mode, a model or another session option is a small request, but the agent may
/// reload a model when it happens.
const CONFIG_TIMEOUT: Duration = Duration::from_secs(60);

/// Reopening a session replays its whole conversation before the agent answers, and a long history
/// takes as long as it takes.
const LOAD_TIMEOUT: Duration = Duration::from_secs(300);

/// A turn stays open until the agent stops it: real turns run for minutes (thinking, tool calls)
/// and the stop button — not a clock — is what ends one early. The budget is a safety net for an
/// agent that never answers at all.
const TURN_TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// The tail of the agent's stderr kept for the error surface. Harnesses log freely; the last few
/// KiB are what explains an exit, and a bound keeps a chatty agent from growing the process.
const STDERR_TAIL_LIMIT: usize = 8 * 1024;

/// How long the reader waits for the child to report its status once its output has ended.
const EXIT_STATUS_GRACE: Duration = Duration::from_millis(500);

/// JSON-RPC code the protocol defines for a request that needs authentication.
pub const AUTH_REQUIRED_CODE: i64 = -32000;

/// A failed request. The code travels beside the text because `-32000` is the protocol's
/// "authentication required": the page must not infer that from the wording of an error.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentFailure {
    pub code: Option<i64>,
    pub message: String,
    /// Raw transport output (exit status and the agent's stderr tail), shown behind the error's
    /// disclosure instead of inside its summary.
    pub details: Option<String>,
    /// The message describes a connection that ended, not something the agent decided.
    pub transport: bool,
}

impl AgentFailure {
    fn new(code: Option<i64>, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), details: None, transport: false }
    }

    fn transport(message: impl Into<String>) -> Self {
        Self { transport: true, ..Self::new(None, message) }
    }

    fn with_details(mut self, details: Option<String>) -> Self {
        self.details = details;
        self
    }

    fn is_authentication(&self) -> bool { self.code == Some(AUTH_REQUIRED_CODE) }
}

impl std::fmt::Display for AgentFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

/// A readable line from a JSON-RPC error: the message it carries, which is what a user can act on.
/// Agents put their own error objects under `data`, so the raw value is only the last resort.
fn agent_failure(error: &Value) -> AgentFailure {
    let message = error.get("message").and_then(Value::as_str).unwrap_or("").trim();
    let code = error.get("code").and_then(Value::as_i64);
    let text = match (message.is_empty(), code) {
        (false, Some(code)) => format!("agent error ({code}): {message}"),
        (false, None) => format!("agent error: {message}"),
        (true, _) => format!("agent error: {error}"),
    };
    AgentFailure::new(code, text)
}

/// Keep only the end of the agent's diagnostics: a crash explains itself in its last lines.
fn append_stderr_tail(buffer: &mut Vec<u8>, chunk: &[u8]) {
    buffer.extend_from_slice(chunk);
    if buffer.len() > STDERR_TAIL_LIMIT {
        let excess = buffer.len() - STDERR_TAIL_LIMIT;
        buffer.drain(..excess);
    }
}

/// Resolve executable extensions explicitly, skipping extensionless shims for other platforms.
#[cfg(windows)]
fn resolve_program(command: &str) -> Option<PathBuf> {
    let direct = Path::new(command);
    if direct.components().count() > 1 {
        return direct.is_file().then(|| direct.to_path_buf());
    }
    let extensions: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
        .split(';')
        .map(|extension| extension.trim().to_ascii_lowercase())
        .filter(|extension| !extension.is_empty())
        .collect();
    for dir in std::env::split_paths(&std::env::var("PATH").unwrap_or_default()) {
        // npm ships a POSIX `npx` next to `npx.cmd`; a file without a Windows executable extension is
        // a shim for another platform and cannot be started here, so it is skipped.
        let plain = dir.join(command);
        if plain.is_file() && plain.extension().is_some() {
            return Some(plain);
        }
        for extension in &extensions {
            let candidate = dir.join(format!("{command}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// The program to start and the arguments to start it with, after the platform's own resolution.
fn launch_command(command: &str, args: &[String]) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if let Some(resolved) = resolve_program(command) {
            return (resolved.to_string_lossy().to_string(), args.to_vec());
        }
    }
    (command.to_string(), args.to_vec())
}
/// What we tell an agent we can do. Small on purpose: a capability we advertise but cannot gate is
/// a capability we should not have. The `fs` and `terminal` handlers are not advertised: harnesses
/// use their own tools, and every permission request still goes through our approval chain.
pub fn client_capabilities() -> Value {
    json!({
        "session": { "notices": {} },
        "fs": { "readTextFile": false, "writeTextFile": false },
        "terminal": false,
    })
}

/// How a permission request was answered.
#[derive(Clone, Debug, PartialEq)]
pub enum PermissionOutcome {
    /// One of the options the agent offered was picked (its `optionId`).
    Selected(String),
    /// Nobody answered, or the turn was cancelled: the protocol's own "no" for that case.
    Cancelled,
}

/// Decides permission requests. `None` answers immediately (a probe never runs a tool); `Some`
/// means the decision comes later, from the page, and the client waits for it.
pub type PermissionHandler = Arc<dyn Fn(Value) -> Option<oneshot::Receiver<PermissionOutcome>> + Send + Sync>;

/// How long a pending permission may hold a turn before it answers itself with the protocol's own
/// "no". The page normally answers long before this; the deadline exists so an unattended session
/// cannot hang for ever, which is the same rule the approval card follows.
pub const PERMISSION_TIMEOUT: Duration = Duration::from_secs(600);

/// Wait for a decision, or refuse when the deadline passes.
async fn await_permission(receiver: oneshot::Receiver<PermissionOutcome>, timeout: Duration) -> PermissionOutcome {
    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(outcome)) => outcome,
        // A dropped sender means nobody will ever answer.
        _ => PermissionOutcome::Cancelled,
    }
}

/// Requests that arrive from the agent while a turn is running.
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, AgentFailure>>>>>;

pub struct AcpClient {
    /// Lines waiting for the writer task.
    out: mpsc::UnboundedSender<String>,
    next_id: AtomicU64,
    pending: Pending,
    /// Notifications the agent sent (`session/update` and friends), in arrival order. Behind a
    /// mutex so the event pump and a request can run side by side.
    events: tokio::sync::Mutex<mpsc::UnboundedReceiver<Value>>,
    /// Held so the child is killed when the client is dropped (`kill_on_drop`). Shared with the
    /// reader so it can report the exit status once the agent's output ends.
    child: Arc<Mutex<Option<Child>>>,
    tasks: Vec<tokio::task::AbortHandle>,
    /// True once the transport is unusable: the pipe ended or the client was shut down.
    closed: Arc<AtomicBool>,
    /// True only when we closed it ourselves; a connection that ends without this was an agent
    /// that died, which the page has to be told about.
    closing: Arc<AtomicBool>,
    /// The end of the agent's stderr, which is where a crash explains itself.
    stderr: Arc<Mutex<Vec<u8>>>,
    /// Exit code of the agent process, or `i32::MIN` while it is still running.
    exit_code: Arc<AtomicI32>,
    mcp_servers: Mutex<Vec<Value>>,
}

impl AcpClient {
    /// Speak ACP over any readable/writable pair. Tests drive this with an in-memory duplex.
    pub fn over<R, W>(reader: R, writer: W, permission: PermissionHandler) -> Self
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let (event_tx, events) = mpsc::unbounded_channel::<Value>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));
        let closing = Arc::new(AtomicBool::new(false));
        let stderr = Arc::new(Mutex::new(Vec::new()));
        let exit_code = Arc::new(AtomicI32::new(i32::MIN));
        let child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

        // Writer task: one line per message, exactly as the protocol frames them.
        let writer_task = tokio::spawn(async move {
            let mut writer = writer;
            while let Some(line) = out_rx.recv().await {
                if writer.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if writer.write_all(b"\n").await.is_err() {
                    break;
                }
                let _ = writer.flush().await;
            }
        });

        // Reader task: responses resolve their request, agent requests are answered, everything
        // else is a notification and goes to the event channel.
        let reader_pending = pending.clone();
        // The reader answers agent requests, so it needs its own handle to the write queue.
        let answer_tx = out_tx.clone();
        let reader_closed = closed.clone();
        let reader_stderr = stderr.clone();
        let reader_exit = exit_code.clone();
        let reader_child = child.clone();
        let reader_task = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let id = message.get("id").and_then(Value::as_u64);
                if let Some(method) = message.get("method").and_then(Value::as_str) {
                    match (id, method) {
                        // Agent → client request: answer through the handler, or refuse.
                        (Some(id), m) => {
                            let reply = if m == "session/request_permission" {
                                let params = message.get("params").cloned().unwrap_or(Value::Null);
                                // Waiting here is safe: the protocol is sequential at this point (the
                                // agent holds the turn until it has an answer), and the deadline
                                // keeps an unattended session from hanging.
                                let outcome = match permission(params.clone()) {
                                    Some(receiver) => await_permission(receiver, PERMISSION_TIMEOUT).await,
                                    None => PermissionOutcome::Cancelled,
                                };
                                match outcome {
                                    PermissionOutcome::Selected(option) => json!({
                                        "outcome": { "outcome": "selected", "optionId": option }
                                    }),
                                    PermissionOutcome::Cancelled => json!({
                                        "outcome": { "outcome": "cancelled" }
                                    }),
                                }
                            } else {
                                // Not advertised, or not implemented: say so instead of leaving the
                                // agent waiting for an answer that never comes.
                                let _ = event_tx.send(message.clone());
                                let text = format!("method not supported by this client: {m}");
                                let payload = json!({
                                    "jsonrpc": "2.0", "id": id,
                                    "error": { "code": -32601, "message": text }
                                });
                                let _ = out_tx_for_error(&answer_tx, payload);
                                continue;
                            };
                            let payload = json!({ "jsonrpc": "2.0", "id": id, "result": reply });
                            let _ = out_tx_for_error(&answer_tx, payload);
                        }
                        // Agent → client notification.
                        (None, _) => {
                            if event_tx.send(message).is_err() {
                                break;
                            }
                        }
                    }
                    continue;
                }
                // Response to one of our requests.
                if let Some(id) = id {
                    let waiter = reader_pending.lock().ok().and_then(|mut map| map.remove(&id));
                    if let Some(waiter) = waiter {
                        let outcome = match message.get("error") {
                            Some(error) => Err(agent_failure(error)),
                            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                        };
                        let _ = waiter.send(outcome);
                    }
                }
            }
            // The agent closed the pipe. Mark the transport unusable before waking the waiters:
            // a prompt sent after this point must fail at once, not wait out its whole budget.
            reader_closed.store(true, Ordering::SeqCst);
            capture_exit_status(&reader_child, &reader_exit, EXIT_STATUS_GRACE).await;
            let details = transport_details(&reader_stderr, &reader_exit);
            if let Ok(mut map) = reader_pending.lock() {
                for (_, waiter) in map.drain() {
                    let _ = waiter.send(Err(AgentFailure::transport("the agent closed the connection").with_details(details.clone())));
                }
            }
        });

        Self { out: out_tx, next_id: AtomicU64::new(0), pending, events: tokio::sync::Mutex::new(events), mcp_servers: Mutex::new(Vec::new()),
            child, tasks: vec![writer_task.abort_handle(), reader_task.abort_handle()], closed, closing, stderr, exit_code }
    }

    /// Spawn a program and speak ACP to it. `kill_on_drop` keeps a killed client from leaking a
    /// process, and the working directory is the session's, never the app's.
    pub fn spawn(
        command: &str,
        args: &[String],
        cwd: Option<&Path>,
        env: &HashMap<String, String>,
        permission: PermissionHandler,
    ) -> Result<Self, String> {
        // Resolve the configured program; the process builder owns native argument encoding.
        let (program, program_args) = launch_command(command, args);
        let mut cmd = Command::new(&program);
        cmd.args(&program_args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.as_std_mut().process_group(0);
        }
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        for (key, value) in env {
            cmd.env(key, value);
        }
        let mut child = cmd.spawn().map_err(|e| format!("could not start the harness: {e}"))?;
        let stdin = child.stdin.take().ok_or("the harness gave no stdin")?;
        let stdout = child.stdout.take().ok_or("the harness gave no stdout")?;
        let stderr = child.stderr.take();
        let mut client = Self::over(BufReader::new(stdout), stdin, permission);
        if let Some(mut stderr) = stderr {
            // Keep reading stderr for the life of the process: a pipe nobody drains would fill up
            // and block a chatty agent, and the tail is what explains a crash.
            let tail = client.stderr.clone();
            let reader = tokio::spawn(async move {
                let mut chunk = [0u8; 4096];
                loop {
                    match stderr.read(&mut chunk).await {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            if let Ok(mut buffer) = tail.lock() { append_stderr_tail(&mut buffer, &chunk[..count]); }
                        }
                    }
                }
            });
            client.tasks.push(reader.abort_handle());
        }
        *client.child.lock().map_err(|_| "the client state is poisoned")? = Some(child);
        Ok(client)
    }

    /// True only when this client closed the connection itself; an agent that dies leaves it false.
    pub fn is_closing(&self) -> bool { self.closing.load(Ordering::SeqCst) }

    pub fn exit_code(&self) -> Option<i32> {
        match self.exit_code.load(Ordering::SeqCst) {
            i32::MIN => None,
            code => Some(code),
        }
    }

    pub fn stderr_len(&self) -> usize {
        self.stderr.lock().map(|buffer| buffer.len()).unwrap_or(0)
    }

    /// What the process left behind, for the error's disclosure. `None` when it left nothing.
    pub fn transport_details(&self) -> Option<String> { transport_details(&self.stderr, &self.exit_code) }

    /// A short suffix for a start-up failure: the exit code and the last stderr line, which is
    /// usually the only sentence that says why the program refused to run.
    pub fn transport_hint(&self) -> String {
        let code = self.exit_code();
        let tail = self.stderr.lock().ok().map(|buffer| String::from_utf8_lossy(&buffer).to_string()).unwrap_or_default();
        let line = tail.lines().rev().find(|line| !line.trim().is_empty()).map(|line| line.trim().replace(['\r', '\n'], " ")).unwrap_or_default();
        let line = line.chars().take(200).collect::<String>();
        match (code, line.is_empty()) {
            (Some(code), false) => format!(" (exit code {code}; stderr: {line})"),
            (Some(code), true) => format!(" (exit code {code})"),
            (None, false) => format!(" (stderr: {line})"),
            (None, true) => String::new(),
        }
    }

    fn stop_io(&self) {
        self.closing.store(true, Ordering::SeqCst);
        self.closed.store(true, Ordering::SeqCst);
        for task in &self.tasks { task.abort(); }
        if let Ok(mut pending) = self.pending.lock() {
            for (_, waiter) in pending.drain() {
                let _ = waiter.send(Err(AgentFailure::transport("the harness connection is closed")));
            }
        }
    }

    /// Closing is explicit: pending requests and the event pump may still own this client.
    async fn shutdown(&self) {
        self.stop_io();
        let child = self.child.lock().ok().and_then(|mut child| child.take());
        if let Some(mut child) = child {
            #[cfg(unix)]
            if let Some(pid) = child.id() {
                // The process has its own group, so descendants close with their session.
                unsafe { libc::kill(-(pid as i32), libc::SIGKILL); }
            }
            #[cfg(windows)]
            if let Some(pid) = child.id() {
                // Include descendants started by command-script wrappers.
                let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(0x08000000).output().await;
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }

    fn send_line(&self, message: Value) -> Result<(), String> {
        if self.closed.load(Ordering::SeqCst) { return Err("the harness connection is closed".to_string()); }
        let line = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        self.out.send(line).map_err(|_| "the harness connection is closed".to_string())
    }

    /// A request that waits for its own answer. Every caller names its budget: how long an answer
    /// takes differs by method, and a budget shorter than the work turns a slow turn into a
    /// failure the user cannot explain.
    pub async fn request(&self, method: &str, params: Value, budget: Duration) -> Result<Value, String> {
        self.request_detailed(method, params, budget).await.map_err(|failure| failure.to_string())
    }

    /// The same request, keeping the JSON-RPC code so a caller can tell an authentication failure
    /// from any other. Only the turn path needs that distinction today.
    async fn request_detailed(&self, method: &str, params: Value, budget: Duration) -> Result<Value, AgentFailure> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().map_err(|_| AgentFailure::new(None, "the client state is poisoned"))?;
            if self.closed.load(Ordering::SeqCst) { return Err(AgentFailure::transport("the harness connection is closed")); }
            map.insert(id, tx);
        }
        if let Err(error) = self.send_line(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })) {
            if let Ok(mut pending) = self.pending.lock() { pending.remove(&id); }
            return Err(AgentFailure::transport(error));
        }
        match tokio::time::timeout(budget, rx).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err(AgentFailure::new(None, format!("{method} answered nothing"))),
            Err(_) => {
                // Drop the waiter so a late answer is ignored rather than resolving a dead call.
                if let Ok(mut map) = self.pending.lock() {
                    map.remove(&id);
                }
                Err(AgentFailure::new(None, format!("{method} timed out")))
            }
        }
    }

    /// A notification: sent, never answered.
    pub fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.send_line(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    /// The next notification the agent sent; `None` once the connection is gone.
    pub async fn next_event(&self) -> Option<Value> {
        self.events.lock().await.recv().await
    }

    /// Negotiate versions and capabilities. The result carries what the agent can do.
    pub async fn initialize(&self, client_name: &str, client_version: &str) -> Result<Value, String> {
        self.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "clientCapabilities": client_capabilities(),
                "clientInfo": { "name": client_name, "title": "Vrykell", "version": client_version },
            }),
            HANDSHAKE_TIMEOUT,
        )
        .await
    }

    /// Create a session in a working directory and answer with the agent's whole session result —
    /// the id plus whatever state it publishes (modes, models, config options).
    pub async fn new_session(&self, cwd: &str) -> Result<Value, String> {
        let servers = self.mcp_servers.lock().map_err(|_| "application tools unavailable")?.clone();
        let result = self
            .request("session/new", json!({ "cwd": cwd, "mcpServers": servers }), SESSION_TIMEOUT)
            .await?;
        if result.get("sessionId").and_then(Value::as_str).is_none() {
            return Err("the agent created no session".to_string());
        }
        Ok(result)
    }

    /// Reopen an existing session. The agent replays the conversation as notifications before it
    /// answers, so the caller must drain [`Self::drain_events`] right afterwards.
    pub async fn load_session(&self, session_id: &str, cwd: &str) -> Result<Value, String> {
        let servers = self.mcp_servers.lock().map_err(|_| "application tools unavailable")?.clone();
        self.request(
            "session/load",
            json!({ "sessionId": session_id, "cwd": cwd, "mcpServers": servers }),
            LOAD_TIMEOUT,
        )
        .await
    }

    /// Everything the agent has sent and nobody has read yet, in arrival order.
    pub async fn drain_events(&self) -> Vec<Value> {
        let mut events = self.events.lock().await;
        let mut drained = Vec::new();
        while let Ok(message) = events.try_recv() {
            drained.push(message);
        }
        drained
    }

    /// Switch the session mode (the legacy mode API; agents with config options expose it there).
    pub async fn set_mode(&self, session_id: &str, mode_id: &str) -> Result<(), String> {
        self.request(
            "session/set_mode",
            json!({ "sessionId": session_id, "modeId": mode_id }),
            CONFIG_TIMEOUT,
        )
        .await
        .map(|_| ())
    }

    /// Switch the session model: the older model API, which the agents still accept next to
    /// `session/set_config_option`.
    pub async fn set_model(&self, session_id: &str, model_id: &str) -> Result<(), String> {
        self.request(
            "session/set_model",
            json!({ "sessionId": session_id, "modelId": model_id }),
            CONFIG_TIMEOUT,
        )
        .await
        .map(|_| ())
    }

    /// Set one session config option; the answer carries the complete configuration state.
    pub async fn set_config_option(&self, session_id: &str, config_id: &str, value: Value) -> Result<Value, String> {
        let result = self
            .request(
                "session/set_config_option",
                json!({ "sessionId": session_id, "configId": config_id, "value": value }),
                CONFIG_TIMEOUT,
            )
            .await?;
        Ok(result.get("configOptions").cloned().unwrap_or(Value::Null))
    }

    /// Send a prompt and wait for the stop reason; the turn's content arrives as notifications.
    pub async fn prompt(&self, session_id: &str, prompt: Value) -> Result<String, AgentFailure> {
        let result = self
            .request_detailed(
                "session/prompt",
                json!({ "sessionId": session_id, "prompt": prompt }),
                TURN_TIMEOUT,
            )
            .await?;
        Ok(result
            .get("stopReason")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string())
    }

    /// Ask the agent to stop; the turn ends with the `cancelled` stop reason.
    pub fn cancel(&self, session_id: &str) -> Result<(), String> {
        self.notify("session/cancel", json!({ "sessionId": session_id }))
    }
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        self.stop_io();
        // The reader task holds a clone of the child slot, so dropping this client alone would not
        // necessarily drop the process. Taking it out here keeps `kill_on_drop` immediate.
        if let Ok(mut child) = self.child.lock() { child.take(); }
    }
}

/// Small helper so the reader task can send an agent-request answer without owning the sender.
fn out_tx_for_error(tx: &mpsc::UnboundedSender<String>, payload: Value) -> Result<(), String> {
    let line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    tx.send(line).map_err(|_| "the harness connection is closed".to_string())
}

/// Record the child's exit status once its output has ended. A process is normally reaped by the
/// time its stdout closes; the short grace covers the kernel's own ordering, not a slow program.
async fn capture_exit_status(child: &Arc<Mutex<Option<Child>>>, exit_code: &AtomicI32, grace: Duration) {
    let deadline = tokio::time::Instant::now() + grace;
    loop {
        {
            if let Ok(mut guard) = child.lock() {
                let Some(child) = guard.as_mut() else { return };
                if let Ok(Some(status)) = child.try_wait() {
                    exit_code.store(status.code().unwrap_or(i32::MIN), Ordering::SeqCst);
                    return;
                }
            }
        }
        if tokio::time::Instant::now() >= deadline { return; }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// The exit status and the stderr tail, formatted for the error disclosure. Only what the process
/// actually produced: no prompt text and no invented reason.
fn transport_details(stderr: &Arc<Mutex<Vec<u8>>>, exit_code: &Arc<AtomicI32>) -> Option<String> {
    let code = match exit_code.load(Ordering::SeqCst) {
        i32::MIN => None,
        code => Some(code),
    };
    let tail = stderr.lock().ok().map(|buffer| String::from_utf8_lossy(&buffer).trim().to_string()).unwrap_or_default();
    match (code, tail.is_empty()) {
        (None, true) => None,
        (Some(code), true) => Some(format!("exit code: {code}")),
        (None, false) => Some(tail),
        (Some(code), false) => Some(format!("exit code: {code}\n\n{tail}")),
    }
}

/// A protocol version the client cannot speak has to fail at the handshake: continuing would make
/// every later message mean something else.
fn check_protocol_version(info: &Value) -> Result<(), String> {
    match info.get("protocolVersion").and_then(Value::as_u64) {
        Some(version) if version != PROTOCOL_VERSION => Err(format!(
            "the harness speaks protocol version {version}; this app speaks protocol version {PROTOCOL_VERSION}"
        )),
        _ => Ok(()),
    }
}

// ── configuration ────────────────────────────────────────────────────────────

/// One external harness: the program to start and how to start it. A harness is a program the user
/// adds deliberately — that, not a sandbox, is the authorization (see the security model).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HarnessConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    /// Working directory for the process; the session's own `cwd` is sent per session.
    pub cwd: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HarnessFile {
    pub harnesses: Vec<HarnessConfig>,
}

impl HarnessFile {
    fn path() -> PathBuf {
        dirs::home_dir().unwrap_or_default().join(".vrykell").join("harnesses.json")
    }

    pub fn load() -> Result<Self, String> {
        Self::read_from(&Self::path())
    }

    fn read_from(path: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(path) {
            Ok(raw) => serde_json::from_str(&raw).map_err(|_| "harness-config-invalid".to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("harness-config-unreadable".to_string()),
        }
    }

    /// Write the config back. The settings page is the caller, and it is also what the built-in
    /// presets fill in.
    pub fn save(&self) -> Result<(), String> {
        let path = Self::path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("cannot create the config directory: {e}"))?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let temporary = path.with_file_name(format!("harnesses-{}.tmp", uuid::Uuid::new_v4().simple()));
        let result = std::fs::write(&temporary, json).and_then(|_| std::fs::rename(&temporary, &path));
        if result.is_err() { let _ = std::fs::remove_file(&temporary); }
        result.map_err(|_| "harness-config-write-failed".to_string())
    }

    /// A configured harness that is switched on, by name.
    pub fn find_enabled(&self, name: &str) -> Option<&HarnessConfig> {
        self.harnesses.iter().find(|harness| harness.name == name && harness.enabled && !harness.command.trim().is_empty())
    }
}

/// Probe a configured harness: start it, negotiate, report what it says it can do, and let the
/// process go. This is the only ACP command that starts something, and it starts a program the user
/// put in the config — the same class as the terminal.
#[tauri::command]
pub async fn acp_handshake(name: String) -> Result<Value, String> {
    let config = HarnessFile::load()?;
    note("acp-handshake", json!({ "name": name, "configured": config.harnesses.len() }));
    let harness = config
        .find_enabled(&name)
        .ok_or_else(|| format!("no enabled harness named {name}"))?
        .clone();
    let client = AcpClient::spawn(
        &harness.command,
        &harness.args,
        if harness.cwd.trim().is_empty() { None } else { Some(Path::new(&harness.cwd)) },
        &harness.env,
        // A probe never runs a tool: anything the agent asks for is refused, fail closed.
        Arc::new(|_| None),
    )
    .map_err(|error| {
        // Say which program was missing: "program not found" alone leaves the user guessing.
        let error = format!("{error} (command: {})", harness.command);
        note("acp-handshake-failed", json!({ "name": harness.name, "stage": "spawn" }));
        error
    })?;
    let outcome = client.initialize("vrykell", env!("CARGO_PKG_VERSION")).await;
    // Capture what the process said before shutdown takes its pipes away.
    let hint = client.transport_hint();
    client.shutdown().await;
    let info = outcome.map_err(|error| {
        note("acp-handshake-failed", json!({ "name": harness.name, "stage": "initialize" }));
        format!("harness handshake failed: {error}{hint}")
    })?;
    check_protocol_version(&info).map_err(|error| {
        note("acp-handshake-failed", json!({ "name": harness.name, "stage": "version" }));
        error
    })?;
    note("acp-handshake-ok", json!({
        "name": harness.name,
        "protocolVersion": info.get("protocolVersion").cloned().unwrap_or(Value::Null),
    }));
    Ok(describe_agent(&info))
}

/// What a handshake tells us about an agent.
fn describe_agent(info: &Value) -> Value {
    json!({
        "protocolVersion": info.get("protocolVersion").cloned().unwrap_or(Value::Null),
        "agentInfo": info.get("agentInfo").cloned().unwrap_or(Value::Null),
        "agentCapabilities": info.get("agentCapabilities").cloned().unwrap_or(Value::Null),
        "authMethods": info.get("authMethods").cloned().unwrap_or(Value::Null),
    })
}

/// Replace the harness list. Validation is deliberately strict: a harness without a name or a
/// command cannot be started, and it would only confuse the settings list.
#[tauri::command]
pub fn acp_harness_save(harnesses: Vec<HarnessConfig>) -> Result<(), String> {
    for harness in &harnesses {
        if harness.name.trim().is_empty() {
            return Err("a harness needs a name".to_string());
        }
        if harness.command.trim().is_empty() {
            return Err(format!("harness {} has no command", harness.name));
        }
    }
    HarnessFile { harnesses }.save()
}

/// The configured harnesses, for the settings list. Commands and arguments are included on purpose:
/// the user is looking at what will run.
#[tauri::command]
pub fn acp_harnesses() -> Result<Vec<HarnessConfig>, String> {
    Ok(HarnessFile::load()?.harnesses)
}

/// Sessions currently open. Dropping the last reference kills the child (`kill_on_drop`).
#[derive(Default)]
pub struct AcpRuntime {
    sessions: Mutex<HashMap<String, Arc<RuntimeSession>>>,
    /// Permission requests waiting for the page's answer, keyed by session and tool call id: two
    /// sessions may use the same tool call id, and an answer must only reach the one that asked.
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionOutcome>>>>,
}

struct RuntimeSession { client: Arc<AcpClient>, agent_session_id: String, app_tools: Option<super::app_mcp::AppMcpServer> }

/// Key of a pending permission request: the session and the tool call id it belongs to.
fn pending_key(session: &str, tool_call_id: &str) -> String {
    format!("{session}::{tool_call_id}")
}

impl AcpRuntime {
    fn insert(&self, session: String, agent_session_id: String, client: Arc<AcpClient>, app_tools: Option<super::app_mcp::AppMcpServer>) {
        if let Ok(mut map) = self.sessions.lock() {
            map.insert(session, Arc::new(RuntimeSession { client, agent_session_id, app_tools }));
        }
    }

    fn get(&self, session: &str) -> Result<Arc<RuntimeSession>, String> {
        self.sessions
            .lock()
            .map_err(|_| "the ACP state is poisoned".to_string())?
            .get(session)
            .cloned()
            .ok_or_else(|| format!("no open harness session {session}"))
    }

    fn remove(&self, session: &str) -> Option<Arc<RuntimeSession>> {
        let client = self.sessions.lock().ok().and_then(|mut map| map.remove(session));
        self.reject_pending(session);
        client
    }

    fn reject_pending(&self, session: &str) {
        // Requests this session was waiting on cannot be answered any more; drop them with it so a
        // stale id cannot resolve later.
        if let Ok(mut pending) = self.pending.lock() {
            let prefix = format!("{session}::");
            pending.retain(|key, _| !key.starts_with(&prefix));
        }
    }

    /// Answer a pending permission request. `option_id` is one of the options the agent offered;
    /// `None` answers the protocol's own "cancelled".
    fn answer(&self, session: &str, tool_call_id: &str, option_id: Option<String>) -> Result<(), String> {
        let key = pending_key(session, tool_call_id);
        let sender = self
            .pending
            .lock()
            .map_err(|_| "the ACP state is poisoned".to_string())?
            .remove(&key)
            .ok_or_else(|| format!("no permission request is waiting for {tool_call_id}"))?;
        let outcome = match option_id {
            Some(option) => PermissionOutcome::Selected(option),
            None => PermissionOutcome::Cancelled,
        };
        sender.send(outcome).map_err(|_| "the request is no longer waiting".to_string())
    }
}

/// Answer a permission request the harness sent (the card's buttons land here). The tool call id is
/// what the request was keyed by, and an unknown one is refused rather than ignored.
#[tauri::command]
pub fn acp_answer_permission(
    state: tauri::State<'_, AcpRuntime>,
    session_id: String,
    tool_call_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    let answered = state.answer(&session_id, &tool_call_id, option_id.clone());
    note("acp-permission-answered", json!({ "sessionId": session_id, "toolCallId": tool_call_id, "optionId": option_id }));
    answered
}

/// One event from a harness session. `kind` is one of `update`, `permission`, `stop`, `error`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AcpEvent {
    session_id: String,
    kind: String,
    payload: Value,
}

/// Event name the frontend listens on.
const EVENT: &str = "acp://session";

/// Record what the harness commands did, so a failed attempt can be read out of the diagnostics log
/// instead of guessed at. Metadata only: names, session ids and error text, never prompt content.
fn note(event: &str, detail: serde_json::Value) {
    if let Err(error) = crate::diagnostics::record(event, detail) {
        eprintln!("[acp] could not record {event}: {error}");
    }
}

fn emit<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: AcpEvent) {
    // A closed window is not an error worth surfacing; the session is dropped with it.
    let _ = tauri::Emitter::emit(app, EVENT, event);
}

/// Open a session, resuming `resume` when the agent can. A failed load falls back to a new session:
/// a stale id (a deleted session, another directory) must not lock the user out. The replay of a
/// loaded session is drained here, in arrival order, because the page only learns the id when the
/// command returns.
async fn open_session(
    client: &AcpClient,
    name: &str,
    cwd: &str,
    resume: Option<&str>,
    can_load: bool,
) -> Result<(Value, String, Vec<AcpEvent>), String> {
    if let (Some(id), true) = (resume, can_load) {
        match client.load_session(id, cwd).await {
            Ok(loaded) => {
                let replayed: Vec<AcpEvent> = client
                    .drain_events()
                    .await
                    .into_iter()
                    .map(|message| AcpEvent { session_id: id.to_string(), kind: "update".to_string(), payload: message })
                    .collect();
                note("acp-load-ok", json!({ "name": name, "sessionId": id, "replayed": replayed.len() }));
                return Ok((loaded, id.to_string(), replayed));
            }
            Err(_) => note("acp-load-failed", json!({ "name": name, "stage": "load" })),
        }
    }
    let session = client
        .new_session(cwd)
        .await
        .map_err(|e| format!("harness could not open a session: {e}"))?;
    let id = session.get("sessionId").and_then(Value::as_str).unwrap_or_default().to_string();
    Ok((session, id, Vec::new()))
}

/// Start a harness and open a session in `cwd` (or reopen `resume_session_id`), then pump its
/// notifications to the frontend.
#[tauri::command]
pub async fn acp_open<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AcpRuntime>,
    name: String,
    cwd: String,
    resume_session_id: Option<String>,
    app_tools: Option<Vec<Value>>,
) -> Result<Value, String> {
    let catalog = super::app_mcp::validate_catalog(app_tools.unwrap_or_default())?;
    let config = HarnessFile::load()?;
    note("acp-open", json!({
        "name": name, "hasDirectory": !cwd.is_empty(), "configured": config.harnesses.len(),
        "resume": resume_session_id.is_some(),
    }));
    let harness = config
        .find_enabled(&name)
        .ok_or_else(|| format!("no enabled harness named {name}"))?
        .clone();

    // The request is shown in the transcript; the answer comes back through
    // `acp_answer_permission`, and an unanswered request refuses itself when the deadline passes.
    let permission_app = app.clone();
    let connection_id = format!("acp_{}", uuid::Uuid::new_v4().simple());
    let permission_session = connection_id.clone();
    let pending = state.pending.clone();
    // Cloned up front: the handler runs on the reader task and cannot borrow the command's state.
    let pending_handle = pending.clone();
    let permission: PermissionHandler = Arc::new(move |params: Value| {
        let tool_call = params.get("toolCall").cloned().unwrap_or(Value::Null);
        let tool_call_id = tool_call.get("toolCallId").and_then(Value::as_str).unwrap_or_default().to_string();
        let session = permission_session.clone();
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut map) = pending_handle.lock() {
            map.insert(pending_key(&session, &tool_call_id), sender);
        }
        emit(
            &permission_app,
            AcpEvent { session_id: session, kind: "permission".to_string(), payload: params },
        );
        Some(receiver)
    });

    let client = Arc::new(AcpClient::spawn(
        &harness.command,
        &harness.args,
        if harness.cwd.trim().is_empty() { None } else { Some(Path::new(&harness.cwd)) },
        &harness.env,
        permission,
    )
    .map_err(|error| {
        // Same reason as the handshake: name the program that could not be started.
        let error = format!("{error} (command: {})", harness.command);
        note("acp-open-failed", json!({ "name": harness.name, "stage": "spawn" }));
        error
    })?);
    let info = match client.initialize("vrykell", env!("CARGO_PKG_VERSION")).await {
        Ok(info) => info,
        Err(error) => {
            let hint = client.transport_hint();
            client.shutdown().await;
            note("acp-open-failed", json!({ "name": harness.name, "stage": "initialize" }));
            return Err(format!("harness handshake failed: {error}{hint}"));
        }
    };
    if let Err(error) = check_protocol_version(&info) {
        client.shutdown().await;
        note("acp-open-failed", json!({ "name": harness.name, "stage": "version" }));
        return Err(error);
    }
    // The protocol requires an absolute working directory, and an empty one is refused by the agent
    // ("cwd must be an absolute path"). Fall back to the directory the app itself runs in; a caller
    // that knows the project directory (the workspace does) should pass it.
    let session_cwd = if cwd.trim().is_empty() {
        std::env::current_dir()
            .map(|dir| dir.to_string_lossy().to_string())
            .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().to_string_lossy().to_string())
    } else {
        cwd.clone()
    };
    // Reopen the previous conversation when the page asks for it and the agent can: `session/load`
    // replays the history as notifications, which are drained with the result because the page only
    // learns the session id when this call returns. A failed load falls back to a new session — a
    // stale id (a deleted session, another directory) must not lock the user out.
    let can_load = info
        .pointer("/agentCapabilities/loadSession")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let resume = resume_session_id.filter(|id| !id.trim().is_empty());
    let app_tools = if catalog.is_empty() { None } else {
        let tool_app = app.clone(); let tool_session = connection_id.clone();
        let bridge = match super::app_mcp::AppMcpServer::start(catalog, Arc::new(move |payload| {
            tauri::Emitter::emit_to(&tool_app, "main", EVENT, AcpEvent { session_id: tool_session.clone(), kind: "app-tool".into(), payload }).is_ok()
        })).await {
            Ok(bridge) => bridge,
            Err(error) => { client.shutdown().await; return Err(error); }
        };
        if let Ok(mut servers) = client.mcp_servers.lock() { *servers = vec![bridge.descriptor()]; }
        Some(bridge)
    };
    let (session, agent_session_id, mut replayed) = match open_session(&client, &harness.name, &session_cwd, resume.as_deref(), can_load).await {
        Ok(result) => result,
        Err(error) => { client.shutdown().await; state.reject_pending(&connection_id); return Err(error); }
    };
    let session_id = connection_id;
    for event in &mut replayed { event.session_id = session_id.clone(); }

    // Pump the agent's notifications for as long as the session lives.
    let pump_app = app.clone();
    let pump_name = harness.name.clone();
    let mut saw_update = false;
    let pump_session = session_id.clone();
    let pump_client = Arc::downgrade(&client);
    tokio::spawn(async move {
        loop {
            // Explicit shutdown closes the notification channel even while this task owns a client.
            let Some(pump_client) = pump_client.upgrade() else { break };
            let Some(message) = pump_client.next_event().await else {
                // The channel closes for two reasons only: we shut the session down, or the agent's
                // output ended. The second one has to reach the page, which would otherwise keep
                // showing a session that can no longer answer anything.
                if !pump_client.is_closing() {
                    let details = pump_client.transport_details();
                    note("acp-transport-closed", json!({
                        "name": pump_name,
                        "sessionId": pump_session.clone(),
                        "exitCode": pump_client.exit_code(),
                        "stderrBytes": pump_client.stderr_len(),
                    }));
                    emit(
                        &pump_app,
                        AcpEvent {
                            session_id: pump_session.clone(),
                            kind: "error".to_string(),
                            payload: json!({
                                "message": "the agent closed the connection",
                                "reason": "transport",
                                "details": details,
                            }),
                        },
                    );
                }
                break;
            };
            // The first notification is the interesting one for diagnosis: an open session that
            // never speaks means the agent found nothing to report, not that the wire is broken.
            if !saw_update {
                saw_update = true;
                note("acp-open-first-update", json!({
                    "name": pump_name,
                    "kind": message.pointer("/params/update/sessionUpdate").cloned().unwrap_or(Value::Null),
                }));
            }
            emit(
                &pump_app,
                AcpEvent { session_id: pump_session.clone(), kind: "update".to_string(), payload: message },
            );
        }
    });

    let app_tools_connected = app_tools.is_some();
    state.insert(session_id.clone(), agent_session_id.clone(), client, app_tools);
    note("acp-open-ok", json!({ "name": harness.name, "sessionId": session_id }));
    // The session's own state travels with the id: the page shows the modes, models and config
    // options the agent published, and needs them before the first turn.
    Ok(json!({
        "sessionId": session_id,
        "appToolsConnected": app_tools_connected,
        "resumeSessionId": agent_session_id,
        "harness": harness.name,
        "cwd": session_cwd,
        "agent": describe_agent(&info),
        "modes": session.get("modes").cloned().unwrap_or(Value::Null),
        "models": session.get("models").cloned().unwrap_or(Value::Null),
        "configOptions": session.get("configOptions").cloned().unwrap_or(Value::Null),
        "replayed": replayed,
    }))
}

/// Switch the session mode (legacy mode API; agents that publish config options get those instead).
#[tauri::command]
pub async fn acp_set_mode(
    state: tauri::State<'_, AcpRuntime>,
    session_id: String,
    mode_id: String,
) -> Result<(), String> {
    let session = state.get(&session_id)?;
    session.client.set_mode(&session.agent_session_id, &mode_id).await
}

/// Switch the session model (legacy model API; see `acp_set_config_option` for the newer one).
#[tauri::command]
pub async fn acp_set_model(
    state: tauri::State<'_, AcpRuntime>,
    session_id: String,
    model_id: String,
) -> Result<(), String> {
    let session = state.get(&session_id)?;
    session.client.set_model(&session.agent_session_id, &model_id).await
}

/// Set one session config option and answer with the complete configuration state the agent returns.
#[tauri::command]
pub async fn acp_set_config_option(
    state: tauri::State<'_, AcpRuntime>,
    session_id: String,
    config_id: String,
    value: Value,
) -> Result<Value, String> {
    let session = state.get(&session_id)?;
    session.client.set_config_option(&session.agent_session_id, &config_id, value).await
}

/// Send a prompt. The turn runs in the background; its content and stop reason arrive as events.
#[tauri::command]
pub async fn acp_prompt<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AcpRuntime>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let client = state.get(&session_id)?;
    let generation = client.app_tools.as_ref().map(|tools| tools.begin_turn()).transpose()?;
    note("acp-prompt", json!({ "sessionId": session_id }));
    let app = app.clone();
    let session = session_id.clone();
    tokio::spawn(async move {
        let started = std::time::Instant::now();
        let outcome = client.client
            .prompt(&client.agent_session_id, json!([{ "type": "text", "text": text }]))
            .await;
        if let Some(tools) = &client.app_tools { tools.end_turn(generation); }
        let duration_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        match outcome {
            Ok(stop) => {
                note("acp-prompt-end", json!({ "sessionId": session, "stopReason": stop.clone(), "durationMs": duration_ms }));
                emit(
                    &app,
                    AcpEvent {
                        session_id: session,
                        kind: "stop".to_string(),
                        payload: json!({ "stopReason": stop }),
                    },
                )
            }
            Err(failure) => {
                // Error text is useful in the log; the prompt itself never is.
                note("acp-prompt-end", json!({
                    "sessionId": session,
                    "code": failure.code,
                    "error": failure.message.chars().take(200).collect::<String>(),
                    "durationMs": duration_ms,
                }));
                emit(
                    &app,
                    AcpEvent {
                        session_id: session,
                        kind: "error".to_string(),
                        payload: {
                            let auth_required = failure.is_authentication();
                            let transport = failure.transport;
                            json!({
                                "message": failure.message,
                                "code": failure.code,
                                "authRequired": auth_required,
                                "details": failure.details,
                                "reason": if transport { json!("transport") } else { Value::Null },
                            })
                        },
                    },
                )
            }
        }
    });
    Ok(())
}

/// Ask the agent to stop the current turn.
#[tauri::command]
pub fn acp_cancel(state: tauri::State<'_, AcpRuntime>, session_id: String) -> Result<(), String> {
    state.reject_pending(&session_id);
    let session = state.get(&session_id)?;
    if let Some(tools) = &session.app_tools { tools.end_turn(None); }
    session.client.cancel(&session.agent_session_id)
}

/// Close a session: the agent's process goes with it.
#[tauri::command]
pub async fn acp_close(state: tauri::State<'_, AcpRuntime>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.remove(&session_id) {
        if let Some(tools) = &session.app_tools { tools.end_turn(None); }
        session.client.shutdown().await;
    }
    note("acp-closed", json!({ "sessionId": session_id }));
    Ok(())
}

#[tauri::command]
pub fn acp_app_tool_result<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>, state: tauri::State<'_, AcpRuntime>, session_id: String, request_id: String, payload: Value,
) -> Result<(), String> {
    if window.label() != "main" { return Err("application tools require the main window".into()); }
    if session_id.len() > 128 || request_id.len() > 64 { return Err("invalid application tool request identity".into()); }
    let session = state.get(&session_id)?;
    session.app_tools.as_ref().ok_or("application tools are not connected")?.answer(&request_id, payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn application_server_descriptor_reaches_new_and_loaded_sessions() {
        let (client_io, agent_io) = tokio::io::duplex(8192);
        let (client_reader, client_writer) = tokio::io::split(client_io);
        let client = AcpClient::over(client_reader, client_writer, Arc::new(|_| None));
        let descriptor = json!({"name": "application", "command": "/fixture/helper", "args": ["--app-mcp"], "env": []});
        *client.mcp_servers.lock().unwrap() = vec![descriptor.clone()];
        let agent = tokio::spawn(async move {
            let (reader, mut writer) = tokio::io::split(agent_io);
            let mut lines = BufReader::new(reader).lines();
            for method in ["session/new", "session/load"] {
                let message: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(message["method"], method);
                assert_eq!(message["params"]["mcpServers"], json!([descriptor.clone()]));
                writer.write_all(format!("{}\n", json!({"jsonrpc": "2.0", "id": message["id"], "result": {"sessionId": "fixture"}})).as_bytes()).await.unwrap();
            }
        });
        client.new_session("/tmp/project").await.unwrap();
        client.load_session("fixture", "/tmp/project").await.unwrap();
        agent.await.unwrap();
    }

    #[test]
    fn idle_child_fixture() {
        if std::env::var("APP_ACP_TEST_CHILD").as_deref() == Ok("1") {
            loop { std::thread::park(); }
        }
    }

    #[tokio::test]
    async fn closing_an_idle_child_releases_waiters_and_the_event_pump() {
        let executable = std::env::current_exe().unwrap();
        let client = Arc::new(AcpClient::spawn(executable.to_str().unwrap(),
            &["--exact".into(), "agent::acp::tests::idle_child_fixture".into(), "--nocapture".into()],
            None, &HashMap::from([("APP_ACP_TEST_CHILD".into(), "1".into())]), Arc::new(|_| None)).unwrap());
        let runtime = AcpRuntime::default();
        runtime.insert("idle".into(), "agent-id".into(), client.clone(), None);
        let pump_client = client.clone();
        let pump = tokio::spawn(async move { pump_client.next_event().await });
        let request_client = client.clone();
        let request = tokio::spawn(async move { request_client.request("initialize", json!({}), Duration::from_secs(60)).await });
        tokio::task::yield_now().await;
        runtime.remove("idle").unwrap().client.shutdown().await;
        assert!(tokio::time::timeout(Duration::from_secs(2), pump).await.unwrap().unwrap().is_none());
        assert!(tokio::time::timeout(Duration::from_secs(2), request).await.unwrap().unwrap().is_err());
        assert!(client.child.lock().unwrap().is_none());
        assert!(runtime.get("idle").is_err());
    }

    #[tokio::test]
    async fn native_executable_keeps_the_original_argument_list() {
        let executable = std::env::current_exe().unwrap();
        let (program, args) = launch_command(executable.to_str().unwrap(), &["--list".into()]);
        let output = Command::new(program).args(args).output().await.unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("agent::acp::tests::idle_child_fixture"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn command_script_keeps_paths_and_arguments_containing_spaces() {
        let directory = std::env::temp_dir().join(format!("acp test {}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("agent shim.cmd");
        std::fs::write(&path, "@echo off\r\necho %~1\r\necho %~2\r\n").unwrap();
        let (program, args) = launch_command(path.to_str().unwrap(), &["a path with spaces".into(), "--flag".into()]);
        let output = Command::new(program).args(args).output().await.unwrap();
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(String::from_utf8_lossy(&output.stdout).replace('\r', ""), "a path with spaces\n--flag\n");
    }

    #[test]
    fn invalid_configuration_is_reported_instead_of_becoming_an_empty_list() {
        let path = std::env::temp_dir().join(format!("acp-config-test-{}.json", uuid::Uuid::new_v4().simple()));
        assert!(HarnessFile::read_from(&path).unwrap().harnesses.is_empty());
        std::fs::write(&path, "{invalid").unwrap();
        assert!(HarnessFile::read_from(&path).is_err());
        std::fs::remove_file(&path).unwrap();
    }

    #[tokio::test]
    async fn equal_agent_ids_on_different_connections_remain_independent() {
        let runtime = AcpRuntime::default();
        let (first, first_agent) = client_pair(Arc::new(Mutex::new(Vec::new())), Arc::new(|_| None));
        let (second, second_agent) = client_pair(Arc::new(Mutex::new(Vec::new())), Arc::new(|_| None));
        runtime.insert("local-a".into(), "same-agent-id".into(), Arc::new(first), None);
        runtime.insert("local-b".into(), "same-agent-id".into(), Arc::new(second), None);
        runtime.remove("local-a").unwrap().client.shutdown().await;
        assert!(!runtime.get("local-b").unwrap().client.closed.load(Ordering::SeqCst));
        runtime.remove("local-b").unwrap().client.shutdown().await;
        first_agent.abort();
        second_agent.abort();
    }

    #[test]
    fn reads_a_readable_line_from_a_jsonrpc_error() {
        // The shape an agent sends when its own upstream refuses: the message is the actionable part.
        let error = json!({
            "code": -32603,
            "message": "Internal error: Forbidden, gateway detected abuse traffic",
            "data": { "errorName": "APIError", "service": "session" },
        });
        assert_eq!(
            agent_failure(&error).to_string(),
            "agent error (-32603): Internal error: Forbidden, gateway detected abuse traffic",
        );

        assert_eq!(agent_failure(&json!({ "message": "boom" })).to_string(), "agent error: boom");
        assert_eq!(agent_failure(&json!({ "code": 1 })).to_string(), "agent error: {\"code\":1}");
    }

    #[test]
    fn authentication_is_recognised_by_its_protocol_code_not_its_wording() {
        // The protocol's own auth code; the page must not show login hints for other failures.
        let failure = agent_failure(&json!({ "code": -32000, "message": "Authentication required" }));
        assert_eq!(failure.code, Some(AUTH_REQUIRED_CODE));
        assert!(failure.is_authentication());
        assert!(!agent_failure(&json!({ "code": -32603, "message": "Insufficient Balance" })).is_authentication());
        assert!(!agent_failure(&json!({ "message": "please log in" })).is_authentication());
    }

    #[test]
    fn a_closed_transport_is_flagged_so_the_page_can_localise_it() {
        assert!(AgentFailure::transport("the harness connection is closed").transport);
        assert!(!AgentFailure::new(None, "agent error: boom").transport);
    }

    #[test]
    fn a_protocol_version_the_client_cannot_speak_is_refused() {
        assert!(check_protocol_version(&json!({ "protocolVersion": 1 })).is_ok());
        // Older clients tolerated a missing field; the version is only enforced when it is present.
        assert!(check_protocol_version(&json!({})).is_ok());
        let error = check_protocol_version(&json!({ "protocolVersion": 2 })).unwrap_err();
        assert!(error.contains("protocol version 2"), "{error}");
        assert!(error.contains("speaks protocol version 1"), "{error}");
    }

    #[test]
    fn the_stderr_tail_keeps_the_end_and_drops_the_start() {
        let mut buffer = Vec::new();
        append_stderr_tail(&mut buffer, b"npx: command failed\n");
        append_stderr_tail(&mut buffer, &vec![b'x'; STDERR_TAIL_LIMIT]);
        assert_eq!(buffer.len(), STDERR_TAIL_LIMIT);
        assert!(buffer.ends_with(b"xxxx"));
        assert!(!buffer.starts_with(b"npx"));
    }

    #[tokio::test]
    async fn the_transport_hint_names_the_exit_code_and_the_last_stderr_line() {
        let (ours, _theirs) = tokio::io::duplex(64);
        let (read, write) = tokio::io::split(ours);
        let client = AcpClient::over(read, write, Arc::new(|_| None));
        client.stderr.lock().unwrap().extend_from_slice(b"booting\nunknown option --acp\n");
        client.exit_code.store(2, Ordering::SeqCst);
        assert_eq!(client.transport_hint(), " (exit code 2; stderr: unknown option --acp)");
        assert!(client.transport_details().unwrap().contains("exit code: 2"));
        assert!(client.transport_details().unwrap().contains("unknown option --acp"));
    }

    #[tokio::test]
    async fn an_agent_that_ends_its_output_marks_the_connection_closed_and_wakes_waiters() {
        let (ours, theirs) = tokio::io::duplex(1024);
        let (read, write) = tokio::io::split(ours);
        let client = Arc::new(AcpClient::over(read, write, Arc::new(|_| None)));
        let request_client = client.clone();
        let request = tokio::spawn(async move {
            request_client.request("initialize", json!({}), Duration::from_secs(30)).await
        });
        // Let the request register its waiter, then let the agent disappear without answering.
        tokio::task::yield_now().await;
        drop(theirs);
        let outcome = tokio::time::timeout(Duration::from_secs(5), request).await.expect("the waiter was released").unwrap();
        assert!(outcome.unwrap_err().contains("closed the connection"));
        assert!(client.closed.load(Ordering::SeqCst));
        assert!(!client.closing.load(Ordering::SeqCst));
    }

    /// A scripted agent: answers the handshake, creates a session, streams a turn, asks for
    /// permission, and records what it saw. Everything it does is what the specification says an
    /// agent may do, so the client is tested against the protocol rather than against itself.
    async fn scripted_agent(mut pipe: tokio::io::DuplexStream, seen: Arc<Mutex<Vec<Value>>>) {
        let mut buf: Vec<u8> = Vec::new();
        loop {
            buf.clear();
            let mut byte = [0u8; 1];
            let mut line = String::new();
            // Read one line without pulling in a BufReader (keeps the assertions explicit).
            loop {
                match pipe.read(&mut byte).await {
                    Ok(0) => return,
                    Ok(_) => {
                        if byte[0] == b'\n' {
                            break;
                        }
                        line.push(byte[0] as char);
                    }
                    Err(_) => return,
                }
            }
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            seen.lock().unwrap().push(message.clone());
            let method = message.get("method").and_then(Value::as_str).unwrap_or("");
            let id = message.get("id").cloned();
            match method {
                "initialize" => {
                    let reply = json!({
                        "jsonrpc": "2.0", "id": id,
                        "result": {
                            "protocolVersion": 1,
                            "agentCapabilities": { "loadSession": true },
                            "agentInfo": { "name": "fake", "title": "Fake Agent", "version": "0.1" },
                            "authMethods": []
                        }
                    });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                "session/new" => {
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": {
                        "sessionId": "sess_1",
                        "modes": {
                            "currentModeId": "default",
                            "availableModes": [
                                { "id": "default", "name": "Default" },
                                { "id": "plan", "name": "Plan" }
                            ]
                        },
                        "models": {
                            "currentModelId": "m1",
                            "availableModels": [{ "modelId": "m1", "name": "Model One" }]
                        }
                    } });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                "session/load" => {
                    // The protocol replays the conversation before it answers the load.
                    let update = json!({
                        "jsonrpc": "2.0", "method": "session/update",
                        "params": { "sessionId": "sess_1", "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": { "type": "text", "text": "earlier" }
                        } }
                    });
                    let _ = pipe.write_all(format!("{update}\n").as_bytes()).await;
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": {
                        "modes": { "currentModeId": "plan", "availableModes": [{ "id": "plan", "name": "Plan" }] }
                    } });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                "session/set_mode" | "session/set_model" => {
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": {} });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                "session/set_config_option" => {
                    // The answer carries the complete state, as the specification requires.
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": {
                        "configOptions": [{
                            "id": "mode", "name": "Mode", "type": "select",
                            "category": "mode", "currentValue": "plan",
                            "options": [{ "value": "plan", "name": "Plan" }]
                        }]
                    } });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                "session/prompt" => {
                    for text in ["Hello", " world"] {
                        let update = json!({
                            "jsonrpc": "2.0", "method": "session/update",
                            "params": { "sessionId": "sess_1", "update": {
                                "sessionUpdate": "agent_message_chunk",
                                "content": { "type": "text", "text": text }
                            } }
                        });
                        let _ = pipe.write_all(format!("{update}\n").as_bytes()).await;
                    }
                    // Ask for permission and wait for the answer before finishing the turn.
                    let ask = json!({
                        "jsonrpc": "2.0", "id": 900, "method": "session/request_permission",
                        "params": {
                            "sessionId": "sess_1",
                            "toolCall": { "toolCallId": "call_1", "title": "Run the tests" },
                            "options": [
                                { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
                                { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
                            ]
                        }
                    });
                    let _ = pipe.write_all(format!("{ask}\n").as_bytes()).await;
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": { "stopReason": "end_turn" } });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                _ => {}
            }
        }
    }

    fn client_pair(
        seen: Arc<Mutex<Vec<Value>>>,
        handler: PermissionHandler,
    ) -> (AcpClient, tokio::task::JoinHandle<()>) {
        let (ours, theirs) = tokio::io::duplex(8192);
        let (read, write) = tokio::io::split(ours);
        let client = AcpClient::over(read, write, handler);
        let agent = tokio::spawn(scripted_agent(theirs, seen));
        (client, agent)
    }

    #[tokio::test]
    async fn negotiates_creates_a_session_and_streams_a_turn() {
        let seen: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let asked: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let asked_for_handler = asked.clone();
        let (client, agent) = client_pair(
            seen.clone(),
            Arc::new(move |params: Value| {
                asked_for_handler.lock().unwrap().push(params);
                // The answer travels through a channel, which is how the page answers too.
                let (sender, receiver) = oneshot::channel();
                let _ = sender.send(PermissionOutcome::Selected("allow-once".to_string()));
                Some(receiver)
            }),
        );

        let info = client.initialize("vrykell", "0.1.0").await.expect("handshake");
        assert_eq!(info.get("protocolVersion"), Some(&json!(1)));
        assert_eq!(
            info.pointer("/agentInfo/name").and_then(Value::as_str),
            Some("fake")
        );

        // What we advertise is small on purpose: no file system, no terminal yet.
        let sent = seen.lock().unwrap()[0].clone();
        let caps = sent.pointer("/params/clientCapabilities").cloned().unwrap_or(Value::Null);
        assert_eq!(caps.pointer("/fs/readTextFile"), Some(&json!(false)));
        assert_eq!(caps.get("terminal"), Some(&json!(false)));

        let session = client.new_session("/tmp/project").await.expect("session");
        assert_eq!(session.get("sessionId"), Some(&json!("sess_1")));
        let session_id = session.get("sessionId").and_then(Value::as_str).unwrap().to_string();

        let turn = client.prompt(&session_id, json!([{ "type": "text", "text": "hi" }]));
        let stop = tokio::join!(turn, async {
            // The two chunks arrive while the turn is open.
            let first = client.next_event().await.expect("chunk");
            let second = client.next_event().await.expect("chunk");
            assert_eq!(first.pointer("/params/update/content/text").and_then(Value::as_str), Some("Hello"));
            assert_eq!(second.pointer("/params/update/content/text").and_then(Value::as_str), Some(" world"));
        });
        assert_eq!(stop.0.expect("stop reason"), "end_turn");

        // The handler saw the agent's options and the agent received the chosen one.
        let questions = asked.lock().unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(
            questions[0].pointer("/options/1/kind").and_then(Value::as_str),
            Some("reject_once")
        );
        drop(questions);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let answers = seen.lock().unwrap();
        assert!(
            answers.iter().any(|message| message
                .pointer("/result/outcome/optionId")
                .and_then(Value::as_str)
                == Some("allow-once")
                || message.get("id") == Some(&json!(900))
                    && message.pointer("/result/outcome/outcome").and_then(Value::as_str) == Some("selected")),
            "the agent should have received the selected option"
        );
        agent.abort();
    }

    #[tokio::test]
    async fn refuses_a_request_it_cannot_answer_instead_of_going_silent() {
        // The fake agent asks for a file the client never advertised.
        let (theirs, ours) = tokio::io::duplex(4096);
        let (read, write) = tokio::io::split(ours);
        let client = AcpClient::over(read, write, Arc::new(|_| None));

        let agent = tokio::spawn(async move {
            let mut ours = theirs;
            let ask = json!({
                "jsonrpc": "2.0", "id": 5, "method": "fs/read_text_file",
                "params": { "sessionId": "s", "path": "/etc/hosts" }
            });
            ours.write_all(format!("{ask}\n").as_bytes()).await.unwrap();
            let mut buf = vec![0u8; 512];
            let read = ours.read(&mut buf).await.unwrap();
            String::from_utf8_lossy(&buf[..read]).to_string()
        });

        let answer = agent.await.expect("agent task");
        let parsed: Value = serde_json::from_str(answer.trim()).expect("a JSON-RPC answer");
        assert_eq!(parsed.get("id"), Some(&json!(5)));
        assert_eq!(
            parsed.pointer("/error/code"),
            Some(&json!(-32601)),
            "an unsupported request must be refused, not ignored"
        );
        drop(client);
    }

    /// One newline-delimited message from the agent side of the pipe; `None` once it closes.
    async fn read_line(pipe: &mut tokio::io::DuplexStream) -> Option<Value> {
        let mut line = String::new();
        let mut byte = [0u8; 1];
        loop {
            match pipe.read(&mut byte).await {
                Ok(0) | Err(_) => return None,
                Ok(_) => {
                    if byte[0] == b'\n' {
                        break;
                    }
                    line.push(byte[0] as char);
                }
            }
        }
        serde_json::from_str::<Value>(&line).ok()
    }

    /// An agent that answers the handshake and the session at once but takes `turn` before it
    /// answers the prompt — a model that thinks and calls tools, in other words.
    async fn slow_agent(mut pipe: tokio::io::DuplexStream, turn: Duration) {
        while let Some(message) = read_line(&mut pipe).await {
            let id = message.get("id").cloned();
            match message.get("method").and_then(Value::as_str).unwrap_or("") {
                "initialize" => {
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": { "protocolVersion": 1 } });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                "session/new" => {
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": { "sessionId": "sess_1" } });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                "session/prompt" => {
                    tokio::time::sleep(turn).await;
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": { "stopReason": "end_turn" } });
                    let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
                }
                _ => {}
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn waits_out_a_turn_that_runs_longer_than_a_request_budget() {
        // Real turns run for minutes: with the clock paused, this agent takes 45 s to answer the
        // prompt, and the client must still be waiting rather than reporting a timeout.
        let (ours, theirs) = tokio::io::duplex(8192);
        let (read, write) = tokio::io::split(ours);
        let client = AcpClient::over(read, write, Arc::new(|_| None));
        let agent = tokio::spawn(slow_agent(theirs, Duration::from_secs(45)));

        client.initialize("vrykell", "0.1.0").await.expect("handshake");
        let session = client.new_session("/tmp/project").await.expect("session");
        let session_id = session.get("sessionId").and_then(Value::as_str).unwrap().to_string();
        let stop = client
            .prompt(&session_id, json!([{ "type": "text", "text": "hi" }]))
            .await
            .expect("a slow turn is still a turn");
        assert_eq!(stop, "end_turn");
        agent.abort();
    }

    #[tokio::test]
    async fn loading_a_session_returns_its_state_and_the_replayed_history() {
        let seen: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let (client, agent) = client_pair(seen.clone(), Arc::new(|_| None));
        client.initialize("vrykell", "0.1.0").await.expect("handshake");

        let loaded = client.load_session("sess_1", "/tmp/project").await.expect("load");
        assert_eq!(loaded.pointer("/modes/currentModeId"), Some(&json!("plan")));

        // The replay is queued in arrival order and drained by the caller that opens the page.
        let replayed = client.drain_events().await;
        assert_eq!(replayed.len(), 1);
        assert_eq!(
            replayed[0].pointer("/params/update/content/text").and_then(Value::as_str),
            Some("earlier")
        );
        assert_eq!(
            seen.lock().unwrap().iter().filter(|message| message.get("method") == Some(&json!("session/load"))).count(),
            1
        );
        agent.abort();
    }

    #[tokio::test]
    async fn a_failed_or_unsupported_load_falls_back_to_a_new_session() {
        let (ours, theirs) = tokio::io::duplex(8192);
        let (read, write) = tokio::io::split(ours);
        let client = AcpClient::over(read, write, Arc::new(|_| None));
        let agent = tokio::spawn(async move {
            let mut pipe = theirs;
            while let Some(message) = read_line(&mut pipe).await {
                let id = message.get("id").cloned();
                let reply = match message.get("method").and_then(Value::as_str).unwrap_or("") {
                    "session/load" => json!({
                        "jsonrpc": "2.0", "id": id,
                        "error": { "code": -32602, "message": "no such session" }
                    }),
                    "session/new" => json!({ "jsonrpc": "2.0", "id": id, "result": { "sessionId": "fresh" } }),
                    _ => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
                };
                let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
            }
        });

        // The agent supports loading but the id is stale: a new session opens instead of failing.
        let (session, id, replayed) = open_session(&client, "Fake", "/tmp/project", Some("stale"), true)
            .await
            .expect("fallback");
        assert_eq!(id, "fresh");
        assert_eq!(session.get("sessionId").and_then(Value::as_str), Some("fresh"));
        assert!(replayed.is_empty());

        // An agent that cannot load skips the attempt entirely.
        let (_, id, replayed) = open_session(&client, "Fake", "/tmp/project", Some("stale"), false)
            .await
            .expect("new session");
        assert_eq!(id, "fresh");
        assert!(replayed.is_empty());
        agent.abort();
    }

    #[tokio::test]
    async fn the_session_publishes_its_selectors_and_the_client_can_change_them() {
        let seen: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let (client, agent) = client_pair(seen.clone(), Arc::new(|_| None));
        client.initialize("vrykell", "0.1.0").await.expect("handshake");

        // The session result is the whole state: id plus the modes and models the agent offers.
        let session = client.new_session("/tmp/project").await.expect("session");
        assert_eq!(session.pointer("/modes/currentModeId"), Some(&json!("default")));
        assert_eq!(session.pointer("/models/currentModelId"), Some(&json!("m1")));
        let id = session.get("sessionId").and_then(Value::as_str).unwrap();

        client.set_mode(id, "plan").await.expect("mode");
        client.set_model(id, "m2").await.expect("model");
        let options = client.set_config_option(id, "mode", json!("plan")).await.expect("config");
        assert_eq!(options.pointer("/0/currentValue"), Some(&json!("plan")));

        tokio::time::sleep(Duration::from_millis(50)).await;
        let sent = seen.lock().unwrap();
        let params = |method: &str| {
            sent.iter()
                .find(|message| message.get("method") == Some(&json!(method)))
                .and_then(|message| message.get("params").cloned())
                .unwrap_or(Value::Null)
        };
        assert_eq!(params("session/set_mode").get("modeId"), Some(&json!("plan")));
        assert_eq!(params("session/set_model").get("modelId"), Some(&json!("m2")));
        assert_eq!(params("session/set_config_option").get("configId"), Some(&json!("mode")));
        drop(sent);
        agent.abort();
    }

    #[tokio::test]
    async fn a_cancelled_turn_is_a_notification_the_agent_sees() {
        let seen: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let (client, agent) = client_pair(seen.clone(), Arc::new(|_| None));
        client.initialize("vrykell", "0.1.0").await.expect("handshake");
        client.cancel("sess_1").expect("cancel");
        tokio::time::sleep(Duration::from_millis(50)).await;
        let cancels = seen
            .lock()
            .unwrap()
            .iter()
            .filter(|message| message.get("method") == Some(&json!("session/cancel")))
            .count();
        assert_eq!(cancels, 1);
        assert!(
            seen.lock()
                .unwrap()
                .iter()
                .all(|message| message.get("method") != Some(&json!("session/cancel"))
                    || message.get("id").is_none()),
            "session/cancel is a notification, never a request"
        );
        agent.abort();
    }

    #[tokio::test]
    async fn a_permission_nobody_answers_times_out_as_cancelled() {
        // A dropped sender is an answer that can never arrive: the wait ends instead of hanging.
        let (sender, receiver) = oneshot::channel();
        drop(sender);
        assert_eq!(await_permission(receiver, Duration::from_millis(50)).await, PermissionOutcome::Cancelled);

        // The deadline wins when the answer never comes: the sender is alive but silent, so only the
        // clock can end the wait.
        let (sender, receiver) = oneshot::channel();
        assert_eq!(await_permission(receiver, Duration::from_millis(20)).await, PermissionOutcome::Cancelled);
        drop(sender);

        // ... and an answer that arrives in time wins over the deadline, which is the case that
        // matters: the page's click decides, not the clock.
        let (sender, receiver) = oneshot::channel();
        let _ = sender.send(PermissionOutcome::Selected("allow-once".to_string()));
        assert_eq!(
            await_permission(receiver, Duration::from_millis(500)).await,
            PermissionOutcome::Selected("allow-once".to_string())
        );
    }

    #[test]
    fn harness_config_finds_only_enabled_programs() {        let file = HarnessFile {
            harnesses: vec![
                HarnessConfig { name: "off".into(), command: "x".into(), enabled: false, ..Default::default() },
                HarnessConfig { name: "empty".into(), command: "  ".into(), enabled: true, ..Default::default() },
                HarnessConfig { name: "on".into(), command: "agent".into(), enabled: true, ..Default::default() },
            ],
        };
        assert!(file.find_enabled("off").is_none(), "disabled harnesses are not started");
        assert!(file.find_enabled("empty").is_none(), "a harness without a command is not started");
        assert_eq!(file.find_enabled("on").map(|h| h.command.as_str()), Some("agent"));
    }
}
