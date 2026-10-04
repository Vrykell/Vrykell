use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub mod download;
pub mod history;
pub mod session;
pub mod ssh_connection;
pub mod workspace;

pub use download::DownloadEntry;
pub use history::HistoryEntry;
pub use session::{BlockEntry, ChatMessageEntry, GroupEntry, SessionEntry};
pub use ssh_connection::SshConnection;
pub use workspace::WorkspaceEntry;

/// 历史数据库路径：~/.vrykell/history.db
fn db_path() -> PathBuf {
    // Windows 原生环境没有 HOME，不能用 "." 兜底（会写到 cwd）
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = home.join(".vrykell");
    std::fs::create_dir_all(&dir).ok();
    dir.join("history.db")
}

/// 旧库检测：user_version < 2（v0/v1，缺 output_html 等新列）或无法读取 → 需要重置。
/// 不做逐列迁移 —— 直接删库从零开始，避免旧库 SQL 因缺列静默失败（历史块消失）。
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

/// 删除旧库文件（如有），让 open() 从零建表。
fn reset_old_db(path: &std::path::Path) {
    if db_needs_reset(path) {
        std::fs::remove_file(path).ok();
    }
}

pub struct HistoryDb {
    conn: Connection,
}

/// 建表（open 与测试用 in-memory 连接共用）。
///
/// 不做逐列迁移：旧库（v1 及更早）由 HistoryDb::open 的 reset_old_db 整库删除
/// 后从零重建，新库统一标记 `PRAGMA user_version = 2`。
fn init_schema(conn: &Connection) -> Result<(), String> {
    // 开启外键约束，使 blocks.session_id 的 ON DELETE CASCADE 真正生效
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
                output_raw TEXT NOT NULL DEFAULT '',
                output_clean TEXT NOT NULL DEFAULT '',
                output_html TEXT NOT NULL DEFAULT '',
                exit_code INTEGER,
                status TEXT NOT NULL DEFAULT 'running',
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                collapsed INTEGER NOT NULL DEFAULT 0
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
    // Keep the existing schema version to avoid resetting compatible databases.
    conn.execute_batch("PRAGMA user_version = 2;")
        .map_err(|e| format!("记录 schema 版本失败：{e}"))?;
    // 索引幂等创建
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id);")
        .map_err(|e| e.to_string())?;
    Ok(())
}

impl HistoryDb {
    pub fn open() -> Result<Self, String> {
        let path = db_path();
        // 旧库（缺新列/版本过旧）不做逐列迁移 —— 直接删除历史从零开始
        reset_old_db(&path);
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        init_schema(&conn)?;
        Ok(Self { conn })
    }

    /// 降级打开：磁盘 DB 失败时用内存库兜底（历史功能不可用，应用可继续跑）。
    pub fn open_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("in-memory sqlite 打开失败");
        init_schema(&conn).expect("in-memory schema 初始化失败");
        Self { conn }
    }

    pub(crate) fn conn(&self) -> &rusqlite::Connection {
        &self.conn
    }
}

