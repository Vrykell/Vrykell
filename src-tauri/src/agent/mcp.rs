//! mcp: Model Context Protocol client for local stdio servers, following mainstream agent tools.
//! MCP design.
//!
//! Configuration lives in the `servers` array of `~/.vrykell/mcp.json`; each entry declares:
//!   - `command` + `args` + `env`: a local stdio server such as `npx -y @modelcontextprotocol/server-filesystem`.
//!   - `url`: a remote HTTP/SSE server (reserved for v1; stdio is the current focus).
//!
//! The connection is JSON-RPC 2.0 over stdio, one message per line:
//!   initialize → notifications/initialized → tools/list → tools/call
//! The connection owns a child process with kill_on_drop as a fallback. Tools are listed on demand and forwarded on call.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{watch, Mutex};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_MCP_ARGS_BYTES: usize = 1024 * 1024; // 1 MB tool-argument limit
const MAX_MCP_RESULT_CHARS: usize = 256 * 1024; // 256 KB tool-result limit
const MAX_MCP_MESSAGE_BYTES: usize = 2 * 1024 * 1024;

async fn exchange(
    stdin: &mut (impl AsyncWrite + Unpin),
    stdout: &mut (impl AsyncBufRead + Unpin),
    id: u64,
    method: &str,
    params: serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let operation = async {
        let message = serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let mut line = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        line.push(b'\n');
        stdin.write_all(&line).await.map_err(|error| error.to_string())?;
        stdin.flush().await.map_err(|error| error.to_string())?;
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            let count = (&mut *stdout).take(MAX_MCP_MESSAGE_BYTES as u64 + 1)
                .read_until(b'\n', &mut buffer).await.map_err(|error| error.to_string())?;
            if count == 0 { return Err("The tool server closed its connection.".into()); }
            if count > MAX_MCP_MESSAGE_BYTES { return Err("The tool response exceeds its size limit.".into()); }
            let value: serde_json::Value = serde_json::from_slice(&buffer).map_err(|error| error.to_string())?;
            if value.get("id").and_then(|value| value.as_u64()) != Some(id) { continue; }
            if let Some(error) = value.get("error") { return Err(format!("Tool protocol error: {error}")); }
            return Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null));
        }
    };
    tokio::time::timeout(timeout, operation).await.map_err(|_| "The tool request timed out.".to_string())?
}

async fn until_closed<T>(
    closed: &watch::Sender<bool>,
    operation: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let mut receiver = closed.subscribe();
    if *receiver.borrow() { return Err("The tool connection was closed.".into()); }
    tokio::select! {
        biased;
        _ = receiver.changed() => Err("The tool connection was closed.".into()),
        result = operation => result,
    }
}

// -- Configuration --

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct McpServerConfig {
    pub name: String,
    /// Local stdio command (alternatives to url; stdio wins when both are set).
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    /// Remote HTTP/SSE address (reserved for v1; using it reports an error).
    pub url: String,
    pub enabled: bool,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            command: String::new(),
            args: Vec::new(),
            env: HashMap::new(),
            url: String::new(),
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct McpConfig {
    pub servers: Vec<McpServerConfig>,
}

impl McpConfig {
    fn path() -> std::path::PathBuf {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".vrykell")
            .join("mcp.json")
    }

    pub fn load() -> Self {
        std::fs::read_to_string(Self::path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), String> {
        let p = Self::path();
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create the configuration directory: {e}"))?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| format!("Failed to serialize the MCP configuration: {e}"))?;
        std::fs::write(&p, json).map_err(|e| format!("Failed to write the MCP configuration: {e}"))
    }
}

// -- Tool metadata exposed to the frontend --

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub input_schema: serde_json::Value,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub url: String,
    pub enabled: bool,
    pub connected: bool,
    pub tool_count: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpExposedTool {
    pub server: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub input_schema: serde_json::Value,
}

// -- Connection --

struct McpConnection {
    /// Holds the child process; kill_on_drop(true) reaps it when the connection is replaced or dropped.
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    tools: Vec<McpToolInfo>,
}

impl McpConnection {
    /// Send a JSON-RPC request and read lines until the matching id returns a result, ignoring notifications and logs.
    async fn request(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        exchange(&mut self.stdin, &mut self.stdout, id, method, params, REQUEST_TIMEOUT).await
    }

    async fn initialize(&mut self) -> Result<(), String> {
        self.request(
            "initialize",
            serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "vrykell", "version": env!("CARGO_PKG_VERSION") }
            }),
        )
        .await?;
        let note = serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized", "params": {} });
        let mut line = serde_json::to_string(&note).map_err(|e| format!("Failed to serialize the notification: {e}"))?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write the initialized notification: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush the initialized notification: {e}"))?;
        Ok(())
    }

    async fn list_tools(&mut self) -> Result<Vec<McpToolInfo>, String> {
        let resp = self.request("tools/list", serde_json::json!({})).await?;
        let tools = resp.get("tools").cloned().unwrap_or(serde_json::Value::Null);
        let list: Vec<McpToolInfo> = serde_json::from_value(tools)
            .map_err(|e| format!("Failed to parse tools/list: {e}"))?;
        self.tools = list.clone();
        Ok(list)
    }

    async fn call_tool(&mut self, name: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
        let resp = self
            .request(
                "tools/call",
                serde_json::json!({ "name": name, "arguments": args }),
            )
            .await?;
        Ok(tool_result(resp))
    }
}

