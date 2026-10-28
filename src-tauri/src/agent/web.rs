//! Network access without an API key (first-class tools):
//!   - `web_search`: DuckDuckGo HTML scraping (no search API or native search dependency).
//!   - `web_fetch`: fetch any URL and return structured Markdown text (heading hierarchy and links preserved).
//!   - `web_crawl`: breadth-first crawl from a starting URL (same domain, depth and page limits), structured per page.
//!
//! All requests go directly through Rust's reqwest, so keys and tokens never enter the webview; results
//! become truncated structured text for the model to read and for the ToolRunCard to expand.

use futures_util::StreamExt;
use regex::Regex;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use url::Url;

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/// Character limit for structured web_fetch text.
const FETCH_TEXT_CAP: usize = 24_000;
/// Character limit for a single web_crawl page.
const CRAWL_PAGE_CAP: usize = 8_000;
/// Response body limit in bytes. Excess is streamed and discarded to keep malicious or unexpectedly large responses from exhausting memory.
const FETCH_BODY_CAP: usize = 10 * 1024 * 1024;

/// Read the response body as a stream and stop at max_bytes (returning over=true).
/// Do not read everything via `resp.text()/bytes()` and check afterwards: memory is exhausted during the read.
pub(crate) async fn read_body_capped(
    resp: reqwest::Response,
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut body = Vec::with_capacity(max_bytes.min(1024 * 1024));
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取响应失败：{e}"))?;
        let room = max_bytes.saturating_sub(body.len());
        if room == 0 {
            return Ok((body, true));
        }
        let take = chunk.len().min(room);
        body.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            return Ok((body, true));
        }
    }
    Ok((body, false))
}

/// One search or fetch result.
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

/// A hyperlink found on a page (for structured output).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebLink {
    pub text: String,
    pub url: String,
}

/// web_fetch result: structured text plus metadata.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResponse {
    pub title: String,
    /// Final URL after redirects
    pub url: String,
    pub content_type: String,
    /// Structured Markdown text (headings, lists and links keep their structure; plain text and JSON are returned as-is)
    pub text: String,
    /// Heading text at each level (h1–h6)
    pub headings: Vec<String>,
    /// Absolute links on the page (deduplicated, fragments removed)
    pub links: Vec<WebLink>,
    pub truncated: bool,
}

/// One page from web_crawl.
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
    /// True when crawling stopped early at the page limit
    pub truncated: bool,
}

fn http_client() -> Result<reqwest::Client, String> {
    http_client_impl(true)
}

/// Client with follow_redirects=false: fetch_public validates every redirect hop to prevent SSRF.
pub(crate) fn http_client_impl(follow_redirects: bool) -> Result<reqwest::Client, String> {
    http_client_impl_ext(follow_redirects, true)
}

/// Client for trusted endpoints (skill marketplace GitHub API/raw): pins DNS only, without private-network validation.
/// Hosts are constrained by the is_github_host allowlist, so DNS-level blocking is unnecessary.
pub(crate) fn http_client_trusted() -> Result<reqwest::Client, String> {
    http_client_impl_ext(false, false)
}

fn http_client_impl_ext(follow_redirects: bool, validate_dns: bool) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent(USER_AGENT)
        // DNS pinning: resolve once, validate and cache, then reuse the same result for connections to prevent alternating answers (rebinding)
        .dns_resolver(std::sync::Arc::new(PinnedResolver::new(validate_dns, proxy_hostnames())));
    if !follow_redirects {
        b = b.redirect(reqwest::redirect::Policy::none());
    }
    // Honor proxy environment variables (HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/NO_PROXY).
    // Returns None when no proxy is set, keeping direct connections.
    if let Some(proxy) = env_system_proxy() {
        b = b.proxy(proxy);
    }
    b.build().map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))
}

/// Proxy hosts configured through environment variables (trusted by the user, excluded from private-network validation).
fn proxy_hostnames() -> HashSet<String> {
    let mut set = HashSet::new();
    for k in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
        let Some(v) = env_nonempty(k) else { continue };
        let host = if let Ok(u) = url::Url::parse(&v) {
            u.host_str().map(|s| s.to_string())
        } else {
            // Bare host:port address (no scheme)
            v.split(':').next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        };
        if let Some(h) = host {
            set.insert(h.to_lowercase());
        }
    }
    set
}

/// DNS pinning cache: domain name → verified public addresses (reused within the TTL).
type DnsCache = std::sync::Arc<Mutex<HashMap<String, (Instant, Vec<std::net::SocketAddr>)>>>;

