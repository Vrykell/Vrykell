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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

/// Protocol major version this client speaks.
pub const PROTOCOL_VERSION: u64 = 1;

/// How long a request may take before the caller is told it will never finish.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// What we tell an agent we can do. Small on purpose: a capability we advertise but cannot gate is
/// a capability we should not have. The `fs` handlers (which must run our path policy and approval
/// chain) are not implemented yet, so they are not claimed; `terminal` is a later phase.
pub fn client_capabilities() -> Value {
    json!({
        "session": { "notices": {} },
        "fs": { "readTextFile": false, "writeTextFile": false },
        "terminal": false,
    })
}

/// How a permission request was answered.
#[derive(Clone, Debug, PartialEq)]
#[allow(dead_code)] // the card that answers with `Selected` arrives with the session UI (phase 1)
pub enum PermissionOutcome {
    /// One of the options the agent offered was picked (its `optionId`).
    Selected(String),
    /// Nobody answered, or the turn was cancelled: the protocol's own "no" for that case.
    Cancelled,
}

/// Decides permission requests. The caller installs one; the local approval chain lives behind it.
pub type PermissionHandler = Arc<dyn Fn(Value) -> PermissionOutcome + Send + Sync>;

/// Requests that arrive from the agent while a turn is running.
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct AcpClient {
    /// Lines waiting for the writer task.
    out: mpsc::UnboundedSender<String>,
    next_id: AtomicU64,
    pending: Pending,
    /// Notifications the agent sent (`session/update` and friends), in arrival order. Behind a
    /// mutex so the event pump and a request can run side by side.
    #[allow(dead_code)] // drained by the session UI in phase 1
    events: tokio::sync::Mutex<mpsc::UnboundedReceiver<Value>>,
    /// Held so the child is killed when the client is dropped (`kill_on_drop`).
    _child: Option<Child>,
}

#[allow(dead_code)] // `new_session`, `prompt`, `cancel` and `next_event` are called by the session UI in phase 1
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

        // Writer task: one line per message, exactly as the protocol frames them.
        tokio::spawn(async move {
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
        tokio::spawn(async move {
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
                                match permission(params) {
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
                            Some(error) => Err(format!("agent error: {error}")),
                            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                        };
                        let _ = waiter.send(outcome);
                    }
                }
            }
            // The agent closed the pipe: every waiter has to learn that, not hang.
            if let Ok(mut map) = reader_pending.lock() {
                for (_, waiter) in map.drain() {
                    let _ = waiter.send(Err("the agent closed the connection".to_string()));
                }
            }
        });

        Self { out: out_tx, next_id: AtomicU64::new(0), pending, events: tokio::sync::Mutex::new(events), _child: None }
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
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        for (key, value) in env {
            cmd.env(key, value);
        }
        let mut child = cmd.spawn().map_err(|e| format!("could not start the harness: {e}"))?;
        let stdin = child.stdin.take().ok_or("the harness gave no stdin")?;
        let stdout = child.stdout.take().ok_or("the harness gave no stdout")?;
        let mut client = Self::over(BufReader::new(stdout), stdin, permission);
        client._child = Some(child);
        Ok(client)
    }

    fn send_line(&self, message: Value) -> Result<(), String> {
        let line = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        self.out.send(line).map_err(|_| "the harness connection is closed".to_string())
    }

    /// A request that waits for its own answer, bounded by [`REQUEST_TIMEOUT`].
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().map_err(|_| "the client state is poisoned".to_string())?;
            map.insert(id, tx);
        }
        self.send_line(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err(format!("{method} answered nothing")),
            Err(_) => {
                // Drop the waiter so a late answer is ignored rather than resolving a dead call.
                if let Ok(mut map) = self.pending.lock() {
                    map.remove(&id);
                }
                Err(format!("{method} timed out"))
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
        )
        .await
    }

    /// Create a session in a working directory and answer with its id.
    pub async fn new_session(&self, cwd: &str) -> Result<String, String> {
        let result = self.request("session/new", json!({ "cwd": cwd, "mcpServers": [] })).await?;
        result
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "the agent created no session".to_string())
    }

    /// Send a prompt and wait for the stop reason; the turn's content arrives as notifications.
    pub async fn prompt(&self, session_id: &str, prompt: Value) -> Result<String, String> {
        let result = self
            .request("session/prompt", json!({ "sessionId": session_id, "prompt": prompt }))
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

/// Small helper so the reader task can send an agent-request answer without owning the sender.
fn out_tx_for_error(tx: &mpsc::UnboundedSender<String>, payload: Value) -> Result<(), String> {
    let line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    tx.send(line).map_err(|_| "the harness connection is closed".to_string())
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

    pub fn load() -> Self {
        std::fs::read_to_string(Self::path())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    /// Write the config back. The settings page is the caller, and it is also what the built-in
    /// presets fill in.
    pub fn save(&self) -> Result<(), String> {
        let path = Self::path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("cannot create the config directory: {e}"))?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, json).map_err(|e| format!("cannot write the harness config: {e}"))
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
    let config = HarnessFile::load();
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
        Arc::new(|_| PermissionOutcome::Cancelled),
    )?;
    let info = client
        .initialize("vrykell", env!("CARGO_PKG_VERSION"))
        .await
        .map_err(|e| format!("harness handshake failed: {e}"))?;
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
pub fn acp_harnesses() -> Vec<HarnessConfig> {
    HarnessFile::load().harnesses
}

/// Sessions currently open. Dropping the last reference kills the child (`kill_on_drop`).
#[derive(Default)]
pub struct AcpRuntime(Mutex<HashMap<String, Arc<AcpClient>>>);

impl AcpRuntime {
    fn insert(&self, session: String, client: Arc<AcpClient>) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(session, client);
        }
    }

    fn get(&self, session: &str) -> Result<Arc<AcpClient>, String> {
        self.0
            .lock()
            .map_err(|_| "the ACP state is poisoned".to_string())?
            .get(session)
            .cloned()
            .ok_or_else(|| format!("no open harness session {session}"))
    }

    fn remove(&self, session: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(session);
        }
    }
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