// -- Runtime state --

struct McpRuntime {
    config: McpConfig,
    connections: HashMap<String, Arc<McpSession>>,
    connecting: HashMap<String, watch::Sender<bool>>,
    revisions: HashMap<String, u64>,
}

struct McpSession {
    connection: Mutex<McpConnection>,
    tools: Vec<McpToolInfo>,
    closed: watch::Sender<bool>,
}

impl McpRuntime {
    fn disconnect(&mut self, name: &str) {
        *self.revisions.entry(name.to_string()).or_default() += 1;
        if let Some(closed) = self.connecting.remove(name) { closed.send_replace(true); }
        if let Some(session) = self.connections.remove(name) { session.closed.send_replace(true); }
    }
}

impl Default for McpRuntime {
    fn default() -> Self {
        Self {
            config: McpConfig::load(),
            connections: HashMap::new(),
            connecting: HashMap::new(),
            revisions: HashMap::new(),
        }
    }
}

pub struct McpState(tokio::sync::Mutex<McpRuntime>);

impl Default for McpState {
    fn default() -> Self {
        Self(tokio::sync::Mutex::new(McpRuntime::default()))
    }
}

async fn spawn_server(cfg: &McpServerConfig) -> Result<McpConnection, String> {
    if cfg.command.trim().is_empty() {
        return Err(format!("Server '{}' is missing command", cfg.name));
    }
    let mut cmd = Command::new(cfg.command.trim());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.args(&cfg.args);
    cmd.envs(&cfg.env);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start the MCP server: {e}"))?;
    let stdin = child.stdin.take().ok_or("Could not obtain the MCP server stdin")?;
    let stdout = child.stdout.take().ok_or("Could not obtain the MCP server stdout")?;

    // Drain stderr in the background so a full pipe cannot block the child; logs are discarded for v1.
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut se = stderr;
            let mut buf = [0u8; 4096];
            loop {
                match se.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        });
    }

    let mut conn = McpConnection {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        next_id: 1,
        tools: Vec::new(),
    };
    conn.initialize().await?;
    conn.list_tools().await?;
    Ok(conn)
}

// -- Tauri commands --

#[tauri::command]
pub async fn mcp_get_servers(state: tauri::State<'_, McpState>) -> Result<Vec<McpServerStatus>, String> {
    let rt = state.0.lock().await;
    Ok(rt
        .config
        .servers
        .iter()
        .map(|s| McpServerStatus {
            name: s.name.clone(),
            command: s.command.clone(),
            args: s.args.clone(),
            env: s.env.clone(),
            url: s.url.clone(),
            enabled: s.enabled,
            connected: rt.connections.contains_key(&s.name),
            tool_count: rt
                .connections
                .get(&s.name)
                .map(|c| c.tools.len() as u32)
                .unwrap_or(0),
        })
        .collect())
}

#[tauri::command]
pub async fn mcp_save_server(
    state: tauri::State<'_, McpState>,
    config: McpServerConfig,
) -> Result<(), String> {
    let mut rt = state.0.lock().await;
    let name = config.name.trim().to_string();
    if name.is_empty() {
        return Err("Server name cannot be empty".to_string());
    }
    if name.len() > 80 {
        return Err("Server name is too long (maximum 80 characters)".to_string());
    }
    if name.chars().any(|c| c.is_control()) {
        return Err("Server name contains invalid characters".to_string());
    }
    if config.command.trim().is_empty() && config.url.trim().is_empty() {
        return Err("Provide a command or url".to_string());
    }
    if config.command.contains('\0') || config.args.iter().any(|a| a.contains('\0')) {
        return Err("command or args contain invalid characters".to_string());
    }
    // Configuration changed: disconnect the old connection and reconnect with the new settings.
    rt.disconnect(&name);
    let mut cfg = config;
    cfg.name = name.clone();
    let idx = rt.config.servers.iter().position(|s| s.name == name);
    if let Some(i) = idx {
        rt.config.servers[i] = cfg;
    } else {
        rt.config.servers.push(cfg);
    }
    rt.config.save()
}

