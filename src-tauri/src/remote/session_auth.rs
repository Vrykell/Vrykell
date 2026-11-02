//! Temporary credentials shared by file operations and resource collection.

use crate::db::SshConnection;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    Password,
    KeyPassphrase,
    KeyboardInteractive,
}

// Credentials deliberately implement neither Debug nor Serialize.
pub struct Credential {
    pub method: AuthMethod,
    pub secret: Zeroizing<String>,
}

fn credential_binding(conn: &SshConnection) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(serde_json::json!([conn.host, conn.port.unwrap_or(22), conn.user, conn.options, conn.auth_method]).to_string());
    digest.update(conn.password.as_bytes());
    digest.finalize().into()
}

pub(super) fn binding(conn: &SshConnection) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(credential_binding(conn));
    for hop in &conn.options.resolved_jumps.0 { digest.update(binding(hop)); }
    digest.finalize().into()
}

struct Entry {
    binding: [u8; 32],
    credential: Option<Arc<Credential>>,
    service: Option<Arc<RetainedSession>>,
    dependencies: Vec<String>,
    revision: u64,
}

struct ServiceSession {
    sftp: Option<ssh2::Sftp>,
    session: ssh2::Session,
}

/// Only blocking file and monitoring operations share this transport, under one bounded gate.
pub(crate) struct RetainedSession(Mutex<Option<ServiceSession>>);

impl RetainedSession {
    pub fn new(session: ssh2::Session) -> Self {
        Self(Mutex::new(Some(ServiceSession { sftp: None, session })))
    }

    fn with<T>(&self, file_operation: bool, operation: impl FnOnce(&mut ServiceSession) -> Result<T, String>) -> Result<T, String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.0.try_lock() {
                Ok(mut guard) => {
                    let value = guard.as_mut().ok_or("SSH_AUTH_FAILED: Authenticate the services again")?;
                    value.session.set_timeout(5000);
                    let result = operation(value);
                    if let Err(error) = &result {
                        let mut transport_failed = service_transport_failed(error);
                        if file_operation && file_channel_failed(error) {
                            // Reopen only the subsystem to distinguish a closed file channel from a lost transport.
                            // The failed operation is returned unchanged and is never replayed here.
                            drop(value.sftp.take());
                            match value.session.sftp() {
                                Ok(sftp) => { value.sftp = Some(sftp); transport_failed = false; }
                                Err(recovery) => { transport_failed = service_transport_failed(&recovery.to_string()); }
                            }
                        } else if transport_failed {
                            // A timed-out command channel does not establish that the authenticated transport ended.
                            transport_failed = match value.session.channel_session() {
                                Ok(mut probe) => probe.close().is_err(),
                                Err(probe) => probe.code() != ssh2::ErrorCode::Session(-21),
                            };
                        }
                        if transport_failed {
                            if let Some(retired) = guard.take() { tauri::async_runtime::spawn_blocking(move || drop(retired)); }
                            return Err(format!("SSH_AUTH_FAILED: The authenticated service connection ended. Authenticate again. {error}"));
                        }
                    }
                    return result;
                }
                Err(std::sync::TryLockError::Poisoned(_)) => return Err("SSH service connection is unavailable".into()),
                Err(std::sync::TryLockError::WouldBlock) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => return Err("SSH service connection is busy. Retry the operation.".into()),
            }
        }
    }

    pub fn session<T>(&self, operation: impl FnOnce(&ssh2::Session) -> Result<T, String>) -> Result<T, String> {
        self.with(false, |value| operation(&value.session))
    }

    pub fn sftp<T>(&self, operation: impl FnOnce(&ssh2::Session, &ssh2::Sftp) -> Result<T, String>) -> Result<T, String> {
        self.with(true, |value| {
            if value.sftp.is_none() {
                value.sftp = Some(value.session.sftp().map_err(|error| format!("SFTP_UNAVAILABLE: {error}"))?);
            }
            operation(&value.session, value.sftp.as_ref().ok_or("SFTP_UNAVAILABLE: Could not open SFTP")?)
        })
    }
}

fn service_transport_failed(error: &str) -> bool {
    [-1, -7, -9, -13, -30, -43].iter().any(|code| error.contains(&format!("Session({code})")))
}

fn file_channel_failed(error: &str) -> bool {
    service_transport_failed(error) || ["Session(-26)", "Session(-27)", "SFTP(6)", "SFTP(7)"].iter().any(|code| error.contains(code))
}

impl Drop for RetainedSession {
    fn drop(&mut self) {
        // Closing a transport may block. Never do it while holding the authentication cache lock.
        if let Ok(value) = self.0.get_mut() {
            if let Some(value) = value.take() { tauri::async_runtime::spawn_blocking(move || drop(value)); }
        }
    }
}

#[derive(Default)]
pub struct AuthCache {
    entries: HashMap<String, Entry>,
    pending: HashMap<String, u64>,
    revision: u64,
}

