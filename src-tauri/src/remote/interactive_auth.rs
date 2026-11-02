//! Bounded, owner-scoped exchanges for server authentication challenges.

use crate::db::SshConnection;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

const CANCELLED: &str = "SSH_AUTH_CANCELLED: Authentication cancelled";
const ROUND_TIMEOUT: Duration = Duration::from_secs(90);
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeTarget {
    connection_id: String,
    host: String,
    port: u16,
    user: String,
}

impl From<&SshConnection> for ChallengeTarget {
    fn from(conn: &SshConnection) -> Self {
        Self { connection_id: conn.id.clone(), host: conn.host.clone(), port: conn.port.unwrap_or(22), user: conn.user.clone() }
    }
}

#[derive(Clone, Serialize)]
pub struct ChallengePrompt { pub text: String, pub echo: bool }

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Challenge {
    HostKey { round: u32, target: ChallengeTarget, fingerprint: String, key_type: String },
    Prompts { round: u32, target: ChallengeTarget, instructions: String, prompts: Vec<ChallengePrompt> },
}

#[derive(Default)]
struct Pending {
    round: u32,
    count: Option<usize>,
    response: Option<Vec<Zeroizing<String>>>,
    cancelled: bool,
    answer_deadline: Option<Instant>,
    committed: Option<(String, u64)>,
}

pub(super) struct Attempt {
    owner: String,
    dependencies: Vec<String>,
    pending: Mutex<Pending>,
    changed: Condvar,
    deadline: Instant,
}

impl Attempt {
    fn cancel(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.cancelled = true;
            pending.response = None;
            let committed = pending.committed.take();
            self.changed.notify_all();
            drop(pending);
            if let Some((id, revision)) = committed {
                if let Ok(mut cache) = super::session_auth::AUTH_CACHE.lock() { cache.clear_revision(&id, revision); }
            }
        }
    }

    pub fn check(&self) -> Result<(), String> {
        let pending = self.pending.lock().map_err(|_| "Authentication exchange is unavailable")?;
        self.check_pending(&pending)
    }

    fn check_pending(&self, pending: &Pending) -> Result<(), String> {
        if pending.cancelled { return Err(CANCELLED.into()); }
        if Instant::now() >= self.deadline { return Err("SSH_AUTH_TIMEOUT: Authentication timed out".into()); }
        Ok(())
    }

    pub fn finish<T>(&self, id: &str, revision: u64, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let mut pending = self.pending.lock().map_err(|_| "Authentication exchange is unavailable")?;
        self.check_pending(&pending)?;
        let result = action()?;
        pending.committed = Some((id.to_owned(), revision));
        Ok(result)
    }

    fn respond(&self, round: u32, responses: Vec<Zeroizing<String>>) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "Authentication exchange is unavailable")?;
        self.check_pending(&pending)?;
        if pending.answer_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err("SSH_AUTH_TIMEOUT: Authentication challenge timed out".into());
        }
        if pending.round != round || pending.count != Some(responses.len()) || pending.response.is_some() {
            return Err("Authentication challenge is no longer current".into());
        }
        if responses.iter().any(|response| response.len() > 4096 || response.contains('\0')) {
            return Err("Authentication responses must be at most 4096 bytes without null characters".into());
        }
        pending.response = Some(responses);
        self.changed.notify_all();
        Ok(())
    }

    fn exchange(&self, count: usize, send: impl FnOnce(u32) -> Result<(), String>) -> Result<Vec<Zeroizing<String>>, String> {
        let mut pending = self.pending.lock().map_err(|_| "Authentication exchange is unavailable")?;
        self.check_pending(&pending)?;
        if count > 16 || pending.round >= 32 { return Err("SSH_AUTH_FAILED: Too many authentication challenges".into()); }
        pending.round += 1;
        pending.count = Some(count);
        pending.response = None;
        let deadline = (Instant::now() + ROUND_TIMEOUT).min(self.deadline);
        pending.answer_deadline = Some(deadline);
        let round = pending.round;
        drop(pending);
        send(round)?;
        let mut pending = self.pending.lock().map_err(|_| "Authentication exchange is unavailable")?;
        loop {
            self.check_pending(&pending)?;
            if let Some(response) = pending.response.take() { pending.count = None; pending.answer_deadline = None; return Ok(response); }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() { pending.cancelled = true; return Err("SSH_AUTH_TIMEOUT: Authentication timed out".into()); }
            pending = self.changed.wait_timeout(pending, remaining).map_err(|_| "Authentication exchange is unavailable")?.0;
        }
    }
}

