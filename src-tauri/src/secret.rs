//! 密钥存储：
//!   - macOS：系统钥匙串（`security` CLI，无新增依赖）
//!   - 其它平台：回退到 `~/.vrykell/secrets.json`（0600 权限）
//!
//! 用于 SSH 密码等敏感信息，避免明文落 SQLite。

#[cfg(not(target_os = "macos"))]
use std::path::PathBuf;

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.vrykell.app.ssh";

#[cfg(not(target_os = "macos"))]
const FALLBACK_NAME: &str = "secrets.json";

#[cfg(not(target_os = "macos"))]
fn fallback_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".vrykell")
        .join(FALLBACK_NAME)
}

// ── macOS：系统钥匙串（security CLI） ──

#[cfg(target_os = "macos")]
fn security(args: &[&str]) -> std::io::Result<std::process::Output> {
    std::process::Command::new("/usr/bin/security").args(args).output()
}

#[cfg(target_os = "macos")]
pub fn set_secret(account: &str, secret: &str) -> Result<(), String> {
    let out = security(&[
        "add-generic-password",
        "-U", // 已存在则更新
        "-s",
        SERVICE,
        "-a",
        account,
        "-w",
        secret,
    ])
    .map_err(|e| format!("钥匙串写入失败：{e}"))?;
    if !out.status.success() {
        return Err(format!("钥匙串写入失败：{}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn get_secret(account: &str) -> Option<String> {
    let out = security(&["find-generic-password", "-s", SERVICE, "-a", account, "-w"]).ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    Some(s.trim_end_matches('\n').to_string())
}

#[cfg(target_os = "macos")]
pub fn delete_secret(account: &str) {
    let _ = security(&["delete-generic-password", "-s", SERVICE, "-a", account]);
}

// ── 其它平台：本地文件回退（0600） ──

#[cfg(not(target_os = "macos"))]
fn read_map() -> serde_json::Map<String, serde_json::Value> {
    let Ok(text) = std::fs::read_to_string(fallback_path()) else {
        return serde_json::Map::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn write_map(map: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let path = fallback_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    // Create the file already private under Unix: a plain write would leave it world-readable
    // until the permission fix below lands.
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let written = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .and_then(|mut file| file.write_all(json.as_bytes()));
        written.map_err(|e| format!("写入密钥文件失败：{e}"))?;
        // Tighten a file that already existed with wider permissions.
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    std::fs::write(&path, json).map_err(|e| format!("写入密钥文件失败：{e}"))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_secret(account: &str, secret: &str) -> Result<(), String> {
    let mut map = read_map();
    map.insert(account.to_string(), serde_json::Value::String(secret.to_string()));
    write_map(&map)
}

#[cfg(not(target_os = "macos"))]
pub fn get_secret(account: &str) -> Option<String> {
    read_map()
        .get(account)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn delete_secret(account: &str) {
    let mut map = read_map();
    map.remove(account);
    let _ = write_map(&map);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_delete_roundtrip() {
        let account = format!("test-{}", std::process::id());
        // 写入 → 读回 → 删除（删除后读回 None）
        set_secret(&account, "s3cr3t").unwrap();
        assert_eq!(get_secret(&account).as_deref(), Some("s3cr3t"));
        delete_secret(&account);
        assert_eq!(get_secret(&account), None);
        // 幂等删除
        delete_secret(&account);
    }
}
