use super::HistoryDb;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommand {
    pub id: String,
    pub target: String,
    pub shell: String,
    pub command: String,
    #[serde(default)]
    pub name: String,
    pub cwd: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub timestamp: i64,
    #[serde(default = "one")]
    pub run_count: i64,
}
fn one() -> i64 { 1 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommandKey { pub shell: String, pub cwd: String, pub command: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommandDraft { pub shell: String, pub cwd: String, pub command: String, pub name: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommandMutation {
    pub target: String,
    pub root: String,
    pub scope: String,
    pub original: Option<HistoryCommandKey>,
    pub draft: Option<HistoryCommandDraft>,
    pub preferences: serde_json::Value,
}

pub fn init(conn: &Connection) -> Result<(), String> {
    // Preserve saved runs and JSON preferences when upgrading the feature name.
    conn.execute_batch("BEGIN;").map_err(|e| e.to_string())?;
    let migration = (|| -> Result<(), rusqlite::Error> {
        for (legacy, current) in [("project_command_runs", "command_history_runs"),
            ("project_command_preferences", "command_history_preferences"),
            ("project_command_removed_runs", "command_history_removed_runs")] {
            let old: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)", [legacy], |row| row.get(0))?;
            let new: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)", [current], |row| row.get(0))?;
            if old && !new { conn.execute_batch(&format!("ALTER TABLE {legacy} RENAME TO {current};"))?; }
            else if old && new {
                if current == "command_history_runs" {
                    let has_column = |table: &str, column: &str| -> Result<bool, rusqlite::Error> {
                        let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
                        let names = statement.query_map([], |row| row.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>()?;
                        Ok(names.iter().any(|name| name == column))
                    };
                    if !has_column(current, "name")? { conn.execute_batch("ALTER TABLE command_history_runs ADD COLUMN name TEXT NOT NULL DEFAULT '';")?; }
                    let name = if has_column(legacy, "name")? { "name" } else { "''" };
                    conn.execute_batch(&format!("INSERT OR IGNORE INTO {current}(id,target,shell,command,cwd,status,exit_code,timestamp,run_count,name)
                        SELECT id,target,shell,command,cwd,status,exit_code,timestamp,run_count,{name} FROM {legacy};"))?;
                } else {
                    conn.execute_batch(&format!("INSERT OR IGNORE INTO {current} SELECT * FROM {legacy};"))?;
                }
                conn.execute_batch(&format!("DROP TABLE {legacy};"))?;
            }
        }
        Ok(())
    })();
    if let Err(error) = migration { let _ = conn.execute_batch("ROLLBACK;"); return Err(error.to_string()); }
    conn.execute_batch("COMMIT;").map_err(|e| e.to_string())?;
    let existed: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='command_history_runs')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS command_history_runs (
        id TEXT PRIMARY KEY, target TEXT NOT NULL, shell TEXT NOT NULL,
        command TEXT NOT NULL, cwd TEXT NOT NULL, status TEXT NOT NULL,
        exit_code INTEGER, timestamp INTEGER NOT NULL, run_count INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX IF NOT EXISTS idx_command_history_scope ON command_history_runs(target, cwd);
        CREATE TABLE IF NOT EXISTS command_history_preferences (scope TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS command_history_removed_runs (id TEXT PRIMARY KEY);")
        .map_err(|e| e.to_string())?;
    let has_name = conn.prepare("PRAGMA table_info(command_history_runs)").map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?
        .any(|column| column.as_deref() == Ok("name"));
    if !has_name {
        conn.execute_batch("ALTER TABLE command_history_runs ADD COLUMN name TEXT NOT NULL DEFAULT '';").map_err(|e| e.to_string())?;
    }
    if !existed { backfill(conn)?; }
    Ok(())
}

fn backfill(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn.prepare("SELECT b.id,b.pane_id,b.command,b.cwd,b.exit_code,b.started_at,s.payload,s.kind
        FROM blocks b JOIN sessions s ON s.id=b.session_id WHERE b.cwd<>'' AND b.command<>''").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?,
        r.get::<_, String>(3)?, r.get::<_, Option<i32>>(4)?, r.get::<_, i64>(5)?, r.get::<_, String>(6)?, r.get::<_, String>(7)?))).map_err(|e| e.to_string())?;
    fn panes<'a>(layout: &'a serde_json::Value, out: &mut Vec<&'a serde_json::Value>) {
        if layout["type"] == "leaf" { out.push(&layout["terminal"]); }
        else if layout["type"] == "split" { panes(&layout["first"], out); panes(&layout["second"], out); }
    }
    for row in rows {
        let (id, pane, command, cwd, exit, timestamp, payload, kind) = row.map_err(|e| e.to_string())?;
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(&payload) else { continue };
        let mut candidates = Vec::new();
        panes(&payload["layout"], &mut candidates);
        let spec = if candidates.len() == 1 { candidates.first().copied() }
            else { candidates.into_iter().find(|spec| pane.as_deref() == spec["id"].as_str()) };
        let (target, shell) = if let Some(spec) = spec {
            if spec["kind"] == "ssh" {
                let Some(host) = spec["ssh"]["host"].as_str() else { continue };
                (serde_json::json!(["ssh", host.to_lowercase(), spec["ssh"]["port"].as_u64().unwrap_or(22), spec["ssh"]["user"].as_str().unwrap_or("")]).to_string(), "posix".to_owned())
            } else if spec["kind"] == "local" { ("local".into(), spec["shellType"].as_str().unwrap_or("system").to_owned()) }
            else { continue }
        } else if kind == "local" && payload.get("ssh").is_none() {
            ("local".into(), payload["shellType"].as_str().unwrap_or("system").to_owned())
        } else { continue };
        conn.execute("INSERT OR IGNORE INTO command_history_runs(id,target,shell,command,cwd,status,exit_code,timestamp)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![format!("archive:{id}"), target, shell,
                crate::redact::redact_text(&command), canonical_path(&cwd), if exit == Some(0) { "success" } else if exit.is_some() { "failed" } else { "unknown" }, exit, timestamp])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

impl HistoryDb {
    pub fn record_command_history(&self, item: &HistoryCommand) -> Result<(), String> {
        if item.command.trim().is_empty() { return Ok(()); }
        if !["running", "success", "failed", "unknown"].contains(&item.status.as_str()) {
            return Err("Invalid command status".into());
        }
        self.conn().execute("INSERT INTO command_history_runs
            (id,target,shell,command,cwd,status,exit_code,timestamp,run_count)
            SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9 WHERE NOT EXISTS(SELECT 1 FROM command_history_removed_runs WHERE id=?1)
            ON CONFLICT(id) DO UPDATE SET command=excluded.command, cwd=excluded.cwd,
            status=excluded.status, exit_code=excluded.exit_code
            WHERE command_history_runs.target=excluded.target AND command_history_runs.shell=excluded.shell",
            params![item.id, item.target, item.shell, crate::redact::redact_text(&item.command), canonical_path(&item.cwd),
                item.status, item.exit_code, item.timestamp, item.run_count.max(1)])
            .map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn command_history(&self, target: &str, root: &str) -> Result<Vec<HistoryCommand>, String> {
        let mut stmt = self.conn().prepare("WITH ranked AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY shell,cwd,command ORDER BY timestamp DESC,id DESC) AS rank,
            SUM(run_count) OVER (PARTITION BY shell,cwd,command) AS total,
            FIRST_VALUE(name) OVER (PARTITION BY shell,cwd,command ORDER BY (name<>'') DESC,timestamp DESC,id DESC) AS display_name
            FROM command_history_runs WHERE target=?1)
            SELECT id,target,shell,command,cwd,status,exit_code,timestamp,total,display_name FROM ranked
            WHERE rank=1 ORDER BY timestamp DESC,id DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([target], |r| Ok(HistoryCommand {
            id: r.get(0)?, target: r.get(1)?, shell: r.get(2)?, command: r.get(3)?, cwd: r.get(4)?,
            status: r.get(5)?, exit_code: r.get(6)?, timestamp: r.get(7)?, run_count: r.get(8)?,
            name: r.get(9)?,
        })).map_err(|e| e.to_string())?;
        rows.filter_map(|row| match row {
            Ok(item) if within(&item.cwd, root) => Some(Ok(item)),
            Ok(_) => None,
            Err(error) => Some(Err(error.to_string())),
        }).collect()
    }

    /// Apply library changes and their favorite references in one transaction.
    pub fn mutate_command_history(&self, change: HistoryCommandMutation) -> Result<serde_json::Value, String> {
        let expected_scope = serde_json::json!([change.target, canonical_path(&change.root)]).to_string();
        if change.target.is_empty() || change.scope != expected_scope {
            return Err("Invalid command scope".into());
        }
        let tx = self.conn().unchecked_transaction().map_err(|e| e.to_string())?;
        let key_count = |key: &HistoryCommandKey| -> Result<i64, String> {
            tx.query_row("SELECT COUNT(*) FROM command_history_runs WHERE target=?1 AND shell=?2 AND cwd=?3 AND command=?4",
                params![change.target, key.shell, canonical_path(&key.cwd), key.command], |r| r.get(0)).map_err(|e| e.to_string())
        };
        if let Some(original) = &change.original {
            if !within(&original.cwd, &change.root) { return Err("The execution directory must be inside this project.".into()); }
            if change.draft.is_some() && key_count(original)? == 0 { return Err("This command no longer exists. Refresh the history and try again.".into()); }
        }
        let draft = change.draft.as_ref().map(|draft| HistoryCommandDraft {
            shell: draft.shell.trim().to_owned(), cwd: canonical_path(&draft.cwd),
            command: crate::redact::redact_text(draft.command.trim()), name: crate::redact::redact_text(draft.name.trim()),
        });
        if let Some(draft) = &draft {
            if draft.command.is_empty() || draft.shell.is_empty() { return Err("Enter a command.".into()); }
            if !within(&draft.cwd, &change.root) { return Err("The execution directory must be inside this project.".into()); }
        } else if change.original.is_none() { return Err("Choose a command to delete.".into()); }
        let same_key = draft.as_ref().zip(change.original.as_ref()).is_some_and(|(draft, original)|
            draft.shell == original.shell && draft.cwd == canonical_path(&original.cwd) && draft.command == original.command);
        if let Some(draft) = &draft {
            if !same_key && key_count(&HistoryCommandKey { shell: draft.shell.clone(), cwd: draft.cwd.clone(), command: draft.command.clone() })? > 0 {
                return Err("A command with this text already exists in this directory.".into());
            }
        }
        if !same_key {
            if let Some(original) = &change.original {
                // Late completion events must not recreate removed or replaced entries.
                tx.execute("INSERT OR IGNORE INTO command_history_removed_runs(id)
                    SELECT id FROM command_history_runs WHERE target=?1 AND shell=?2 AND cwd=?3 AND command=?4",
                    params![change.target, original.shell, canonical_path(&original.cwd), original.command]).map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM command_history_runs WHERE target=?1 AND shell=?2 AND cwd=?3 AND command=?4",
                    params![change.target, original.shell, canonical_path(&original.cwd), original.command]).map_err(|e| e.to_string())?;
            }
        }
        if let Some(draft) = &draft {
            if same_key {
                tx.execute("UPDATE command_history_runs SET name=?5 WHERE target=?1 AND shell=?2 AND cwd=?3 AND command=?4",
                    params![change.target, draft.shell, draft.cwd, draft.command, draft.name]).map_err(|e| e.to_string())?;
            } else {
                let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as i64;
                tx.execute("INSERT INTO command_history_runs(id,target,shell,command,cwd,name,status,exit_code,timestamp,run_count)
                    VALUES(?1,?2,?3,?4,?5,?6,'unknown',NULL,?7,0)",
                    params![format!("manual:{}", uuid::Uuid::new_v4()), change.target, draft.shell, draft.command, draft.cwd, draft.name, timestamp]).map_err(|e| e.to_string())?;
            }
        }
        let text = crate::redact::redact_json(&change.preferences.to_string());
        let preferences = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO command_history_preferences(scope,payload) VALUES(?1,?2) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload",
            params![change.scope, text]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(preferences)
    }

    pub fn history_preferences(&self, scope: &str) -> Result<serde_json::Value, String> {
        use rusqlite::OptionalExtension;
        let json: Option<String> = self.conn().query_row(
            "SELECT payload FROM command_history_preferences WHERE scope=?1", [scope], |r| r.get(0))
            .optional().map_err(|e| e.to_string())?;
        json.map(|text| serde_json::from_str(&text).map_err(|e| e.to_string())).unwrap_or(Ok(serde_json::Value::Null))
    }

    pub fn save_history_preferences(&self, scope: &str, payload: &serde_json::Value) -> Result<(), String> {
        let text = crate::redact::redact_json(&payload.to_string());
        let _: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        self.conn().execute("INSERT INTO command_history_preferences(scope,payload) VALUES(?1,?2)
            ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload", params![scope, text])
            .map(|_| ()).map_err(|e| e.to_string())
    }
}

fn canonical_path(text: &str) -> String {
    let value = text.replace('\\', "/");
    let value = value.trim_end_matches('/');
    if value.len() == 2 && value.as_bytes().get(1) == Some(&b':') { format!("{}/", value.to_lowercase()) }
    else if value.as_bytes().get(1) == Some(&b':') { value.to_lowercase() } else if value.is_empty() { "/".into() } else { value.to_owned() }
}
fn within(path: &str, root: &str) -> bool {
    if root.is_empty() { return false; }
    let path = canonical_path(path);
    let root = canonical_path(root);
    if root == "/" { return path.starts_with('/'); }
    path == root || path.starts_with(&format!("{}/", root.trim_end_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrates_legacy_tables_and_preserves_group_preferences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE project_command_runs(id TEXT PRIMARY KEY,target TEXT,shell TEXT,command TEXT,cwd TEXT,status TEXT,exit_code INTEGER,timestamp INTEGER,run_count INTEGER,name TEXT);
            INSERT INTO project_command_runs VALUES('one','local','bash','build','/app','success',0,1,1,'Build');
            CREATE TABLE project_command_preferences(scope TEXT PRIMARY KEY,payload TEXT);
            INSERT INTO project_command_preferences VALUES('scope','{\"groups\":[{\"id\":\"release\"}]}');
            CREATE TABLE project_command_removed_runs(id TEXT PRIMARY KEY);
            INSERT INTO project_command_removed_runs VALUES('removed');").unwrap();
        init(&conn).unwrap(); init(&conn).unwrap();
        conn.execute_batch("CREATE TABLE project_command_runs AS SELECT * FROM command_history_runs;
            UPDATE project_command_runs SET id='two';
            CREATE TABLE project_command_preferences AS SELECT * FROM command_history_preferences;
            UPDATE project_command_preferences SET scope='second';
            CREATE TABLE project_command_removed_runs AS SELECT * FROM command_history_removed_runs;").unwrap();
        init(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM command_history_runs", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM command_history_preferences", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(conn.query_row("SELECT command FROM command_history_runs WHERE id='one'", [], |r| r.get::<_, String>(0)).unwrap(), "build");
        assert!(conn.query_row("SELECT payload FROM command_history_preferences WHERE scope='scope'", [], |r| r.get::<_, String>(0)).unwrap().contains("release"));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM command_history_removed_runs", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }
    fn run(id: &str, target: &str, cwd: &str, status: &str) -> HistoryCommand {
        HistoryCommand { id: id.into(), target: target.into(), cwd: cwd.into(), shell: "bash".into(),
            command: "npm run build".into(), name: String::new(), status: status.into(), exit_code: None, timestamp: 1, run_count: 1 }
    }
    #[test]
    fn isolates_targets_directories_and_counts_each_execution_once() {
        let db = HistoryDb::open_in_memory();
        for item in [run("1", "local", "/app", "running"), run("2", "local", "/app/sub", "success"),
            run("3", "ssh:a", "/app", "success"), run("4", "local", "/application", "success")] {
            db.record_command_history(&item).unwrap();
        }
        db.record_command_history(&run("1", "local", "/app", "success")).unwrap();
        let rows = db.command_history("local", "/app").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows.iter().find(|r| r.cwd == "/app").unwrap().run_count, 1);
        assert_eq!(rows.iter().find(|r| r.cwd == "/app").unwrap().status, "success");
        db.record_command_history(&run("5", "local", "/app", "success")).unwrap();
        assert_eq!(db.command_history("local", "/app").unwrap().iter().find(|r| r.cwd == "/app").unwrap().run_count, 2);
    }
    #[test]
    fn preserves_preferences_and_redacts_saved_commands() {
        let db = HistoryDb::open_in_memory();
        let mut item = run("1", "local", "C:/APP", "running");
        item.command = "curl --header 'Bearer secret-token'".into();
        db.record_command_history(&item).unwrap();
        assert!(!db.command_history("local", "c:/app").unwrap()[0].command.contains("secret-token"));
        db.save_history_preferences("local:/app", &serde_json::json!({"hidden": ["build"]})).unwrap();
        init(db.conn()).unwrap();
        assert_eq!(db.history_preferences("local:/app").unwrap()["hidden"][0], "build");
        assert_eq!(db.command_history("local", "C:/APP").unwrap()[0].status, "running");
    }
    #[test]
    fn upgrades_compatible_history_and_imports_only_known_block_environments() {
        let db = HistoryDb::open_in_memory();
        db.record("old command", "/app", Some(0), 1).unwrap();
        db.create_session("local", "local", 0, "/app", "local", r#"{"shellType":"bash"}"#).unwrap();
        db.create_session("unknown", "unknown", 0, "/app", "session", "{}").unwrap();
        db.record_block("b-local", "local", Some("p1"), "cargo build", "", "", "", Some(0), "done", 1, Some(2), "/app").unwrap();
        db.record_block("b-unknown", "unknown", None, "private source", "", "", "", Some(0), "done", 1, Some(2), "/app").unwrap();
        db.conn().execute_batch("DROP TABLE command_history_runs; DROP TABLE command_history_preferences;").unwrap();
        init(db.conn()).unwrap();
        let rows = db.command_history("local", "/app").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].command, "cargo build");
        assert_eq!(db.search("old command", 10, None, None, None).unwrap().len(), 1);
        init(db.conn()).unwrap();
        assert_eq!(db.command_history("local", "/app").unwrap()[0].run_count, 1);
    }
    #[test]
    fn clearing_history_retains_favorites_and_secret_redaction_preserves_json() {
        let db = HistoryDb::open_in_memory();
        db.record_command_history(&run("1", "local", "/app", "success")).unwrap();
        db.save_history_preferences("scope", &serde_json::json!({"favorites": [{"command": "export TOKEN=private", "name": "build"}]})).unwrap();
        let value = db.history_preferences("scope").unwrap();
        assert_eq!(value["favorites"][0]["name"], "build");
        assert!(!value.to_string().contains("private"));
        db.clear_history().unwrap();
        assert!(db.command_history("local", "/app").unwrap().is_empty());
        assert_eq!(db.history_preferences("scope").unwrap(), value);
    }
    #[test]
    fn drive_root_keeps_its_absolute_path_and_includes_descendants() {
        let db = HistoryDb::open_in_memory();
        db.record_command_history(&run("root", "local", "C:/", "success")).unwrap();
        db.record_command_history(&run("child", "local", "C:/app", "success")).unwrap();
        let rows = db.command_history("local", "c:/").unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row.cwd == "c:/"));
    }
}
