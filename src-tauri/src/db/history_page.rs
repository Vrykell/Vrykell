use super::{ConversationEntry, HistoryDb, SessionEntry};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCursor { pub value: String, pub key: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPageRequest {
    pub limit: usize,
    pub sort: String,
    pub source: String,
    pub cursor: Option<HistoryCursor>,
    pub layout: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub sessions: Vec<SessionEntry>,
    pub conversations: Vec<ConversationEntry>,
    pub next_cursor: Option<HistoryCursor>,
}

impl HistoryDb {
    pub fn history_page(&self, request: &HistoryPageRequest) -> Result<HistoryPage, String> {
        if !(1..=100).contains(&request.limit) || !matches!(request.source.as_str(), "all" | "terminal" | "conversation")
            || request.layout.as_ref().is_some_and(|layout| !matches!(layout.as_str(), "all" | "single" | "split"))
            || request.cursor.as_ref().is_some_and(|cursor| cursor.key.len() > 512 || cursor.value.len() > 1024) {
            return Err("Invalid history page request".into());
        }
        let (column, descending, numeric) = match request.sort.as_str() {
            "activity-desc" => ("activity", true, true), "activity-asc" => ("activity", false, true),
            "created-desc" => ("created", true, true), "created-asc" => ("created", false, true),
            "title-asc" => ("lower(title)", false, false), "title-desc" => ("lower(title)", true, false),
            _ => return Err("Invalid history sort".into()),
        };
        let comparison = if descending { "<" } else { ">" };
        let direction = if descending { "DESC" } else { "ASC" };
        let cursor_value = if numeric { "CAST(?1 AS INTEGER)" } else { "?1" };
        let sql = format!("WITH entries AS (
            SELECT 'session:' || id AS record_key, 'terminal' AS source, id, title,
                COALESCE(closed_at, created_at) AS activity, created_at AS created,
                (history_flags & 1)!=0 AS has_terminal, (history_flags & 2)!=0 AS has_conversation, (history_flags & 4)!=0 AS is_split
                FROM sessions WHERE status='historical'
            UNION ALL SELECT 'conversation:' || id, 'conversation', id, title, updated_at, created_at,0,1,0 FROM ai_conversations
        ), ordered AS (SELECT *, {column} AS sort_value FROM entries
            WHERE (?4='all' OR (?4='terminal' AND has_terminal=1) OR (?4='conversation' AND has_conversation=1))
            AND (?5='all' OR (?5='split' AND is_split=1) OR (?5='single' AND is_split=0)))
        SELECT source, id, CAST(sort_value AS TEXT), record_key FROM ordered
        WHERE ?1 IS NULL OR sort_value {comparison} {cursor_value} OR (sort_value={cursor_value} AND record_key>?2)
        ORDER BY sort_value {direction}, record_key ASC LIMIT ?3");
        let mut statement = self.conn().prepare(&sql).map_err(|error| error.to_string())?;
        let keys = statement.query_map(params![request.cursor.as_ref().map(|cursor| &cursor.value), request.cursor.as_ref().map(|cursor| &cursor.key), request.limit + 1, request.source, request.layout.as_deref().unwrap_or("all")], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, HistoryCursor { value: row.get(2)?, key: row.get(3)? }))
        }).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        let next_cursor = if keys.len() > request.limit { keys.get(request.limit - 1).map(|entry| entry.2.clone()) } else { None };
        let mut page = HistoryPage { sessions: Vec::new(), conversations: Vec::new(), next_cursor };
        for (source, id, _) in keys.into_iter().take(request.limit) {
            if source == "terminal" { page.sessions.push(self.get_session(&id)?); }
            else {
                page.conversations.push(self.conn().query_row("SELECT id,title,created_at,updated_at,environment FROM ai_conversations WHERE id=?1", [&id], |row| {
                    Ok(ConversationEntry { id: row.get(0)?, title: row.get(1)?, created_at: row.get(2)?, updated_at: row.get(3)?, environment: row.get(4)? })
                }).map_err(|error| error.to_string())?);
            }
        }
        Ok(page)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(sort: &str) -> HistoryPageRequest { HistoryPageRequest { limit: 2, sort: sort.into(), source: "all".into(), cursor: None, layout: None } }
    #[test]
    fn paginates_both_sources_with_stable_ties_and_never_reads_message_bodies() {
        let db = HistoryDb::open_in_memory();
        for id in ["a", "b", "c"] { db.create_session(id, id, 10, "", "session", "{}").unwrap(); db.archive_session(id, 20).unwrap(); }
        db.save_conversation("d", "d", 10, 20, "{}").unwrap();
        let first = db.history_page(&request("activity-desc")).unwrap();
        assert_eq!(first.sessions.len() + first.conversations.len(), 2);
        assert_eq!(first.conversations[0].id, "d");
        let mut next = request("activity-desc"); next.cursor = first.next_cursor;
        db.delete_session("a").unwrap();
        let second = db.history_page(&next).unwrap();
        assert_eq!(second.sessions.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), ["b", "c"]);
        assert!(second.next_cursor.is_none());
    }
    #[test]
    fn validates_bounds_and_respects_sources_and_sort_direction() {
        let db = HistoryDb::open_in_memory();
        for (id, title) in [("a", "Zulu"), ("b", "Alpha")] { db.save_conversation(id, title, 1, 2, "{}").unwrap(); }
        let mut input = request("title-asc"); input.limit = 1; input.source = "conversation".into();
        let first = db.history_page(&input).unwrap(); assert_eq!(first.conversations[0].id, "b");
        input.cursor = first.next_cursor;
        assert_eq!(db.history_page(&input).unwrap().conversations[0].id, "a");
        input.source = "terminal".into(); input.cursor = None; assert!(db.history_page(&input).unwrap().sessions.is_empty());
        for limit in [0, 101] { input.limit = limit; assert!(db.history_page(&input).is_err()); }
        input.limit = 2; input.sort = "untrusted SQL".into(); assert!(db.history_page(&input).is_err());
    }

    #[test]
    fn mixed_combinations_match_each_member_type_and_an_independent_split_filter() {
        let db = HistoryDb::open_in_memory();
        let payload = serde_json::json!({"layout":{"type":"split"},"members":[{"kind":"terminal"},{"kind":"conversation"}]}).to_string();
        db.create_session("mixed", "Mixed", 10, "", "workspace", &payload).unwrap(); db.archive_session("mixed", 20).unwrap();
        db.create_session("single", "Shell", 10, "", "session", "{}").unwrap(); db.archive_session("single", 20).unwrap();
        for source in ["terminal", "conversation"] {
            let mut input = request("activity-desc"); input.source = source.into(); input.layout = Some("split".into());
            let page = db.history_page(&input).unwrap();
            assert_eq!(page.sessions.len(), 1); assert_eq!(page.sessions[0].id, "mixed");
            input.layout = Some("single".into());
            assert!(!db.history_page(&input).unwrap().sessions.iter().any(|session| session.id == "mixed"));
        }
    }
}
