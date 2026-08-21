//! AI 调用下沉到 Rust：API key / Base URL / 模型存后端（持久化到
//! ~/.vrykell/config.json），不进 webview 的 localStorage。
//! 前端只负责把消息发来、订阅 `ai-chunk` 事件收流式文本。
//!
//! 采用 OpenAI 兼容的 `/chat/completions` 流式协议（可配 Base URL），
//! 因此支持 OpenAI / DeepSeek / 通义 / Moonshot / GLM 等各类兼容服务。

use base64::Engine as _;
use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri::ipc::Channel;

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_PROVIDER: &str = "openai-compatible";

/// 全局 AI 配置（provider / 各家 key / base_url / model），Mutex 保护 + 落盘持久化。
pub struct AiConfig(Mutex<AiConfigInner>);

#[derive(Serialize, Deserialize, Clone)]
struct AiConfigInner {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default = "default_base_url")]
    base_url: String,
    #[serde(default = "default_model")]
    model: String,
    /// openai-compatible | anthropic | gemini
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default)]
    anthropic_key: Option<String>,
    #[serde(default)]
    gemini_key: Option<String>,
    #[serde(default)]
    tavily_key: Option<String>,
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_string()
}
fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}
fn default_provider() -> String {
    DEFAULT_PROVIDER.to_string()
}

impl Default for AiConfigInner {
    fn default() -> Self {
        Self {
            api_key: None,
            base_url: default_base_url(),
            model: default_model(),
            provider: default_provider(),
            anthropic_key: None,
            gemini_key: None,
            tavily_key: None,
        }
    }
}

fn config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".vrykell")
        .join("config.json")
}

impl AiConfig {
    /// 启动时从磁盘加载（文件缺失或损坏时回退默认）。
    pub fn load() -> Self {
        let inner = std::fs::read_to_string(config_path())
            .ok()
            .and_then(|s| serde_json::from_str::<AiConfigInner>(&s).ok())
            .unwrap_or_default();
        AiConfig(Mutex::new(inner))
    }

    fn save(&self) {
        if let Ok(c) = self.0.lock() {
            if let Some(dir) = config_path().parent() {
                let _ = std::fs::create_dir_all(dir);
                #[cfg(unix)]
                {
                    let _ = std::fs::set_permissions(dir, std::os::unix::fs::PermissionsExt::from_mode(0o700));
                }
            }
            if let Ok(s) = serde_json::to_string_pretty(&*c) {
                let path = config_path();
                if std::fs::write(&path, s).is_ok() {
                    #[cfg(unix)]
                    {
                        // API key 敏感：写盘后收紧为 0600
                        let _ = std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o600));
                    }
                }
            }
        }
    }
}

#[derive(Clone, Serialize)]
pub struct AiConfigInfo {
    pub has_key: bool,
    pub base_url: String,
    pub model: String,
    pub provider: String,
    pub has_anthropic_key: bool,
    pub has_gemini_key: bool,
    pub has_tavily_key: bool,
}

#[derive(Clone, Serialize)]
struct AiChunk {
    id: String,
    text: String,
}

#[derive(Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

fn set_field(state: &State<'_, AiConfig>, f: impl FnOnce(&mut AiConfigInner)) {
    if let Ok(mut c) = state.0.lock() {
        f(&mut c);
    }
    state.save();
}

#[tauri::command]
pub fn set_ai_key(state: State<'_, AiConfig>, key: String) {
    let k = key.trim().to_string();
    if k.is_empty() {
        return;
    }
    set_field(&state, |c| c.api_key = Some(k));
}

#[tauri::command]
pub fn clear_ai_key(state: State<'_, AiConfig>) {
    set_field(&state, |c| c.api_key = None);
}

#[tauri::command]
pub fn set_ai_base_url(state: State<'_, AiConfig>, base_url: String) {
    let u = base_url.trim().trim_end_matches('/').to_string();
    if u.is_empty() {
        return;
    }
    set_field(&state, |c| c.base_url = u);
}

#[tauri::command]
pub fn set_ai_model(state: State<'_, AiConfig>, model: String) {
    let m = model.trim().to_string();
    if m.is_empty() {
        return;
    }
    set_field(&state, |c| c.model = m);
}

#[tauri::command]
pub fn set_ai_provider(state: State<'_, AiConfig>, provider: String) {
    let p = provider.trim().to_string();
    if !matches!(p.as_str(), "openai-compatible" | "anthropic" | "gemini") {
        return;
    }
    set_field(&state, |c| c.provider = p);
}