#[tauri::command]
pub async fn mcp_remove_server(state: tauri::State<'_, McpState>, name: String) -> Result<(), String> {
    let mut rt = state.0.lock().await;
    rt.disconnect(&name);
    rt.config.servers.retain(|s| s.name != name);
    rt.config.save()
}

#[tauri::command]
pub async fn mcp_toggle_server(
    state: tauri::State<'_, McpState>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    let mut rt = state.0.lock().await;
    if !enabled {
        rt.disconnect(&name);
    }
    if let Some(s) = rt.config.servers.iter_mut().find(|s| s.name == name) {
        s.enabled = enabled;
    }
    rt.config.save()
}

#[tauri::command]
pub async fn mcp_connect(state: tauri::State<'_, McpState>, name: String) -> Result<(), String> {
    let (cfg, revision, closed) = {
        let mut rt = state.0.lock().await;
        let cfg = rt.config.servers.iter().find(|server| server.name == name).cloned()
            .ok_or_else(|| format!("MCP server '{name}' was not found"))?;
        if !cfg.enabled {
            return Err(format!("MCP server '{name}' is disabled"));
        }
        if !cfg.url.trim().is_empty() {
            return Err("Remote HTTP/SSE MCP servers are not supported yet; v1 supports local stdio only".to_string());
        }
        rt.disconnect(&name);
        let revision = rt.revisions[&name];
        let (closed, _) = watch::channel(false);
        rt.connecting.insert(name.clone(), closed.clone());
        (cfg, revision, closed)
    };
    let result = until_closed(&closed, spawn_server(&cfg)).await;
    let mut rt = state.0.lock().await;
    if rt.revisions.get(&name) != Some(&revision) { return Err("The tool connection was closed.".into()); }
    rt.connecting.remove(&name);
    let connection = result?;
    let tools = connection.tools.clone();
    rt.connections.insert(name, Arc::new(McpSession { connection: Mutex::new(connection), tools, closed }));
    Ok(())
}

#[tauri::command]
pub async fn mcp_disconnect(state: tauri::State<'_, McpState>, name: String) -> Result<(), String> {
    let mut rt = state.0.lock().await;
    rt.disconnect(&name);
    Ok(())
}

/// Tools from every connected server, namespaced by server for the agent tool table.
#[tauri::command]
pub async fn mcp_list_all_tools(state: tauri::State<'_, McpState>) -> Result<Vec<McpExposedTool>, String> {
    let rt = state.0.lock().await;
    let mut out = Vec::new();
    for (server, conn) in &rt.connections {
        for t in &conn.tools {
            out.push(McpExposedTool {
                server: server.clone(),
                name: t.name.clone(),
                description: t.description.clone(),
                input_schema: t.input_schema.clone(),
            });
        }
    }
    Ok(out)
}

/// Call a server tool and return its content, preferring text.
#[tauri::command]
pub async fn mcp_call_tool(
    state: tauri::State<'_, McpState>,
    server: String,
    tool: String,
    args: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let session = state.0.lock().await.connections.get(&server).cloned()
        .ok_or_else(|| format!("MCP server '{server}' is not connected"))?;
    let args = args.unwrap_or(serde_json::Value::Object(Default::default()));
    // Cap argument size so an oversized payload cannot exhaust memory or context.
    if let Ok(s) = serde_json::to_string(&args) {
        if s.len() > MAX_MCP_ARGS_BYTES {
            return Err("MCP call arguments exceed the 1 MB limit".to_string());
        }
    }
    let result = until_closed(&session.closed, async {
        session.connection.lock().await.call_tool(&tool, args).await
    }).await;
    if result.is_err() {
        let mut runtime = state.0.lock().await;
        if runtime.connections.get(&server).is_some_and(|current| Arc::ptr_eq(current, &session)) {
            runtime.disconnect(&server);
        }
    }
    result
}

