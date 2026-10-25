use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Semaphore};

const MAX_FRAME: usize = 1024 * 1024;
const TOOLS: &[&str] = &["run_command", "read_terminal", "terminal_keys", "read_file", "write_file", "edit_file", "list_dir", "search_files", "ask_user"];
type Dispatch = Arc<dyn Fn(Value) -> bool + Send + Sync>;

#[derive(Default)]
struct Turn {
    active: bool,
    generation: u64,
    pending: HashMap<String, oneshot::Sender<Value>>,
}

struct State {
    turn: Mutex<Turn>,
    dispatch: Dispatch,
    tools: Vec<Value>,
}

pub struct AppMcpServer {
    state: Arc<State>,
    task: tokio::task::JoinHandle<()>,
    descriptor: Value,
}

fn failure(message: &str) -> Value {
    json!({"content": [{"type": "text", "text": message}], "isError": true})
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

pub fn validate_catalog(tools: Vec<Value>) -> Result<Vec<Value>, String> {
    if tools.len() > TOOLS.len() || serde_json::to_vec(&tools).map_err(|_| "invalid tool catalog")?.len() > 128 * 1024 {
        return Err("application tool catalog exceeds its limit".into());
    }
    let mut names = std::collections::HashSet::new();
    for tool in &tools {
        let name = tool.get("name").and_then(Value::as_str).unwrap_or_default();
        if !TOOLS.contains(&name) || !names.insert(name.to_string()) || tool.pointer("/inputSchema/type").and_then(Value::as_str) != Some("object") {
            return Err("invalid application tool descriptor".into());
        }
    }
    Ok(tools)
}

impl AppMcpServer {
    pub async fn start(tools: Vec<Value>, dispatch: Dispatch) -> Result<Self, String> {
        let tools = validate_catalog(tools)?;
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.map_err(|_| "could not bind application tools")?;
        let address = listener.local_addr().map_err(|_| "could not locate application tools")?;
        let token = uuid::Uuid::new_v4().to_string();
        let executable = std::env::current_exe().map_err(|_| "could not locate application helper")?;
        let descriptor = json!({"name": "application", "command": executable, "args": ["--app-mcp"], "env": [
            {"name": "APP_MCP_ENDPOINT", "value": address.to_string()}, {"name": "APP_MCP_TOKEN", "value": token}
        ]});
        let state = Arc::new(State { turn: Mutex::new(Turn::default()), dispatch, tools });
        let serving = state.clone();
        let task = tokio::spawn(async move {
            let slots = Arc::new(Semaphore::new(4));
            let mut connections = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break; };
                        let Ok(permit) = slots.clone().try_acquire_owned() else { continue; };
                        let state = serving.clone(); let token = token.clone();
                        connections.spawn(async move { let _permit = permit; let _ = serve(stream, &token, state).await; });
                    }
                    _ = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        });
        Ok(Self { state, task, descriptor })
    }

    pub fn descriptor(&self) -> Value { self.descriptor.clone() }

    pub fn begin_turn(&self) -> Result<u64, String> {
        let mut turn = self.state.turn.lock().map_err(|_| "application tools unavailable")?;
        if turn.active { return Err("the agent already has an active turn".into()); }
        turn.generation += 1; turn.active = true;
        Ok(turn.generation)
    }

    pub fn end_turn(&self, generation: Option<u64>) {
        if let Ok(mut turn) = self.state.turn.lock() {
            if generation.is_none() || generation == Some(turn.generation) {
                turn.active = false;
                turn.pending.clear();
                (self.state.dispatch)(json!({"method": "cancel"}));
            }
        }
    }

    pub fn answer(&self, request_id: &str, payload: Value) -> Result<(), String> {
        if serde_json::to_vec(&payload).map_err(|_| "invalid tool result")?.len() > MAX_FRAME / 2 { return Err("application tool result exceeds its limit".into()); }
        let sender = self.state.turn.lock().map_err(|_| "application tools unavailable")?.pending.remove(request_id).ok_or("application tool request is no longer active")?;
        sender.send(payload).map_err(|_| "application tool request is no longer active".into())
    }
}

