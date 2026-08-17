use super::HistoryDb;
use rusqlite::params;
use serde::Serialize;

impl HistoryDb {
    // ── 工作区 CRUD ──

    pub fn add_workspace(&self, path: &str, name: &str, timestamp: u64) -> Result<(), String> {
        self.conn()
            .execute(
                "INSERT OR IGNORE INTO workspaces (path, name, added_at) VALUES (?1, ?2, ?3)",
                params![path, name, timestamp as i64],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_workspace(&self, id: i64) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM workspaces WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_workspaces(&self) -> Result<Vec<WorkspaceEntry>, String> {
        let mut stmt = self
            .conn()
            .prepare("SELECT id, path, name, added_at FROM workspaces ORDER BY added_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_workspace_entry)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

/// 工作区记录
#[derive(Clone, Serialize, Debug)]
pub struct WorkspaceEntry {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub added_at: u64,
}

fn map_workspace_entry(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceEntry> {
    Ok(WorkspaceEntry {
        id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        added_at: row.get::<_, i64>(3)? as u64,
    })
}
