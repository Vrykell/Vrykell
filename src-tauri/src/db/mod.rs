pub mod transfer;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub mod download;
pub mod conversation;
pub mod history;
pub mod history_page;
pub mod workspace_history;
pub mod pane_ownership;
pub mod command_history;
pub mod session;
pub mod ssh_connection;
pub mod workspace;

pub use download::DownloadEntry;
pub use conversation::{ConversationEntry, ConversationMessageEntry};
pub use history::HistoryEntry;
pub use session::{BlockEntry, ChatMessageEntry, GroupEntry, SessionEntry};
pub use ssh_connection::SshConnection;
pub use workspace::WorkspaceEntry;

/// History database path: ~/.vrykell/history.db
fn db_path() -> PathBuf {
    // Native Windows has no HOME, so "." is not a safe fallback (it would write to the cwd).
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = home.join(".vrykell");
    std::fs::create_dir_all(&dir).ok();
    dir.join("history.db")
}

/// Detect an old database: user_version < 2 (v0/v1 lacks columns such as output_html) or unreadable.
/// Do not migrate column by column: recreate from scratch so old SQL cannot fail silently on missing columns.
fn db_needs_reset(path: &std::path::Path) -> bool {
    if !path.exists() {
        return false;
    }
    let Ok(conn) = Connection::open(path) else { return true };
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    version < 2
}

/// Remove the old database file, if present, so open() creates the schema from scratch.
fn reset_old_db(path: &std::path::Path) {
    if db_needs_reset(path) {
        std::fs::remove_file(path).ok();
    }
}

pub struct HistoryDb {
    conn: Connection,
}

/// Initialize tables and add optional columns to compatible version 2 databases.
/// Earlier incompatible schemas are reset by the existing open path.
fn init_schema(conn: &Connection) -> Result<(), String> {
    // Enable foreign keys so blocks.session_id ON DELETE CASCADE takes effect.
    let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
    conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command TEXT NOT NULL,
                cwd TEXT NOT NULL DEFAULT '',
                exit_code INTEGER,
                timestamp INTEGER NOT NULL,
                run_count INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_history_command ON history(command);
            CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
            CREATE INDEX IF NOT EXISTS idx_history_cwd ON history(cwd);

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                created_at INTEGER NOT NULL,
                closed_at INTEGER,
                cwd TEXT NOT NULL DEFAULT '',
                group_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL DEFAULT 'local',
                payload TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_title ON sessions(title);

            CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                collapsed INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                pane_id TEXT,
                command TEXT NOT NULL DEFAULT '',
                cwd TEXT NOT NULL DEFAULT '',
                output_raw TEXT NOT NULL DEFAULT '',
                output_clean TEXT NOT NULL DEFAULT '',
                output_html TEXT NOT NULL DEFAULT '',
                exit_code INTEGER,
                status TEXT NOT NULL DEFAULT 'running',
                started_at INTEGER NOT NULL,
                ended_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_blocks_session ON blocks(session_id);
            CREATE INDEX IF NOT EXISTS idx_blocks_command ON blocks(command);

            CREATE TABLE IF NOT EXISTS workspaces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                added_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ssh_connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                user TEXT NOT NULL DEFAULT '',
                password TEXT NOT NULL DEFAULT '',
                auth_method TEXT NOT NULL DEFAULT 'password',
                last_opened_at INTEGER,
                options_json TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                parts TEXT NOT NULL DEFAULT '',
                attachments TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                local_path TEXT NOT NULL,
                remote_path TEXT NOT NULL,
                connection_name TEXT NOT NULL DEFAULT '',
                is_dir INTEGER NOT NULL DEFAULT 0,
                size INTEGER NOT NULL DEFAULT 0,
                downloaded_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_downloads_time ON downloads(downloaded_at);",
        )
        .map_err(|e| e.to_string())?;

    // Add per-command paths without deleting compatible history databases.
    let has_cwd = conn.prepare("PRAGMA table_info(blocks)")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .any(|column| column.as_deref() == Ok("cwd"));
    if !has_cwd {
        conn.execute_batch("ALTER TABLE blocks ADD COLUMN cwd TEXT NOT NULL DEFAULT '';")
            .map_err(|e| e.to_string())?;
    }
    // Preserve existing connections when adding optional connection settings.
    let has_options = conn.prepare("PRAGMA table_info(ssh_connections)")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .any(|column| column.as_deref() == Ok("options_json"));
    if !has_options {
        conn.execute_batch("ALTER TABLE ssh_connections ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}';")
            .map_err(|e| e.to_string())?;
    }
    // Preserve message ownership when restoring terminal panes.
    let has_chat_pane = conn.prepare("PRAGMA table_info(chat_messages)")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .any(|column| column.as_deref() == Ok("pane_id"));
    if !has_chat_pane {
        conn.execute_batch("ALTER TABLE chat_messages ADD COLUMN pane_id TEXT;")
            .map_err(|e| e.to_string())?;
    }
    conversation::init_conversations(conn)?;
    workspace_history::init_history_metadata(conn)?;
    workspace_history::remove_file_history(conn)?;
    command_history::init(conn)?;
    // Keep the existing schema version to avoid resetting compatible databases.
    conn.execute_batch("PRAGMA user_version = 2;")
        .map_err(|e| format!("Failed to record the schema version: {e}"))?;
    // Create indexes idempotently.
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id);")
        .map_err(|e| e.to_string())?;
    Ok(())
}

