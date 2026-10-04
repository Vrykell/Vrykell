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

/// 一个可用的模型配置（命名 profile）：独立 provider/base_url/model。
/// API key 仍按 provider 复用（api_key / anthropic_key / gemini_key）。
/// 注意：字段序列化为 camelCase（baseUrl），与前端 ModelProfile 对齐。
/// 模型能力标记（创建时由前端探测，随 profile 持久化）。
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelCapabilities {
    pub vision: bool,
    pub reasoning: bool,
    pub tools: bool,
    pub search: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfile {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// openai-compatible | anthropic | gemini
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    /// 能力标记（缺省 = 未探测，前端按名字启发式兜底）
    #[serde(default)]
    pub capabilities: Option<ModelCapabilities>,
}

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
    /// 多模型列表（命名 profile）
    #[serde(default)]
    models: Vec<ModelProfile>,
    /// 当前生效模型 id（对应 models 里某一项）
    #[serde(default)]
    active_model: String,
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
            models: Vec::new(),
            active_model: String::new(),
        }
    }
}

impl AiConfigInner {
    /// 从旧单模型字段迁移出首个 model profile，并保证 active_model 有效。
    fn normalize(&mut self) {
        if self.models.is_empty() {
            self.models.push(ModelProfile {
                id: "default".to_string(),
                name: "默认模型".to_string(),
                provider: self.provider.clone(),
                base_url: self.base_url.clone(),
                model: self.model.clone(),
                capabilities: None,
            });
        }
        if self.active_model.is_empty() || !self.models.iter().any(|m| m.id == self.active_model) {
            self.active_model = self.models[0].id.clone();
        }
        self.sync_legacy();
    }

    /// 把 active model 的 provider/base_url/model 同步到旧字段（向后兼容旧命令/旧前端）。
    fn sync_legacy(&mut self) {
        if let Some(m) = self.models.iter().find(|m| m.id == self.active_model).cloned() {
            self.provider = m.provider;
            self.base_url = m.base_url;
            self.model = m.model;
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
        let mut inner = std::fs::read_to_string(config_path())
            .ok()
            .and_then(|s| serde_json::from_str::<AiConfigInner>(&s).ok())
            .unwrap_or_default();
        inner.normalize();
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
    /// 多模型列表
    pub models: Vec<ModelProfile>,
    /// 当前生效模型 id
    pub active_model: String,
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
    set_field(&state, |c| {
        c.normalize();
        if let Some(m) = c.models.iter_mut().find(|m| m.id == c.active_model) {
            m.base_url = u;
        }
        c.sync_legacy();
    });
}

#[tauri::command]
pub fn set_ai_model(state: State<'_, AiConfig>, model: String) {
    let m = model.trim().to_string();
    if m.is_empty() {
        return;
    }
    set_field(&state, |c| {
        c.normalize();
        if let Some(active) = c.models.iter_mut().find(|x| x.id == c.active_model) {
            active.model = m;
        }
        c.sync_legacy();
    });
}

#[tauri::command]
pub fn set_ai_provider(state: State<'_, AiConfig>, provider: String) {
    let p = provider.trim().to_string();
    if !matches!(p.as_str(), "openai-compatible" | "anthropic" | "gemini") {
        return;
    }
    set_field(&state, |c| {
        c.normalize();
        if let Some(active) = c.models.iter_mut().find(|x| x.id == c.active_model) {
            active.provider = p;
        }
        c.sync_legacy();
    });
}

/// 一次性替换整个模型列表 + 当前生效模型。
#[tauri::command]
pub fn set_ai_models(state: State<'_, AiConfig>, models: Vec<ModelProfile>, active_model: String) {
    set_field(&state, |c| {
        c.models = models;
        c.active_model = active_model;
        c.normalize();
    });
}

/// 切换当前生效模型（按 id）。
#[tauri::command]
pub fn set_active_model(state: State<'_, AiConfig>, id: String) {
    set_field(&state, |c| {
        c.normalize();
        if c.models.iter().any(|m| m.id == id) {
            c.active_model = id;
            c.sync_legacy();
        }
    });
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
            models: c.models.clone(),
            active_model: c.active_model.clone(),
        })
        .unwrap_or_else(|_| AiConfigInfo {
            has_key: false,
            base_url: DEFAULT_BASE_URL.to_string(),
            model: DEFAULT_MODEL.to_string(),
            provider: DEFAULT_PROVIDER.to_string(),
            has_anthropic_key: false,
            has_gemini_key: false,
            has_tavily_key: false,
            models: Vec::new(),
            active_model: String::new(),
        })
}

