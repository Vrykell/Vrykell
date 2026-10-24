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
    /// openai-compatible | anthropic | gemini | opencode
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    /// 自定义分组名；缺省按厂商自动分组
    #[serde(default)]
    pub group: Option<String>,
    /// 能力标记（缺省 = 未探测，前端按名字启发式兜底）
    #[serde(default)]
    pub capabilities: Option<ModelCapabilities>,
}

#[derive(Serialize, Deserialize, Clone)]
struct AiConfigInner {
    /// Key 不进 config.json（`skip_serializing`）：它们存在平台密钥存储里（Windows DPAPI /
    /// macOS 钥匙串 / 其它平台的 0600 文件，见 `crate::secret`）。字段仍可反序列化，用于把
    /// 旧版明文文件里的 key 一次性迁移出去。
    #[serde(default, skip_serializing)]
    api_key: Option<String>,
    #[serde(default = "default_base_url")]
    base_url: String,
    #[serde(default = "default_model")]
    model: String,
    /// openai-compatible | anthropic | gemini | opencode
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default, skip_serializing)]
    anthropic_key: Option<String>,
    #[serde(default, skip_serializing)]
    gemini_key: Option<String>,
    #[serde(default, skip_serializing)]
    tavily_key: Option<String>,
    /// 多模型列表（命名 profile）
    #[serde(default)]
    models: Vec<ModelProfile>,
    /// 当前生效模型 id（对应 models 里某一项）
    #[serde(default)]
    active_model: String,
    /// 已配置密钥的 provider 身份列表（`kind|生效端点`）；密钥本体在平台密钥存储里。
    #[serde(default)]
    provider_keys: Vec<String>,
}

/// 平台密钥存储里的账户名（`crate::secret`）。
const SECRET_OPENAI: &str = "ai.openai";
const SECRET_ANTHROPIC: &str = "ai.anthropic";
const SECRET_GEMINI: &str = "ai.gemini";
const SECRET_TAVILY: &str = "ai.tavily";

/// Official endpoint per API family; kept in sync with the frontend provider catalog.
const DEFAULT_BASE_URL_ANTHROPIC: &str = "https://api.anthropic.com/v1";
const DEFAULT_BASE_URL_GEMINI: &str = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_BASE_URL_OPENCODE: &str = "https://opencode.ai/zen/go/v1";

fn default_base_url_for(kind: &str) -> &'static str {
    match kind {
        "anthropic" => DEFAULT_BASE_URL_ANTHROPIC,
        "gemini" => DEFAULT_BASE_URL_GEMINI,
        "opencode" => DEFAULT_BASE_URL_OPENCODE,
        _ => DEFAULT_BASE_URL,
    }
}

fn is_default_base_url(url: &str) -> bool {
    url == DEFAULT_BASE_URL
        || url == DEFAULT_BASE_URL_ANTHROPIC
        || url == DEFAULT_BASE_URL_GEMINI
        || url == DEFAULT_BASE_URL_OPENCODE
}

/// provider 身份（家族 + 生效端点），与前端 `providerList.providerId` 的算法一致；
/// 密钥按这个身份各存各的，换服务商就换密钥。
fn provider_identity(kind: &str, base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    let effective = if trimmed.is_empty() || is_default_base_url(trimmed) {
        default_base_url_for(kind)
    } else {
        trimmed
    };
    format!("{kind}|{effective}")
}

/// 平台密钥存储里的账户名：按 provider 身份的稳定散列命名，URL 不进文件名。
fn provider_secret_name(provider_id: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in provider_id.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("ai.provider.{hash:016x}")
}