fn emit<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: AcpEvent) {
    // A closed window is not an error worth surfacing; the session is dropped with it.
    let _ = tauri::Emitter::emit(app, EVENT, event);
}

/// Start a harness, open a session in `cwd`, and pump its notifications to the frontend.
#[tauri::command]
pub async fn acp_open<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AcpRuntime>,
    name: String,
    cwd: String,
) -> Result<Value, String> {
    let config = HarnessFile::load();
    let harness = config
        .find_enabled(&name)
        .ok_or_else(|| format!("no enabled harness named {name}"))?
        .clone();

    // Phase 1 has no approval card for harness permissions yet, so the client refuses and tells the
    // session what was asked for; the wire stays honest and nothing runs unapproved.
    let permission_app = app.clone();
    let permission: PermissionHandler = Arc::new(move |params: Value| {
        let session = params.get("sessionId").and_then(Value::as_str).unwrap_or_default().to_string();
        emit(
            &permission_app,
            AcpEvent { session_id: session, kind: "permission".to_string(), payload: params },
        );
        PermissionOutcome::Cancelled
    });

    let client = Arc::new(AcpClient::spawn(
        &harness.command,
        &harness.args,
        if harness.cwd.trim().is_empty() { None } else { Some(Path::new(&harness.cwd)) },
        &harness.env,
        permission,
    )?);
    let info = client
        .initialize("vrykell", env!("CARGO_PKG_VERSION"))
        .await
        .map_err(|e| format!("harness handshake failed: {e}"))?;
    let session = client
        .new_session(&cwd)
        .await
        .map_err(|e| format!("harness could not open a session: {e}"))?;

    // Pump the agent's notifications for as long as the session lives.
    let pump_app = app.clone();
    let pump_session = session.clone();
    let pump_client = client.clone();
    tokio::spawn(async move {
        while let Some(message) = pump_client.next_event().await {
            emit(
                &pump_app,
                AcpEvent { session_id: pump_session.clone(), kind: "update".to_string(), payload: message },
            );
        }
    });

    state.insert(session.clone(), client);
    Ok(json!({
        "sessionId": session,
        "harness": harness.name,
        "agent": describe_agent(&info),
    }))
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
    let app = app.clone();
    let session = session_id.clone();
    tokio::spawn(async move {
        let outcome = client
            .prompt(&session, json!([{ "type": "text", "text": text }]))
            .await;
        match outcome {
            Ok(stop) => emit(
                &app,
                AcpEvent {
                    session_id: session,
                    kind: "stop".to_string(),
                    payload: json!({ "stopReason": stop }),
                },
            ),
            Err(message) => emit(
                &app,
                AcpEvent { session_id: session, kind: "error".to_string(), payload: json!({ "message": message }) },
            ),
        }
    });
    Ok(())
}

/// Ask the agent to stop the current turn.
#[tauri::command]
pub fn acp_cancel(state: tauri::State<'_, AcpRuntime>, session_id: String) -> Result<(), String> {
    state.get(&session_id)?.cancel(&session_id)
}

/// Close a session: the agent's process goes with it.
#[tauri::command]
pub fn acp_close(state: tauri::State<'_, AcpRuntime>, session_id: String) -> Result<(), String> {
    state.remove(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": { "sessionId": "sess_1" } });
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
                PermissionOutcome::Selected("allow-once".to_string())
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
        assert_eq!(session, "sess_1");

        let turn = client.prompt(&session, json!([{ "type": "text", "text": "hi" }]));
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
        let client = AcpClient::over(read, write, Arc::new(|_| PermissionOutcome::Cancelled));

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

    #[tokio::test]
    async fn a_cancelled_turn_is_a_notification_the_agent_sees() {
        let seen: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let (client, agent) = client_pair(seen.clone(), Arc::new(|_| PermissionOutcome::Cancelled));
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

    #[test]
    fn harness_config_finds_only_enabled_programs() {
        let file = HarnessFile {
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