#[derive(Default)]
struct Registry {
    active: HashMap<String, Arc<Attempt>>,
    cancelled: Vec<(String, String)>,
    completed: Vec<Completion>,
}

struct Completion {
    attempt_id: String,
    owner: String,
    connection_id: String,
    revision: u64,
}

static ATTEMPTS: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(Registry::default()));

pub(super) struct Exchange {
    id: String,
    pub attempt: Arc<Attempt>,
    send: Box<dyn Fn(Challenge) -> Result<(), String> + Send>,
}

impl Exchange {
    pub fn new(id: String, owner: String, conn: &SshConnection, send: impl Fn(Challenge) -> Result<(), String> + Send + 'static) -> Result<Self, String> {
        if id.is_empty() || id.len() > 128 { return Err("Invalid authentication attempt identifier".into()); }
        let mut registry = ATTEMPTS.lock().map_err(|_| "Authentication registry is unavailable")?;
        if registry.cancelled.iter().any(|(cancelled, caller)| *cancelled == id && *caller == owner) { return Err(CANCELLED.into()); }
        if registry.completed.iter().any(|completed| completed.attempt_id == id) { return Err("Authentication attempt identifier has already been used".into()); }
        if registry.active.contains_key(&id) || registry.active.len() >= 16 { return Err("Too many active authentication attempts".into()); }
        let dependencies = conn.options.resolved_jumps.0.iter().map(|hop| hop.id.clone()).chain(std::iter::once(conn.id.clone())).collect();
        let attempt = Arc::new(Attempt { owner, dependencies, pending: Mutex::new(Pending::default()), changed: Condvar::new(), deadline: Instant::now() + ATTEMPT_TIMEOUT });
        registry.active.insert(id.clone(), attempt.clone());
        Ok(Self { id, attempt, send: Box::new(send) })
    }

    pub fn host_key(&self, conn: &SshConnection, fingerprint: String, key_type: String) -> Result<(), String> {
        let response = self.attempt.exchange(1, |round| (self.send)(Challenge::HostKey {
            round, target: conn.into(), fingerprint: fingerprint.clone(), key_type,
        }))?;
        if response[0].as_str() != fingerprint { return Err(CANCELLED.into()); }
        Ok(())
    }

