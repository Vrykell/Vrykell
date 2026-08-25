//! 无 key 的联网能力（一等工具）：
//!   - `web_search`：DuckDuckGo HTML 抓取（不依赖 Tavily/原生搜索）。
//!   - `web_fetch`：抓取任意 URL → 结构化 Markdown 文本（标题/标题层级/链接保留结构）。
//!   - `web_crawl`：从起始 URL 广度优先爬取多个页面（同域、限深度/页数），逐页结构化。
//!
//! 都走 Rust 的 reqwest 直连，key/令牌不出 webview；结果转结构化文本截断，
//! 供模型阅读与 ToolRunCard 展开展示。

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::time::Duration;
use url::Url;

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/// web_fetch 结构化文本截断上限（字符）。
const FETCH_TEXT_CAP: usize = 24_000;
/// web_crawl 单页文本截断上限（字符）。
const CRAWL_PAGE_CAP: usize = 8_000;

/// 单条搜索/抓取结果。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebResultItem {
    pub title: String,
    pub url: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResponse {
    pub results: Vec<WebResultItem>,
}

/// 页面内超链接（结构化输出用）。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebLink {
    pub text: String,
    pub url: String,
}

/// web_fetch 结果：结构化文本 + 元信息。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResponse {
    pub title: String,
    /// 重定向后的最终 URL
    pub url: String,
    pub content_type: String,
    /// 结构化 Markdown 文本（标题/列表/链接保留结构；纯文本/JSON 原样返回）
    pub text: String,
    /// 各级标题文本（h1–h6）
    pub headings: Vec<String>,
    /// 页面内绝对链接（去重、去 fragment）
    pub links: Vec<WebLink>,
    pub truncated: bool,
}

/// web_crawl 的单个页面。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrawlPage {
    pub title: String,
    pub url: String,
    pub text: String,
    pub headings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCrawlResponse {
    pub pages: Vec<CrawlPage>,
    /// 达到页数上限提前停止时为 true
    pub truncated: bool,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))
}

/// 简单 URL 百分号编码（保留 RFC3986 非保留字符，空格 → `+`）。
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 百分号解码（用于 DuckDuckGo 的 uddg 跳转参数）。
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8(out).ok()
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

