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

pub struct HistoryDb {
    conn: Connection,
}

/// 建表 / 迁移（open 与测试用 in-memory 连接共用）。
///
/// 迁移策略：`PRAGMA user_version` 版本化。v0（旧库）逐列检查缺失后补齐；
/// 任何「补列失败」都会向上报错——不再吞 ALTER 错误碰运气。
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
                last_opened_at INTEGER
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

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if version < 1 {
        // 旧库补齐（新库的 CREATE TABLE 已含全部列，这里逐列检查幂等跳过）
        ensure_column(conn, "blocks", "output_clean", "ALTER TABLE blocks ADD COLUMN output_clean TEXT NOT NULL DEFAULT '';")?;
        ensure_column(conn, "sessions", "cwd", "ALTER TABLE sessions ADD COLUMN cwd TEXT NOT NULL DEFAULT '';")?;
        ensure_column(conn, "sessions", "group_id", "ALTER TABLE sessions ADD COLUMN group_id TEXT;")?;
        ensure_column(conn, "sessions", "sort_order", "ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;")?;
        ensure_column(conn, "groups", "archived", "ALTER TABLE groups ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;")?;
        ensure_column(conn, "sessions", "kind", "ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'local';")?;
        ensure_column(conn, "sessions", "payload", "ALTER TABLE sessions ADD COLUMN payload TEXT NOT NULL DEFAULT '{}';")?;
        ensure_column(conn, "blocks", "pane_id", "ALTER TABLE blocks ADD COLUMN pane_id TEXT;")?;
        ensure_column(conn, "blocks", "collapsed", "ALTER TABLE blocks ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;")?;
        ensure_column(conn, "chat_messages", "parts", "ALTER TABLE chat_messages ADD COLUMN parts TEXT NOT NULL DEFAULT '';")?;
        ensure_column(conn, "chat_messages", "attachments", "ALTER TABLE chat_messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '';")?;
        conn.execute_batch("PRAGMA user_version = 1;")
            .map_err(|e| format!("记录迁移版本失败：{e}"))?;
    }
    // 索引幂等创建（放在迁移之后：老库在补列前还没有 group_id）
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id);")
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 仅当列缺失时执行 ADD COLUMN；已存在则跳过（区分「列已存在」与「真实迁移失败」）。
fn ensure_column(conn: &Connection, table: &str, column: &str, ddl: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if cols.iter().any(|c| c == column) {
        return Ok(());
    }
    conn.execute_batch(ddl)
        .map_err(|e| format!("迁移失败：{table}.{column} —— {e}"))
}

impl HistoryDb {
    pub fn open() -> Result<Self, String> {
        let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
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
    fn migration_adds_group_columns_to_existing_sessions() {
        // 模拟旧库：sessions 只有老列（无 group_id/sort_order）
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                created_at INTEGER NOT NULL,
                closed_at INTEGER,
                cwd TEXT NOT NULL DEFAULT ''
            );",
        )
        .unwrap();
        // 跑迁移不应 panic，且新列/新表可用
        init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, title, status, created_at, cwd, group_id, sort_order) VALUES ('s1','t','active',0,'', NULL, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO groups (id, title, sort_order, collapsed, created_at) VALUES ('g1','g',0,0,0)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn record_block_persists_even_before_session_created() {
        let db = test_db();
        // 不先 create_session，直接记 block —— 兜底 INSERT OR IGNORE 会话行
        db.record_block("b1", "t9", None, "ls -la", "out", "out", Some(0), "done", 100, Some(200))
            .unwrap();
        let blocks = db.get_session_blocks("t9").unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].command, "ls -la");
        // list_sessions 的 block_count 也应 > 0
        let sessions = db.list_sessions().unwrap();
        assert!(sessions.iter().any(|s| s.id == "t9" && s.block_count == 1));
    }

    #[test]
    fn delete_session_cascades_blocks_and_chat() {
        let db = test_db();
        db.create_session("s1", "标题", 0, "", "local", "{}").unwrap();
        db.record_block("b1", "s1", None, "ls", "o", "o", Some(0), "done", 1, Some(2)).unwrap();
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
        db.record_block("b1", "s1", None, "ls", "o", "o", Some(0), "done", 1, Some(2)).unwrap();
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
