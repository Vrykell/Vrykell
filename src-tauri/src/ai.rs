//! AI 调用下沉到 Rust：API key / Base URL / 模型存后端（持久化到
//! ~/.vrykell/config.json），不进 webview 的 localStorage。
//! 前端只负责把消息发来、订阅 `ai-chunk` 事件收流式文本。
//!
//! 采用 OpenAI 兼容的 `/chat/completions` 流式协议（可配 Base URL），
//! 因此支持 OpenAI / DeepSeek / 通义 / Moonshot / GLM 等各类兼容服务。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL: &str = "gpt-4o-mini";

/// 全局 AI 配置（api_key / base_url / model），Mutex 保护 + 落盘持久化。
pub struct AiConfig(Mutex<AiConfigInner>);

#[derive(Serialize, Deserialize, Clone)]
struct AiConfigInner {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default = "default_base_url")]
    base_url: String,
    #[serde(default = "default_model")]
    model: String,
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_string()
}
fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}

impl Default for AiConfigInner {
    fn default() -> Self {
        Self { api_key: None, base_url: default_base_url(), model: default_model() }
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
pub fn get_ai_config(state: State<'_, AiConfig>) -> AiConfigInfo {
    let (has_key, base_url, model) = state
        .0
        .lock()
        .map(|c| (c.api_key.is_some(), c.base_url.clone(), c.model.clone()))
        .unwrap_or((false, DEFAULT_BASE_URL.to_string(), DEFAULT_MODEL.to_string()));
    AiConfigInfo { has_key, base_url, model }
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
