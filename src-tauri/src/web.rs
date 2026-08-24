//! 无 key 的联网能力（M6 兜底）：
//!   - `web_search`：DuckDuckGo HTML 抓取（不依赖 Tavily/原生搜索）。
//!   - `web_fetch`：抓取任意 URL 并转成可读文本（webfetch 技能）。
//!
//! 两者都走 Rust 的 reqwest 直连，key/令牌不出 webview；抓取结果转纯文本截断，
//! 供模型阅读与 ToolRunCard 展开展示。

use regex::Regex;
use serde::Serialize;
use std::time::Duration;

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResponse {
    pub title: String,
    pub text: String,
    pub url: String,
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

/// HTML → 可读文本：去掉 script/style/head、块级标签转换行、剥标签、实体解码、空白折叠。
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

fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn extract_title(html: &str) -> String {
    Regex::new(r"(?is)<title[^>]*>(.*?)</title>")
        .ok()
        .and_then(|re| re.captures(html).map(|c| html_to_text(&c[1])))
        .unwrap_or_default()
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

/// webfetch：抓取任意 URL → 可读文本（webfetch 技能）。
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<WebFetchResponse, String> {
    let u = url.trim().to_string();
    if u.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    let client = http_client()?;
    let resp = client.get(&u).send().await.map_err(|e| format!("请求失败：{e}"))?;
    let final_url = resp.url().to_string();
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败：{e}"))?;
    if !status.is_success() {
        let cap = body.len().min(300);
        return Err(format!("返回 {status}：{}", &body[..cap]));
    }
    let title = extract_title(&body);
    let text = truncate_chars(&html_to_text(&body), 8000);
    Ok(WebFetchResponse { title, text, url: final_url })
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
}