/// HTML → 可读纯文本：去掉 script/style/head、块级标签转换行、剥标签、实体解码、空白折叠。
fn html_to_text(html: &str) -> String {
    let mut s = html.to_string();
    for tag in ["script", "style", "noscript", "head", "svg"] {
        if let Ok(re) = Regex::new(&format!(r"(?is)<{tag}\b[^>]*>.*?</{tag}>")) {
            s = re.replace_all(&s, " ").to_string();
        }
    }
    if let Ok(re) = Regex::new(r"(?i)</(p|div|li|tr|h[1-6]|article|section|blockquote|pre|br)>") {
        s = re.replace_all(&s, "\n").to_string();
    }
    if let Ok(re) = Regex::new(r"<[^>]+>") {
        s = re.replace_all(&s, " ").to_string();
    }
    s = decode_entities(&s);
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// HTML → 结构化 Markdown：标题/列表/代码/链接保留结构，正文按段落分行。
fn html_to_markdown(html: &str) -> String {
    let mut s = html.to_string();
    // 去掉非正文块
    for tag in ["script", "style", "noscript", "head", "svg", "iframe", "form", "nav", "footer"] {
        if let Ok(re) = Regex::new(&format!(r"(?is)<{tag}\b[^>]*>.*?</{tag}>")) {
            s = re.replace_all(&s, " ").to_string();
        }
    }
    // pre → fenced code block
    if let Ok(re) = Regex::new(r"(?is)<pre\b[^>]*>(.*?)</pre>") {
        s = re
            .replace_all(&s, |c: &regex::Captures| {
                let inner = html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or(""));
                format!("\n```\n{}\n```\n", inner)
            })
            .to_string();
    }
    // code → 行内代码
    if let Ok(re) = Regex::new(r"(?is)<code\b[^>]*>(.*?)</code>") {
        s = re
            .replace_all(&s, |c: &regex::Captures| {
                let inner = html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or(""));
                format!("`{inner}`")
            })
            .to_string();
    }
    // 标题 h1–h6 → # … ######（单遍匹配保文档顺序；闭合标签用通用 h[1-6]，假定良构 HTML）
    if let Ok(re) = Regex::new(r"(?is)<(h[1-6])\b[^>]*>(.*?)</h[1-6]>") {
        s = re
            .replace_all(&s, |c: &regex::Captures| {
                let tag = c.get(1).map(|m| m.as_str()).unwrap_or("h1");
                let level = tag[1..].parse::<usize>().unwrap_or(1).clamp(1, 6);
                let text = html_to_text(c.get(2).map(|m| m.as_str()).unwrap_or(""));
                format!("\n{} {}\n", "#".repeat(level), text)
            })
            .to_string();
    }
    // 列表项 → - item
    if let Ok(re) = Regex::new(r"(?is)<li\b[^>]*>(.*?)</li>") {
        s = re
            .replace_all(&s, |c: &regex::Captures| {
                let text = html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or(""));
                format!("\n- {text}\n")
            })
            .to_string();
    }
    // 链接 → [text](href)
    if let Ok(re) = Regex::new(r#"(?is)<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#) {
        s = re
            .replace_all(&s, |c: &regex::Captures| {
                let href = c.get(1).map(|m| m.as_str()).unwrap_or("").trim();
                let text = html_to_text(c.get(2).map(|m| m.as_str()).unwrap_or(""));
                if href.is_empty() || href.starts_with('#') || href.starts_with("javascript:") {
                    text
                } else {
                    format!("[{text}]({href})")
                }
            })
            .to_string();
    }
    // 块级闭合标签 → 换行
    if let Ok(re) = Regex::new(r"(?i)</(p|div|li|tr|h[1-6]|article|section|blockquote|br|pre|table|ul|ol)>") {
        s = re.replace_all(&s, "\n").to_string();
    }
    // 行内格式标签直接剥除（不留空格，避免「正文 加粗」断词）
    if let Ok(re) = Regex::new(r"(?i)</?(b|i|u|em|strong|span|small|mark|sub|sup|del|ins)\b[^>]*>") {
        s = re.replace_all(&s, "").to_string();
    }
    // 剥剩余标签
    if let Ok(re) = Regex::new(r"<[^>]+>") {
        s = re.replace_all(&s, " ").to_string();
    }
    s = decode_entities(&s);

    // 逐行 trim + 折叠连续空行
    let mut out = String::new();
    let mut blank = 0usize;
    for line in s.lines() {
        let t = line.trim();
        if t.is_empty() {
            if blank == 0 {
                out.push('\n');
            }
            blank += 1;
        } else {
            out.push_str(t);
            out.push('\n');
            blank = 0;
        }
    }
    out.trim().to_string()
}

fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn extract_title(html: &str) -> String {
    Regex::new(r"(?is)<title[^>]*>(.*?)</title>")
        .ok()
        .and_then(|re| re.captures(html).map(|c| html_to_text(&c[1])))
        .unwrap_or_default()
}

/// 各级标题文本（h1–h6，按出现顺序）。
fn extract_headings(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(re) = Regex::new(r"(?is)<(h[1-6])\b[^>]*>(.*?)</h[1-6]>") {
        for c in re.captures_iter(html) {
            let t = html_to_text(c.get(2).map(|m| m.as_str()).unwrap_or(""));
            if !t.is_empty() {
                out.push(t);
            }
        }
    }
    out
}

/// 去掉 URL fragment 作为去重键（crawler 用）。
fn normalize_url(url: &str) -> String {
    match Url::parse(url) {
        Ok(mut u) => {
            u.set_fragment(None);
            u.to_string()
        }
        Err(_) => url.trim_end_matches('/').to_string(),
    }
}

/// 提取页面内绝对链接（相对链接按 base 解析；去 fragment 去重；可限同域）。
fn extract_links(html: &str, base: &str, same_domain: bool) -> Vec<WebLink> {
    let Ok(re) = Regex::new(r#"(?is)<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#) else {
        return Vec::new();
    };
    let base_url = Url::parse(base).ok();
    let base_host = base_url
        .as_ref()
        .and_then(|u| u.host_str().map(|h| h.to_string()));
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for c in re.captures_iter(html) {
        let href = c.get(1).map(|m| m.as_str()).unwrap_or("").trim();
        let text = html_to_text(c.get(2).map(|m| m.as_str()).unwrap_or(""));
        if text.trim().is_empty() {
            continue;
        }
        let resolved = match &base_url {
            Some(b) => match b.join(href) {
                Ok(mut u) => {
                    if same_domain {
                        if let (Some(h1), Some(h2)) = (u.host_str(), base_host.as_deref()) {
                            if h1 != h2 {
                                continue;
                            }
                        }
                    }
                    u.set_fragment(None);
                    u.to_string()
                }
                Err(_) => continue,
            },
            None => href.to_string(),
        };
        if !(resolved.starts_with("http://") || resolved.starts_with("https://")) {
            continue;
        }
        if seen.insert(resolved.clone()) {
            out.push(WebLink { text, url: resolved });
        }
        if out.len() >= 100 {
            break;
        }
    }
    out
}

