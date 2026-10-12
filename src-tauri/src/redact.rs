//! Secret redaction shared by persisted history and diagnostics.
//!
//! Only recognizable secrets are masked: bearer tokens, API keys, `password=…` style pairs and
//! PEM private-key blocks. Ordinary text is returned unchanged, so command output and restored
//! history stay readable when nothing sensitive is present.

use std::sync::OnceLock;

/// The compiled pattern; built once per process.
fn secrets() -> &'static regex::Regex {
    static SECRETS: OnceLock<regex::Regex> = OnceLock::new();
    SECRETS.get_or_init(|| {
        regex::Regex::new(
            r#"(?i)\bauthorization\s*[=:]\s*Bearer\s+\S+|\bBearer\s+\S+|\bsk-[\w-]+|(?:password|passphrase|api[_-]?key|token|secret|authorization)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)|-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----"#,
        )
        .expect("valid secret redaction pattern")
    })
}

/// Replace every recognizable secret in `text` with `[redacted]`.
pub fn redact_text(text: &str) -> String {
    secrets().replace_all(text, "[redacted]").into_owned()
}

/// Redact JSON values without changing the structure used by restored chat messages.
pub fn redact_json(text: &str) -> String {
    fn visit(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::String(text) => *text = redact_text(text),
            serde_json::Value::Array(values) => values.iter_mut().for_each(visit),
            serde_json::Value::Object(fields) => {
                for (key, value) in fields {
                    let normalized = key.to_ascii_lowercase().replace(['_', '-'], "");
                    if matches!(normalized.as_str(), "password" | "passphrase" | "apikey" | "token" | "secret" | "authorization") && !value.is_null() {
                        *value = serde_json::Value::String("[redacted]".into());
                    } else {
                        visit(value);
                    }
                }
            }
            _ => {}
        }
    }
    if text.is_empty() { return String::new(); }
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(mut value) => {
            let original = value.clone();
            visit(&mut value);
            if value == original { text.to_owned() } else { value.to_string() }
        }
        Err(_) => redact_text(text),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_key_values_and_tokens_but_keeps_ordinary_text() {
        for secret in ["export TOKEN=abc123", "password: hunter2", "Authorization: Bearer xy.z", "install sk-abc123"] {
            let redacted = redact_text(secret);
            assert!(redacted.contains("[redacted]"), "{secret} should be redacted");
        }
        assert!(!redact_text("export TOKEN=abc123").contains("abc123"));
        assert!(!redact_text("password: hunter2").contains("hunter2"));
        assert!(!redact_text("Authorization: Bearer xy.z").contains("xy.z"));
        // Ordinary output is left exactly as it was.
        assert_eq!(redact_text("list the files"), "list the files");
    }

    #[test]
    fn masks_a_private_key_block() {
        let text = "-----BEGIN OPENSSH PRIVATE KEY-----\nbody\n-----END OPENSSH PRIVATE KEY-----";
        assert_eq!(redact_text(text), "[redacted]");
    }
}
