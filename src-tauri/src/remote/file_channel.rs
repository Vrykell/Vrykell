//! Bounded reuse of authenticated file channels, independent of terminal and transfer traffic.

use crate::db::SshConnection;
use sha2::{Digest, Sha256};
use ssh2::{Session, Sftp};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const IDLE_TTL: Duration = Duration::from_secs(60);
const MAX_IDLE: usize = 32;

struct Entry<T> {
    id: String,
    binding: [u8; 32],
    returned: Instant,
    value: T,
}

struct IdlePool<T> {
    entries: Vec<Entry<T>>,
    retired: Vec<T>,
    epoch: u64,
}

impl<T> Default for IdlePool<T> {
    fn default() -> Self { Self { entries: Vec::new(), retired: Vec::new(), epoch: 0 } }
}

impl<T> IdlePool<T> {
    fn take(&mut self, id: &str, binding: [u8; 32], now: Instant) -> (u64, Option<T>) {
        self.retire(|entry| now.duration_since(entry.returned) >= IDLE_TTL
            || (entry.id == id && entry.binding != binding));
        let value = self.entries.iter().rposition(|entry| entry.id == id && entry.binding == binding)
            .map(|index| self.entries.remove(index).value);
        (self.epoch, value)
    }

    fn put(&mut self, epoch: u64, id: String, binding: [u8; 32], value: T, now: Instant) {
        if epoch != self.epoch { self.retired.push(value); return; }
        self.retire(|entry| now.duration_since(entry.returned) >= IDLE_TTL);
        // Keep at most two idle channels per profile, so concurrent reads do not queue globally.
        if self.entries.iter().filter(|entry| entry.id == id).count() >= 2 {
            if let Some(index) = self.entries.iter().position(|entry| entry.id == id) { self.retired.push(self.entries.remove(index).value); }
        }
        if self.entries.len() >= MAX_IDLE { self.retired.push(self.entries.remove(0).value); }
        self.entries.push(Entry { id, binding, value, returned: now });
    }

    fn invalidate(&mut self, id: &str) {
        self.epoch = self.epoch.wrapping_add(1);
        self.retire(|entry| entry.id == id);
    }

    fn retire(&mut self, predicate: impl Fn(&Entry<T>) -> bool) {
        let mut index = 0;
        while index < self.entries.len() {
            if predicate(&self.entries[index]) { self.retired.push(self.entries.remove(index).value); }
            else { index += 1; }
        }
    }
}

struct FileChannel {
    sftp: Sftp,
    session: Session,
}

static CHANNELS: LazyLock<Mutex<IdlePool<FileChannel>>> = LazyLock::new(|| Mutex::new(IdlePool::default()));

fn close_retired(channels: Vec<FileChannel>) {
    if !channels.is_empty() { tauri::async_runtime::spawn_blocking(move || drop(channels)); }
}

fn binding(conn: &SshConnection) -> Result<[u8; 32], String> {
    let revision = super::session_auth::AUTH_CACHE.lock()
        .map_err(|_| "SSH authentication cache is unavailable")?.revision_for(conn);
    let mut digest = Sha256::new();
    digest.update(serde_json::to_vec(&(&conn.host, conn.port.unwrap_or(22), &conn.user, &conn.auth_method, &conn.options))
        .map_err(|error| error.to_string())?);
    digest.update(conn.password.as_bytes());
    digest.update(revision.to_le_bytes());
    Ok(digest.finalize().into())
}

pub(super) fn invalidate(id: &str) {
    if let Ok(mut pool) = CHANNELS.lock() {
        pool.invalidate(id);
        let retired = std::mem::take(&mut pool.retired);
        drop(pool);
        close_retired(retired);
    }
}

pub(crate) fn invalidate_all() {
    if let Ok(mut pool) = CHANNELS.lock() {
        pool.epoch = pool.epoch.wrapping_add(1);
        pool.retire(|_| true);
        let retired = std::mem::take(&mut pool.retired);
        drop(pool);
        close_retired(retired);
    }
}