/// 按 provider 设置 key（openai-compatible 即 api_key）。
#[tauri::command]
pub fn set_provider_key(state: State<'_, AiConfig>, provider: String, key: String) {
    let k = key.trim().to_string();
    if k.is_empty() {
        return;
    }
    set_field(&state, |c| match provider.as_str() {
        "anthropic" => c.anthropic_key = Some(k.clone()),
        "gemini" => c.gemini_key = Some(k.clone()),
        _ => c.api_key = Some(k.clone()),
    });
}

#[tauri::command]
pub fn clear_provider_key(state: State<'_, AiConfig>, provider: String) {
    set_field(&state, |c| match provider.as_str() {
        "anthropic" => c.anthropic_key = None,
        "gemini" => c.gemini_key = None,
        _ => c.api_key = None,
    });
}

#[tauri::command]
pub fn set_tavily_key(state: State<'_, AiConfig>, key: String) {
    let k = key.trim().to_string();
    if k.is_empty() {
        return;
    }
    set_field(&state, |c| c.tavily_key = Some(k));
}

#[tauri::command]
pub fn clear_tavily_key(state: State<'_, AiConfig>) {
    set_field(&state, |c| c.tavily_key = None);
}

#[tauri::command]
pub fn get_ai_config(state: State<'_, AiConfig>) -> AiConfigInfo {
    state
        .0
        .lock()
        .map(|c| AiConfigInfo {
            has_key: c.api_key.is_some(),
            base_url: c.base_url.clone(),
            model: c.model.clone(),
            provider: c.provider.clone(),
            has_anthropic_key: c.anthropic_key.is_some(),
            has_gemini_key: c.gemini_key.is_some(),
            has_tavily_key: c.tavily_key.is_some(),
        })
        .unwrap_or(AiConfigInfo {
            has_key: false,
            base_url: DEFAULT_BASE_URL.to_string(),
            model: DEFAULT_MODEL.to_string(),
            provider: DEFAULT_PROVIDER.to_string(),
            has_anthropic_key: false,
            has_gemini_key: false,
            has_tavily_key: false,
        })
}

#[tauri::command]
pub async fn ai_stream(
    app: AppHandle,
    state: State<'_, AiConfig>,
    id: String,
    messages: Vec<AiMessage>,
) -> Result<(), String> {
    let (api_key, base_url, model) = {
        let c = state.0.lock().map_err(|e| e.to_string())?;
        (
            c.api_key
                .clone()
                .ok_or_else(|| "尚未配置 API Key，请先在设置中填入".to_string())?,
            c.base_url.clone(),
            c.model.clone(),
        )
    };

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "messages": messages
            .iter()
            .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
            .collect::<Vec<_>>(),
    });

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;
    let resp = client
        .post(&url)
        .header("authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 AI 服务失败：{e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("AI 服务返回 {status}：{text}"));
    }

    // OpenAI 兼容 SSE：`data: {json}` 行 + `data: [DONE]` 结束标记。
    // 用字节缓冲按 `\n` 切完整行再解码，避免多字节 UTF-8 被 chunk 边界切断变成乱码。
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("读取 AI 响应失败：{e}"))?;
        buf.extend_from_slice(&bytes);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim_end_matches('\r');
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            if data.trim() == "[DONE]" {
                return Ok(());
            }
            let v: serde_json::Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(text) = v.pointer("/choices/0/delta/content").and_then(|t| t.as_str()) {
                let _ = app.emit("ai-chunk", AiChunk { id: id.clone(), text: text.to_string() });
            } else if let Some(msg) = v.pointer("/error/message").and_then(|m| m.as_str()) {
                return Err(msg.to_string());
            }
        }
    }
    Ok(())
}

// ── LLM 代理（AI SDK 前端 agent 的网络层）──────────────────────────────
//
// 前端 AI SDK provider 注入自定义 fetch：请求体经 invoke('llm_stream') 到这里，
// Rust 按目标 host 附加真实 API key 后发 HTTPS，响应字节流经 Channel 以 base64
// 块原样透传（不解析内容，SSE/JSON 由前端 AI SDK 处理）。效果：
//   - API key 永不进 webview；
//   - 不依赖 WebKit 的流式 fetch。
// 安全边界：只允许打向白名单 host（已配置的 base_url / api.anthropic.com /
// generativelanguage.googleapis.com），防止被滥用成带 key 的开放代理。

/// 进行中的代理请求（前端 abort → llm_abort → AbortHandle 取消 reqwest）。
#[derive(Default)]
pub struct LlmStreamState(pub Mutex<HashMap<String, AbortHandle>>);