/// DuckDuckGo 结果链接通常是 `//duckduckgo.com/l/?uddg=<urlencoded>&rut=...`，
/// 取 uddg 参数还原真实目标 URL。
fn resolve_duckduckgo_url(href: &str) -> String {
    if let Some(pos) = href.find("uddg=") {
        let rest = &href[pos + 5..];
        let end = rest.find('&').unwrap_or(rest.len());
        if let Some(decoded) = percent_decode(&rest[..end]) {
            return decoded;
        }
    }
    href.to_string()
}

/// 从 DuckDuckGo HTML 提取 title/url/snippet；结构变化时可能返回空。
fn parse_duckduckgo(html: &str, n: usize) -> Vec<WebResultItem> {
    let link_re = Regex::new(
        r#"(?is)<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#,
    );
    let snip_re = Regex::new(
        r#"(?is)<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>"#,
    );
    let (Ok(link_re), Ok(snip_re)) = (link_re, snip_re) else {
        return Vec::new();
    };
    let links: Vec<(String, String)> = link_re
        .captures_iter(html)
        .map(|c| (resolve_duckduckgo_url(&c[1]), html_to_text(&c[2])))
        .collect();
    let snips: Vec<String> = snip_re
        .captures_iter(html)
        .map(|c| html_to_text(&c[1]))
        .collect();

    let mut out = Vec::new();
    let count = links.len().min(snips.len()).min(n);
    for i in 0..count {
        let (url, title) = &links[i];
        let content = &snips[i];
        if title.trim().is_empty() && content.trim().is_empty() {
            continue;
        }
        out.push(WebResultItem {
            title: title.clone(),
            url: url.clone(),
            content: truncate_chars(content, 300),
        });
    }
    out
}

/// 无 key 搜索：抓 DuckDuckGo HTML 结果页并解析；解析失败退化为整页可读文本。
#[tauri::command]
pub async fn web_search(query: String, max_results: Option<u32>) -> Result<WebSearchResponse, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Err("搜索词不能为空".to_string());
    }
    let n = max_results.unwrap_or(5).clamp(1, 8) as usize;
    let url = format!("https://html.duckduckgo.com/html/?q={}", url_encode(&q));
    let client = http_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求 DuckDuckGo 失败：{e}"))?;
    let status = resp.status();
    let html = resp.text().await.map_err(|e| format!("读取响应失败：{e}"))?;
    if !status.is_success() {
        let cap = html.len().min(300);
        return Err(format!("DuckDuckGo 返回 {status}：{}", &html[..cap]));
    }
    let results = parse_duckduckgo(&html, n);
    if results.is_empty() {
        // 解析失败（结构变化/验证页）：整页可读文本作为单条结果，模型仍可自行提炼
        let text = truncate_chars(&html_to_text(&html), 4000);
        return Ok(WebSearchResponse {
            results: vec![WebResultItem { title: q, url, content: text }],
        });
    }
    Ok(WebSearchResponse { results })
}

/// webfetch：抓取任意 URL → 结构化 Markdown 文本（一等工具，与 read_file 同级）。
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<WebFetchResponse, String> {
    let u = url.trim().to_string();
    if u.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("仅支持 http/https URL".to_string());
    }
    let client = http_client()?;
    let resp = client.get(&u).send().await.map_err(|e| format!("请求失败：{e}"))?;
    let final_url = resp.url().to_string();
    let status = resp.status();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = resp.text().await.map_err(|e| format!("读取响应失败：{e}"))?;
    if !status.is_success() {
        let cap = body.len().min(300);
        return Err(format!("返回 {status}：{}", &body[..cap]));
    }
    let is_html = content_type.contains("text/html") || body.trim_start().starts_with('<');
    let title = if is_html { extract_title(&body) } else { String::new() };
    let headings = if is_html { extract_headings(&body) } else { Vec::new() };
    let links = if is_html { extract_links(&body, &final_url, false) } else { Vec::new() };
    let full_text = if is_html { html_to_markdown(&body) } else { body.clone() };
    let truncated = full_text.chars().count() > FETCH_TEXT_CAP;
    let text = truncate_chars(&full_text, FETCH_TEXT_CAP);
    Ok(WebFetchResponse {
        title,
        url: final_url,
        content_type,
        text,
        headings,
        links,
        truncated,
    })
}