impl AuthCache {
    pub fn begin(&mut self, id: &str) -> u64 {
        self.clear(id);
        self.revision += 1;
        // Bound both retained credentials and unfinished authentication attempts.
        if self.pending.len() >= 64 { self.pending.clear(); }
        self.pending.insert(id.to_owned(), self.revision);
        self.revision
    }

    pub fn store(&mut self, conn: &SshConnection, revision: u64, credential: Arc<Credential>) -> bool {
        self.insert(conn, revision, Some(credential), None)
    }

    pub fn store_session(&mut self, conn: &SshConnection, revision: u64, session: ssh2::Session) -> bool {
        self.insert(conn, revision, None, Some(Arc::new(RetainedSession::new(session))))
    }

    fn insert(&mut self, conn: &SshConnection, revision: u64, credential: Option<Arc<Credential>>, service: Option<Arc<RetainedSession>>) -> bool {
        if self.pending.get(&conn.id) != Some(&revision) { return false; }
        self.pending.remove(&conn.id);
        if self.entries.len() >= 64 {
            if let Some(id) = self.entries.iter().min_by_key(|(_, entry)| entry.revision).map(|(id, _)| id.clone()) {
                self.entries.remove(&id);
            }
        }
        let binding = if service.is_some() { binding(conn) } else { credential_binding(conn) };
        self.entries.insert(conn.id.clone(), Entry { binding, credential, service,
            dependencies: conn.options.resolved_jumps.0.iter().map(|hop| hop.id.clone()).collect(), revision });
        true
    }

    pub fn get(&mut self, conn: &SshConnection) -> Option<Arc<Credential>> {
        // Credentials belong to an endpoint, including when it is flattened into another route.
        if self.entries.get(&conn.id).is_some_and(|entry| entry.credential.is_some() && entry.binding != credential_binding(conn)) {
            self.clear(&conn.id);
        }
        self.entries.get(&conn.id).and_then(|entry| entry.credential.clone())
    }

    pub fn service(&mut self, conn: &SshConnection) -> Option<Arc<RetainedSession>> {
        self.get(conn);
        if self.entries.get(&conn.id).is_some_and(|entry| entry.service.is_some() && entry.binding != binding(conn)) {
            self.clear(&conn.id);
        }
        self.entries.get(&conn.id).and_then(|entry| entry.service.clone())
    }

    pub fn revision_for(&mut self, conn: &SshConnection) -> u64 {
        self.get(conn);
        self.entries.get(&conn.id).map_or(0, |entry| entry.revision)
    }

    pub fn reject(&mut self, id: &str, credential: &Arc<Credential>) {
        if self.entries.get(id).and_then(|entry| entry.credential.as_ref()).is_some_and(|stored| Arc::ptr_eq(stored, credential)) {
            self.entries.remove(id);
        }
    }

    pub fn clear(&mut self, id: &str) {
        self.entries.remove(id);
        self.entries.retain(|_, entry| entry.service.is_none() || !entry.dependencies.iter().any(|dependency| dependency == id));
        self.pending.remove(id);
    }

    pub fn clear_revision(&mut self, id: &str, revision: u64) {
        if self.entries.get(id).is_some_and(|entry| entry.revision == revision) { self.clear(id); }
    }
}

pub static AUTH_CACHE: LazyLock<Mutex<AuthCache>> = LazyLock::new(|| Mutex::new(AuthCache::default()));

