//! Secret storage for SSH passwords, AI API keys and other sensitive values:
//!   - macOS: the system keychain (`security` CLI, no extra dependency)
//!   - Windows: DPAPI-encrypted values in `~/.vrykell/secrets.json` (only the current user can unseal them)
//!   - Other platforms: `~/.vrykell/secrets.json` (mode 0600), **plaintext** - a known limitation because no
//!     default keyring is available. Do not sync or share this file on those platforms.
//!
//! Windows values use the form `dpapi:<base64>`. Plaintext values written by older versions remain readable
//! and are sealed automatically on the next write.

use base64::Engine as _;

#[cfg(not(target_os = "macos"))]
use std::path::PathBuf;

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.vrykell.app";

/// Older versions stored SSH passwords under a different keychain service. Read them in place and
/// migrate them to the shared service name.
#[cfg(target_os = "macos")]
const LEGACY_SSH_SERVICE: &str = "com.vrykell.app.ssh";

#[cfg(not(target_os = "macos"))]
const FALLBACK_NAME: &str = "secrets.json";

/// Prefix for sealed Windows values. Values without it are read as legacy plaintext and migrated on read.
const SEALED_PREFIX: &str = "dpapi:";

#[cfg(not(target_os = "macos"))]
fn fallback_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".vrykell")
        .join(FALLBACK_NAME)
}

// -- macOS: system keychain (`security` CLI) --

#[cfg(target_os = "macos")]
fn security(args: &[&str]) -> std::io::Result<std::process::Output> {
    std::process::Command::new("/usr/bin/security").args(args).output()
}

#[cfg(target_os = "macos")]
pub fn set_secret(account: &str, secret: &str) -> Result<(), String> {
    let out = security(&[
        "add-generic-password",
        "-U", // update an existing entry
        "-s",
        SERVICE,
        "-a",
        account,
        "-w",
        secret,
    ])
    .map_err(|e| format!("Keychain write failed: {e}"))?;
    if !out.status.success() {
        return Err(format!("Keychain write failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn get_secret(account: &str) -> Option<String> {
    if let Some(value) = find_in(SERVICE, account) {
        return Some(value);
    }
    // SSH password under the legacy service name: migrate it on read, then use the shared service only.
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
    // The legacy service may still hold the same account.
    let _ = security(&["delete-generic-password", "-s", LEGACY_SSH_SERVICE, "-a", account]);
}

// -- Windows: DPAPI --

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
                return Err(format!("DPAPI encryption failed: {}", std::io::Error::last_os_error()));
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
                return Err(format!("DPAPI decryption failed: {}", std::io::Error::last_os_error()));
            }
            let plain = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as *mut _);
            Ok(plain)
        }
    }
}

/// Seal plaintext for storage on Windows; other platforms return it unchanged (the file itself is mode 0600).
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

/// Sealed value to plaintext. Legacy plaintext or a value that cannot be unsealed returns None.
#[cfg(windows)]
fn unseal(stored: &str) -> Option<String> {
    let encoded = stored.strip_prefix(SEALED_PREFIX)?;
    let sealed = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    let plain = dpapi::unprotect(&sealed).ok()?;
    String::from_utf8(plain).ok()
}

/// Other platforms: a local file (values are platform-sealed; Unix tightens it to mode 0600).

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
        written.map_err(|e| format!("Failed to write the secrets file: {e}"))?;
        // Tighten a file that already existed with wider permissions.
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    std::fs::write(&path, json).map_err(|e| format!("Failed to write the secrets file: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn write_secret(account: &str, secret: &str) -> Result<(), String> {
    let mut map = read_map();
    let stored = seal(secret)?;
    map.insert(account.to_string(), serde_json::Value::String(stored));
    write_map(&map)
}

/// Windows accepts only sealed values that can be decrypted. Legacy plaintext and corrupt values count
/// as missing and are never used as keys (no migration; re-entering the value seals it).
#[cfg(windows)]
fn read_secret(account: &str) -> Option<String> {
    let raw = read_map()
        .get(account)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())?;
    unseal(&raw)
}

/// Other platforms have no system keyring: values are stored and read as plaintext and rely on file permissions (a known limitation).
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

/// macOS keeps values in the keychain and does not use the file; other platforms have no system keyring and keep the file path.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_delete_roundtrip() {
        let account = format!("test-{}", std::process::id());
        // Write, read back, then delete (reading after deletion returns None).
        set_secret(&account, "s3cr3t").unwrap();
        assert_eq!(get_secret(&account).as_deref(), Some("s3cr3t"));
        delete_secret(&account);
        assert_eq!(get_secret(&account), None);
        // Deletion is idempotent.
        delete_secret(&account);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn stored_value_never_keeps_the_plaintext() {
        // macOS uses the keychain, so the file path does not apply.
        let sealed = seal("sk-do-not-leak").unwrap();
        #[cfg(windows)]
        {
            assert!(!sealed.contains("sk-do-not-leak"), "sealed value must not embed the plaintext");
            assert!(sealed.starts_with(SEALED_PREFIX));
            assert_eq!(unseal(&sealed).as_deref(), Some("sk-do-not-leak"));
            // Tampered ciphertext cannot be unsealed (it does not silently return garbage).
            let mut broken = sealed.clone();
            broken.push('A');
            assert_eq!(unseal(&broken), None);
        }
        #[cfg(not(windows))]
        {
            // Other platforms have no system keyring: the value is stored as-is and relies on file permissions.
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
        // At runtime only decryptable values are accepted: legacy plaintext counts as missing and is never migrated.
        assert_eq!(read_secret(&account), None);
        let stored = read_map()
            .get(&account)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap();
        assert_eq!(stored, "old-plain-value", "no migration may rewrite the stored value");
        // Tampered or corrupt ciphertext also counts as missing and is never used as a key.
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