fn tool_result(response: serde_json::Value) -> serde_json::Value {
    let failed = response.get("isError").and_then(|value| value.as_bool()) == Some(true);
    let raw = response.get("content").cloned().unwrap_or(serde_json::Value::Null);
    let content = match raw {
        serde_json::Value::Array(items) => {
            let texts: Vec<String> = items
                .iter()
                .filter_map(|it| {
                    it.get("type")
                        .and_then(|t| t.as_str())
                        .filter(|t| *t == "text")
                        .and_then(|_| it.get("text"))
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                })
                .collect();
            if !texts.is_empty() {
                let mut joined = texts.join("\n");
                if joined.chars().count() > MAX_MCP_RESULT_CHARS {
                    joined = joined.chars().take(MAX_MCP_RESULT_CHARS).collect();
                }
                serde_json::Value::String(joined)
            } else {
                serde_json::Value::Array(items)
            }
        }
        other => other,
    };
    if failed {
        let error = content.as_str().unwrap_or("The tool reported a failure.");
        serde_json::json!({ "ok": false, "error": error, "content": content })
    } else {
        content
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_errors_are_not_reported_as_successful_text() {
        let result = tool_result(serde_json::json!({ "isError": true, "content": [{ "type": "text", "text": "Permission denied" }] }));
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "Permission denied");
        assert_eq!(tool_result(serde_json::json!({ "content": [{ "type": "text", "text": "Done" }] })), "Done");
    }

    #[tokio::test(start_paused = true)]
    async fn notifications_cannot_extend_the_total_request_deadline() {
        let (responses, mut responses_writer) = tokio::io::duplex(8192);
        let notifications = tokio::spawn(async move {
            loop {
                if responses_writer.write_all(b"{\"method\":\"progress\"}\n").await.is_err() { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        });
        let start = tokio::time::Instant::now();
        let error = exchange(&mut tokio::io::sink(), &mut BufReader::new(responses), 1, "tools/call", serde_json::json!({}), Duration::from_millis(100)).await.unwrap_err();
        assert!(error.contains("timed out"));
        assert_eq!(start.elapsed(), Duration::from_millis(100));
        notifications.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn a_blocked_request_write_has_the_same_deadline() {
        let (mut writer, _unread_peer) = tokio::io::duplex(1);
        let error = exchange(&mut writer, &mut &b""[..], 1, "tools/call", serde_json::json!({}), Duration::from_millis(100)).await.unwrap_err();
        assert!(error.contains("timed out"));
    }

    #[tokio::test]
    async fn response_frames_are_bounded_and_matching_ids_are_required() {
        let valid = b"{\"method\":\"progress\"}\n{\"id\":2,\"result\":0}\n{\"id\":1,\"result\":42}\n";
        let result = exchange(&mut tokio::io::sink(), &mut &valid[..], 1, "tools/call", serde_json::json!({}), Duration::from_secs(1)).await.unwrap();
        assert_eq!(result, 42);
        let frame = vec![b'x'; MAX_MCP_MESSAGE_BYTES + 1];
        let error = exchange(&mut tokio::io::sink(), &mut frame.as_slice(), 1, "tools/call", serde_json::json!({}), Duration::from_secs(1)).await.unwrap_err();
        assert!(error.contains("size limit"));
    }

    #[tokio::test]
    async fn closing_a_connection_cancels_requests_waiting_for_its_lock() {
        let (closed, _) = watch::channel(false);
        let lock = Mutex::new(());
        let guard = lock.lock().await;
        let operation = until_closed(&closed, async { let _guard = lock.lock().await; Ok(()) });
        tokio::pin!(operation);
        tokio::select! {
            result = &mut operation => panic!("request finished before cancellation: {result:?}"),
            _ = tokio::task::yield_now() => {}
        }
        closed.send_replace(true);
        assert!(operation.await.unwrap_err().contains("closed"));
        drop(guard);
    }

    #[test]
    fn config_roundtrip_serde() {
        let cfg = McpConfig {
            servers: vec![McpServerConfig {
                name: "fs".to_string(),
                command: "npx".to_string(),
                args: vec!["-y".to_string(), "@modelcontextprotocol/server-filesystem".to_string()],
                env: HashMap::from([("X".to_string(), "1".to_string())]),
                url: String::new(),
                enabled: true,
            }],
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: McpConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.servers.len(), 1);
        assert_eq!(back.servers[0].command, "npx");
        assert_eq!(back.servers[0].args.len(), 2);
    }

    #[test]
    fn config_defaults_when_fields_missing() {
        let json = r#"{ "servers": [ { "name": "x", "command": "node" } ] }"#;
        let cfg: McpConfig = serde_json::from_str(json).unwrap();
        let s = &cfg.servers[0];
        assert!(s.args.is_empty());
        assert!(s.env.is_empty());
        assert!(s.url.is_empty());
        assert!(s.enabled);
    }

    #[test]
    fn tool_info_serde_camel_case() {
        let t = McpToolInfo {
            name: "read".to_string(),
            description: Some("Read file".to_string()),
            input_schema: serde_json::json!({ "type": "object" }),
        };
        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("inputSchema"));
        assert!(json.contains("description"));
    }
}
