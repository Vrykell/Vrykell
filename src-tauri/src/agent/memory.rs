//! Scoped facts with transactional revisions and full-text retrieval.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::{Duration, SystemTime, UNIX_EPOCH}};

const DAY: i64 = 86_400_000;
const COLUMNS: &str = "m.id,m.scope,m.key,m.content,m.status,m.source,m.updated_at,m.expires_at,m.revision";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: String, pub scope: String, pub key: String, pub content: String,
    pub status: String, pub source: String, pub updated_at: i64,
    pub expires_at: i64, pub revision: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryQuery {
    pub scope: Option<String>, pub query: Option<String>, pub include_inactive: Option<bool>,
    pub offset: Option<u32>, pub limit: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryWrite {
    pub id: Option<String>, pub expected_revision: Option<i64>, pub scope: String,
    pub key: String, pub content: String, pub status: String, pub source: String,
    pub expires_at: Option<i64>,
}

fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64 }

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryRecord> {
    Ok(MemoryRecord { id: r.get(0)?, scope: r.get(1)?, key: r.get(2)?, content: r.get(3)?,
        status: r.get(4)?, source: r.get(5)?, updated_at: r.get(6)?, expires_at: r.get(7)?, revision: r.get(8)? })
}

fn open_at(dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut db = Connection::open(dir.join("memory.sqlite")).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(3)).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY, scope TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active','inactive','pending')),
            source TEXT NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
            revision INTEGER NOT NULL, UNIQUE(scope,key));
        CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope,status,expires_at);
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(key,content,content='memories',content_rowid='rowid',tokenize='trigram');
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memory_fts(rowid,key,content) VALUES(new.rowid,new.key,new.content); END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memory_fts(memory_fts,rowid,key,content) VALUES('delete',old.rowid,old.key,old.content); END;
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memory_fts(memory_fts,rowid,key,content) VALUES('delete',old.rowid,old.key,old.content);
            INSERT INTO memory_fts(rowid,key,content) VALUES(new.rowid,new.key,new.content); END;
        CREATE TABLE IF NOT EXISTS memory_meta(key TEXT PRIMARY KEY);")
        .map_err(|e| e.to_string())?;
    let imported: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM memory_meta WHERE key='legacy-v1')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if imported { return Ok(db); }
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let imported: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM memory_meta WHERE key='legacy-v1')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !imported {
        for name in ["memory.md", "memory-journal.md"] {
            let path = dir.join(name);
            if !path.is_file() { continue; }
            // Large archives stay on disk; migration never loads an unbounded document.
            if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 2_000_000 { continue; }
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            for (index, line) in text.lines().filter(|s| !s.trim().is_empty()).take(1000).enumerate() {
                let content: String = line.chars().take(2048).collect();
                tx.execute("INSERT INTO memories VALUES(?1,'global',?2,?3,'pending',?4,?5,?5,1)",
                    params![uuid::Uuid::new_v4().to_string(), format!("legacy:{name}:{index}"), content, name, now()]).map_err(|e| e.to_string())?;
            }
        }
        tx.execute("INSERT INTO memory_meta VALUES('legacy-v1')", []).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(db)
}

fn open() -> Result<Connection, String> {
    open_at(&dirs::home_dir().ok_or("Home directory unavailable")?.join(".vrykell"))
}

// Escape literal terms rather than accepting raw full-text query syntax.
fn search_expression(query: &str) -> String {
    let mut terms = Vec::new();
    for word in query.split(|c: char| !c.is_alphanumeric()).filter(|s| !s.is_empty()) {
        let chars: Vec<char> = word.chars().collect();
        if chars.iter().any(|c| *c >= '\u{3000}') {
            for chunk in chars.windows(3).take(32) { terms.push(chunk.iter().collect::<String>()); }
        } else if chars.len() >= 3 { terms.push(word.to_string()); }
        if terms.len() >= 48 { break; }
    }
    terms.truncate(48); terms.sort(); terms.dedup();
    terms.into_iter().map(|s| format!("\"{}\"", s.replace('"', "\"\""))).collect::<Vec<_>>().join(" OR ")
}