/// 全局 HistoryDb 实例（由 Tauri manage 持有）
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
    fn v1_db_is_detected_and_reset_to_fresh() {
        // 模拟 v1 旧库：blocks 缺 output_html 列（历史命令块颜色快照缺失的来源）
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
        assert!(!path.exists(), "旧库应被整库删除");
        // 从零重建后：blocks 含 output_html，record_block 不再 SQL 失败
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
        assert!(version >= 2, "新库应标记当前 schema 版本");
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
        assert!(!db_needs_reset(&path), "新库不应被重置");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn record_block_persists_even_before_session_created() {
        let db = test_db();
        // 不先 create_session，直接记 block —— 兜底 INSERT OR IGNORE 会话行
        db.record_block("b1", "t9", None, "ls -la", "out", "out", "<span>out</span>", Some(0), "done", 100, Some(200))
            .unwrap();
        let blocks = db.get_session_blocks("t9").unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].command, "ls -la");
        assert_eq!(blocks[0].output_html, "<span>out</span>");
        // list_sessions 的 block_count 也应 > 0
        let sessions = db.list_sessions().unwrap();
        assert!(sessions.iter().any(|s| s.id == "t9" && s.block_count == 1));
    }

    #[test]
    fn delete_session_cascades_blocks_and_chat() {
        let db = test_db();
        db.create_session("s1", "标题", 0, "", "local", "{}").unwrap();
        db.record_block("b1", "s1", None, "ls", "o", "o", "oh", Some(0), "done", 1, Some(2)).unwrap();
        db.append_chat_message("m1", "s1", "user", "hi", 1, "", "").unwrap();
        db.delete_session("s1").unwrap();
        assert!(db.get_session_blocks("s1").unwrap().is_empty());
        assert!(db.get_chat_messages("s1").unwrap().is_empty());
    }

    #[test]
    fn chat_message_append_upserts_and_lists_in_order() {
        let db = test_db();
        db.create_session("s1", "标题", 0, "", "local", "{}").unwrap();
        db.append_chat_message("m1", "s1", "user", "第一", 1, "", "").unwrap();
        db.append_chat_message("m2", "s1", "assistant", "答", 2, "", "").unwrap();
        // 助手流式更新（同 id 覆盖）
        db.append_chat_message("m2", "s1", "assistant", "答案", 2, "", "").unwrap();
        let msgs = db.get_chat_messages("s1").unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].content, "第一");
        assert_eq!(msgs[1].content, "答案");
        // 未写 parts 的消息读回空串（迁移列默认值）
        assert_eq!(msgs[1].parts, "");
    }

    #[test]
    fn chat_message_parts_roundtrip() {
        let db = test_db();
        db.create_session("s1", "标题", 0, "", "local", "{}").unwrap();
        let parts = r#"[{"kind":"text","text":"hi"},{"kind":"tool","tool":{"toolCallId":"t1","toolName":"run_command","input":{"command":"ls"},"state":"done","startedAt":1}}]"#;
        db.append_chat_message("m1", "s1", "assistant", "hi", 1, parts, "").unwrap();
        let msgs = db.get_chat_messages("s1").unwrap();
        assert_eq!(msgs[0].parts, parts);
        // 同 id 覆盖时 parts 同步更新
        db.append_chat_message("m1", "s1", "assistant", "hi!", 1, "", "").unwrap();
        assert_eq!(db.get_chat_messages("s1").unwrap()[0].parts, "");
    }

    #[test]
    fn chat_message_delete_is_idempotent() {
        let db = test_db();
        db.create_session("s1", "标题", 0, "", "local", "{}").unwrap();
        db.append_chat_message("m1", "s1", "user", "问", 1, "", "").unwrap();
        db.append_chat_message("m2", "s1", "assistant", "答", 2, "", "").unwrap();
        // 删除其中一条，其余保留且顺序不变
        db.delete_chat_message("m1").unwrap();
        let msgs = db.get_chat_messages("s1").unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, "m2");
        // 幂等：重复删除 / 删除不存在的 id 均不报错
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

        // 本地会话带 shellType
        db.create_session("local-1", "Zsh", 0, "/home/u", "local", r#"{"shellType":"zsh"}"#).unwrap();
        let s = db.get_session("local-1").unwrap();
        assert_eq!(s.kind, "local");
        assert_eq!(s.payload, r#"{"shellType":"zsh"}"#);
        assert_eq!(s.cwd, "/home/u");
    }

    #[test]
    fn set_block_collapsed_persists_and_reads_back() {
        let db = test_db();
        db.create_session("s1", "t", 0, "", "local", "{}").unwrap();
        db.record_block("b1", "s1", None, "ls", "o", "o", "oh", Some(0), "done", 1, Some(2)).unwrap();
        assert!(!db.get_session_blocks("s1").unwrap()[0].collapsed);
        db.set_block_collapsed("b1", true).unwrap();
        assert!(db.get_session_blocks("s1").unwrap()[0].collapsed);
        db.set_block_collapsed("b1", false).unwrap();
        assert!(!db.get_session_blocks("s1").unwrap()[0].collapsed);
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
}