/// Tavily 搜索转发：openai-compatible 无原生搜索能力时的兜底。
/// key 由 Rust 附加，不进 webview；返回 Tavily 原始 JSON（前端截取展示）。
#[tauri::command]
pub async fn tavily_search(
    state: State<'_, AiConfig>,
    query: String,
    max_results: Option<u32>,
) -> Result<serde_json::Value, String> {
    let key = {
        let c = state.0.lock().map_err(|e| e.to_string())?;
        c.tavily_key
            .clone()
            .ok_or_else(|| "尚未配置 Tavily API Key，请先在设置中填入".to_string())?
    };
    let q = query.trim().to_string();
    if q.is_empty() {
        return Err("搜索词不能为空".to_string());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;
    let resp = client
        .post("https://api.tavily.com/search")
        .json(&serde_json::json!({
            "api_key": key,
            "query": q,
            "max_results": max_results.unwrap_or(5).clamp(1, 8),
            "include_answer": true,
        }))
        .send()
        .await
        .map_err(|e| format!("请求 Tavily 失败：{e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 Tavily 响应失败：{e}"))?;
    if !status.is_success() {
        let cap = text.len().min(300);
        return Err(format!("Tavily 返回 {status}：{}", &text[..cap]));
    }
    serde_json::from_str(&text).map_err(|e| format!("解析 Tavily 响应失败：{e}"))
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
    pub provider: Option<String>,
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

#[derive(Debug, PartialEq)]
enum ProviderAuth {
    OpenAI,
    Anthropic,
    Gemini,
}

// Match the configured origin and path, including local ports.
fn matches_endpoint(url: &reqwest::Url, base: &str) -> bool {
    let Ok(base) = reqwest::Url::parse(base) else { return false; };
    let path = base.path().trim_end_matches('/');
    url.origin() == base.origin()
        && (url.path() == path || url.path().starts_with(&format!("{path}/")))
}

fn provider_auth(provider: &str) -> Result<ProviderAuth, String> {
    match provider {
        "anthropic" => Ok(ProviderAuth::Anthropic),
        "gemini" => Ok(ProviderAuth::Gemini),
        "openai-compatible" => Ok(ProviderAuth::OpenAI),
        _ => Err("未知 AI 服务商".to_string()),
    }
}

// The requested provider selects its key only after validating the saved endpoint.
fn classify(url: &str, cfg: &AiConfigInner, requested: Option<&str>) -> Result<(reqwest::Url, ProviderAuth), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("无效 URL：{e}"))?;
    let host = parsed.host_str().ok_or_else(|| "无效 URL：缺少 host".to_string())?;
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && local) {
        return Err("仅允许 https 请求（本地调试地址除外）".to_string());
    }
    let official = match host {
        "api.anthropic.com" => Some("anthropic"),
        "generativelanguage.googleapis.com" => Some("gemini"),
        _ => None,
    };
    if let Some(provider) = official {
        if requested.is_none() || requested == Some(provider) {
            let auth = provider_auth(provider)?;
            return Ok((parsed, auth));
        }
    }
    let configured = cfg.models.iter().find(|model| {
        matches_endpoint(&parsed, &model.base_url)
            && requested.map_or(true, |provider| model.provider == provider)
    });
    let provider = configured.map(|model| model.provider.as_str()).or_else(|| {
        if matches_endpoint(&parsed, &cfg.base_url)
            && requested.map_or(true, |provider| cfg.provider == provider) {
            Some(cfg.provider.as_str())
        } else { None }
    }).ok_or_else(|| format!("目标地址 {host} 不在当前服务商的 AI 服务白名单内"))?;
    let auth = provider_auth(provider)?;
    Ok((parsed, auth))
}

async fn run_proxy(
    cfg: AiConfigInner,
    req: LlmProxyRequest,
    on_event: &Channel<LlmStreamEvent>,
) -> Result<(), String> {
    let (url, auth) = classify(&req.url, &cfg, req.provider.as_deref())?;
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

#[cfg(test)]
mod proxy_endpoint_tests {
    use super::*;

    #[test]
    fn configured_gateways_use_their_provider_auth() {
        for (provider, expected) in [("anthropic", ProviderAuth::Anthropic), ("gemini", ProviderAuth::Gemini), ("openai-compatible", ProviderAuth::OpenAI)] {
            let mut cfg = AiConfigInner::default();
            cfg.provider = provider.into();
            cfg.base_url = "https://gateway.example/api/v1".into();
            cfg.models.clear();
            assert_eq!(classify("https://gateway.example/api/v1/messages", &cfg, Some(provider)).unwrap().1, expected);
            assert!(classify("https://gateway.example/unconfigured/messages", &cfg, Some(provider)).is_err());
        }
    }

    #[test]
    fn configured_origins_reject_different_ports_and_providers() {
        let mut cfg = AiConfigInner::default();
        cfg.provider = "anthropic".into();
        cfg.base_url = "http://localhost:8000/v1".into();
        cfg.models.clear();
        assert!(classify("http://localhost:8001/v1/messages", &cfg, Some("anthropic")).is_err());
        assert!(classify("http://localhost:8000/v1/messages", &cfg, Some("gemini")).is_err());
        assert!(classify("http://localhost:8000/v1/messages", &cfg, Some("anthropic")).is_ok());
    }
}