fn query_at(db: &Connection, input: MemoryQuery, at: i64) -> Result<Vec<MemoryRecord>, String> {
    let query = input.query.unwrap_or_default();
    if query.chars().count() > 2048 { return Err("Memory query is too long".into()); }
    let expr = search_expression(&query);
    let short = !query.trim().is_empty() && expr.is_empty();
    let join = if expr.is_empty() { "" } else { " JOIN memory_fts ON memory_fts.rowid=m.rowid" };
    let filter = if expr.is_empty() { "" } else { " AND memory_fts MATCH :expr" };
    let order = if expr.is_empty() { "m.updated_at DESC,m.id" } else { "bm25(memory_fts,2.0,1.0),m.updated_at DESC,m.id" };
    let sql = format!("SELECT {COLUMNS} FROM memories m{join}
        WHERE (:scope IS NULL OR m.scope=:scope OR m.scope='global')
        AND (:inactive OR (m.status='active' AND m.expires_at>:at))
        AND (:inactive OR m.scope!='global' OR :scope IS NULL OR :scope='global' OR NOT EXISTS (
            SELECT 1 FROM memories override WHERE override.scope=:scope AND override.key=m.key
            AND override.status='active' AND override.expires_at>:at))
        AND (NOT :short OR instr(lower(m.key || ' ' || m.content),lower(:literal))>0)
        {filter} ORDER BY {order} LIMIT :limit OFFSET :offset");
    let mut statement = db.prepare(&sql).map_err(|e| e.to_string())?;
    for (name, value) in [
        (":scope", input.scope.map(rusqlite::types::Value::Text).unwrap_or(rusqlite::types::Value::Null)),
        (":inactive", (input.include_inactive.unwrap_or(false) as i64).into()),
        (":at", at.into()), (":short", (short as i64).into()), (":literal", query.trim().to_string().into()),
        (":limit", i64::from(input.limit.unwrap_or(20).clamp(1, 50)).into()),
        (":offset", i64::from(input.offset.unwrap_or(0).min(100_000)).into()), (":expr", expr.into()),
    ] {
        if let Some(index) = statement.parameter_index(name).map_err(|e| e.to_string())? {
            statement.raw_bind_parameter(index, value).map_err(|e| e.to_string())?;
        }
    }
    let rows = statement.raw_query().mapped(row).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

fn save_at(db: &mut Connection, input: MemoryWrite, at: i64) -> Result<MemoryRecord, String> {
    if input.scope.trim().is_empty() || input.scope.len() > 2048 || input.key.trim().is_empty() || input.key.chars().count() > 160
        || input.content.trim().is_empty() || input.content.chars().count() > 2048 || input.source.len() > 512
        || !["active", "inactive", "pending"].contains(&input.status.as_str()) {
        return Err("Invalid memory: provide a scope, a key and at most 2048 content characters".into());
    }
    let expires = input.expires_at.unwrap_or(at + 90 * DAY);
    if input.status == "active" && (expires <= at || expires > at + 366 * DAY) {
        return Err("Active memories require an expiry within 366 days".into());
    }
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let id = input.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if input.id.is_some() {
        let previous: Option<(String, String)> = tx.query_row("SELECT scope,status FROM memories WHERE id=?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional().map_err(|e| e.to_string())?;
        if previous.is_some_and(|(scope, status)| scope != input.scope && status != "pending") {
            return Err("An existing fact cannot change scope. Create a scoped override instead".into());
        }
        let changed = tx.execute("UPDATE memories SET scope=?1,key=?2,content=?3,status=?4,source=?5,updated_at=?6,expires_at=?7,revision=revision+1 WHERE id=?8 AND revision=?9",
            params![input.scope, input.key.trim(), input.content.trim(), input.status, input.source, at, expires, id, input.expected_revision])
            .map_err(memory_write_error)?;
        if changed != 1 { return Err("Memory changed or no longer exists. Reload before saving".into()); }
    } else {
        tx.execute("INSERT INTO memories VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1)",
            params![id, input.scope, input.key.trim(), input.content.trim(), input.status, input.source, at, expires])
            .map_err(memory_write_error)?;
    }
    let result = tx.query_row(&format!("SELECT {COLUMNS} FROM memories m WHERE id=?1"), [&id], row).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

fn memory_write_error(error: rusqlite::Error) -> String {
    if matches!(&error, rusqlite::Error::SqliteFailure(code, _) if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE) {
        "Memory key already exists in this scope. Read it and update its revision".into()
    } else {
        error.to_string()
    }
}

#[tauri::command]
pub async fn query_memories(input: MemoryQuery) -> Result<Vec<MemoryRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || query_at(&open()?, input, now())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_memory(input: MemoryWrite) -> Result<MemoryRecord, String> {
    tauri::async_runtime::spawn_blocking(move || save_at(&mut open()?, input, now())).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats { pub total: i64, pub active: i64, pub pending: i64, pub inactive: i64, pub expired: i64 }

#[tauri::command]
pub async fn memory_stats() -> Result<MemoryStats, String> {
    tauri::async_runtime::spawn_blocking(move || stats_at(&open()?, now())).await.map_err(|e| e.to_string())?
}

fn stats_at(db: &Connection, at: i64) -> Result<MemoryStats, String> {
    db.query_row("SELECT count(*), coalesce(sum(status='active' AND expires_at>?1),0),
        coalesce(sum(status='pending'),0), coalesce(sum(status='inactive'),0),
        coalesce(sum(status='active' AND expires_at<=?1),0) FROM memories", [at], |r|
        Ok(MemoryStats { total: r.get(0)?, active: r.get(1)?, pending: r.get(2)?, inactive: r.get(3)?, expired: r.get(4)? }))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (std::path::PathBuf, Connection) {
        let dir = std::env::temp_dir().join(format!("memory-{}", uuid::Uuid::new_v4()));
        let db = open_at(&dir).unwrap(); (dir, db)
    }
    fn write(scope: &str, key: &str, content: &str) -> MemoryWrite {
        MemoryWrite { id: None, expected_revision: None, scope: scope.into(), key: key.into(), content: content.into(), status: "active".into(), source: "user".into(), expires_at: None }
    }
    fn query(scope: Option<&str>, text: &str, inactive: bool) -> MemoryQuery {
        MemoryQuery { scope: scope.map(str::to_string), query: Some(text.into()), include_inactive: Some(inactive), offset: None, limit: None }
    }
    #[test]
    fn retrieval_filters_scopes_expiry_and_updates_the_index() {
        let (dir, mut db) = fixture();
        let first = save_at(&mut db, write("local:a", "editor", "Uses terminal editor"), 100).unwrap();
        save_at(&mut db, write("local:b", "editor", "Other terminal editor"), 100).unwrap();
        save_at(&mut db, write("global", "language", "Prefers English"), 100).unwrap();
        let mut pending = write("global", "pending", "terminal pending"); pending.status = "pending".into();
        save_at(&mut db, pending, 100).unwrap();
        let counts = stats_at(&db, 101).unwrap();
        assert_eq!((counts.total, counts.active, counts.pending), (4, 3, 1));
        assert_eq!(query_at(&db, query(Some("local:a"), "terminal", false), 101).unwrap().len(), 1);
        assert_eq!(query_at(&db, query(Some("local:a"), "", false), 101).unwrap().len(), 2);
        assert!(query_at(&db, query(Some("local:a"), "terminal", false), 100 + 91 * DAY).unwrap().is_empty());
        assert_eq!(stats_at(&db, 100 + 91 * DAY).unwrap().expired, 3);
        let mut edit = write("local:a", "editor", "Uses graphical editing"); edit.id = Some(first.id); edit.expected_revision = Some(1);
        assert_eq!(save_at(&mut db, edit, 102).unwrap().revision, 2);
        assert!(query_at(&db, query(Some("local:a"), "terminal", false), 103).unwrap().is_empty());
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn revisions_and_keys_prevent_lost_writes_and_duplicate_facts() {
        let (dir, mut db) = fixture();
        let first = save_at(&mut db, write("global", "editor", "first"), 100).unwrap();
        assert!(save_at(&mut db, write("global", "editor", "duplicate"), 100).is_err());
        let mut edit = write("global", "editor", "stale"); edit.id = Some(first.id); edit.expected_revision = Some(0);
        assert!(save_at(&mut db, edit, 101).is_err());
        assert_eq!(query_at(&db, query(None, "", true), 101).unwrap()[0].content, "first");
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn updating_a_project_cannot_move_an_active_global_preference() {
        let (dir, mut db) = fixture();
        let global = save_at(&mut db, write("global", "editor", "global preference"), 100).unwrap();
        let mut edit = write("local:a", "editor", "project preference");
        edit.id = Some(global.id); edit.expected_revision = Some(global.revision);
        assert!(save_at(&mut db, edit, 101).unwrap_err().contains("scope"));
        save_at(&mut db, write("local:a", "editor", "project preference"), 101).unwrap();
        assert_eq!(query_at(&db, query(Some("local:b"), "", false), 102).unwrap()[0].content, "global preference");
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn project_overrides_apply_before_search_and_preserve_explicit_review() {
        let (dir, mut db) = fixture();
        save_at(&mut db, write("global", "editor", "legacy terminal editor"), 100).unwrap();
        let mut project = write("local:a", "editor", "graphical editing");
        project.expires_at = Some(200);
        save_at(&mut db, project, 100).unwrap();
        assert!(query_at(&db, query(Some("local:a"), "legacy", false), 101).unwrap().is_empty());
        assert_eq!(query_at(&db, query(Some("local:a"), "legacy", true), 101).unwrap().len(), 1);
        assert_eq!(query_at(&db, query(Some("local:b"), "legacy", false), 101).unwrap().len(), 1);
        assert_eq!(query_at(&db, query(Some("local:a"), "legacy", false), 201).unwrap().len(), 1);
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn storage_failures_are_not_reported_as_duplicate_keys() {
        let (dir, mut db) = fixture();
        db.execute_batch("PRAGMA query_only=ON").unwrap();
        let error = save_at(&mut db, write("global", "editor", "preference"), 100).unwrap_err();
        assert!(!error.contains("already exists"));
        assert!(error.contains("readonly"));
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn supports_cjk_short_queries_and_literal_syntax() {
        let (dir, mut db) = fixture();
        save_at(&mut db, write("global", "editor", "使用终端编辑器"), 100).unwrap();
        assert_eq!(query_at(&db, query(None, "我用什么编辑器", false), 101).unwrap().len(), 1);
        assert_eq!(query_at(&db, query(None, "终端", false), 101).unwrap().len(), 1);
        assert!(query_at(&db, query(None, "\" OR *", false), 101).unwrap().is_empty());
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn migration_is_pending_idempotent_and_preserves_archives() {
        let dir = std::env::temp_dir().join(format!("memory-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("memory.md"), "Old editor\nOld workflow").unwrap();
        let db = open_at(&dir).unwrap();
        assert!(query_at(&db, query(None, "", false), now()).unwrap().is_empty());
        assert_eq!(query_at(&db, query(None, "", true), now()).unwrap().len(), 2);
        drop(db);
        let db = open_at(&dir).unwrap();
        assert_eq!(query_at(&db, query(None, "", true), now()).unwrap().len(), 2);
        assert_eq!(std::fs::read_to_string(dir.join("memory.md")).unwrap(), "Old editor\nOld workflow");
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
}