#[derive(Deserialize)]
pub struct LlmProxyRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<Vec<(String, String)>>,
    pub body: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct LlmStreamEvent {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    headers: Option<Vec<(String, String)>>,
    /// base64 编码的原始字节（chunk 可能切断多字节 UTF-8，前端拼好再解码）
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl LlmStreamEvent {
    fn started(status: u16, headers: Vec<(String, String)>) -> Self {
        Self { kind: "started", status: Some(status), headers: Some(headers), data: None, message: None }
    }
    fn chunk(bytes: &[u8]) -> Self {
        Self {
            kind: "chunk",
            status: None,
            headers: None,
            data: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            message: None,
        }
    }
    fn done() -> Self {
        Self { kind: "done", status: None, headers: None, data: None, message: None }
    }
}

enum ProviderAuth {
    OpenAI,
    Anthropic,
    Gemini,
}

/// 按目标 host 归类 provider 并校验白名单。
fn classify(url: &str, cfg: &AiConfigInner) -> Result<(reqwest::Url, ProviderAuth), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("无效 URL：{e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "无效 URL：缺少 host".to_string())?
        .to_string();
    let local = matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1");
    if parsed.scheme() != "https" && !local {
        return Err("仅允许 https 请求（本地调试地址除外）".to_string());
    }
    if host == "api.anthropic.com" {
        return Ok((parsed, ProviderAuth::Anthropic));
    }
    if host == "generativelanguage.googleapis.com" {
        return Ok((parsed, ProviderAuth::Gemini));
    }
    let base_host = reqwest::Url::parse(&cfg.base_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_default();
    if host == base_host {
        Ok((parsed, ProviderAuth::OpenAI))
    } else {
        Err(format!("目标地址 {host} 不在 AI 服务白名单内"))
    }
}

async fn run_proxy(
    cfg: AiConfigInner,
    req: LlmProxyRequest,
    on_event: &Channel<LlmStreamEvent>,
) -> Result<(), String> {
    let (url, auth) = classify(&req.url, &cfg)?;
    let key = match auth {
        ProviderAuth::OpenAI => cfg.api_key.clone(),
        ProviderAuth::Anthropic => cfg.anthropic_key.clone(),
        ProviderAuth::Gemini => cfg.gemini_key.clone(),
    }
    .ok_or_else(|| "当前服务尚未配置 API Key，请先在设置中填入".to_string())?;

    let method = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("POST").as_bytes())
        .map_err(|e| format!("无效 HTTP 方法：{e}"))?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        // 流式响应可能持续很久，不设总超时，靠 llm_abort 取消
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;

    let mut rb = client.request(method, url);
    // 认证头不转发前端值（前端用的是占位 key），由下方统一附加真实 key
    for (k, v) in req.headers.unwrap_or_default() {
        let lk = k.to_ascii_lowercase();
        if matches!(
            lk.as_str(),
            "host" | "content-length" | "authorization" | "x-api-key" | "x-goog-api-key"
        ) {
            continue;
        }
        rb = rb.header(k, v);
    }
    rb = match auth {
        ProviderAuth::OpenAI => rb.header("authorization", format!("Bearer {key}")),
        ProviderAuth::Anthropic => rb.header("x-api-key", key),
        ProviderAuth::Gemini => rb.header("x-goog-api-key", key),
    };
    if let Some(body) = req.body {
        rb = rb.body(body);
    }

    let resp = rb.send().await.map_err(|e| format!("请求 AI 服务失败：{e}"))?;
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or_default().to_string()))
        .collect::<Vec<_>>();
    let _ = on_event.send(LlmStreamEvent::started(status, headers));

    // 无论状态码都原样透传 body，AI SDK 需要错误体生成可读报错
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("读取 AI 响应失败：{e}"))?;
        on_event
            .send(LlmStreamEvent::chunk(&bytes))
            .map_err(|e| format!("回传数据失败：{e}"))?;
    }
    let _ = on_event.send(LlmStreamEvent::done());
    Ok(())
}

#[tauri::command]
pub async fn llm_stream(
    state: State<'_, AiConfig>,
    streams: State<'_, LlmStreamState>,
    id: String,
    req: LlmProxyRequest,
    on_event: Channel<LlmStreamEvent>,
) -> Result<(), String> {
    let cfg = state.0.lock().map_err(|e| e.to_string())?.clone();
    let (handle, reg) = AbortHandle::new_pair();
    streams
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), handle);
    let result = Abortable::new(run_proxy(cfg, req, &on_event), reg).await;
    if let Ok(mut m) = streams.0.lock() {
        m.remove(&id);
    }
    match result {
        Ok(r) => r,
        // 前端主动 abort：静默结束，不算错误
        Err(_) => Ok(()),
    }
}

#[tauri::command]
pub fn llm_abort(streams: State<'_, LlmStreamState>, id: String) {
    if let Ok(mut m) = streams.0.lock() {
        if let Some(h) = m.remove(&id) {
            h.abort();
        }
    }
}