impl Drop for AppMcpServer {
    fn drop(&mut self) { self.end_turn(None); self.task.abort(); }
}

async fn read_frame<R: tokio::io::AsyncBufRead + Unpin>(reader: &mut R, limit: usize) -> Result<Option<Vec<u8>>, String> {
    let mut bytes = Vec::new();
    let count = reader.take((limit + 1) as u64).read_until(b'\n', &mut bytes).await.map_err(|_| "application tool stream closed")?;
    if count == 0 { return Ok(None); }
    if count > limit || !bytes.ends_with(b"\n") { return Err("application tool frame exceeds its limit".into()); }
    Ok(Some(bytes))
}

async fn serve(stream: tokio::net::TcpStream, token: &str, state: Arc<State>) -> Result<(), String> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let auth = tokio::time::timeout(Duration::from_secs(3), read_frame(&mut reader, 1024)).await.map_err(|_| "authentication expired")??.ok_or("authentication required")?;
    let auth: Value = serde_json::from_slice(&auth).map_err(|_| "invalid authentication")?;
    if auth.get("token").and_then(Value::as_str) != Some(token) { return Err("authentication failed".into()); }
    writer.write_all(b"{\"ok\":true}\n").await.map_err(|_| "stream closed")?;
    let mut initialized = false;
    while let Some(frame) = read_frame(&mut reader, MAX_FRAME).await? {
        let message: Value = match serde_json::from_slice(&frame) {
            Ok(message) => message,
            Err(_) => { let response = rpc_error(Value::Null, -32700, "Invalid JSON"); writer.write_all(format!("{response}\n").as_bytes()).await.map_err(|_| "stream closed")?; continue; }
        };
        let id = message.get("id").cloned();
        let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
        if message.get("jsonrpc").and_then(Value::as_str) != Some("2.0") || method.is_empty() || message.is_array() {
            writer.write_all(format!("{}\n", rpc_error(id.unwrap_or(Value::Null), -32600, "Invalid request")).as_bytes()).await.map_err(|_| "stream closed")?; continue;
        }
        let Some(id) = id else { continue; };
        let result = match method {
            "initialize" => {
                initialized = true;
                let requested = message.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or_default();
                let version = if ["2024-11-05", "2025-03-26", "2025-06-18"].contains(&requested) { requested } else { "2025-06-18" };
                Ok(json!({"protocolVersion": version, "serverInfo": {"name": "application", "version": env!("CARGO_PKG_VERSION")}, "capabilities": {"tools": {}}}))
            }
            "ping" => Ok(json!({})),
            _ if !initialized => Err((-32000, "Initialize the server first")),
            "tools/list" => Ok(json!({"tools": state.tools})),
            "tools/call" => Ok(call_tool(state.clone(), message.get("params").cloned().unwrap_or(Value::Null)).await),
            _ => Err((-32601, "Method not found")),
        };
        let response = match result { Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}), Err((code, message)) => rpc_error(id, code, message) };
        writer.write_all(format!("{response}\n").as_bytes()).await.map_err(|_| "stream closed")?;
    }
    Ok(())
}

async fn call_tool(state: Arc<State>, params: Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
    let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    if !arguments.is_object() || !state.tools.iter().any(|tool| tool.get("name").and_then(Value::as_str) == Some(name)) { return failure("Unknown tool or invalid arguments"); }
    let request_id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    {
        let Ok(mut turn) = state.turn.lock() else { return failure("Application tools unavailable"); };
        if !turn.active || turn.pending.len() >= 4 { return failure("No active agent turn or too many pending calls"); }
        turn.pending.insert(request_id.clone(), sender);
    }
    if !(state.dispatch)(json!({"method": "call", "requestId": request_id, "name": name, "arguments": arguments})) {
        if let Ok(mut turn) = state.turn.lock() { turn.pending.remove(&request_id); }
        return failure("Application tool interface unavailable");
    }
    let result = tokio::time::timeout(Duration::from_secs(3600), receiver).await;
    if let Ok(mut turn) = state.turn.lock() { turn.pending.remove(&request_id); }
    match result { Ok(Ok(result)) => result, _ => failure("Application tool call cancelled or expired") }
}