    pub fn prompts(&self, conn: &SshConnection, instructions: &str, prompts: &[ssh2::Prompt<'_>]) -> Result<Vec<String>, String> {
        if instructions.len() > 4096 || prompts.len() > 16 || prompts.iter().any(|prompt| prompt.text.len() > 1024) {
            return Err("SSH_AUTH_FAILED: Authentication challenge exceeded the size limit".into());
        }
        let responses = self.attempt.exchange(prompts.len(), |round| (self.send)(Challenge::Prompts {
            round, target: conn.into(), instructions: instructions.to_owned(),
            prompts: prompts.iter().map(|prompt| ChallengePrompt { text: prompt.text.to_string(), echo: prompt.echo }).collect(),
        }))?;
        // The authentication library takes ownership of the answers. Never retain or log them.
        Ok(responses.iter().map(|response| response.to_string()).collect())
    }
}

impl Drop for Exchange {
    fn drop(&mut self) {
        // Transfer completion metadata atomically with removal, so late cancellation can revoke it.
        if let Ok(mut registry) = ATTEMPTS.lock() {
            if let Ok(mut pending) = self.attempt.pending.lock() {
                pending.cancelled = true;
                pending.response = None;
                self.attempt.changed.notify_all();
                if let Some((connection_id, revision)) = pending.committed.take() {
                    if registry.completed.len() >= 64 { registry.completed.remove(0); }
                    registry.completed.push(Completion { attempt_id: self.id.clone(), owner: self.attempt.owner.clone(), connection_id, revision });
                }
            }
            registry.active.remove(&self.id);
        }
    }
}

#[tauri::command]
pub fn ssh_authentication_respond(webview: tauri::Webview, attempt_id: String, round: u32, responses: Vec<String>) -> Result<(), String> {
    respond(webview.label(), &attempt_id, round, responses)
}

pub(super) fn respond(owner: &str, attempt_id: &str, round: u32, responses: Vec<String>) -> Result<(), String> {
    let responses = responses.into_iter().map(Zeroizing::new).collect();
    let attempt = ATTEMPTS.lock().map_err(|_| "Authentication registry is unavailable")?.active.get(attempt_id).cloned()
        .ok_or("Authentication attempt is no longer active")?;
    if attempt.owner != owner { return Err("Authentication attempt belongs to another window".into()); }
    attempt.respond(round, responses)
}

#[tauri::command]
pub fn ssh_authentication_cancel(webview: tauri::Webview, attempt_id: String) -> Result<(), String> {
    cancel(webview.label(), &attempt_id)
}

fn cancel(owner: &str, attempt_id: &str) -> Result<(), String> {
    if attempt_id.is_empty() || attempt_id.len() > 128 { return Err("Invalid authentication attempt identifier".into()); }
    let mut registry = ATTEMPTS.lock().map_err(|_| "Authentication registry is unavailable")?;
    if let Some(attempt) = registry.active.get(attempt_id) {
        if attempt.owner != owner { return Err("Authentication attempt belongs to another window".into()); }
        attempt.cancel();
    }
    if let Some(completed) = registry.completed.iter().find(|completed| completed.attempt_id == attempt_id) {
        if completed.owner != owner { return Err("Authentication attempt belongs to another window".into()); }
        super::session_auth::AUTH_CACHE.lock().map_err(|_| "SSH authentication cache is unavailable")?
            .clear_revision(&completed.connection_id, completed.revision);
    }
    if registry.cancelled.len() >= 64 { registry.cancelled.remove(0); }
    registry.cancelled.push((attempt_id.to_owned(), owner.to_owned()));
    Ok(())
}

pub(super) fn cancel_connection(id: &str) {
    if let Ok(registry) = ATTEMPTS.lock() {
        for attempt in registry.active.values().filter(|attempt| attempt.dependencies.iter().any(|dependency| dependency == id)) { attempt.cancel(); }
    }
}

pub(super) fn cancel_all() {
    if let Ok(registry) = ATTEMPTS.lock() { for attempt in registry.active.values() { attempt.cancel(); } }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_attempt() -> Arc<Attempt> {
        Arc::new(Attempt { owner: "main".into(), dependencies: vec!["server".into()], pending: Mutex::new(Pending::default()), changed: Condvar::new(), deadline: Instant::now() + ROUND_TIMEOUT })
    }

    #[test]
    fn rounds_reject_replays_wrong_counts_and_oversized_answers() {
        let attempt = new_attempt();
        let answer = attempt.clone();
        let values = attempt.exchange(2, move |round| {
            assert!(answer.respond(round + 1, vec![]).is_err());
            assert!(answer.respond(round, vec![Zeroizing::new("wrong count".into())]).is_err());
            assert!(answer.respond(round, vec![Zeroizing::new("x".repeat(4097)), Zeroizing::new(String::new())]).is_err());
            answer.respond(round, vec![Zeroizing::new("code".into()), Zeroizing::new(String::new())])?;
            assert!(answer.respond(round, vec![Zeroizing::new("replay".into()), Zeroizing::new(String::new())]).is_err());
            Ok(())
        }).unwrap();
        assert_eq!(values[0].as_str(), "code");
        assert!(attempt.respond(1, vec![]).is_err());
        let answer = attempt.clone();
        assert!(attempt.exchange(0, move |round| answer.respond(round, vec![])).unwrap().is_empty());
    }

    #[test]
    fn cancellation_wakes_waiters_and_prevents_committing_a_session() {
        let attempt = new_attempt();
        let cancel = attempt.clone();
        let waiting = std::thread::spawn(move || attempt.exchange(1, |_| { cancel.cancel(); Ok(()) }));
        assert!(waiting.join().unwrap().unwrap_err().contains("SSH_AUTH_CANCELLED"));
        let attempt = new_attempt();
        attempt.cancel();
        assert!(attempt.finish("server", 1, || Ok(())).is_err());
    }

    #[test]
    fn deadlines_and_round_limits_are_enforced() {
        let mut expired = new_attempt();
        Arc::get_mut(&mut expired).unwrap().deadline = Instant::now();
        assert!(expired.exchange(0, |_| Ok(())).unwrap_err().contains("SSH_AUTH_TIMEOUT"));
        let attempt = new_attempt();
        attempt.pending.lock().unwrap().round = 32;
        assert!(attempt.exchange(0, |_| Ok(())).is_err());
        assert!(attempt.exchange(17, |_| Ok(())).is_err());
        attempt.pending.lock().unwrap().answer_deadline = Some(Instant::now());
        assert!(attempt.respond(32, vec![]).unwrap_err().contains("SSH_AUTH_TIMEOUT"));
    }

    #[test]
    fn exchanges_reject_another_window_and_profile_changes_cancel_dependencies() {
        let conn: SshConnection = serde_json::from_value(serde_json::json!({ "id": "exchange-owner-test", "name": "server", "host": "server.test", "user": "tester", "authMethod": "ask" })).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let exchange = Exchange::new(id.clone(), "main".into(), &conn, |_| Ok(())).unwrap();
        assert!(respond("other", &id, 1, vec![]).unwrap_err().contains("another window"));
        assert!(Exchange::new(id.clone(), "other".into(), &conn, |_| Ok(())).is_err());
        cancel_connection(&conn.id);
        assert!(exchange.attempt.check().is_err());
        drop(exchange);
        assert!(respond("main", &id, 1, vec![]).is_err());
    }

    #[test]
    fn cancellation_retires_a_committed_result_without_clearing_a_newer_authentication() {
        let id = uuid::Uuid::new_v4().to_string();
        let conn: SshConnection = serde_json::from_value(serde_json::json!({ "id": id, "name": "server", "host": "server.test", "user": "tester", "authMethod": "ask" })).unwrap();
        let attempt = new_attempt();
        let revision = super::super::session_auth::AUTH_CACHE.lock().unwrap().begin(&id);
        attempt.finish(&id, revision, || {
            assert!(super::super::session_auth::AUTH_CACHE.lock().unwrap().store_session(&conn, revision, ssh2::Session::new().unwrap()));
            Ok(())
        }).unwrap();
        attempt.cancel();
        let mut cache = super::super::session_auth::AUTH_CACHE.lock().unwrap();
        assert!(cache.service(&conn).is_none());
        let newer = cache.begin(&id);
        assert!(cache.store_session(&conn, newer, ssh2::Session::new().unwrap()));
        cache.clear_revision(&id, revision);
        assert!(cache.service(&conn).is_some());
        cache.clear(&id);
    }

    #[test]
    fn cancellation_after_command_completion_still_retires_its_session() {
        let connection_id = uuid::Uuid::new_v4().to_string();
        let attempt_id = uuid::Uuid::new_v4().to_string();
        let conn: SshConnection = serde_json::from_value(serde_json::json!({ "id": connection_id, "name": "server", "host": "server.test", "user": "tester", "authMethod": "ask" })).unwrap();
        let exchange = Exchange::new(attempt_id.clone(), "main".into(), &conn, |_| Ok(())).unwrap();
        let revision = super::super::session_auth::AUTH_CACHE.lock().unwrap().begin(&connection_id);
        exchange.attempt.finish(&connection_id, revision, || {
            assert!(super::super::session_auth::AUTH_CACHE.lock().unwrap().store_session(&conn, revision, ssh2::Session::new().unwrap()));
            Ok(())
        }).unwrap();
        drop(exchange);
        assert!(cancel("another-window", &attempt_id).is_err());
        assert!(super::super::session_auth::AUTH_CACHE.lock().unwrap().service(&conn).is_some());
        cancel("main", &attempt_id).unwrap();
        let mut cache = super::super::session_auth::AUTH_CACHE.lock().unwrap();
        assert!(cache.service(&conn).is_none());
        let newer = cache.begin(&connection_id);
        assert!(cache.store_session(&conn, newer, ssh2::Session::new().unwrap()));
        drop(cache);
        cancel("main", &attempt_id).unwrap();
        let mut cache = super::super::session_auth::AUTH_CACHE.lock().unwrap();
        assert!(cache.service(&conn).is_some());
        cache.clear(&connection_id);
    }
}