impl HistoryDb {
    pub fn open() -> Result<Self, String> {
        let path = db_path();
        // Old databases with missing columns or an outdated version are not migrated column by column; history is recreated from scratch.
        reset_old_db(&path);
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        init_schema(&conn)?;
        Ok(Self { conn })
    }

    /// Degraded open: fall back to an in-memory database when the disk database fails, so history is unavailable but the app keeps running.
    pub fn open_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory sqlite");
        init_schema(&conn).expect("Failed to initialize the in-memory schema");
        Self { conn }
    }

    pub(crate) fn conn(&self) -> &rusqlite::Connection {
        &self.conn
    }
}

/// Global HistoryDb instance owned by Tauri state.
pub struct HistoryState(pub Mutex<HistoryDb>);

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> HistoryDb {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        HistoryDb { conn }
    }

    #[test]
    fn per_command_paths_survive_completion_and_session_path_changes() {
        let db = test_db();
        db.create_session("s1", "terminal", 0, "/latest", "local", "{}").unwrap();
        db.record_block("b1", "s1", None, "pwd", "", "", "", None, "executing", 1, None, "/original").unwrap();
        db.record_block("b1", "s1", None, "pwd", "", "/original", "/original", Some(0), "done", 1, Some(2), "").unwrap();
        db.record_block("b2", "s1", Some("pane2"), "pwd", "", "/other", "/other", Some(0), "done", 3, Some(4), "/other").unwrap();
        let restored = db.get_session_blocks("s1").unwrap();
        assert_eq!(restored[0].cwd, "/original");
        assert_eq!(restored[1].cwd, "/other");
        let found = db.search_blocks("pwd", 10, None).unwrap();
        assert!(found.iter().any(|block| block.cwd == "/original"));
        assert!(found.iter().any(|block| block.cwd == "/other"));
    }

    #[test]
    fn persisted_blocks_and_messages_strip_recognizable_secrets() {
        let db = test_db();
        db.record_block("b1", "s1", None, "export TOKEN=abc123", "", "password=hunter2", "password=hunter2", Some(0), "done", 1, Some(2), "/work").unwrap();
        db.append_chat_message("m1", "s1", "user", "my token=abcdef", 1, "", "").unwrap();
        let block = &db.get_session_blocks("s1").unwrap()[0];
        assert!(!block.command.contains("abc123"));
        assert!(!block.output_clean.contains("hunter2"));
        assert!(!block.output_html.contains("hunter2"));
        let message = &db.get_chat_messages("s1").unwrap()[0];
        assert!(!message.content.contains("abcdef"));
    }

    #[test]
    fn redacted_history_preserves_json_and_uses_plain_output_for_styled_secrets() {
        let db = test_db();
        let parts = r#"[{"type":"text","text":"Authorization: Bearer xy.z"},{"type":"tool","input":{"password":"hunter2"}}]"#;
        let attachments = r#"[{"name":"key","content":"token=abc123"}]"#;
        db.append_chat_message("m1", "s1", "assistant", "ok", 1, parts, attachments).unwrap();
        let messages = db.get_chat_messages("s1").unwrap();
        let message = &messages[0];
        let restored: serde_json::Value = serde_json::from_str(&message.parts).unwrap();
        assert_eq!(restored[0]["type"], "text");
        assert_eq!(restored[1]["input"]["password"], "[redacted]");
        assert!(!message.parts.contains("xy.z"));
        assert!(serde_json::from_str::<serde_json::Value>(&message.attachments).is_ok());
        assert!(!message.attachments.contains("abc123"));
        db.record_block("b1", "s1", None, "cat config", "token=abc123", "token=abc123", "<span>token=</span><span>abc123</span>", Some(0), "done", 1, Some(2), "/work").unwrap();
        let blocks = db.get_session_blocks("s1").unwrap();
        assert_eq!(blocks[0].output_clean, "[redacted]");
        assert!(blocks[0].output_html.is_empty());
    }

    #[test]
    fn command_history_redacts_secrets_before_deduplication_and_search() {
        let db = test_db();
        db.record("export TOKEN=abc123", "/work", Some(0), 1).unwrap();
        db.record("export TOKEN=def456", "/work", Some(0), 2).unwrap();
        let history = db.search("", 10, None, None, None).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].command, "export [redacted]");
        assert_eq!(history[0].run_count, 2);
        assert!(db.search("abc123", 10, None, None, None).unwrap().is_empty());
        let stored: String = db.conn().query_row("SELECT command FROM history", [], |row| row.get(0)).unwrap();
        assert!(!stored.contains("abc123"));
        assert!(!stored.contains("def456"));
    }

    #[test]
    fn styled_secrets_are_removed_from_every_persisted_block_snapshot() {
        let db = test_db();
        db.record_block("b1", "s1", None, "cat config", "pass\x1b[31mword=hunter2", "password=hunter2", "<span>pass</span><span>word=hunter2</span>", Some(0), "done", 1, Some(2), "/work").unwrap();
        let blocks = db.get_session_blocks("s1").unwrap();
        assert_eq!(blocks[0].output_raw, "[redacted]");
        assert_eq!(blocks[0].output_clean, "[redacted]");
        assert!(blocks[0].output_html.is_empty());
        db.record_block("b2", "s1", None, "ls", "\x1b[31mfile\x1b[0m", "file", "<span>file</span>", Some(0), "done", 3, Some(4), "/work").unwrap();
        let blocks = db.get_session_blocks("s1").unwrap();
        assert_eq!(blocks[1].output_raw, "\x1b[31mfile\x1b[0m");
        assert_eq!(blocks[1].output_html, "<span>file</span>");
    }

    #[test]
    fn adding_command_paths_preserves_existing_version_two_history() {
        let db = test_db();
        db.create_session("s1", "saved", 0, "/work", "local", "{}").unwrap();
        db.record_block("b1", "s1", None, "ls", "raw", "files", "files", Some(0), "done", 1, Some(2), "").unwrap();
        db.conn().execute_batch("ALTER TABLE blocks DROP COLUMN cwd;").unwrap();
        init_schema(db.conn()).unwrap();
        init_schema(db.conn()).unwrap();
        let restored = db.get_session_blocks("s1").unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].output_clean, "files");
        assert_eq!(restored[0].cwd, "");
        assert_eq!(db.get_session("s1").unwrap().cwd, "/work");
    }

    #[test]
    fn v1_db_is_detected_and_reset_to_fresh() {
        // Simulate a v1 database: blocks lacks output_html, the source of missing color snapshots in history.
        let dir = std::env::temp_dir().join(format!("vrykell-db-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.db");
        let _ = std::fs::remove_file(&path);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE blocks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, command TEXT NOT NULL DEFAULT '');
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        }
        assert!(db_needs_reset(&path));
        reset_old_db(&path);
        assert!(!path.exists(), "The old database should be removed as a whole");
        // After rebuilding from scratch, blocks contains output_html and record_block no longer fails in SQL.
        let conn = Connection::open(&path).unwrap();
        init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, title, status, created_at) VALUES ('s1','t','active',1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO blocks (id, session_id, command, output_html, started_at) VALUES ('b1','s1','ls','<span>x</span>',1)",
            [],
        )
        .unwrap();
        let html: String = conn
            .query_row("SELECT output_html FROM blocks WHERE id = 'b1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(html, "<span>x</span>");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert!(version >= 2, "A fresh database should carry the current schema version");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn fresh_db_does_not_need_reset() {
        let dir = std::env::temp_dir().join(format!("vrykell-db-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.db");
        let _ = std::fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        init_schema(&conn).unwrap();
        drop(conn);
        assert!(!db_needs_reset(&path), "A fresh database should not be reset");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn record_block_persists_even_before_session_created() {
        let db = test_db();
        // Record a block without create_session first; the fallback INSERT OR IGNORE creates the session row.
        db.record_block("b1", "t9", None, "ls -la", "out", "out", "<span>out</span>", Some(0), "done", 100, Some(200), "/work")
            .unwrap();
        let blocks = db.get_session_blocks("t9").unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].command, "ls -la");
        assert_eq!(blocks[0].output_html, "<span>out</span>");
        // list_sessions should also report block_count > 0.
        let sessions = db.list_sessions().unwrap();
        assert!(sessions.iter().any(|s| s.id == "t9" && s.block_count == 1));
    }

    #[test]
    fn remove_download_drops_only_the_matching_path() {
        let db = test_db();
        db.record_download("a", "/d/a", "/r/a", "conn", false, 1, 1).unwrap();
        db.record_download("b", "/d/b", "/r/b", "conn", false, 1, 2).unwrap();
        db.remove_download("/d/a").unwrap();
        let list = db.list_downloads().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].local_path, "/d/b");
    }

    #[test]
    fn delete_session_cascades_blocks_and_chat() {
        let db = test_db();
        db.create_session("s1", "Title", 0, "", "local", "{}").unwrap();
        db.record_block("b1", "s1", None, "ls", "o", "o", "oh", Some(0), "done", 1, Some(2), "/work").unwrap();
        db.append_chat_message("m1", "s1", "user", "hi", 1, "", "").unwrap();
        db.delete_session("s1").unwrap();
        assert!(db.get_session_blocks("s1").unwrap().is_empty());
        assert!(db.get_chat_messages("s1").unwrap().is_empty());
    }

    #[test]
    fn chat_message_append_upserts_and_lists_in_order() {
        let db = test_db();
        db.create_session("s1", "Title", 0, "", "local", "{}").unwrap();
        db.append_chat_message("m1", "s1", "user", "first", 1, "", "").unwrap();
        db.append_chat_message("m2", "s1", "assistant", "answer", 2, "", "").unwrap();
        // Assistant streaming updates overwrite by id.
        db.append_chat_message("m2", "s1", "assistant", "answer updated", 2, "", "").unwrap();
        let msgs = db.get_chat_messages("s1").unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].content, "first");
        assert_eq!(msgs[1].content, "answer updated");
        // Messages without parts read back as an empty string (the migration column default).
        assert_eq!(msgs[1].parts, "");
    }

    #[test]
    fn chat_message_parts_roundtrip() {
        let db = test_db();
        db.create_session("s1", "Title", 0, "", "local", "{}").unwrap();
        let parts = r#"[{"kind":"text","text":"hi"},{"kind":"tool","tool":{"toolCallId":"t1","toolName":"run_command","input":{"command":"ls"},"state":"done","startedAt":1}}]"#;
        db.append_chat_message("m1", "s1", "assistant", "hi", 1, parts, "").unwrap();
        let msgs = db.get_chat_messages("s1").unwrap();
        assert_eq!(msgs[0].parts, parts);
        // Overwriting the same id updates parts too.
        db.append_chat_message("m1", "s1", "assistant", "hi!", 1, "", "").unwrap();
        assert_eq!(db.get_chat_messages("s1").unwrap()[0].parts, "");
    }

    #[test]
    fn chat_message_delete_is_idempotent() {
        let db = test_db();
        db.create_session("s1", "Title", 0, "", "local", "{}").unwrap();
        db.append_chat_message("m1", "s1", "user", "question", 1, "", "").unwrap();
        db.append_chat_message("m2", "s1", "assistant", "answer", 2, "", "").unwrap();
        // Delete one message; the others remain in order.
        db.delete_chat_message("m1").unwrap();
        let msgs = db.get_chat_messages("s1").unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, "m2");
        // Idempotent: repeated deletes and missing ids are not errors.
        db.delete_chat_message("m1").unwrap();
        db.delete_chat_message("nope").unwrap();
        assert_eq!(db.get_chat_messages("s1").unwrap().len(), 1);
    }

    #[test]
    fn create_session_stores_kind_and_payload() {
        let db = test_db();
        let ssh_payload = r#"{"ssh":{"name":"prod","host":"h","user":"u","port":22,"connectionId":"c1"}}"#;
        db.create_session("ssh-1", "prod", 0, "", "ssh", ssh_payload).unwrap();
        let s = db.get_session("ssh-1").unwrap();
        assert_eq!(s.kind, "ssh");
        assert_eq!(s.payload, ssh_payload);
        assert_eq!(s.group_id, None);

        // Local sessions carry shellType.
        db.create_session("local-1", "Zsh", 0, "/home/u", "local", r#"{"shellType":"zsh"}"#).unwrap();
        let s = db.get_session("local-1").unwrap();
        assert_eq!(s.kind, "local");
        assert_eq!(s.payload, r#"{"shellType":"zsh"}"#);
        assert_eq!(s.cwd, "/home/u");
    }

    #[test]
    fn legacy_collapsed_blocks_keep_output_in_history_and_search() {
        let db = test_db();
        db.conn().execute_batch("ALTER TABLE blocks ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;").unwrap();
        db.create_session("s1", "terminal", 0, "", "local", "{}").unwrap();
        db.record_block("b1", "s1", None, "ls", "files", "files", "files", Some(0), "done", 1, Some(2), "/work").unwrap();
        db.conn().execute("UPDATE blocks SET collapsed = 1 WHERE id = 'b1'", []).unwrap();
        let restored = db.get_session_blocks("s1").unwrap();
        assert_eq!(restored[0].output_clean, "files");
        assert!(serde_json::to_value(&restored[0]).unwrap().get("collapsed").is_none());
        assert_eq!(db.search_blocks("ls", 10, None).unwrap()[0].output_clean, "files");
        db.record_block("b1", "s1", None, "ls", "updated", "updated", "updated", Some(0), "done", 1, Some(3), "/work").unwrap();
        assert_eq!(db.get_session_blocks("s1").unwrap()[0].output_clean, "updated");
    }

    #[test]
    fn update_session_payload_merges_split_layout() {
        let db = test_db();
        db.create_session("s1", "t", 0, "", "local", r#"{"shellType":"zsh"}"#).unwrap();
        db.update_session_payload("s1", r#"{"shellType":"zsh","split":{"dir":"row","sizes":[0.3,0.7]}}"#).unwrap();
        let s = db.get_session("s1").unwrap();
        assert_eq!(s.payload, r#"{"shellType":"zsh","split":{"dir":"row","sizes":[0.3,0.7]}}"#);
    }

    #[test]
    fn list_sessions_returns_kind_and_payload() {
        let db = test_db();
        db.create_session("s1", "t", 0, "", "ssh", r#"{"ssh":{"host":"h"}}"#).unwrap();
        db.create_session("s2", "t", 0, "", "local", "{}").unwrap();
        let sessions = db.list_sessions().unwrap();
        let ssh = sessions.iter().find(|s| s.id == "s1").unwrap();
        let local = sessions.iter().find(|s| s.id == "s2").unwrap();
        assert_eq!(ssh.kind, "ssh");
        assert!(ssh.payload.contains("ssh"));
        assert_eq!(local.kind, "local");
        assert_eq!(local.payload, "{}");
    }

    #[test]
    fn partial_restore_reopens_original_group_without_restoring_other_members() {
        let db = test_db();
        db.create_group("g1", "Project", 1).unwrap();
        for id in ["one", "two"] {
            db.create_session(id, id, 1, "", "local", "{}").unwrap();
            db.session_set_group(id, Some("g1")).unwrap();
        }
        db.sessions_reorder(Some("g1"), &["two".into(), "one".into()]).unwrap();
        db.session_set_group("two", Some("g1")).unwrap();
        assert_eq!(db.get_session("two").unwrap().sort_order, 0);
        db.archive_group("g1", 2).unwrap();
        db.restore_session("one").unwrap();
        db.sessions_reorder(Some("g1"), &["one".into()]).unwrap();
        assert_eq!(db.get_session("one").unwrap().sort_order, 1);
        assert_eq!(db.get_session("two").unwrap().sort_order, 0);
        let groups = db.list_groups().unwrap();
        assert!(!groups[0].archived);
        assert_eq!(groups[0].title, "Project");
        assert_eq!(groups[0].session_count, 1);
        assert_eq!(db.get_session("one").unwrap().group_id.as_deref(), Some("g1"));
        assert_eq!(db.get_session("two").unwrap().status, "historical");
        assert_eq!(db.get_session("two").unwrap().group_id.as_deref(), Some("g1"));
    }

    #[test]
    fn failed_group_reopen_keeps_the_session_historical() {
        let db = test_db();
        db.create_group("g1", "Project", 1).unwrap();
        db.create_session("one", "One", 1, "", "local", "{}").unwrap();
        db.session_set_group("one", Some("g1")).unwrap();
        db.archive_group("g1", 2).unwrap();
        db.conn().execute_batch("CREATE TRIGGER reject_reopen BEFORE UPDATE OF archived ON groups BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
        assert!(db.restore_session("one").is_err());
        assert_eq!(db.get_session("one").unwrap().status, "historical");
        assert!(db.list_groups().unwrap()[0].archived);
    }
}