pub(crate) fn invalidate_transports() {
    super::interactive_auth::cancel_all();
    if let Ok(mut cache) = AUTH_CACHE.lock() {
        cache.pending.clear();
        cache.entries.retain(|_, entry| entry.service.is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(id: &str) -> SshConnection {
        SshConnection { id: id.into(), name: "server".into(), host: "server.test".into(), port: None,
            user: "tester".into(), auth_method: "key".into(), password: String::new(),
            last_opened_at: None, has_password: false, options: Default::default() }
    }

    fn credential() -> Arc<Credential> {
        Arc::new(Credential { method: AuthMethod::Password, secret: Zeroizing::new("test-secret".into()) })
    }

    #[test]
    fn credentials_are_isolated_by_profile_and_address() {
        let mut cache = AuthCache::default();
        let connection = conn("one");
        let revision = cache.begin("one");
        assert!(cache.store(&connection, revision, credential()));
        assert!(cache.get(&conn("two")).is_none());
        assert!(cache.get(&connection).is_some());
        let mut changed = connection.clone();
        changed.user = "another-user".into();
        assert!(cache.get(&changed).is_none());
        assert!(cache.get(&connection).is_none());
    }

    #[test]
    fn middle_hop_credentials_survive_flattening_without_discarding_its_own_service() {
        let mut cache = AuthCache::default();
        let first = conn("flatten-first");
        let mut second = conn("flatten-second");
        second.options.jump_connection_id = Some(first.id.clone());
        second.options.resolved_jumps.0.push(first);
        let revision = cache.begin(&second.id);
        let secret = credential();
        assert!(cache.store(&second, revision, secret.clone()));
        let mut flattened = second.clone();
        flattened.options.resolved_jumps.0.clear();
        let recovered = cache.get(&flattened).expect("The same hop must retain its credential inside a flattened route");
        assert!(Arc::ptr_eq(&recovered, &secret));
        assert_eq!(cache.revision_for(&flattened), revision);
        let revision = cache.begin(&second.id);
        assert!(cache.store_session(&second, revision, ssh2::Session::new().unwrap()));
        assert!(cache.get(&flattened).is_none());
        assert_eq!(cache.revision_for(&flattened), revision);
        assert!(cache.service(&second).is_some());
        second.options.resolved_jumps.0[0].host = "changed-gateway.test".into();
        assert!(cache.service(&second).is_none());
    }

    #[test]
    fn clearing_or_replacing_invalidates_in_flight_authentication() {
        let mut cache = AuthCache::default();
        let connection = conn("one");
        let first = cache.begin("one");
        let second = cache.begin("one");
        assert!(!cache.store(&connection, first, credential()));
        assert!(cache.store(&connection, second, credential()));
        let third = cache.begin("one");
        cache.clear("one");
        assert!(!cache.store(&connection, third, credential()));
    }

    #[test]
    fn late_rejection_does_not_remove_new_credentials() {
        let mut cache = AuthCache::default();
        let connection = conn("one");
        let old = credential();
        let revision = cache.begin("one");
        cache.store(&connection, revision, Arc::clone(&old));
        let revision = cache.begin("one");
        cache.store(&connection, revision, credential());
        cache.reject("one", &old);
        assert!(cache.get(&connection).is_some());
        let current = cache.get(&connection).unwrap();
        cache.reject("one", &current);
        assert!(cache.get(&connection).is_none());
    }

    #[test]
    fn channel_bindings_follow_credential_replacement_and_forgetting() {
        let mut cache = AuthCache::default();
        let connection = conn("channel-binding");
        assert_eq!(cache.revision_for(&connection), 0);
        let first = cache.begin(&connection.id);
        cache.store(&connection, first, credential());
        assert_eq!(cache.revision_for(&connection), first);
        let second = cache.begin(&connection.id);
        cache.store(&connection, second, credential());
        assert_ne!(cache.revision_for(&connection), first);
        cache.clear(&connection.id);
        assert_eq!(cache.revision_for(&connection), 0);
    }

    #[test]
    fn authenticated_services_are_isolated_and_forgetting_a_hop_retires_its_dependents() {
        let mut cache = AuthCache::default();
        let hop = conn("service-hop");
        let mut target = conn("service-target");
        target.options.resolved_jumps.0.push(hop.clone());
        let revision = cache.begin(&target.id);
        assert!(cache.store_session(&target, revision, ssh2::Session::new().unwrap()));
        assert!(cache.get(&target).is_none());
        assert!(cache.service(&target).is_some());
        assert_eq!(cache.revision_for(&target), revision);
        assert!(cache.service(&conn("other")).is_none());
        cache.clear(&hop.id);
        assert!(cache.service(&target).is_none());
        assert_eq!(cache.revision_for(&target), 0);
        assert!(!cache.store_session(&target, revision, ssh2::Session::new().unwrap()));
    }

    #[test]
    fn expired_service_transports_require_authentication_without_reclassifying_permission_errors() {
        assert!(service_transport_failed("[Session(-43)] Failed getting response"));
        assert!(service_transport_failed("[Session(-9)] Timed out"));
        assert!(!service_transport_failed("[SFTP(3)] Permission denied"));
        assert!(!service_transport_failed("[Session(-21)] Channel request denied"));
    }

    #[test]
    fn every_authentication_target_change_invalidates_credentials() {
        let connection = conn("one");
        let mut alternatives = vec![connection.clone(); 8];
        alternatives[0].host = "other.test".into();
        alternatives[1].port = Some(2222);
        alternatives[2].options.identity_file = Some("other-key".into());
        alternatives[3].options.jump_host = Some("jump.test".into());
        alternatives[4].auth_method = "password".into();
        alternatives[5].options.jump_connection_id = Some("other-jump".into());
        alternatives[6].options.proxy_id = Some("other-proxy".into());
        alternatives[7].options.authentication_mode = Some("ask".into());
        for changed in alternatives {
            let mut cache = AuthCache::default();
            let revision = cache.begin("one");
            cache.store(&connection, revision, credential());
            assert!(cache.get(&changed).is_none());
        }
    }

    #[test]
    fn cache_and_pending_attempts_are_bounded() {
        let mut cache = AuthCache::default();
        for index in 0..100 {
            let connection = conn(&format!("profile-{index}"));
            let revision = cache.begin(&connection.id);
            cache.store(&connection, revision, credential());
        }
        assert_eq!(cache.entries.len(), 64);
        assert!(cache.get(&conn("profile-0")).is_none());
        for index in 0..100 { cache.begin(&format!("pending-{index}")); }
        assert!(cache.pending.len() <= 64);
    }
}