/// web_crawl：从起始 URL 广度优先爬取，逐页结构化（同域、限深度/页数）。
#[tauri::command]
pub async fn web_crawl(
    start_url: String,
    max_pages: Option<u32>,
    max_depth: Option<u32>,
    same_domain: Option<bool>,
) -> Result<WebCrawlResponse, String> {
    let start = start_url.trim().to_string();
    if start.is_empty() {
        return Err("起始 URL 不能为空".to_string());
    }
    if !(start.starts_with("http://") || start.starts_with("https://")) {
        return Err("仅支持 http/https URL".to_string());
    }
    let max_pages = max_pages.unwrap_or(10).clamp(1, 30) as usize;
    let max_depth = max_depth.unwrap_or(2).clamp(1, 4) as usize;
    let same_domain = same_domain.unwrap_or(true);
    let client = http_client()?;

    let mut pages: Vec<CrawlPage> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(String, usize)> = VecDeque::new();
    queue.push_back((start, 0));
    let mut truncated = false;

    while let Some((url, depth)) = queue.pop_front() {
        if pages.len() >= max_pages {
            truncated = true;
            break;
        }
        let key = normalize_url(&url);
        if !visited.insert(key) {
            continue;
        }
        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => continue, // 单页失败不中断整次爬取
        };
        if !resp.status().is_success() {
            continue;
        }
        let final_url = resp.url().to_string();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = match resp.text().await {
            Ok(b) => b,
            Err(_) => continue,
        };
        let is_html = content_type.contains("text/html") || body.trim_start().starts_with('<');
        let title = if is_html { extract_title(&body) } else { String::new() };
        let headings = if is_html { extract_headings(&body) } else { Vec::new() };
        let text = if is_html {
            truncate_chars(&html_to_markdown(&body), CRAWL_PAGE_CAP)
        } else {
            truncate_chars(&body, CRAWL_PAGE_CAP)
        };
        pages.push(CrawlPage {
            title,
            url: final_url.clone(),
            text,
            headings,
        });

        // 未达深度上限才继续扩展同页链接
        if depth < max_depth && is_html {
            for link in extract_links(&body, &final_url, same_domain) {
                let lkey = normalize_url(&link.url);
                let already_queued = queue.iter().any(|(u, _)| normalize_url(u) == lkey);
                if !visited.contains(&lkey) && !already_queued {
                    queue.push_back((link.url, depth + 1));
                }
            }
        }
    }
    Ok(WebCrawlResponse { pages, truncated })
}

// ── 技能清单（统一协议 vrykell-skills/v1） ──

/// 网络技能清单里的单条技能。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteSkill {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub version: String,
    pub author: String,
}

