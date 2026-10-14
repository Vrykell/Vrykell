//! 密钥存储（SSH 密码、AI API Key 等敏感值）：
//!   - macOS   ：系统钥匙串（`security` CLI，无新增依赖）
//!   - Windows ：DPAPI 加密后写入 `~/.vrykell/secrets.json`（只有当前用户能解开）
//!   - 其它平台：`~/.vrykell/secrets.json`（0600 权限），**明文** —— 已知限制，没有可用的
//!     默认密钥环；在此平台上不要把该文件同步或共享出去。
//!
//! Windows 的已存值形如 `dpapi:<base64>`；旧版本写入的明文值仍可读取，并在下一次写入时
//! 自动改为加密形式。

use base64::Engine as _;

#[cfg(not(target_os = "macos"))]
use std::path::PathBuf;

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.vrykell.app";

/// 旧版本只用钥匙串存 SSH 密码，服务名不同：读到旧值后就地迁移到统一服务名。
#[cfg(target_os = "macos")]
const LEGACY_SSH_SERVICE: &str = "com.vrykell.app.ssh";

#[cfg(not(target_os = "macos"))]
const FALLBACK_NAME: &str = "secrets.json";

/// Windows 加密值的标记前缀；无前缀按旧明文读取（读取时自动迁移）。
const SEALED_PREFIX: &str = "dpapi:";

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
    if let Some(value) = find_in(SERVICE, account) {
        return Some(value);
    }
    // 旧服务名下的 SSH 密码：读到时顺手迁移，之后只查统一服务名
    let legacy = find_in(LEGACY_SSH_SERVICE, account)?;
    if set_secret(account, &legacy).is_ok() {
        let _ = security(&["delete-generic-password", "-s", LEGACY_SSH_SERVICE, "-a", account]);
    }
    Some(legacy)
}

#[cfg(target_os = "macos")]
fn find_in(service: &str, account: &str) -> Option<String> {
    let out = security(&["find-generic-password", "-s", service, "-a", account, "-w"]).ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    Some(s.trim_end_matches('\n').to_string())
}

#[cfg(target_os = "macos")]
pub fn delete_secret(account: &str) {
    let _ = security(&["delete-generic-password", "-s", SERVICE, "-a", account]);
    // 旧服务名里可能还留着同一个账户
    let _ = security(&["delete-generic-password", "-s", LEGACY_SSH_SERVICE, "-a", account]);
}

// ── Windows：DPAPI ──

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    /// Seals bytes for the current user (and machine): the blob cannot be opened elsewhere.
    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut input = CRYPT_INTEGER_BLOB {
                cbData: plain.len() as u32,
                pbData: plain.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
            let ok = CryptProtectData(
                &mut input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return Err(format!("DPAPI 加密失败：{}", std::io::Error::last_os_error()));
            }
            let sealed = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as *mut _);
            Ok(sealed)
        }
    }

    pub fn unprotect(sealed: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut input = CRYPT_INTEGER_BLOB {
                cbData: sealed.len() as u32,
                pbData: sealed.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
            let ok = CryptUnprotectData(
                &mut input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return Err(format!("DPAPI 解密失败：{}", std::io::Error::last_os_error()));
            }
            let plain = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as *mut _);
            Ok(plain)
        }
    }
}

/// Windows 上把明文变成可落盘的加密串；其它平台原样返回（文件本身收 0600）。
#[cfg(windows)]
fn seal(plain: &str) -> Result<String, String> {
    let sealed = dpapi::protect(plain.as_bytes())?;
    Ok(format!(
        "{SEALED_PREFIX}{}",
        base64::engine::general_purpose::STANDARD.encode(sealed)
    ))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn seal(plain: &str) -> Result<String, String> {
    Ok(plain.to_string())
}

/// 加密串 → 明文；不是加密串（旧明文）返回 None，由调用方按原文处理。
#[cfg(windows)]
fn unseal(stored: &str) -> Option<String> {
    let encoded = stored.strip_prefix(SEALED_PREFIX)?;
    let sealed = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    let plain = dpapi::unprotect(&sealed).ok()?;
    String::from_utf8(plain).ok()
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn unseal(_stored: &str) -> Option<String> {
    None
}

/// 其它平台：本地文件（值按平台加密；unix 上收紧为 0600） ──

#[cfg(not(target_os = "macos"))]
/// Serializes the read-modify-write of the whole file: two concurrent saves (settings plus the
/// agent, say) would otherwise lose the value the other one just wrote.
static STORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
    }
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("写入密钥文件失败：{e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn write_secret(account: &str, secret: &str) -> Result<(), String> {
    let mut map = read_map();
    let stored = seal(secret)?;
    map.insert(account.to_string(), serde_json::Value::String(stored));
    write_map(&map)
}

#[cfg(not(target_os = "macos"))]
fn read_secret(account: &str) -> Option<String> {
    let raw = read_map()
        .get(account)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())?;
    // 加密值解成明文；旧明文（或本平台不加密）按原样返回
    Some(unseal(&raw).unwrap_or(raw))
}

