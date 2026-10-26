use super::HistoryDb;
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ConversationEntry {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub environment: String,
}

#[derive(Debug, Serialize)]
pub struct ConversationMessageEntry {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    pub parts: String,
    pub attachments: String,
    pub pane_id: Option<String>,
    pub context: String,
}

pub(super) fn init_conversations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_conversations (
            id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            environment TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS ai_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
            parts TEXT NOT NULL DEFAULT '', attachments TEXT NOT NULL DEFAULT '',
            pane_id TEXT, context TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);
        CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY);",
    )
    .map_err(|e| e.to_string())?;
    // Copy legacy records once; terminal deletion and later startup cannot remove or resurrect conversations.
    conn.execute_batch(
        "BEGIN;
        INSERT OR IGNORE INTO ai_conversations (id, title, created_at, updated_at)
        SELECT 'legacy:' || m.session_id,
            COALESCE((SELECT content FROM chat_messages u WHERE u.session_id=m.session_id AND u.role='user' ORDER BY created_at, rowid LIMIT 1), s.title, ''),
            MIN(m.created_at), MAX(m.created_at)
        FROM chat_messages m LEFT JOIN sessions s ON s.id=m.session_id
        WHERE NOT EXISTS (SELECT 1 FROM app_migrations WHERE name='independent-conversations')
        GROUP BY m.session_id;
        INSERT OR IGNORE INTO ai_messages (id, conversation_id, role, content, created_at, parts, attachments, pane_id)
        SELECT id, 'legacy:' || session_id, role, content, created_at, parts, attachments, pane_id
        FROM chat_messages WHERE NOT EXISTS (SELECT 1 FROM app_migrations WHERE name='independent-conversations');
        INSERT OR IGNORE INTO app_migrations (name) VALUES ('independent-conversations');
        COMMIT;"
    ).map_err(|e| e.to_string())
}

impl HistoryDb {
    pub fn get_conversation(&self, id: &str) -> Result<ConversationEntry, String> {
        self.conn().query_row("SELECT id,title,created_at,updated_at,environment FROM ai_conversations WHERE id=?1", [id], |row| {
            Ok(ConversationEntry { id: row.get(0)?, title: row.get(1)?, created_at: row.get(2)?, updated_at: row.get(3)?, environment: row.get(4)? })
        }).map_err(|error| error.to_string())
    }