/// DNS-pinning resolver: resolve once → validate (reject private networks) → cache (reuse within the TTL).
///
/// Prevents DNS rebinding attacks: the public addresses seen during validation are cached and used
/// directly for connections, so switching the domain to a private IP after validation cannot succeed —
/// connections use the verified cached result.
struct PinnedResolver {
    cache: DnsCache,
    /// Whether to validate resolution results (false = trusted endpoint, pinning only)
    validate: bool,
    /// User-configured proxy hosts: the proxy itself is trusted by the user, so it is not validated
    trusted_hosts: HashSet<String>,
}

impl PinnedResolver {
    fn new(validate: bool, trusted_hosts: HashSet<String>) -> Self {
        Self {
            cache: std::sync::Arc::new(Mutex::new(HashMap::new())),
            validate,
            trusted_hosts,
        }
    }
}

/// Validate resolution results: reject when any address resolves to a private network (including IPv4-mapped IPv6).
fn validate_resolved(host: &str, addrs: &[std::net::SocketAddr]) -> Result<(), String> {
    if addrs.is_empty() {
        return Err("域名解析无结果".to_string());
    }
    if addrs.iter().any(|a| is_private_ip(a.ip())) {
        return Err(format!("禁止访问解析到内网的地址：{host}"));
    }
    Ok(())
}

/// DNS pinning TTL: connections reuse the verified result during this window, leaving no room for alternating answers.
/// Re-resolving after expiry validates again (it may be briefly unavailable, but it never bypasses validation).
const DNS_PIN_TTL: Duration = Duration::from_secs(300);