#[cfg(not(target_os = "macos"))]
fn remove_secret(account: &str) {
    let mut map = read_map();
    map.remove(account);
    let _ = write_map(&map);
}

#[cfg(not(target_os = "macos"))]
pub fn set_secret(account: &str, secret: &str) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    write_secret(account, secret)
}

#[cfg(not(target_os = "macos"))]
pub fn get_secret(account: &str) -> Option<String> {
    let _guard = STORE_LOCK.lock().ok()?;
    read_secret(account)
}

#[cfg(not(target_os = "macos"))]
pub fn delete_secret(account: &str) {
    let Ok(_guard) = STORE_LOCK.lock() else { return };
    remove_secret(account);
}

/// 启动时一次性升级：把文件里仍是明文的旧值改写成平台加密形式（幂等，返回升级条数）。
#[cfg(windows)]
pub fn seal_pending_values() -> usize {
    let Ok(_guard) = STORE_LOCK.lock() else { return 0 };
    let mut map = read_map();
    let mut upgraded = 0usize;
    for value in map.values_mut() {
        let Some(text) = value.as_str() else { continue };
        if text.starts_with(SEALED_PREFIX) {
            continue;
        }
        match seal(text) {
            Ok(sealed) => {
                *value = serde_json::Value::String(sealed);
                upgraded += 1;
            }
            Err(error) => eprintln!("[secret] 加密旧值失败：{error}"),
        }
    }
    if upgraded > 0 {
        let _ = write_map(&map);
    }
    upgraded
}

/// macOS 把值放在钥匙串里，文件不参与；其它平台没有系统密钥环，保持原样。
#[cfg(not(windows))]
pub fn seal_pending_values() -> usize {
    0
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

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn stored_value_never_keeps_the_plaintext() {
        // macOS 在钥匙串里，文件路径不适用
        let sealed = seal("sk-do-not-leak").unwrap();
        if cfg!(windows) {
            assert!(!sealed.contains("sk-do-not-leak"), "sealed value must not embed the plaintext");
            assert!(sealed.starts_with(SEALED_PREFIX));
            assert_eq!(unseal(&sealed).as_deref(), Some("sk-do-not-leak"));
            // 篡改过的密文解不开（不是静默返回垃圾）
            let mut broken = sealed.clone();
            broken.push('A');
            assert_eq!(unseal(&broken), None);
        } else {
            // 其它平台没有系统密钥环：值原样保存，依赖文件权限
            assert_eq!(sealed, "sk-do-not-leak");
        }
    }

    #[cfg(windows)]
    #[test]
    fn legacy_plaintext_values_stay_readable() {
        let account = format!("legacy-{}", std::process::id());
        // Hold the store lock across the raw write and the reads so the other tests in this
        // file cannot clobber the file in between.
        let _guard = STORE_LOCK.lock().unwrap();
        let mut map = read_map();
        map.insert(account.clone(), serde_json::Value::String("old-plain-value".into()));
        write_map(&map).unwrap();
        assert_eq!(read_secret(&account).as_deref(), Some("old-plain-value"));
        // 下一次写入即升级为加密形式
        write_secret(&account, "old-plain-value").unwrap();
        let stored = read_map()
            .get(&account)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap();
        assert!(stored.starts_with(SEALED_PREFIX), "value must be sealed after a write");
        assert_eq!(read_secret(&account).as_deref(), Some("old-plain-value"));
        remove_secret(&account);
    }
}