impl Default for RemoteSkill {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: String::new(),
            prompt: String::new(),
            version: String::new(),
            author: String::new(),
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct SkillRegistryManifest {
    protocol: String,
    skills: Vec<RemoteSkill>,
}

/// 解析技能清单：兼容裸数组 `[...]` 或 `{ protocol, skills: [...] }`。
fn parse_skill_registry(body: &str) -> Result<Vec<RemoteSkill>, String> {
    if let Ok(list) = serde_json::from_str::<Vec<RemoteSkill>>(body) {
        return Ok(list);
    }
    let manifest: SkillRegistryManifest =
        serde_json::from_str(body).map_err(|e| format!("技能清单解析失败：{e}"))?;
    if !manifest.protocol.is_empty() && manifest.protocol != "vrykell-skills/v1" {
        return Err(format!("不支持的技能协议版本：{}", manifest.protocol));
    }
    if manifest.skills.is_empty() {
        return Err("技能清单为空".to_string());
    }
    Ok(manifest.skills)
}

/// 通过统一协议从网络获取技能清单。
#[tauri::command]
pub async fn fetch_skill_registry(url: String) -> Result<Vec<RemoteSkill>, String> {
    let u = url.trim().to_string();
    if u.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("仅支持 http/https URL".to_string());
    }
    let client = http_client()?;
    let resp = client.get(&u).send().await.map_err(|e| format!("请求失败：{e}"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败：{e}"))?;
    if !status.is_success() {
        let cap = body.len().min(300);
        return Err(format!("返回 {status}：{}", &body[..cap]));
    }
    parse_skill_registry(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_to_text_strips_tags_and_collapses() {
        let html = "<html><head><style>a{}</style></head><body><script>x()</script><p>Hello <b>world</b></p><p>Foo &amp; bar</p></body></html>";
        let t = html_to_text(html);
        assert!(t.contains("Hello world"));
        assert!(t.contains("Foo & bar"));
        assert!(!t.contains("<p>"));
        assert!(!t.contains("a{}"));
    }

    #[test]
    fn truncate_is_utf8_safe() {
        assert_eq!(truncate_chars("你好世界", 2), "你好");
    }

    #[test]
    fn resolves_uddg_redirect() {
        let href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&rut=xx";
        assert_eq!(resolve_duckduckgo_url(href), "https://example.com/a?b=1");
    }

    #[test]
    fn url_encode_spaces_and_symbols() {
        assert_eq!(url_encode("hello world"), "hello+world");
        assert_eq!(url_encode("a/b?c=d"), "a%2Fb%3Fc%3Dd");
    }

    #[test]
    fn markdown_preserves_structure() {
        let html = "<h1>标题</h1><p>正文<b>加粗</b></p><ul><li>项一</li><li>项二</li></ul><a href=\"https://x.com/a\">链接</a>";
        let md = html_to_markdown(html);
        assert!(md.contains("# 标题"));
        assert!(md.contains("正文加粗"));
        assert!(md.contains("- 项一"));
        assert!(md.contains("- 项二"));
        assert!(md.contains("[链接](https://x.com/a)"));
    }

    #[test]
    fn markdown_drops_script_and_nav() {
        let html = "<nav>菜单</nav><script>bad()</script><p>正文</p>";
        let md = html_to_markdown(html);
        assert!(md.contains("正文"));
        assert!(!md.contains("菜单"));
        assert!(!md.contains("bad"));
    }

    #[test]
    fn extract_headings_collects_in_order() {
        let html = "<h2>二</h2><h1>一</h1><h3>三</h3>";
        assert_eq!(extract_headings(html), vec!["二", "一", "三"]);
    }

    #[test]
    fn extract_links_resolves_relative_and_dedups() {
        let html = "<a href=\"/a\">A</a><a href=\"b\">B</a><a href=\"#top\">锚点</a><a href=\"https://other.com/x\">外域</a>";
        let base = "https://example.com/docs/page.html";
        // 同域：外域被过滤；#top 折叠成当前页，与起始无关，但会被去重保留
        let links = extract_links(html, base, true);
        let urls: Vec<&str> = links.iter().map(|l| l.url.as_str()).collect();
        assert!(urls.contains(&"https://example.com/a"));
        assert!(urls.contains(&"https://example.com/docs/b"));
        assert!(!urls.iter().any(|u| u.contains("other.com")));
    }

    #[test]
    fn normalize_url_strips_fragment() {
        assert_eq!(
            normalize_url("https://example.com/a/b#sec"),
            "https://example.com/a/b"
        );
    }

    #[test]
    fn skill_registry_parses_manifest_and_bare_array() {
        let m = r#"{ "protocol": "vrykell-skills/v1", "skills": [ { "name": "a", "description": "d", "prompt": "p" } ] }"#;
        let list = parse_skill_registry(m).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "a");
        assert_eq!(list[0].description, "d");

        let bare = r#"[ { "name": "b", "description": "x", "prompt": "y" } ]"#;
        let list2 = parse_skill_registry(bare).unwrap();
        assert_eq!(list2[0].name, "b");
    }

    #[test]
    fn skill_registry_rejects_unknown_protocol() {
        let m = r#"{ "protocol": "other/v2", "skills": [ { "name": "a", "description": "d", "prompt": "p" } ] }"#;
        assert!(parse_skill_registry(m).unwrap_err().contains("协议"));
    }
}
