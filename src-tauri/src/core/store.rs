use std::collections::HashMap;

use super::models::SessionInfo;

#[cfg(test)]
use super::models::{SessionOptions, SessionType};

/// In-memory session store. Phase 4: add disk persistence.
pub struct SessionStore {
    sessions: HashMap<String, SessionInfo>,
    counter: u32,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            counter: 0,
        }
    }

    pub fn add(&mut self, mut session: SessionInfo) {
        self.counter += 1;
        if session.id.is_empty() {
            session.id = format!("local-{}-{}", self.counter, std::time::UNIX_EPOCH.elapsed().unwrap().as_millis());
        }
        self.sessions.insert(session.id.clone(), session);
    }

    pub fn remove(&mut self, id: &str) {
        self.sessions.remove(id);
    }

    pub fn get(&self, id: &str) -> Option<&SessionInfo> {
        self.sessions.get(id)
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions.values().cloned().collect()
    }

    pub fn update_title(&mut self, id: &str, title: &str) {
        if let Some(s) = self.sessions.get_mut(id) {
            s.title = title.to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> SessionInfo {
        SessionInfo {
            id: id.to_string(),
            session_type: SessionType::Local,
            title: "bash".to_string(),
            cwd: None,
            shell: None,
            cols: 80,
            rows: 24,
            created_at: 0,
            host: None,
            username: None,
        }
    }

    #[test]
    fn add_generates_id_when_empty() {
        let mut store = SessionStore::new();
        let s = sample("");
        store.add(s);
        assert!(!store.list()[0].id.is_empty());
    }

    #[test]
    fn list_returns_all_sessions() {
        let mut store = SessionStore::new();
        store.add(sample("a"));
        store.add(sample("b"));
        assert_eq!(store.list().len(), 2);
    }

    #[test]
    fn remove_deletes_session() {
        let mut store = SessionStore::new();
        store.add(sample("a"));
        store.remove("a");
        assert!(store.get("a").is_none());
    }

    #[test]
    fn update_title_changes_title() {
        let mut store = SessionStore::new();
        store.add(sample("a"));
        store.update_title("a", "zsh");
        assert_eq!(store.get("a").unwrap().title, "zsh");
    }
}
