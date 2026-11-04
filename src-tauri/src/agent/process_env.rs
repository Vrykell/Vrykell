//! Child-only network settings. Explicit process settings take precedence over desktop defaults.
use std::collections::HashMap;

fn lookup<'a>(values: &'a HashMap<String, String>, name: &str) -> Option<&'a str> {
    values.get(&name.to_ascii_lowercase()).or_else(|| values.get(name))
        .or_else(|| values.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value)).map(String::as_str)
}

fn proxy_for(server: &str, scheme: &str) -> Option<String> {
    let candidate = if server.contains('=') {
        server.split(';').filter_map(|part| part.trim().split_once('='))
            .find(|(key, _)| key.trim().eq_ignore_ascii_case(scheme)).map(|(_, value)| value.trim())?
    } else { server.trim() };
    if candidate.is_empty() { return None; }
    let url = if candidate.contains("://") { candidate.to_string() } else { format!("http://{candidate}") };
    let parsed = reqwest::Url::parse(&url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https" | "socks5" | "socks5h") || parsed.host_str().is_none() { return None; }
    Some(url)
}

fn child_env(explicit: &HashMap<String, String>, inherited: &HashMap<String, String>, system: Option<&str>) -> HashMap<String, String> {
    let mut result = explicit.clone();
    for scheme in ["http", "https"] {
        let key = format!("{}_PROXY", scheme.to_ascii_uppercase());
        let value = lookup(explicit, &key).or_else(|| lookup(explicit, "ALL_PROXY")).map(str::to_string).or_else(|| {
            lookup(inherited, &key).or_else(|| lookup(inherited, "ALL_PROXY")).map(str::to_string)
                .or_else(|| system.and_then(|server| proxy_for(server, scheme)))
        });
        if let Some(value) = value {
            result.retain(|name, _| !name.eq_ignore_ascii_case(&key));
            result.insert(key.to_ascii_lowercase(), value.clone());
            result.insert(key, value);
        }
    }
    let uses_proxy = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"].iter()
        .any(|key| lookup(&result, key).or_else(|| lookup(inherited, key)).is_some_and(|value| !value.is_empty()));
    if uses_proxy {
        let mut bypass: Vec<String> = lookup(explicit, "NO_PROXY").or_else(|| lookup(inherited, "NO_PROXY"))
            .unwrap_or("").split(',').map(str::trim).filter(|item| !item.is_empty()).map(str::to_string).collect();
        for host in ["localhost", "127.0.0.1", "::1", "[::1]"] {
            if !bypass.iter().any(|item| item.eq_ignore_ascii_case(host)) { bypass.push(host.to_string()); }
        }
        result.retain(|key, _| !key.eq_ignore_ascii_case("NO_PROXY"));
        result.insert("NO_PROXY".into(), bypass.join(","));
        // Runtimes disagree on casing. Keep both aliases identical in the child only.
        result.insert("no_proxy".into(), bypass.join(","));
    }
    result
}

#[cfg(windows)]
fn desktop_proxy() -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};
    let path: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\0".encode_utf16().collect();
    let enabled: Vec<u16> = "ProxyEnable\0".encode_utf16().collect();
    let server: Vec<u16> = "ProxyServer\0".encode_utf16().collect();
    let mut flag = 0u32;
    let mut size = 4u32;
    unsafe {
        if RegGetValueW(HKEY_CURRENT_USER, path.as_ptr(), enabled.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), (&mut flag as *mut u32).cast(), &mut size) != 0 || flag == 0 { return None; }
        size = 0;
        if RegGetValueW(HKEY_CURRENT_USER, path.as_ptr(), server.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) != 0 || size > 32768 { return None; }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        if RegGetValueW(HKEY_CURRENT_USER, path.as_ptr(), server.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut size) != 0 { return None; }
        Some(String::from_utf16_lossy(&buffer).trim_end_matches('\0').to_string())
    }
}

#[cfg(not(windows))]
fn desktop_proxy() -> Option<String> { None }

pub fn network_env(explicit: &HashMap<String, String>) -> HashMap<String, String> {
    let inherited = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]
        .into_iter().filter_map(|key| std::env::var(key).ok().map(|value| (key.to_string(), value))).collect();
    child_env(explicit, &inherited, desktop_proxy().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn values(entries: &[(&str, &str)]) -> HashMap<String, String> { entries.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() }
    #[test]
    fn uses_desktop_defaults_and_bypasses_local_bridge() {
        let result = child_env(&HashMap::new(), &HashMap::new(), Some("http=127.0.0.1:7897;https=127.0.0.1:7898"));
        assert_eq!(result["HTTP_PROXY"], "http://127.0.0.1:7897");
        assert_eq!(result["HTTPS_PROXY"], "http://127.0.0.1:7898");
        assert!(result["NO_PROXY"].contains("127.0.0.1"));
    }
    #[test]
    fn explicit_and_inherited_settings_win_including_disable() {
        let explicit = values(&[("https_proxy", ""), ("NO_PROXY", "internal.example")]);
        let inherited = values(&[("HTTP_PROXY", "http://configured:8080")]);
        let result = child_env(&explicit, &inherited, Some("desktop:7897"));
        assert_eq!(result["HTTPS_PROXY"], "");
        assert_eq!(result["https_proxy"], "");
        assert_eq!(result["HTTP_PROXY"], "http://configured:8080");
        assert!(result["NO_PROXY"].starts_with("internal.example,"));
        assert_eq!(explicit.len(), 2);
    }
    #[test]
    fn all_proxy_and_absent_configuration_are_preserved() {
        assert!(child_env(&HashMap::new(), &HashMap::new(), None).is_empty());
        let result = child_env(&values(&[("ALL_PROXY", "socks5://configured:1080")]), &HashMap::new(), Some("desktop:7897"));
        assert_eq!(result["HTTPS_PROXY"], "socks5://configured:1080");
        assert!(result.contains_key("NO_PROXY"));
        assert_eq!(proxy_for("file:///bad", "http"), None);
    }
}