pub fn run_helper() -> Option<i32> {
    if std::env::args().nth(1).as_deref() != Some("--app-mcp") { return None; }
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let address: SocketAddr = std::env::var("APP_MCP_ENDPOINT")?.parse()?;
        if !address.ip().is_loopback() { return Err("application tools require a loopback endpoint".into()); }
        let token = std::env::var("APP_MCP_TOKEN")?;
        if token.len() != 36 { return Err("application tool authentication is missing".into()); }
        std::env::remove_var("APP_MCP_ENDPOINT"); std::env::remove_var("APP_MCP_TOKEN");
        let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        writeln!(stream, "{}", json!({"token": token}))?;
        let mut reader = std::io::BufReader::new(stream.try_clone()?);
        let mut auth = Vec::new();
        Read::take(&mut reader, 1024).read_until(b'\n', &mut auth)?;
        if serde_json::from_slice::<Value>(&auth)?.get("ok") != Some(&Value::Bool(true)) { return Err("application tool authentication failed".into()); }
        stream.set_read_timeout(None)?;
        let mut input_stream = stream.try_clone()?;
        std::thread::spawn(move || {
            let input = std::io::stdin(); let mut input = input.lock();
            loop {
                let mut frame = Vec::new();
                match Read::take(&mut input, (MAX_FRAME + 1) as u64).read_until(b'\n', &mut frame) {
                    Ok(count) if count > 0 && count <= MAX_FRAME && frame.ends_with(b"\n") => { if input_stream.write_all(&frame).is_err() { break; } }
                    _ => break,
                }
            }
            let _ = input_stream.shutdown(Shutdown::Write);
        });
        let output = std::io::stdout(); let mut output = output.lock();
        loop {
            let mut frame = Vec::new();
            let count = Read::take(&mut reader, (MAX_FRAME + 1) as u64).read_until(b'\n', &mut frame)?;
            if count == 0 { break; }
            if count > MAX_FRAME || !frame.ends_with(b"\n") { return Err("application tool frame exceeds its limit".into()); }
            output.write_all(&frame)?; output.flush()?;
        }
        let _ = stream.shutdown(Shutdown::Both);
        Ok(())
    })();
    Some(if result.is_ok() { 0 } else { eprintln!("Application tool bridge closed."); 2 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncWriteExt, BufReader};

    fn catalog() -> Vec<Value> { vec![json!({"name": "ask_user", "inputSchema": {"type": "object"}})] }

    async fn connect(server: &AppMcpServer, token: Option<&str>) -> BufReader<tokio::net::TcpStream> {
        let env = server.descriptor.get("env").unwrap().as_array().unwrap();
        let address = env[0]["value"].as_str().unwrap();
        let token = token.unwrap_or_else(|| env[1]["value"].as_str().unwrap());
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        stream.write_all(format!("{}\n", json!({"token": token})).as_bytes()).await.unwrap();
        BufReader::new(stream)
    }

    async fn receive(reader: &mut BufReader<tokio::net::TcpStream>) -> Value {
        serde_json::from_slice(&read_frame(reader, MAX_FRAME).await.unwrap().unwrap()).unwrap()
    }

    async fn send(reader: &mut BufReader<tokio::net::TcpStream>, id: u64, method: &str, params: Value) {
        reader.get_mut().write_all(format!("{}\n", json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).as_bytes()).await.unwrap();
    }

    #[test]
    fn catalog_rejects_unknown_names_duplicates_and_non_object_schemas() {
        assert!(validate_catalog(catalog()).is_ok());
        assert!(validate_catalog(vec![json!({"name": "get_api_key", "inputSchema": {"type": "object"}})]).is_err());
        assert!(validate_catalog([catalog(), catalog()].concat()).is_err());
        assert!(validate_catalog(vec![json!({"name": "ask_user", "inputSchema": {"type": "string"}})]).is_err());
    }

    #[tokio::test]
    async fn authenticated_transport_negotiates_lists_and_scopes_calls_to_one_turn() {
        let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
        let server = AppMcpServer::start(catalog(), Arc::new(move |event| events.send(event).is_ok())).await.unwrap();
        let mut reader = connect(&server, None).await;
        assert_eq!(receive(&mut reader).await["ok"], true);
        send(&mut reader, 1, "initialize", json!({"protocolVersion": "2024-11-05"})).await;
        assert_eq!(receive(&mut reader).await["result"]["protocolVersion"], "2024-11-05");
        send(&mut reader, 2, "tools/list", json!({})).await;
        assert_eq!(receive(&mut reader).await["result"]["tools"].as_array().unwrap().len(), 1);
        send(&mut reader, 3, "tools/call", json!({"name": "ask_user", "arguments": {}})).await;
        assert_eq!(receive(&mut reader).await["result"]["isError"], true);
        assert!(received.try_recv().is_err());
        let generation = server.begin_turn().unwrap();
        assert!(server.begin_turn().is_err());
        send(&mut reader, 4, "tools/call", json!({"name": "ask_user", "arguments": {"question": "Choose"}})).await;
        let event = received.recv().await.unwrap();
        assert_eq!(event["name"], "ask_user");
        let other = AppMcpServer::start(catalog(), Arc::new(|_| true)).await.unwrap();
        assert!(other.answer(event["requestId"].as_str().unwrap(), json!({})).is_err());
        assert!(server.answer("another-session", json!({})).is_err());
        server.answer(event["requestId"].as_str().unwrap(), json!({"content": [{"type": "text", "text": "answer"}], "isError": false})).unwrap();
        assert_eq!(receive(&mut reader).await["result"]["isError"], false);
        send(&mut reader, 5, "tools/call", json!({"name": "ask_user", "arguments": {}})).await;
        let event = received.recv().await.unwrap();
        server.end_turn(Some(generation));
        assert_eq!(receive(&mut reader).await["result"]["isError"], true);
        assert!(server.answer(event["requestId"].as_str().unwrap(), json!({})).is_err());
        let next = server.begin_turn().unwrap();
        server.end_turn(Some(generation));
        assert!(server.begin_turn().is_err());
        server.end_turn(Some(next));
        drop(server);
        assert!(read_frame(&mut reader, MAX_FRAME).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn rejects_untrusted_connections_and_oversized_frames() {
        let server = AppMcpServer::start(catalog(), Arc::new(|_| true)).await.unwrap();
        let mut denied = connect(&server, Some("invalid")).await;
        assert!(read_frame(&mut denied, MAX_FRAME).await.unwrap().is_none());
        let mut reader = connect(&server, None).await;
        receive(&mut reader).await;
        send(&mut reader, 1, "tools/list", json!({})).await;
        assert_eq!(receive(&mut reader).await["error"]["code"], -32000);
        let oversized = vec![b'x'; MAX_FRAME + 1];
        let _ = reader.get_mut().write_all(&oversized).await;
        assert!(read_frame(&mut reader, MAX_FRAME).await.unwrap_or(None).is_none());
    }

    #[tokio::test]
    #[ignore = "requires a built application helper executable"]
    async fn application_binary_relays_stdio_without_starting_a_window() {
        let executable = std::env::var("APP_TEST_MCP_HELPER_EXE").expect("helper executable path");
        let server = AppMcpServer::start(catalog(), Arc::new(|_| true)).await.unwrap();
        let mut command = tokio::process::Command::new(executable);
        command.arg("--app-mcp").stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        for entry in server.descriptor["env"].as_array().unwrap() { command.env(entry["name"].as_str().unwrap(), entry["value"].as_str().unwrap()); }
        let mut child = command.spawn().unwrap();
        let mut input = child.stdin.take().unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\"}}\n").await.unwrap();
        let frame = tokio::time::timeout(Duration::from_secs(5), read_frame(&mut output, MAX_FRAME)).await.unwrap().unwrap().unwrap();
        let response: Value = serde_json::from_slice(&frame).unwrap();
        assert_eq!(response["id"], 1);
        assert_eq!(response["result"]["protocolVersion"], "2025-06-18");
        drop(server);
        assert!(tokio::time::timeout(Duration::from_secs(5), child.wait()).await.unwrap().unwrap().success());
    }
}