    pub fn list_conversations(&self) -> Result<Vec<ConversationEntry>, String> {
        let mut stmt = self.conn().prepare(
            "SELECT id, title, created_at, updated_at, environment FROM ai_conversations ORDER BY updated_at DESC, rowid DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ConversationEntry {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    environment: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn save_conversation(
        &self,
        id: &str,
        title: &str,
        created_at: u64,
        updated_at: u64,
        environment: &str,
    ) -> Result<(), String> {
        let title = crate::redact::redact_text(title);
        let environment = crate::redact::redact_json(environment);
        self.conn().execute(
            "INSERT INTO ai_conversations (id, title, created_at, updated_at, environment) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, environment=excluded.environment",
            params![id, title, created_at as i64, updated_at as i64, environment],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn append_conversation_message(
        &self,
        id: &str,
        conversation_id: &str,
        role: &str,
        content: &str,
        created_at: u64,
        parts: &str,
        attachments: &str,
        pane_id: Option<&str>,
        context: &str,
    ) -> Result<(), String> {
        let content = crate::redact::redact_text(content);
        let parts = crate::redact::redact_json(parts);
        let attachments = crate::redact::redact_json(attachments);
        let context = crate::redact::redact_json(context);
        self.conn().execute(
            "INSERT INTO ai_messages (id, conversation_id, role, content, created_at, parts, attachments, pane_id, context)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET content=excluded.content, parts=excluded.parts, attachments=excluded.attachments, pane_id=excluded.pane_id, context=excluded.context",
            params![id, conversation_id, role, content, created_at as i64, parts, attachments, pane_id, context],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_conversation_messages(
        &self,
        id: &str,
    ) -> Result<Vec<ConversationMessageEntry>, String> {
        let mut stmt = self.conn().prepare(
            "SELECT id, role, content, created_at, parts, attachments, pane_id, context FROM ai_messages WHERE conversation_id=?1 ORDER BY created_at, rowid"
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |row| {
                Ok(ConversationMessageEntry {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    parts: row.get(4)?,
                    attachments: row.get(5)?,
                    pane_id: row.get(6)?,
                    context: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn delete_conversation(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM ai_conversations WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_conversation_message(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM ai_messages WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independent_conversations_redact_secrets_at_every_persistence_boundary() {
        let db = HistoryDb::open_in_memory();
        let secret = "sk-audit-fixture-123456789";
        let json = serde_json::json!({ "label": "keep", "nested": [{ "text": secret }], "apiKey": "fixture-value" }).to_string();
        db.save_conversation("c", secret, 1, 2, &json).unwrap();
        db.append_conversation_message("m", "c", "user", secret, 3, &json, &json, None, &json).unwrap();
        let conversation = db.get_conversation("c").unwrap();
        assert_eq!(conversation.title, "[redacted]");
        let message = db.list_conversation_messages("c").unwrap().remove(0);
        assert_eq!(message.content, "[redacted]");
        for stored in [&conversation.environment, &message.parts, &message.attachments, &message.context] {
            assert!(!stored.contains(secret));
            assert!(!stored.contains("fixture-value"));
            let restored: serde_json::Value = serde_json::from_str(stored).unwrap();
            assert_eq!(restored["label"], "keep");
            assert_eq!(restored["nested"][0]["text"], "[redacted]");
        }
    }

    #[test]
    fn conversations_survive_terminal_deletion_and_have_independent_messages() {
        let db = HistoryDb::open_in_memory();
        db.create_session("terminal", "Shell", 1, "/project", "local", "{}")
            .unwrap();
        db.save_conversation("conversation", "Build failure", 2, 3, "{}")
            .unwrap();
        db.append_conversation_message(
            "message",
            "conversation",
            "user",
            "Help",
            3,
            "",
            "",
            Some("terminal#0"),
            "{\"references\":[]}",
        )
        .unwrap();
        db.delete_session("terminal").unwrap();
        let messages = db.list_conversation_messages("conversation").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].pane_id.as_deref(), Some("terminal#0"));
        db.delete_conversation("conversation").unwrap();
        assert!(db
            .list_conversation_messages("conversation")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn legacy_migration_preserves_records_and_never_resurrects_deleted_conversations() {
        let db = HistoryDb::open_in_memory();
        db.append_chat_message_for_pane(
            "old-user",
            "terminal",
            "user",
            "Old question",
            1,
            "",
            "attachments",
            Some("terminal#0"),
        )
        .unwrap();
        db.append_chat_message_for_pane(
            "old-answer",
            "terminal",
            "assistant",
            "Old answer",
            2,
            "parts",
            "",
            Some("terminal#0"),
        )
        .unwrap();
        db.conn()
            .execute(
                "DELETE FROM app_migrations WHERE name='independent-conversations'",
                [],
            )
            .unwrap();
        init_conversations(db.conn()).unwrap();
        let conversations = db.list_conversations().unwrap();
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0].title, "Old question");
        let messages = db.list_conversation_messages("legacy:terminal").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].attachments, "attachments");
        assert_eq!(messages[1].parts, "parts");
        db.delete_conversation("legacy:terminal").unwrap();
        init_conversations(db.conn()).unwrap();
        assert!(db.list_conversations().unwrap().is_empty());
        assert_eq!(db.get_chat_messages("terminal").unwrap().len(), 2);
    }

    #[test]
    fn retrieves_one_conversation_without_loading_other_records_or_messages() {
        let db = HistoryDb::open_in_memory();
        db.save_conversation("one", "First", 1, 2, "{}").unwrap();
        db.save_conversation("two", "Second", 3, 4, "{}").unwrap();
        let saved = db.get_conversation("one").unwrap();
        assert_eq!(saved.id, "one");
        assert_eq!(saved.title, "First");
        assert_eq!(saved.updated_at, 2);
        assert!(db.get_conversation("missing").is_err());
        assert!(db.get_conversation("one' OR 1=1 --").is_err());
    }
}
