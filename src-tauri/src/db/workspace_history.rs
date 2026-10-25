use super::HistoryDb;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

pub fn init_history_metadata(connection: &Connection) -> Result<(), String> {
    let transaction = connection.unchecked_transaction().map_err(|error| error.to_string())?;
    let has_flags = transaction.prepare("PRAGMA table_info(sessions)").map_err(|error| error.to_string())?
        .query_map([], |row| row.get::<_, String>(1)).map_err(|error| error.to_string())?
        .any(|column| column.as_deref() == Ok("history_flags"));
    let expression = "(CASE WHEN NEW.kind='workspace' THEN CASE WHEN json_valid(NEW.payload) THEN
        (CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.members') WHERE CASE WHEN type='object' THEN json_extract(value,'$.kind') ELSE '' END='terminal') THEN 1 ELSE 0 END)
        + (CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.members') WHERE CASE WHEN type='object' THEN json_extract(value,'$.kind') ELSE '' END IN ('conversation','agent')) THEN 2 ELSE 0 END)
        ELSE 0 END ELSE 1 END)
        + (CASE WHEN json_valid(NEW.payload) THEN CASE WHEN json_extract(NEW.payload,'$.layout.type')='split' THEN 4 ELSE 0 END ELSE 0 END)";
    if !has_flags {
        transaction.execute_batch("ALTER TABLE sessions ADD COLUMN history_flags INTEGER NOT NULL DEFAULT 1;").map_err(|error| error.to_string())?;
        transaction.execute_batch(&format!("UPDATE sessions SET history_flags={};", expression.replace("NEW.", ""))).map_err(|error| error.to_string())?;
    }
    transaction.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS sessions_history_insert AFTER INSERT ON sessions BEGIN
        UPDATE sessions SET history_flags={expression} WHERE id=NEW.id; END;
        CREATE TRIGGER IF NOT EXISTS sessions_history_update AFTER UPDATE OF payload,kind ON sessions BEGIN
        UPDATE sessions SET history_flags={expression} WHERE id=NEW.id; END;
        CREATE INDEX IF NOT EXISTS idx_sessions_history_flags ON sessions(status,history_flags,closed_at,created_at);")).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceHistorySave {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub timestamp: u64,
    pub payload: String,
}

fn layout_ids(node: &Value, depth: usize, panes: &mut HashSet<String>, resources: &mut HashSet<String>) -> bool {
    if depth > 3 { return false; }
    if node["type"] == "pane" {
        if !node.as_object().is_some_and(|object| object.keys().all(|key| ["type", "id", "resourceId"].contains(&key.as_str()))) { return false; }
        let Some(id) = node["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 256) else { return false; };
        let Some(resource) = node["resourceId"].as_str().filter(|id| !id.is_empty() && id.len() <= 2048) else { return false; };
        return panes.insert(id.into()) && resources.insert(resource.into()) && resources.len() <= 4;
    }
    node["type"] == "split" && node.as_object().is_some_and(|object| object.keys().all(|key| ["type", "direction", "ratio", "first", "second"].contains(&key.as_str()))) && matches!(node["direction"].as_str(), Some("row" | "col"))
        && node["ratio"].as_f64().is_some_and(|ratio| (0.2..=0.8).contains(&ratio))
        && layout_ids(&node["first"], depth + 1, panes, resources) && layout_ids(&node["second"], depth + 1, panes, resources)
}

impl HistoryDb {
    pub fn save_workspace_history(&self, request: &WorkspaceHistorySave) -> Result<(), String> {
        if !request.id.starts_with("workspace:") || request.id.len() > 256 || request.title.chars().count() > 320
            || request.payload.len() > 65536 || request.timestamp < request.created_at || request.timestamp > i64::MAX as u64 {
            return Err("Invalid workspace history".into());
        }
        let payload: Value = serde_json::from_str(&request.payload).map_err(|_| "Invalid workspace history")?;
        if !payload.as_object().is_some_and(|object| object.keys().all(|key| ["version", "layout", "focused", "members"].contains(&key.as_str()))) {
            return Err("Invalid workspace history fields".into());
        }
        let mut panes = HashSet::new();
        let mut resources = HashSet::new();
        if payload["version"] != 1 || !layout_ids(&payload["layout"], 0, &mut panes, &mut resources)
            || !payload["focused"].as_str().is_some_and(|id| panes.contains(id)) {
            return Err("Invalid workspace layout".into());
        }
        let members = payload["members"].as_array().ok_or("Invalid workspace members")?;
        if members.len() < 2 || members.len() != resources.len() { return Err("Invalid workspace members".into()); }
        let fields = ["id", "title", "kind", "reference", "paneCount", "local", "ssh", "cwd", "connectionId", "draftId", "remoteId", "paneId", "shellType", "scope", "modes"];
        for member in members {
            let object = member.as_object().ok_or("Invalid workspace member")?;
            if object.keys().any(|key| !fields.contains(&key.as_str()))
                || !member["id"].as_str().is_some_and(|id| resources.remove(id))
                || !member["title"].as_str().is_some_and(|title| title.chars().count() <= 320)
                || !member["reference"].as_str().is_some_and(|reference| !reference.is_empty() && reference.len() <= 8192)
                || !matches!(member["kind"].as_str(), Some("terminal" | "conversation" | "agent" | "document" | "comparison"))
                || !member["paneCount"].as_u64().is_some_and(|count| (1..=4).contains(&count))
                || !member["local"].is_boolean() || !member["ssh"].is_boolean() {
                return Err("Invalid workspace member".into());
            }
            for field in ["cwd", "connectionId", "draftId", "remoteId", "paneId"] {
                if object.contains_key(field) && !member[field].as_str().is_some_and(|value| value.len() <= 4096) { return Err("Invalid workspace reference".into()); }
            }
            if object.contains_key("shellType") && !member["shellType"].as_str().is_some_and(|value| value.len() <= 64) { return Err("Invalid terminal profile".into()); }
            if member["kind"] == "comparison" && !matches!(member["scope"].as_str(), Some("staged" | "unstaged" | "untracked" | "conflicts")) { return Err("Invalid comparison reference".into()); }
            if object.contains_key("modes") && !member["modes"].as_array().is_some_and(|modes| modes.len() <= 2 && modes.iter().all(|mode| matches!(mode.as_str(), Some("block" | "classic")))) { return Err("Invalid workspace modes".into()); }
        }
        let changed = self.conn().execute("INSERT INTO sessions(id,title,status,created_at,closed_at,cwd,kind,payload)
            VALUES(?1,?2,'historical',?3,?4,'','workspace',?5)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title,closed_at=excluded.closed_at,payload=excluded.payload WHERE sessions.kind='workspace'",
            params![request.id, request.title, request.created_at as i64, request.timestamp as i64, request.payload]).map_err(|error| error.to_string())?;
        if changed != 1 { return Err("The history record belongs to another resource".into()); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn request() -> WorkspaceHistorySave {
        WorkspaceHistorySave { id: "workspace:test".into(), title: "Work".into(), created_at: 10, timestamp: 20,
            payload: serde_json::json!({"version":1,"focused":"one","layout":{"type":"split","direction":"row","ratio":0.5,
                "first":{"type":"pane","id":"one","resourceId":"terminal:one"},"second":{"type":"pane","id":"two","resourceId":"chat:two"}},
                "members":[{"id":"terminal:one","title":"Shell","kind":"terminal","reference":"one","paneCount":1,"local":true,"ssh":false},
                {"id":"chat:two","title":"Chat","kind":"conversation","reference":"two","paneCount":1,"local":false,"ssh":false}]}).to_string() }
    }

    #[test]
    fn saves_reference_only_combinations_atomically_and_preserves_creation_time() {
        let db = HistoryDb::open_in_memory();
        let mut input = request();
        db.save_workspace_history(&input).unwrap();
        let saved = db.get_session(&input.id).unwrap();
        assert_eq!(saved.status, "historical"); assert_eq!(saved.kind, "workspace"); assert_eq!(saved.block_count, 0);
        input.created_at = 18; input.timestamp = 30; input.title = "Updated".into();
        db.save_workspace_history(&input).unwrap();
        let saved = db.get_session(&input.id).unwrap();
        assert_eq!(saved.created_at, 10); assert_eq!(saved.closed_at, Some(30));
        assert_eq!(db.list_sessions().unwrap().len(), 1);
    }

    #[test]
    fn rejects_duplicate_missing_oversized_and_content_bearing_members() {
        let db = HistoryDb::open_in_memory();
        let original = request();
        for variant in ["duplicate", "missing", "content", "focus", "ratio"] {
            let mut input = request();
            let mut value: Value = serde_json::from_str(&original.payload).unwrap();
            match variant {
                "duplicate" => value["members"][1]["id"] = "terminal:one".into(),
                "missing" => value["members"].as_array_mut().unwrap().pop().map(|_| ()).unwrap(),
                "content" => value["members"][0]["text"] = "private".into(),
                "focus" => value["focused"] = "missing".into(),
                _ => value["layout"]["ratio"] = 2.into(),
            }
            input.payload = value.to_string();
            assert!(db.save_workspace_history(&input).is_err(), "{variant}");
        }
        let mut input = request(); input.payload = "x".repeat(65537);
        assert!(db.save_workspace_history(&input).is_err());
        assert!(db.list_sessions().unwrap().is_empty());
    }

    #[test]
    fn cannot_overwrite_a_terminal_row() {
        let db = HistoryDb::open_in_memory();
        let input = request();
        db.create_session(&input.id, "Original", 1, "", "session", "{}").unwrap();
        assert!(db.save_workspace_history(&input).is_err());
        assert_eq!(db.get_session(&input.id).unwrap().title, "Original");
    }

    #[test]
    fn accepts_bounded_terminal_profile_metadata_without_allowing_content() {
        let db = HistoryDb::open_in_memory();
        let mut input = request();
        let mut payload: Value = serde_json::from_str(&input.payload).unwrap();
        payload["members"][0]["shellType"] = "powershell".into();
        input.payload = payload.to_string();
        db.save_workspace_history(&input).unwrap();
        payload["members"][0]["shellType"] = "x".repeat(65).into();
        input.payload = payload.to_string();
        assert!(db.save_workspace_history(&input).is_err());
        assert!(db.get_session(&input.id).unwrap().payload.contains("powershell"));
    }

    #[test]
    fn backfills_compatible_rows_and_keeps_metadata_current_without_resetting_history() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE sessions(id TEXT PRIMARY KEY,status TEXT,kind TEXT,payload TEXT,closed_at INTEGER,created_at INTEGER);
            INSERT INTO sessions VALUES('terminal','historical','local','{\"layout\":{\"type\":\"split\"}}',2,1);
            INSERT INTO sessions VALUES('corrupt','historical','workspace','invalid',3,1);").unwrap();
        init_history_metadata(&connection).unwrap();
        let flags = |id: &str| connection.query_row("SELECT history_flags FROM sessions WHERE id=?1", [id], |row| row.get::<_, i64>(0)).unwrap();
        assert_eq!(flags("terminal"), 5);
        assert_eq!(flags("corrupt"), 0);
        connection.execute("INSERT INTO sessions VALUES('mixed','historical','workspace',?1,4,1,0)", [request().payload]).unwrap();
        assert_eq!(flags("mixed"), 7);
        connection.execute("UPDATE sessions SET payload='{\"layout\":{\"type\":\"pane\"}}',kind='local' WHERE id='mixed'", []).unwrap();
        assert_eq!(flags("mixed"), 1);
        init_history_metadata(&connection).unwrap();
        assert_eq!(flags("terminal"), 5);
        assert_eq!(connection.query_row("SELECT count(*) FROM sessions", [], |row| row.get::<_, i64>(0)).unwrap(), 3);
    }
}
