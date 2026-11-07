use super::HistoryDb;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// Metadata shown by the history page. The transcript itself is read only when it is opened.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpTranscriptSummary {
    pub harness: String,
    pub session_id: String,
    pub cwd: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub pending: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpTranscriptDetail {
    #[serde(flatten)]
    pub summary: AcpTranscriptSummary,
    pub messages: String,
}

/// Keep the local transcript store bounded: a session is dropped only after it has been inactive
/// long enough to leave this window.
const MAX_STORED_TRANSCRIPTS: i64 = 200;

pub(super) fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS acp_transcripts (
            harness TEXT NOT NULL,
            session_id TEXT NOT NULL,
            cwd TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            pending INTEGER NOT NULL DEFAULT 0,
            messages TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY (harness, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_acp_transcripts_updated ON acp_transcripts(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_acp_transcripts_harness ON acp_transcripts(harness);",
    )
    .map_err(|error| error.to_string())
}

impl HistoryDb {
    /// Upsert one transcript. Both the title and the message body pass the shared redaction
    /// boundary, exactly like native conversations: recognizable secrets never enter the database.
    #[allow(clippy::too_many_arguments)]
    pub fn save_acp_transcript(
        &self,
        harness: &str,
        session_id: &str,
        cwd: &str,
        title: &str,
        created_at: u64,
        updated_at: u64,
        pending: bool,
        messages: &str,
    ) -> Result<(), String> {
        let title = crate::redact::redact_text(title);
        let messages = crate::redact::redact_json(messages);
        self.conn()
            .execute(
                "INSERT INTO acp_transcripts (harness, session_id, cwd, title, created_at, updated_at, pending, messages)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(harness, session_id) DO UPDATE SET
                    cwd=excluded.cwd, title=excluded.title, created_at=excluded.created_at,
                    updated_at=excluded.updated_at, pending=excluded.pending, messages=excluded.messages",
                params![harness, session_id, cwd, title, created_at as i64, updated_at as i64, pending, messages],
            )
            .map_err(|error| error.to_string())?;
        self.conn()
            .execute(
                "DELETE FROM acp_transcripts WHERE rowid IN (
                    SELECT rowid FROM acp_transcripts ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?1
                )",
                params![MAX_STORED_TRANSCRIPTS],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn list_acp_transcripts(&self) -> Result<Vec<AcpTranscriptSummary>, String> {
        let mut statement = self
            .conn()
            .prepare(
                "SELECT harness, session_id, cwd, title, created_at, updated_at, pending
                 FROM acp_transcripts ORDER BY updated_at DESC, harness ASC, session_id ASC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(AcpTranscriptSummary {
                    harness: row.get(0)?,
                    session_id: row.get(1)?,
                    cwd: row.get(2)?,
                    title: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    pending: row.get::<_, i64>(6)? != 0,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn get_acp_transcript(
        &self,
        harness: &str,
        session_id: &str,
    ) -> Result<Option<AcpTranscriptDetail>, String> {
        self.conn()
            .query_row(
                "SELECT harness, session_id, cwd, title, created_at, updated_at, pending, messages
                 FROM acp_transcripts WHERE harness=?1 AND session_id=?2",
                params![harness, session_id],
                |row| {
                    Ok(AcpTranscriptDetail {
                        summary: AcpTranscriptSummary {
                            harness: row.get(0)?,
                            session_id: row.get(1)?,
                            cwd: row.get(2)?,
                            title: row.get(3)?,
                            created_at: row.get(4)?,
                            updated_at: row.get(5)?,
                            pending: row.get::<_, i64>(6)? != 0,
                        },
                        messages: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn delete_acp_transcript(&self, harness: &str, session_id: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "DELETE FROM acp_transcripts WHERE harness=?1 AND session_id=?2",
                params![harness, session_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcripts_round_trip_per_agent_and_session_and_redact_secrets() {
        let db = HistoryDb::open_in_memory();
        let messages = serde_json::json!([
            { "id": "q", "role": "user", "content": "Use token=abc123", "createdAt": 1 },
            { "id": "a", "role": "assistant", "content": "Done", "createdAt": 2 }
        ])
        .to_string();
        db.save_acp_transcript("Agent", "s1", "/work", "Investigate", 1, 2, true, &messages)
            .unwrap();
        db.save_acp_transcript("Another", "s1", "/other", "Other", 3, 4, false, "[]")
            .unwrap();

        let summaries = db.list_acp_transcripts().unwrap();
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].harness, "Another");
        let stored = db.get_acp_transcript("Agent", "s1").unwrap().unwrap();
        assert_eq!(stored.summary.title, "Investigate");
        assert_eq!(stored.summary.cwd, "/work");
        assert!(stored.summary.pending);
        assert!(!stored.messages.contains("abc123"));
        assert!(stored.messages.contains("[redacted]"));
        let wire = serde_json::to_value(&stored).unwrap();
        assert_eq!(wire["sessionId"], "s1");
        assert_eq!(wire["createdAt"], 1);
        assert!(wire["pending"].as_bool().unwrap());

        db.delete_acp_transcript("Agent", "s1").unwrap();
        assert!(db.get_acp_transcript("Agent", "s1").unwrap().is_none());
        assert_eq!(db.list_acp_transcripts().unwrap().len(), 1);
    }

    #[test]
    fn transcript_updates_keep_the_latest_payload_and_bound_the_store() {
        let db = HistoryDb::open_in_memory();
        for index in 0..(MAX_STORED_TRANSCRIPTS + 1) {
            db.save_acp_transcript("Agent", &format!("s{index}"), "/work", "Title", index as u64, index as u64, false, "[]")
                .unwrap();
        }
        assert_eq!(db.list_acp_transcripts().unwrap().len(), MAX_STORED_TRANSCRIPTS as usize);
        db.save_acp_transcript("Agent", "later", "/work", "New", 9999, 9999, false, "[]")
            .unwrap();
        db.save_acp_transcript("Agent", "later", "/work", "Updated", 9999, 10000, false, "[{\"id\":\"m\"}]")
            .unwrap();
        let stored = db.get_acp_transcript("Agent", "later").unwrap().unwrap();
        assert_eq!(stored.summary.title, "Updated");
        assert_eq!(stored.messages, "[{\"id\":\"m\"}]");
        assert!(db.get_acp_transcript("Agent", "s0").unwrap().is_none());
    }
}