impl Resolve for PinnedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_lowercase();
        let trusted = self.trusted_hosts.contains(&host);
        let validate = self.validate && !trusted;
        let cache = std::sync::Arc::clone(&self.cache);
        Box::pin(async move {
            // Cache hit and not expired → reuse the verified result directly (the core of pinning)
            {
                let c = cache.lock().unwrap();
                if let Some((at, addrs)) = c.get(&host) {
                    if at.elapsed() < DNS_PIN_TTL {
                        return Ok(Box::new(addrs.clone().into_iter()) as Addrs);
                    }
                }
            }
            let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|e| format!("域名解析失败：{e}"))?
                .collect();
            if validate {
                validate_resolved(&host, &addrs)?;
            }
            cache.lock().unwrap().insert(host.clone(), (Instant::now(), addrs.clone()));
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

fn env_nonempty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Build the system proxy from environment variables (same reading rules as proxy_configured_for).
fn env_system_proxy() -> Option<reqwest::Proxy> {
    let all = env_nonempty("ALL_PROXY").or_else(|| env_nonempty("all_proxy"));
    let https = env_nonempty("HTTPS_PROXY").or_else(|| env_nonempty("https_proxy")).or_else(|| all.clone());
    let http = env_nonempty("HTTP_PROXY").or_else(|| env_nonempty("http_proxy")).or_else(|| all.clone());
    if https.is_none() && http.is_none() {
        return None;
    }
    let proxy = reqwest::Proxy::custom(move |u| match u.scheme() {
        "https" => https.clone(),
        _ => http.clone(),
    });
    Some(proxy.no_proxy(reqwest::NoProxy::from_env()))
}

/// Whether the target (scheme, host) is reached through a remote-resolving proxy (reads environment variables).
///
/// Remote-resolving proxies (HTTP(S) forward proxies, socks4a/socks5h) resolve the target domain themselves,
/// so local DNS results do not reflect the actual connection target and SSRF validation should skip the
/// local DNS → private-network blocking step. But socks4/socks5 resolve locally before tunnelling, so the
/// connection still targets the local result and validation must stay — otherwise domains resolving to a
/// private network would pass.
///
/// When NO_PROXY contains IP or CIDR entries, a direct private-network connection that bypasses the proxy
/// cannot be ruled out, so treat it conservatively as direct (keep DNS validation) and avoid bypasses caused
/// by divergence between reqwest and the validation logic.
fn proxy_does_remote_dns_for(scheme: &str, host: &str) -> bool {
    let mut keys: Vec<&str> = Vec::new();
    if scheme.eq_ignore_ascii_case("https") {
        keys.extend(["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]);
    } else {
        keys.extend(["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]);
    }
    let Some(proxy) = keys.iter().find_map(|k| env_nonempty(k)) else {
        return false;
    };
    // NO_PROXY: a matching entry (exact/subdomain/leading dot) → direct connection, keep DNS validation
    let no_proxy = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();
    if no_proxy.trim() == "*" {
        return false;
    }
    let h = host.to_lowercase();
    let mut has_ip_entry = false;
    for e in no_proxy.split(',').map(|s| s.trim().to_lowercase()) {
        if e.is_empty() {
            continue;
        }
        // IP or CIDR entry: the domain could resolve to these addresses and bypass the proxy → treat as direct, conservatively
        if e.parse::<std::net::IpAddr>().is_ok() || e.contains('/') {
            has_ip_entry = true;
            continue;
        }
        if h == e || h.ends_with(&format!(".{e}")) || (e.starts_with('.') && h.ends_with(&e)) {
            return false;
        }
    }
    if has_ip_entry {
        return false;
    }
    // Proxy type: only remote-resolving proxies take over domain resolution
    let Ok(u) = url::Url::parse(&proxy) else {
        return true; // Bare address (host:port) is treated as an HTTP forward proxy
    };
    matches!(u.scheme(), "http" | "https" | "socks4a" | "socks5h")
}

/// Whether an address is private or reserved (SSRF protection).
fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_multicast()
        }
        std::net::IpAddr::V6(v6) => {
            // IPv4-mapped IPv6 (::ffff:127.0.0.1 and similar): the connection lands on the corresponding
            // IPv4 address, so it must be judged with IPv4 semantics or private-network blocking can be bypassed
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private_ip(std::net::IpAddr::V4(v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_multicast()
        }
    }
}

/// Validate that a URL points to a public address (blocks SSRF: private networks, loopback, link-local, credentials).
async fn validate_public_url(url: &str) -> Result<(), String> {
    let u = url::Url::parse(url).map_err(|e| format!("无效 URL：{e}"))?;
    let scheme = u.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("仅支持 http/https URL".to_string());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("URL 不允许包含账号信息".to_string());
    }
    let host = u.host_str().ok_or("URL 缺少主机名")?;
    // Literal IP: block private addresses whether or not a proxy is used (the strongest SSRF signal, unaffected by DNS)
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if is_private_ip(ip) {
            return Err("禁止访问内网地址".to_string());
        }
        return Ok(());
    }
    // Through a remote-resolving proxy (http/https forward, socks4a/socks5h): the proxy resolves the domain,
    // local DNS does not reflect the connection target, and blocking on local results would break proxy users, so skip it.
    // socks4/socks5 (local resolution) and direct connections are still validated.
    if proxy_does_remote_dns_for(scheme, host) {
        return Ok(());
    }
    // Direct connection: resolve with local DNS and block private results (prevents DNS rebinding and private-service probing)
    let port = u.port().unwrap_or_else(|| if scheme == "https" { 443 } else { 80 });
    let addrs: Vec<std::net::IpAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("域名解析失败：{e}"))?
        .map(|a| a.ip())
        .collect();
    if addrs.is_empty() {
        return Err("域名解析无结果".to_string());
    }
    if addrs.iter().any(|ip| is_private_ip(*ip)) {
        return Err("禁止访问解析到内网的地址".to_string());
    }
    Ok(())
}

/// Fetch hop by hop (redirects are checked by the validator supplied by the caller).
async fn fetch_with_validation<F>(
    client: &reqwest::Client,
    url: &str,
    mut validate: F,
) -> Result<reqwest::Response, String>
where
    F: FnMut(&str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + '_>>,
{
    let mut current = url.to_string();
    for _ in 0..10 {
        validate(&current).await?;
        let resp = client
            .get(&current)
            .send()
            .await
            .map_err(|e| format!("请求失败：{e}"))?;
        if !resp.status().is_redirection() {
            return Ok(resp);
        }
        let loc = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .ok_or("重定向响应缺少 Location")?;
        current = url::Url::parse(&current)
            .map_err(|e| format!("解析 URL 失败：{e}"))?
            .join(loc)
            .map_err(|e| format!("解析重定向失败：{e}"))?
            .to_string();
    }
    Err("重定向次数过多".to_string())
}

/// Public fetch that validates every redirect hop (SSRF protection).
pub(crate) async fn fetch_public(client: &reqwest::Client, url: &str) -> Result<reqwest::Response, String> {
    fetch_with_validation(client, url, |u| Box::pin(validate_public_url(u))).await
}

/// GitHub-related host allowlist: both the first hop and redirects of an unchecked fetch must stay on these hosts.
fn is_github_host(host: &str) -> bool {
    let h = host.to_lowercase();
    [
        "github.com",
        "api.github.com",
        "raw.githubusercontent.com",
        "objects.githubusercontent.com",
        "githubusercontent.com",
    ]
    .iter()
    .any(|d| h == *d || h.ends_with(&format!(".{d}")))
}

/// Fetch without SSRF validation. Only for trusted endpoints with a **hardcoded hostname** (such as
/// skill marketplace GitHub API/raw files): user input only reaches path segments and never becomes a hostname.
/// Redirects are likewise restricted to GitHub domains, so the "hardcoded host" promise cannot be broken by a redirect.
/// Arbitrary URLs from the user or the LLM must go through `fetch_public`.
pub(crate) async fn fetch_public_unchecked(client: &reqwest::Client, url: &str) -> Result<reqwest::Response, String> {
    fetch_with_validation(client, url, |u| {
        Box::pin(async move {
            let parsed = url::Url::parse(u).map_err(|_| "无效 URL".to_string())?;
            let host = parsed.host_str().ok_or("URL 缺少主机名")?.to_string();
            if is_github_host(&host) {
                Ok(())
            } else {
                Err(format!("仅允许访问 GitHub 域名，当前主机：{host}"))
            }
        })
    })
    .await
}

/// Simple URL percent-encoding (keeps RFC3986 unreserved characters, spaces become `+`).
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

/// Percent-decoding (for DuckDuckGo's uddg redirect parameter).
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

/// HTML → readable plain text: remove script/style/head, turn block tags into newlines, strip tags, decode entities and collapse whitespace.
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

/// HTML → structured Markdown: headings, lists, code and links keep their structure; body text is split into paragraphs.
fn html_to_markdown(html: &str) -> String {
    let mut s = html.to_string();
    // Remove non-content blocks
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
    // code → inline code
    if let Ok(re) = Regex::new(r"(?is)<code\b[^>]*>(.*?)</code>") {
        s = re
            .replace_all(&s, |c: &regex::Captures| {
                let inner = html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or(""));
                format!("`{inner}`")
            })
            .to_string();
    }
    // Headings h1–h6 → # … ###### (a single pass keeps document order; closing tags use a generic h[1-6], assuming well-formed HTML)
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
    // List item → - item
    if let Ok(re) = Regex::new(r"(?is)<li\b[^>]*>(.*?)</li>") {
        s = re
            .replace_all(&s, |c: &regex::Captures| {
                let text = html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or(""));
                format!("\n- {text}\n")
            })
            .to_string();
    }
    // Link → [text](href)
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
    // Block closing tags → newline
    if let Ok(re) = Regex::new(r"(?i)</(p|div|li|tr|h[1-6]|article|section|blockquote|br|pre|table|ul|ol)>") {
        s = re.replace_all(&s, "\n").to_string();
    }
    // Strip inline formatting tags without leaving spaces, so words around them stay joined
    if let Ok(re) = Regex::new(r"(?i)</?(b|i|u|em|strong|span|small|mark|sub|sup|del|ins)\b[^>]*>") {
        s = re.replace_all(&s, "").to_string();
    }
    // Strip remaining tags
    if let Ok(re) = Regex::new(r"<[^>]+>") {
        s = re.replace_all(&s, " ").to_string();
    }
    s = decode_entities(&s);

    // Trim each line and collapse consecutive blank lines
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

/// Heading text at each level (h1–h6, in document order).
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

/// Remove the URL fragment to form a deduplication key (used by the crawler).
fn normalize_url(url: &str) -> String {
    match Url::parse(url) {
        Ok(mut u) => {
            u.set_fragment(None);
            u.to_string()
        }
        Err(_) => url.trim_end_matches('/').to_string(),
    }
}

/// Extract absolute links from a page (relative links resolve against base; fragments removed before deduplication; optionally same-domain only).
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

/// DuckDuckGo result links are usually `//duckduckgo.com/l/?uddg=<urlencoded>&rut=...`;
/// return the real target URL from the uddg parameter.
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

/// Extract title/url/snippet from DuckDuckGo HTML; may return empty when the structure changes.
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

/// Keyless search: fetch and parse the DuckDuckGo HTML results page; if parsing fails, fall back to the readable page text.
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
    let html = {
        let (bytes, over) = read_body_capped(resp, FETCH_BODY_CAP).await?;
        if over {
            return Err("响应体超过 10MB，已拒绝".to_string());
        }
        String::from_utf8_lossy(&bytes).into_owned()
    };
    if !status.is_success() {
        return Err(format!("DuckDuckGo 返回 {status}：{}", truncate_chars(&html, 300)));
    }
    let results = parse_duckduckgo(&html, n);
    if results.is_empty() {
        // Parsing failed (structure change or challenge page): return the readable page text as one result so the model can still extract what it needs
        let text = truncate_chars(&html_to_text(&html), 4000);
        return Ok(WebSearchResponse {
            results: vec![WebResultItem { title: q, url, content: text }],
        });
    }
    Ok(WebSearchResponse { results })
}