/// 某个 provider 的 key：只读平台密钥存储（明文不进配置文件）。
fn read_provider_key(provider_id: &str) -> Option<String> {
    crate::secret::get_secret(&provider_secret_name(provider_id)).filter(|key| !key.trim().is_empty())
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
            provider_keys: Vec::new(),
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
                group: None,
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

/// Copy a legacy credential without removing its source until every destination is safe.
fn migrate_family_key(
    config: &mut AiConfigInner,
    kind: &str,
    value: &str,
    mut read: impl FnMut(&str) -> Option<String>,
    mut write: impl FnMut(&str, &str) -> Result<(), String>,
) -> (bool, bool) {
    let ids: std::collections::HashSet<_> = config.models.iter()
        .filter(|model| model.provider == kind)
        .map(|model| provider_identity(&model.provider, &model.base_url)).collect();
    let mut complete = !ids.is_empty();
    let mut changed = false;
    for id in ids {
        if read(&id).is_some() || write(&id, value).is_ok() {
            if !config.provider_keys.contains(&id) {
                config.provider_keys.push(id);
                changed = true;
            }
        } else {
            complete = false;
        }
    }
    (changed, complete)
}

impl AiConfig {
    /// Load configuration and migrate credentials through the platform store.
    pub fn load() -> Self {
        let mut inner = std::fs::read_to_string(config_path())
            .ok()
            .and_then(|s| serde_json::from_str::<AiConfigInner>(&s).ok())
            .unwrap_or_default();
        // Keep the original file if any credential could not be sealed.
        let legacy = [
            (SECRET_OPENAI, inner.api_key.take()),
            (SECRET_ANTHROPIC, inner.anthropic_key.take()),
            (SECRET_GEMINI, inner.gemini_key.take()),
            (SECRET_TAVILY, inner.tavily_key.take()),
        ];
        let mut migrated = false;
        let mut sealed_all = true;
        for (account, value) in legacy {
            if let Some(value) = value {
                match crate::secret::set_secret(account, &value) {
                    Ok(()) => migrated = true,
                    Err(error) => {
                        sealed_all = false;
                        eprintln!("[ai] 迁移 API Key 到密钥存储失败：{error}");
                    }
                }
            }
        }
        inner.normalize();
        // Split shared credentials into endpoint accounts, retaining the source on partial failure.
        let family_keys = [
            ("openai-compatible", crate::secret::get_secret(SECRET_OPENAI)),
            ("anthropic", crate::secret::get_secret(SECRET_ANTHROPIC)),
            ("gemini", crate::secret::get_secret(SECRET_GEMINI)),
        ];
        let mut family_migrated = false;
        for (kind, value) in family_keys {
            let Some(value) = value else { continue };
            let (changed, complete) = migrate_family_key(&mut inner, kind, &value, read_provider_key,
                |id, key| crate::secret::set_secret(&provider_secret_name(id), key));
            family_migrated |= changed;
            if complete {
                crate::secret::delete_secret(match kind {
                    "anthropic" => SECRET_ANTHROPIC,
                    "gemini" => SECRET_GEMINI,
                    _ => SECRET_OPENAI,
                });
            }
        }
        inner.tavily_key = crate::secret::get_secret(SECRET_TAVILY);
        let cfg = AiConfig(Mutex::new(inner));
        // A failed plaintext migration must not be erased by an unrelated successful migration.
        if sealed_all && (migrated || family_migrated) {
            cfg.save();
        }
        cfg
    }

    fn save(&self) {
        let Ok(c) = self.0.lock() else { return };
        // Key 只写平台密钥存储；缺省项不在这里删除（clear_* 命令负责），省掉空写的文件/钥匙串往返。
        for (account, value) in [
            (SECRET_OPENAI, &c.api_key),
            (SECRET_ANTHROPIC, &c.anthropic_key),
            (SECRET_GEMINI, &c.gemini_key),
            (SECRET_TAVILY, &c.tavily_key),
        ] {
            if let Some(secret) = value {
                if let Err(error) = crate::secret::set_secret(account, secret) {
                    eprintln!("[ai] 保存 API Key 失败：{error}");
                }
            }
        }
        if let Some(dir) = config_path().parent() {
            let _ = std::fs::create_dir_all(dir);
            #[cfg(unix)]
            {
                let _ = std::fs::set_permissions(dir, std::os::unix::fs::PermissionsExt::from_mode(0o700));
            }
        }
        if let Ok(s) = serde_json::to_string_pretty(&*c) {
            let path = config_path();
            // 文件里不再有 key（`skip_serializing`），权限收紧仍是纵深防御
            let _ = std::fs::write(&path, s);
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
    /// 已配置密钥的 provider 身份列表
    pub provider_keys: Vec<String>,
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
    crate::secret::delete_secret(SECRET_OPENAI);
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
    if !matches!(p.as_str(), "openai-compatible" | "anthropic" | "gemini" | "opencode") {
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

/// Persist an endpoint credential before marking it configured.
#[tauri::command]
pub fn set_provider_key(state: State<'_, AiConfig>, provider_id: String, key: String) -> Result<(), String> {
    let k = key.trim().to_string();
    if k.is_empty() {
        return Err("provider-key-empty".to_string());
    }
    crate::secret::set_secret(&provider_secret_name(&provider_id), &k)
        .map_err(|_| "provider-key-write-failed".to_string())?;
    set_field(&state, |c| {
        if !c.provider_keys.iter().any(|id| id == &provider_id) {
            c.provider_keys.push(provider_id.clone());
        }
    });
    Ok(())
}

#[tauri::command]
pub fn clear_provider_key(state: State<'_, AiConfig>, provider_id: String) {
    crate::secret::delete_secret(&provider_secret_name(&provider_id));
    set_field(&state, |c| c.provider_keys.retain(|id| id != &provider_id));
}

/// 密钥掩码：保留头尾便于辨认，中间用固定长度的星号；过短的 key 整体遮蔽。
fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "•".repeat(chars.len().max(1));
    }
    let head: String = chars[..3].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}********{tail}")
}

/// 设置页展示用的掩码密钥；明文只经 provider_key_reveal 显式返回。
#[tauri::command]
pub fn provider_key_hint(provider_id: String) -> Option<String> {
    read_provider_key(&provider_id).map(|key| mask_key(&key))
}

/// 用户显式查看时返回明文密钥（前端只用于当前会话的展示/复制）。
#[tauri::command]
pub fn provider_key_reveal(provider_id: String) -> Option<String> {
    read_provider_key(&provider_id)
}

/// 模型列表请求的地址与认证头（检测与同步共用；与聊天请求同一 base 约定）。
fn models_request(provider: &str, base_url: &str, key: &str) -> Result<(String, Vec<(&'static str, String)>), String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("请先填写 API 地址".to_string());
    }
    let headers = match provider {
        "anthropic" => vec![
            ("x-api-key", key.to_string()),
            ("anthropic-version", "2023-06-01".to_string()),
        ],
        "gemini" => vec![("x-goog-api-key", key.to_string())],
        _ => vec![("authorization", format!("Bearer {key}"))],
    };
    Ok((format!("{base}/models"), headers))
}

/// 解析模型列表响应：OpenAI/Anthropic 的 `data[].id` 与 Gemini 的 `models[].name` 都认。
fn parse_models(body: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else { return Vec::new() };
    let mut ids: Vec<String> = Vec::new();
    if let Some(items) = value.get("data").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                ids.push(id.to_string());
            }
        }
    }
    if let Some(items) = value.get("models").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                ids.push(name.strip_prefix("models/").unwrap_or(name).to_string());
            }
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

