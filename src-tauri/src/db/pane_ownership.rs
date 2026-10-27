use super::HistoryDb;
use rusqlite::params;
use std::collections::HashSet;

impl HistoryDb {
    /// Delete only the selected pane history, retaining sibling panes and the session row.
    pub fn delete_terminal_panes(&self, session: &str, panes: &[String]) -> Result<(), String> {
        if session.is_empty() || session.len() > 256 || panes.is_empty() || panes.len() > 4
            || panes.iter().any(|id| id.is_empty() || id.len() > 256)
            || panes.iter().collect::<HashSet<_>>().len() != panes.len() {
            return Err("Invalid pane deletion".into());
        }
        let transaction = self.conn().unchecked_transaction().map_err(|error| error.to_string())?;
        for pane in panes {
            transaction.execute("DELETE FROM blocks WHERE session_id=?1 AND pane_id=?2", params![session, pane]).map_err(|error| error.to_string())?;
            transaction.execute("DELETE FROM chat_messages WHERE session_id=?1 AND pane_id=?2", params![session, pane]).map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    /// Reparent persisted pane content without copying it or changing process identity.
    pub fn move_terminal_panes(&self, source: &str, target: &str, panes: &[String]) -> Result<(), String> {
        if source == target || source.is_empty() || target.is_empty() || source.len() > 256 || target.len() > 256
            || panes.is_empty() || panes.len() > 4 || panes.iter().any(|id| id.is_empty() || id.len() > 256)
            || panes.iter().collect::<HashSet<_>>().len() != panes.len() {
            return Err("Invalid pane transfer".into());
        }
        let transaction = self.conn().unchecked_transaction().map_err(|error| error.to_string())?;
        for id in [source, target] {
            let kind: String = transaction.query_row("SELECT kind FROM sessions WHERE id=?1", params![id], |row| row.get(0)).map_err(|error| error.to_string())?;
            if !matches!(kind.as_str(), "session" | "local" | "ssh") { return Err("The transfer requires terminal sessions".into()); }
        }
        for pane in panes {
            transaction.execute("UPDATE blocks SET session_id=?1 WHERE session_id=?2 AND pane_id=?3", params![target, source, pane]).map_err(|error| error.to_string())?;
            transaction.execute("UPDATE chat_messages SET session_id=?1 WHERE session_id=?2 AND pane_id=?3", params![target, source, pane]).map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfers_only_selected_content_and_preserves_it_when_the_source_is_deleted() {
        let db = HistoryDb::open_in_memory();
        for id in ["source", "target", "other"] { db.create_session(id, id, 1, "", "session", "{}").unwrap(); }
        for (id, pane) in [("a", Some("source#0")), ("b", Some("source#1"))] {
            db.record_block(id, "source", pane, "command", "output", "output", "", None, "done", 1, None, "").unwrap();
        }
        db.append_chat_message_for_pane("chat", "source", "user", "text", 1, "", "", Some("source#1")).unwrap();
        db.move_terminal_panes("source", "target", &["source#1".into()]).unwrap();
        assert_eq!(db.get_session_blocks("target").unwrap().len(), 1);
        assert_eq!(db.get_chat_messages("target").unwrap().len(), 1);
        assert_eq!(db.get_session_blocks("source").unwrap().len(), 1);
        db.move_terminal_panes("source", "target", &["source#0".into()]).unwrap();
        assert_eq!(db.get_session_blocks("target").unwrap().len(), 2);
        db.move_terminal_panes("source", "target", &["source#0".into()]).unwrap();
        db.delete_session("source").unwrap();
        assert_eq!(db.get_session_blocks("target").unwrap().len(), 2);
        assert!(db.get_session_blocks("other").unwrap().is_empty());
    }

    #[test]
    fn rejects_invalid_transfers_without_changing_ownership() {
        let db = HistoryDb::open_in_memory();
        db.create_session("source", "Source", 1, "", "session", "{}").unwrap();
        db.create_session("target", "Target", 1, "", "workspace", "{}").unwrap();
        for (source, target, panes) in [
            ("source", "source", vec!["pane".into()]), ("", "target", vec!["pane".into()]),
            ("source", "", vec!["pane".into()]), ("source", "target", vec![]),
            ("source", "target", vec!["".into()]), ("source", "target", vec!["pane".into(), "pane".into()]),
            ("source", "missing", vec!["pane".into()]), ("source", "target", vec!["pane".into()]),
        ] { assert!(db.move_terminal_panes(source, target, &panes).is_err()); }
        assert!(db.move_terminal_panes(&"s".repeat(257), "target", &["pane".into()]).is_err());
        assert!(db.move_terminal_panes("source", &"t".repeat(257), &["pane".into()]).is_err());
        assert!(db.move_terminal_panes("source", "target", &["p".repeat(257)]).is_err());
        assert!(db.move_terminal_panes("source", "target", &(0..5).map(|i| i.to_string()).collect::<Vec<_>>()).is_err());
    }

    #[test]
    fn deletes_only_requested_panes_and_accepts_repeated_deletion() {
        let db = HistoryDb::open_in_memory();
        db.create_session("source", "Source", 1, "", "session", "{}").unwrap();
        for (id, pane) in [("a", Some("source#0")), ("b", Some("source#1"))] {
            db.record_block(id, "source", pane, "command", "output", "output", "", None, "done", 1, None, "").unwrap();
        }
        db.append_chat_message_for_pane("a", "source", "user", "text", 1, "", "", Some("source#1")).unwrap();
        db.delete_terminal_panes("source", &["source#1".into()]).unwrap();
        assert_eq!(db.get_session_blocks("source").unwrap().len(), 1);
        assert!(db.get_chat_messages("source").unwrap().is_empty());
        db.delete_terminal_panes("source", &["source#0".into()]).unwrap();
        assert!(db.get_session_blocks("source").unwrap().is_empty());
        assert!(db.get_chat_messages("source").unwrap().is_empty());
        db.delete_terminal_panes("source", &["source#0".into()]).unwrap();
        db.delete_terminal_panes("missing", &["pane".into()]).unwrap();
        for panes in [vec![], vec!["".into()], vec!["a".into(), "a".into()], vec!["p".repeat(257)], (0..5).map(|i| i.to_string()).collect()] {
            assert!(db.delete_terminal_panes("source", &panes).is_err());
        }
        assert!(db.delete_terminal_panes("", &["pane".into()]).is_err());
        assert!(db.delete_terminal_panes(&"s".repeat(257), &["pane".into()]).is_err());
    }
}
