//! Temporary credentials shared by file operations and resource collection.

use crate::db::SshConnection;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use zeroize::Zeroizing;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    Password,
    KeyPassphrase,
}

// Credentials deliberately implement neither Debug nor Serialize.
pub struct Credential {
    pub method: AuthMethod,
    pub secret: Zeroizing<String>,
}

fn binding(conn: &SshConnection) -> (String, u16, String, Option<String>, Option<String>, String) {
    (conn.host.clone(), conn.port.unwrap_or(22), conn.user.clone(),
        conn.options.identity_file.clone(), conn.options.jump_host.clone(), conn.auth_method.clone())
}

struct Entry {
    binding: (String, u16, String, Option<String>, Option<String>, String),
    credential: Arc<Credential>,
    revision: u64,
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
        if self.pending.get(&conn.id) != Some(&revision) { return false; }
        self.pending.remove(&conn.id);
        if self.entries.len() >= 64 {
            if let Some(id) = self.entries.iter().min_by_key(|(_, entry)| entry.revision).map(|(id, _)| id.clone()) {
                self.entries.remove(&id);
            }
        }
        self.entries.insert(conn.id.clone(), Entry { binding: binding(conn), credential, revision });
        true
    }

    pub fn get(&mut self, conn: &SshConnection) -> Option<Arc<Credential>> {
        if self.entries.get(&conn.id).is_some_and(|entry| entry.binding != binding(conn)) {
            self.clear(&conn.id);
        }
        self.entries.get(&conn.id).map(|entry| Arc::clone(&entry.credential))
    }

    pub fn reject(&mut self, id: &str, credential: &Arc<Credential>) {
        if self.entries.get(id).is_some_and(|entry| Arc::ptr_eq(&entry.credential, credential)) {
            self.entries.remove(id);
        }
    }

    pub fn clear(&mut self, id: &str) {
        self.entries.remove(id);
        self.pending.remove(id);
    }
}

pub static AUTH_CACHE: LazyLock<Mutex<AuthCache>> = LazyLock::new(|| Mutex::new(AuthCache::default()));

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
    fn every_authentication_target_change_invalidates_credentials() {
        let connection = conn("one");
        let mut alternatives = vec![connection.clone(); 5];
        alternatives[0].host = "other.test".into();
        alternatives[1].port = Some(2222);
        alternatives[2].options.identity_file = Some("other-key".into());
        alternatives[3].options.jump_host = Some("jump.test".into());
        alternatives[4].auth_method = "password".into();
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