/// web_fetch: fetch any URL → structured Markdown text (a first-class tool on par with read_file).
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<WebFetchResponse, String> {
    let u = url.trim().to_string();
    if u.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("仅支持 http/https URL".to_string());
    }
    let client = http_client_impl(false)?;
    let resp = fetch_public(&client, &u).await?;
    let final_url = resp.url().to_string();
    let status = resp.status();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = {
        let (bytes, over) = read_body_capped(resp, FETCH_BODY_CAP).await?;
        if over {
            return Err("响应体超过 10MB，已拒绝".to_string());
        }
        String::from_utf8_lossy(&bytes).into_owned()
    };
    if !status.is_success() {
        return Err(format!("返回 {status}：{}", truncate_chars(&body, 300)));
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

/// web_crawl: breadth-first crawl from a starting URL with per-page structure (same domain, depth and page limits).
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
    let client = http_client_impl(false)?;

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
        let resp = match fetch_public(&client, &url).await {
            Ok(r) => r,
            Err(_) => continue, // A failed page or private-network rejection does not abort the whole crawl
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
        let body = match read_body_capped(resp, FETCH_BODY_CAP).await {
            Ok((bytes, _over)) => String::from_utf8_lossy(&bytes).into_owned(),
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

        // Expand links from this page only while the depth limit has not been reached
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

// ── Skill registry (unified protocol vrykell-skills/v1) ──

/// One skill in a remote skill registry.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteSkill {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub version: String,
    pub author: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct SkillRegistryManifest {
    protocol: String,
    skills: Vec<RemoteSkill>,
}

/// Parse a skill registry: accepts a bare array `[...]` or `{ protocol, skills: [...] }`.
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

/// Fetch a skill registry over the network using the unified protocol.
#[tauri::command]
pub async fn fetch_skill_registry(url: String) -> Result<Vec<RemoteSkill>, String> {
    let u = url.trim().to_string();
    if u.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("仅支持 http/https URL".to_string());
    }
    let client = http_client_impl(false)?;
    let resp = fetch_public(&client, &u).await?;
    let status = resp.status();
    let body = {
        let (bytes, over) = read_body_capped(resp, FETCH_BODY_CAP).await?;
        if over {
            return Err("响应体超过 10MB，已拒绝".to_string());
        }
        String::from_utf8_lossy(&bytes).into_owned()
    };
    if !status.is_success() {
        return Err(format!("返回 {status}：{}", truncate_chars(&body, 300)));
    }
    parse_skill_registry(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolver_accepts_a_hostname_without_an_embedded_port() {
        let resolver = PinnedResolver::new(false, HashSet::new());
        let addresses: Vec<_> = resolver.resolve("localhost".parse().unwrap()).await.unwrap().collect();
        assert!(!addresses.is_empty());
        assert!(addresses.iter().all(|address| address.port() == 0));
        let validating = PinnedResolver::new(true, HashSet::new());
        assert!(validating.resolve("localhost".parse().unwrap()).await.is_err());
    }

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
        let body = format!("{}😀error", "a".repeat(299));
        assert_eq!(truncate_chars(&body, 300), format!("{}😀", "a".repeat(299)));
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
        // Same domain: external links are filtered; #top collapses to the current page, unrelated to the start URL but kept after deduplication
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

    #[test]
    fn is_private_ip_blocks_internal_and_allows_public() {
        assert!(is_private_ip("127.0.0.1".parse().unwrap()));
        assert!(is_private_ip("192.168.1.1".parse().unwrap()));
        assert!(is_private_ip("10.0.0.1".parse().unwrap()));
        assert!(is_private_ip("172.16.0.1".parse().unwrap()));
        assert!(is_private_ip("169.254.169.254".parse().unwrap()));
        assert!(is_private_ip("::1".parse().unwrap()));
        assert!(is_private_ip("fd00::1".parse().unwrap()));
        assert!(!is_private_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_private_ip("1.1.1.1".parse().unwrap()));
        // IPv4-mapped IPv6: resolves to the corresponding IPv4, so it must be blocked with IPv4 semantics
        assert!(is_private_ip("::ffff:127.0.0.1".parse().unwrap()));
        assert!(is_private_ip("::ffff:192.168.1.1".parse().unwrap()));
        assert!(is_private_ip("::ffff:169.254.169.254".parse().unwrap()));
        assert!(!is_private_ip("::ffff:8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn github_host_allowlist_matches_only_known_hosts() {
        assert!(is_github_host("api.github.com"));
        assert!(is_github_host("raw.githubusercontent.com"));
        assert!(is_github_host("objects.githubusercontent.com"));
        assert!(is_github_host("github.com"));
        assert!(is_github_host("foo.githubusercontent.com"));
        assert!(!is_github_host("evil.com"));
        assert!(!is_github_host("github.com.evil.com"));
        assert!(!is_github_host("127.0.0.1"));
        assert!(!is_github_host("gitlab.com"));
    }

    #[test]
    fn validate_resolved_blocks_private_mixed_and_mapped() {
        use std::net::SocketAddr;
        let pub1: SocketAddr = "8.8.8.8:443".parse().unwrap();
        let priv1: SocketAddr = "127.0.0.1:80".parse().unwrap();
        let mapped: SocketAddr = "[::ffff:192.168.1.1]:443".parse().unwrap();
        assert!(validate_resolved("x.com", &[pub1]).is_ok());
        // Mixed public and private → reject (alternating DNS answers or multiple records)
        assert!(validate_resolved("x.com", &[pub1, priv1]).is_err());
        // Private IPv4-mapped IPv6 → reject
        assert!(validate_resolved("x.com", &[mapped]).is_err());
        // Empty result → reject
        assert!(validate_resolved("x.com", &[]).is_err());
    }

    // Environment variables are process-wide state; serialize tests to avoid interference
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn proxy_remote_dns_follows_env_no_proxy_and_proxy_type() {
        let _g = ENV_LOCK.lock().unwrap();
        // Clear the environment
        for k in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"] {
            std::env::remove_var(k);
        }

        // No proxy → false
        assert!(!proxy_does_remote_dns_for("https", "github.com"));

        // http/https forward proxy → remote resolution
        std::env::set_var("HTTPS_PROXY", "http://127.0.0.1:7890");
        assert!(proxy_does_remote_dns_for("https", "github.com"));
        assert!(!proxy_does_remote_dns_for("http", "github.com"));

        // ALL_PROXY covers both schemes
        std::env::remove_var("HTTPS_PROXY");
        std::env::set_var("ALL_PROXY", "http://127.0.0.1:7890");
        assert!(proxy_does_remote_dns_for("https", "example.com"));
        assert!(proxy_does_remote_dns_for("http", "example.com"));

        // NO_PROXY exact-domain exclusion → direct connection, validation kept
        std::env::set_var("NO_PROXY", "internal.corp,api.github.com");
        assert!(!proxy_does_remote_dns_for("https", "api.github.com"));
        assert!(proxy_does_remote_dns_for("https", "github.com"));
        assert!(!proxy_does_remote_dns_for("https", "internal.corp"));

        // NO_PROXY wildcard `*` excludes everything
        std::env::set_var("NO_PROXY", "*");
        assert!(!proxy_does_remote_dns_for("https", "github.com"));

        // Subdomain match (leading dot)
        std::env::set_var("NO_PROXY", ".corp.example");
        assert!(!proxy_does_remote_dns_for("https", "svc.corp.example"));
        assert!(proxy_does_remote_dns_for("https", "corp.example.com"));

        // NO_PROXY contains IP/CIDR entries → conservatively treated as direct (cannot rule out a domain resolving to them and bypassing the proxy)
        std::env::set_var("NO_PROXY", "127.0.0.1,192.168.1.0/24");
        assert!(!proxy_does_remote_dns_for("https", "github.com"));

        // socks5 resolves locally → validation kept; socks5h resolves remotely → skipped
        std::env::remove_var("NO_PROXY");
        std::env::set_var("ALL_PROXY", "socks5://127.0.0.1:1080");
        assert!(!proxy_does_remote_dns_for("https", "github.com"));
        std::env::set_var("ALL_PROXY", "socks5h://127.0.0.1:1080");
        assert!(proxy_does_remote_dns_for("https", "github.com"));

        // Clean up
        for k in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"] {
            std::env::remove_var(k);
        }
    }
}
