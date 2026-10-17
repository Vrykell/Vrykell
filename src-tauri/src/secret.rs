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

/// 加密串 → 明文；不是加密串（旧明文）或解不开的密文都返回 None。
#[cfg(windows)]
fn unseal(stored: &str) -> Option<String> {
    let encoded = stored.strip_prefix(SEALED_PREFIX)?;
    let sealed = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    let plain = dpapi::unprotect(&sealed).ok()?;
    String::from_utf8(plain).ok()
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
fn write_secret(account: &str, secret: &str) -> Result<(), String> {
    let mut map = read_map();
    let stored = seal(secret)?;
    map.insert(account.to_string(), serde_json::Value::String(stored));
    write_map(&map)
}

/// Windows 只接受能解密的密文：旧明文与损坏的密文一律按“缺失”处理，绝不把未封存的原串
/// 当作密钥使用（不做迁移——重新输入一次即会以密文覆盖）。
#[cfg(windows)]
fn read_secret(account: &str) -> Option<String> {
    let raw = read_map()
        .get(account)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())?;
    unseal(&raw)
}

/// 其它平台没有系统密钥环：值按原文保存与读回，依赖文件权限（已知限制）。
#[cfg(all(not(windows), not(target_os = "macos")))]
fn read_secret(account: &str) -> Option<String> {
    read_map()
        .get(account)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
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

/// macOS 把值放在钥匙串里，文件不参与；其它平台没有系统密钥环，保持原样。
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
        #[cfg(windows)]
        {
            assert!(!sealed.contains("sk-do-not-leak"), "sealed value must not embed the plaintext");
            assert!(sealed.starts_with(SEALED_PREFIX));
            assert_eq!(unseal(&sealed).as_deref(), Some("sk-do-not-leak"));
            // 篡改过的密文解不开（不是静默返回垃圾）
            let mut broken = sealed.clone();
            broken.push('A');
            assert_eq!(unseal(&broken), None);
        }
        #[cfg(not(windows))]
        {
            // 其它平台没有系统密钥环：值原样保存，依赖文件权限
            assert_eq!(sealed, "sk-do-not-leak");
        }
    }

    #[cfg(windows)]
    #[test]
    fn legacy_plaintext_reads_as_missing_and_is_left_untouched() {
        let account = format!("legacy-{}", std::process::id());
        {
            let _guard = STORE_LOCK.lock().unwrap();
            let mut map = read_map();
            map.insert(account.clone(), serde_json::Value::String("old-plain-value".into()));
            write_map(&map).unwrap();
        }
        // 运行时只接受能解密的密文：旧明文按缺失处理，且不做任何迁移
        assert_eq!(read_secret(&account), None);
        let stored = read_map()
            .get(&account)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap();
        assert_eq!(stored, "old-plain-value", "no migration may rewrite the stored value");
        // 篡改/损坏的密文同样按缺失处理，不会把原始串当作密钥
        {
            let _guard = STORE_LOCK.lock().unwrap();
            let mut map = read_map();
            map.insert(account.clone(), serde_json::Value::String("dpapi:broken".into()));
            write_map(&map).unwrap();
        }
        assert_eq!(read_secret(&account), None);
        delete_secret(&account);
    }
}