/// Return only successful channels to the pool. Mutations are never replayed automatically.
pub(super) fn run<T>(conn: &SshConnection, mut read: bool,
    mut operation: impl FnMut(&Session, &Sftp) -> Result<T, String>) -> Result<T, String> {
    let started = Instant::now();
    let binding = binding(conn)?;
    loop {
        let mut pool = CHANNELS.lock().map_err(|_| "File channel cache is unavailable")?;
        let (epoch, cached) = pool.take(&conn.id, binding, Instant::now());
        let retired = std::mem::take(&mut pool.retired);
        drop(pool);
        close_retired(retired);
        let reused = cached.is_some();
        let channel = match cached {
            Some(channel) => channel,
            None => {
                let session = super::ssh::connect_with_timeout(conn, Some(Duration::from_secs(10)))?;
                let sftp = super::ssh::connection_stage(conn, "sftp-open", || session.sftp()
                    .map_err(|error| format!("SFTP_UNAVAILABLE: {error}")))?;
                FileChannel { session, sftp }
            }
        };
        let operation_started = Instant::now();
        let result = operation(&channel.session, &channel.sftp);
        let _ = crate::diagnostics::record("ssh-file-channel", serde_json::json!({
            "connectionId": conn.id,
            "reused": reused, "succeeded": result.is_ok(), "durationMs": started.elapsed().as_millis(),
            "operationMs": operation_started.elapsed().as_millis(),
        }));
        if result.is_ok() {
            let mut pool = CHANNELS.lock().map_err(|_| "File channel cache is unavailable")?;
            pool.put(epoch, conn.id.clone(), binding, channel, Instant::now());
            let retired = std::mem::take(&mut pool.retired);
            drop(pool);
            close_retired(retired);
            return result;
        }
        close_retired(vec![channel]);
        // A cached connection may have expired remotely. Retry a read once on a fresh channel.
        if read && reused {
            read = false;
            invalidate(&conn.id);
        } else { return result; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binding_covers_transport_changes_without_reconnecting_for_display_metadata() {
        let conn = SshConnection { id: "channel-key-test".into(), name: "name".into(), host: "server.test".into(),
            port: None, user: "tester".into(), password: "secret".into(), auth_method: "password".into(),
            last_opened_at: None, has_password: true, options: Default::default() };
        let expected = binding(&conn).unwrap();
        let mut renamed = conn.clone();
        renamed.name = "another name".into();
        renamed.last_opened_at = Some(100);
        assert_eq!(binding(&renamed).unwrap(), expected);
        let mut variants = vec![conn.clone(); 5];
        variants[0].host = "other.test".into();
        variants[1].port = Some(2222);
        variants[2].user = "another-user".into();
        variants[3].password = "changed-secret".into();
        variants[4].options.proxy_id = Some("another-proxy".into());
        for changed in variants { assert_ne!(binding(&changed).unwrap(), expected); }
    }

    #[test]
    fn channels_are_reused_only_for_the_same_profile_and_binding() {
        let mut pool = IdlePool::default();
        let now = Instant::now();
        pool.put(0, "one".into(), [1; 32], "channel", now);
        assert!(pool.take("two", [1; 32], now).1.is_none());
        assert_eq!(pool.take("one", [1; 32], now).1, Some("channel"));
        assert!(pool.take("one", [1; 32], now).1.is_none());
        pool.put(0, "one".into(), [1; 32], "old", now);
        assert!(pool.take("one", [2; 32], now).1.is_none());
        assert!(pool.take("one", [1; 32], now).1.is_none());
    }

    #[test]
    fn invalidation_rejects_in_flight_returns_without_removing_other_idle_profiles() {
        let mut pool = IdlePool::default();
        let now = Instant::now();
        pool.put(0, "two".into(), [2; 32], "other", now);
        let (epoch, _) = pool.take("one", [1; 32], now);
        pool.invalidate("one");
        pool.put(epoch, "one".into(), [1; 32], "late", now);
        assert!(pool.take("one", [1; 32], now).1.is_none());
        assert_eq!(pool.take("two", [2; 32], now).1, Some("other"));
    }

    #[test]
    fn idle_retention_is_bounded_and_expired_channels_are_not_reused() {
        let mut pool = IdlePool::default();
        let now = Instant::now();
        for index in 0..100 { pool.put(0, format!("profile-{index}"), [1; 32], index, now); }
        assert_eq!(pool.entries.len(), MAX_IDLE);
        assert!(pool.take("profile-0", [1; 32], now).1.is_none());
        assert!(pool.take("profile-99", [1; 32], now + IDLE_TTL).1.is_none());
        assert!(pool.entries.is_empty());
        for index in 0..10 { pool.put(0, "one".into(), [1; 32], index, now); }
        assert_eq!(pool.entries.len(), 2);
    }
}