/// 用已存密钥向服务商拉取模型列表：「检测」验证密钥，「同步」把新模型并入列表。
#[tauri::command]
pub async fn provider_fetch_models(
    provider_id: String,
    provider: String,
    base_url: String,
) -> Result<Vec<String>, String> {
    let key = read_provider_key(&provider_id)
        .ok_or_else(|| "这个服务商还没有配置 API Key".to_string())?;
    let (url, headers) = models_request(&provider, &base_url, &key)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建请求失败：{e}"))?;
    let mut request = client.get(&url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|e| format!("请求失败：{e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| format!("读取响应失败：{e}"))?;
    if !status.is_success() {
        let snippet: String = body.chars().take(200).collect();
        return Err(format!("服务商返回 {status}：{snippet}"));
    }
    Ok(parse_models(&body))
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
    crate::secret::delete_secret(SECRET_TAVILY);
}

#[tauri::command]
pub fn get_ai_config(state: State<'_, AiConfig>) -> AiConfigInfo {
    state
        .0
        .lock()
        .map(|c| AiConfigInfo {
            has_key: c.provider_keys.iter().any(|id| id.starts_with("openai-compatible|")),
            base_url: c.base_url.clone(),
            model: c.model.clone(),
            provider: c.provider.clone(),
            has_anthropic_key: c.provider_keys.iter().any(|id| id.starts_with("anthropic|")),
            has_gemini_key: c.provider_keys.iter().any(|id| id.starts_with("gemini|")),
            has_tavily_key: c.tavily_key.is_some(),
            provider_keys: c.provider_keys.clone(),
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
            provider_keys: Vec::new(),
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
    let (provider_id, base_url, model) = {
        let c = state.0.lock().map_err(|e| e.to_string())?;
        let (provider, base) = c.models.iter()
            .find(|m| m.id == c.active_model)
            .map(|m| (m.provider.clone(), m.base_url.clone()))
            .unwrap_or_else(|| (c.provider.clone(), c.base_url.clone()));
        (provider_identity(&provider, &base), base, c.model.clone())
    };
    let api_key = read_provider_key(&provider_id)
        .ok_or_else(|| "尚未配置 API Key，请先在设置中填入".to_string())?;

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
    /// Chat-completions gateway that also expects the client to identify itself.
    Opencode,
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
        "opencode" => Ok(ProviderAuth::Opencode),
        _ => Err("未知 AI 服务商".to_string()),
    }
}

// The requested provider selects its key only after validating the saved endpoint; the returned
// identity is the endpoint (family + effective base) the key is stored under.
fn classify(url: &str, cfg: &AiConfigInner, requested: Option<&str>) -> Result<(reqwest::Url, ProviderAuth, String), String> {
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
            let identity = request_identity(&parsed, cfg, provider);
            return Ok((parsed, auth, identity));
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
    let identity = request_identity(&parsed, cfg, provider);
    Ok((parsed, auth, identity))
}

/// The provider identity a request belongs to: the configured model whose endpoint contains the
/// URL first, else the family's default endpoint. Keys are stored per identity, so this is what
/// the proxy reads before attaching the auth header.
fn request_identity(url: &reqwest::Url, cfg: &AiConfigInner, kind: &str) -> String {
    if let Some(model) = cfg.models.iter().find(|m| m.provider == kind && matches_endpoint(url, &m.base_url)) {
        return provider_identity(&model.provider, &model.base_url);
    }
    if cfg.provider == kind && matches_endpoint(url, &cfg.base_url) {
        return provider_identity(&cfg.provider, &cfg.base_url);
    }
    provider_identity(kind, "")
}

async fn run_proxy(
    cfg: AiConfigInner,
    req: LlmProxyRequest,
    on_event: &Channel<LlmStreamEvent>,
) -> Result<(), String> {
    let (url, auth, provider_id) = classify(&req.url, &cfg, req.provider.as_deref())?;
    let key = read_provider_key(&provider_id)
        .ok_or_else(|| "当前服务尚未配置 API Key，请先在设置中填入".to_string())?;

    let method = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("POST").as_bytes())
        .map_err(|e| format!("无效 HTTP 方法：{e}"))?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        // 流式响应可能持续很久，不设总超时，靠 llm_abort 取消
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;

    let mut rb = client.request(method, url);
    // The frontend sends a placeholder credential; the real one is attached below. The client
    // identity is set by this side too, so a gateway never sees the HTTP library's default.
    let identifies_client = auth == ProviderAuth::Opencode;
    for (k, v) in req.headers.unwrap_or_default() {
        let lk = k.to_ascii_lowercase();
        if matches!(
            lk.as_str(),
            "host" | "content-length" | "authorization" | "x-api-key" | "x-goog-api-key"
        ) || (identifies_client && lk == "user-agent")
        {
            continue;
        }
        rb = rb.header(k, v);
    }
    rb = match auth {
        ProviderAuth::OpenAI => rb.header("authorization", format!("Bearer {key}")),
        ProviderAuth::Opencode => rb
            .header("authorization", format!("Bearer {key}"))
            .header("user-agent", concat!("Vrykell/", env!("CARGO_PKG_VERSION"))),
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
mod config_tests {
    use super::*;

    #[test]
    fn serialized_config_never_carries_keys() {
        let mut inner = AiConfigInner::default();
        inner.api_key = Some("sk-secret".into());
        inner.anthropic_key = Some("sk-ant-secret".into());
        inner.tavily_key = Some("tv-secret".into());
        inner.normalize();
        let json = serde_json::to_string(&inner).unwrap();
        for leaked in ["sk-secret", "sk-ant-secret", "tv-secret", "api_key", "anthropic_key", "tavily_key"] {
            assert!(!json.contains(leaked), "config.json must not carry {leaked}: {json}");
        }
        // 非密钥字段照常落盘
        assert!(json.contains("base_url") || json.contains("baseUrl"));
    }

    #[test]
    fn legacy_config_keys_still_deserialize_for_migration() {
        let json = r#"{"api_key":"sk-old","anthropic_key":"sk-ant","gemini_key":"g","tavily_key":"t","provider":"anthropic"}"#;
        let inner: AiConfigInner = serde_json::from_str(json).unwrap();
        assert_eq!(inner.api_key.as_deref(), Some("sk-old"));
        assert_eq!(inner.anthropic_key.as_deref(), Some("sk-ant"));
        assert_eq!(inner.gemini_key.as_deref(), Some("g"));
        assert_eq!(inner.tavily_key.as_deref(), Some("t"));
    }

    #[test]
    fn legacy_credentials_are_retained_until_every_endpoint_is_migrated() {
        let mut config = AiConfigInner::default();
        config.normalize();
        let kind = config.models[0].provider.clone();
        let mut second = config.models[0].clone();
        second.id = "second".into();
        second.base_url = "https://other.example/v1".into();
        config.models.push(second);
        let (_, complete) = migrate_family_key(&mut config, &kind, "old", |_| None,
            |id, _| if id.contains("other.example") { Err("unavailable".into()) } else { Ok(()) });
        assert!(!complete, "a partial write must retain the source credential");
        assert_eq!(config.provider_keys.len(), 1);
        let (changed, complete) = migrate_family_key(&mut config, &kind, "old", |_| Some("existing".into()),
            |_, _| panic!("existing endpoint credentials must not be replaced"));
        assert!(changed && complete);
        assert_eq!(config.provider_keys.len(), 2);
        let (_, complete) = migrate_family_key(&mut config, "unused", "old", |_| None, |_, _| Ok(()));
        assert!(!complete, "an unused source must not be removed");
    }
}

#[cfg(test)]
mod proxy_endpoint_tests {
    use super::*;

    #[test]
    fn configured_gateways_use_their_provider_auth() {
        for (provider, expected) in [
            ("anthropic", ProviderAuth::Anthropic),
            ("gemini", ProviderAuth::Gemini),
            ("openai-compatible", ProviderAuth::OpenAI),
            ("opencode", ProviderAuth::Opencode),
        ] {
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

    #[test]
    fn masks_keys_keeping_head_and_tail() {
        assert_eq!(mask_key("sk-1234567890abcdef"), "sk-********cdef");
        assert_eq!(mask_key("short"), "•••••");
    }

    #[test]
    fn models_request_builds_url_and_headers_per_family() {
        let (url, headers) = models_request("anthropic", "https://api.example.com/v1/", "k").unwrap();
        assert_eq!(url, "https://api.example.com/v1/models");
        assert!(headers.iter().any(|(name, value)| *name == "x-api-key" && value == "k"));
        assert!(headers.iter().any(|(name, _)| *name == "anthropic-version"));

        let (url, headers) = models_request("openai-compatible", "https://api.example.com/v1", "k").unwrap();
        assert_eq!(url, "https://api.example.com/v1/models");
        assert!(headers.iter().any(|(name, value)| *name == "authorization" && value == "Bearer k"));

        let (_, headers) = models_request("gemini", "https://generativelanguage.googleapis.com/v1beta", "k").unwrap();
        assert!(headers.iter().any(|(name, value)| *name == "x-goog-api-key" && value == "k"));

        assert!(models_request("anthropic", "   ", "k").is_err());
    }

    #[test]
    fn parses_model_lists_from_both_shapes() {
        let openai = r#"{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}"#;
        assert_eq!(parse_models(openai), vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()]);

        let gemini = r#"{"models":[{"name":"models/gemini-2.5-pro"},{"name":"models/gemini-2.5-flash"}]}"#;
        assert_eq!(parse_models(gemini), vec!["gemini-2.5-flash".to_string(), "gemini-2.5-pro".to_string()]);

        assert_eq!(parse_models(r#"{"data":[{"id":"a"},{"id":"a"}]}"#), vec!["a".to_string()]);
        assert!(parse_models("not json").is_empty());
    }

    #[test]
    fn provider_defaults_match_the_frontend_catalog() {
        let catalog: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/config/providers.json"
        ))
        .expect("provider catalog must be valid JSON");
        for entry in catalog.as_array().expect("provider catalog must be a list") {
            let kind = entry["kind"].as_str().expect("catalog entry needs a kind");
            let endpoint = entry["defaultBaseUrl"]
                .as_str()
                .expect("catalog entry needs a default endpoint");
            assert_eq!(default_base_url_for(kind), endpoint, "default endpoint drifted for {kind}");
        }
    }

    #[test]
    fn provider_identity_matches_the_frontend_rule() {
        assert_eq!(provider_identity("anthropic", ""), "anthropic|https://api.anthropic.com/v1");
        assert_eq!(
            provider_identity("anthropic", "https://api.anthropic.com/v1/"),
            "anthropic|https://api.anthropic.com/v1"
        );
        assert_eq!(
            provider_identity("openai-compatible", "https://api.deepseek.com/v1/"),
            "openai-compatible|https://api.deepseek.com/v1"
        );
        assert_eq!(
            provider_identity("gemini", "https://generativelanguage.googleapis.com/v1beta"),
            "gemini|https://generativelanguage.googleapis.com/v1beta"
        );
        assert_eq!(
            provider_identity("opencode", ""),
            "opencode|https://opencode.ai/zen/go/v1"
        );
    }

    #[test]
    fn provider_secret_names_are_stable_and_distinct() {
        let name = provider_secret_name("anthropic|https://api.anthropic.com/v1");
        assert_eq!(name, provider_secret_name("anthropic|https://api.anthropic.com/v1"));
        assert_ne!(name, provider_secret_name("openai-compatible|https://api.anthropic.com/v1"));
        assert!(name.starts_with("ai.provider."));
    }
}
