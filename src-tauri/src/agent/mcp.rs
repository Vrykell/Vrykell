//! mcp — Model Context Protocol 客户端（本地 stdio 服务器，参照主流 agent 编码工具的
//! MCP 设计）。
//!
//! 配置在 `~/.vrykell/mcp.json` 的 `servers` 数组里，每项声明：
//!   - `command` + `args` + `env`：本地 stdio 服务器（如 `npx -y @modelcontextprotocol/server-filesystem`）
//!   - `url`：远程 HTTP/SSE 服务器（v1 保留字段，当前以 stdio 为主）
//!
//! 连接流程 = JSON-RPC 2.0 over stdio（每行一条消息）：
//!   initialize → notifications/initialized → tools/list → tools/call
//! 连接以子进程方式持有（kill_on_drop 兜底回收）；工具按需列出，调用时转发。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{watch, Mutex};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_MCP_ARGS_BYTES: usize = 1024 * 1024; // 工具调用参数上限 1MB
const MAX_MCP_RESULT_CHARS: usize = 256 * 1024; // 工具结果上限 256KB
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

// ── 配置 ──

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct McpServerConfig {
    pub name: String,
    /// 本地 stdio 启动命令（与 url 二选一，stdio 优先）
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    /// 远程 HTTP/SSE 地址（v1 保留，未实现则报错）
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
            std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| format!("序列化 MCP 配置失败：{e}"))?;
        std::fs::write(&p, json).map_err(|e| format!("写入 MCP 配置失败：{e}"))
    }
}

// ── 工具信息（对前端暴露） ──

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

// ── 连接 ──

struct McpConnection {
    /// 持有子进程句柄：kill_on_drop(true) 保证连接被替换/丢弃时回收进程
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    tools: Vec<McpToolInfo>,
}

impl McpConnection {
    /// 发送 JSON-RPC 请求，读行直到匹配 id 返回 result（通知/日志行忽略）。
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
        let mut line = serde_json::to_string(&note).map_err(|e| format!("序列化通知失败：{e}"))?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("写入 initialized 通知失败：{e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("刷新 initialized 通知失败：{e}"))?;
        Ok(())
    }

    async fn list_tools(&mut self) -> Result<Vec<McpToolInfo>, String> {
        let resp = self.request("tools/list", serde_json::json!({})).await?;
        let tools = resp.get("tools").cloned().unwrap_or(serde_json::Value::Null);
        let list: Vec<McpToolInfo> = serde_json::from_value(tools)
            .map_err(|e| format!("解析 tools/list 失败：{e}"))?;
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

// ── 运行时状态 ──

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
        return Err(format!("服务器「{}」缺少 command", cfg.name));
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
        .map_err(|e| format!("启动 MCP 服务器失败：{e}"))?;
    let stdin = child.stdin.take().ok_or("无法获取 MCP 服务器 stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取 MCP 服务器 stdout")?;

    // stderr 后台排空，避免管道缓冲写满卡住子进程（日志丢弃，v1）
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

// ── Tauri 命令 ──

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
        return Err("服务器名称不能为空".to_string());
    }
    if name.len() > 80 {
        return Err("服务器名称过长（≤80 字符）".to_string());
    }
    if name.chars().any(|c| c.is_control()) {
        return Err("服务器名称含非法字符".to_string());
    }
    if config.command.trim().is_empty() && config.url.trim().is_empty() {
        return Err("需要填写 command 或 url".to_string());
    }
    if config.command.contains('\0') || config.args.iter().any(|a| a.contains('\0')) {
        return Err("command/args 含非法字符".to_string());
    }
    // 配置变更：先断开旧连接，下次按新配置连接
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
            .ok_or_else(|| format!("未找到 MCP 服务器「{name}」"))?;
        if !cfg.enabled {
            return Err(format!("MCP 服务器「{name}」已禁用"));
        }
        if !cfg.url.trim().is_empty() {
            return Err("远程 HTTP/SSE MCP 服务器暂未支持（v1 仅支持本地 stdio）".to_string());
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

/// 所有已连接服务器的工具（带 server 命名空间，供 agent 组装 AI 工具表）。
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

/// 调用某服务器的工具，返回其 content（文本优先）。
#[tauri::command]
pub async fn mcp_call_tool(
    state: tauri::State<'_, McpState>,
    server: String,
    tool: String,
    args: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let session = state.0.lock().await.connections.get(&server).cloned()
        .ok_or_else(|| format!("MCP 服务器「{server}」未连接"))?;
    let args = args.unwrap_or(serde_json::Value::Object(Default::default()));
    // 参数体积上限，防止超大 payload 打爆内存/上下文
    if let Ok(s) = serde_json::to_string(&args) {
        if s.len() > MAX_MCP_ARGS_BYTES {
            return Err("MCP 调用参数过大（>1MB）".to_string());
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
            description: Some("读文件".to_string()),
            input_schema: serde_json::json!({ "type": "object" }),
        };
        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("inputSchema"));
        assert!(json.contains("description"));
    }
}
