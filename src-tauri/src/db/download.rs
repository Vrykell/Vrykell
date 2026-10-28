use super::HistoryDb;
use rusqlite::params;
use serde::Serialize;

impl HistoryDb {
    // ── Download history ──

    // Parameters map one-to-one to the frontend IPC contract; collapsing them into a struct requires a matching frontend change.
    #[allow(clippy::too_many_arguments)]
    pub fn record_download(
        &self,
        name: &str,
        local_path: &str,
        remote_path: &str,
        connection_name: &str,
        is_dir: bool,
        size: u64,
        timestamp: u64,
    ) -> Result<(), String> {
        self.conn()
            .execute(
                "INSERT INTO downloads (name, local_path, remote_path, connection_name, is_dir, size, downloaded_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![name, local_path, remote_path, connection_name, is_dir as i64, size as i64, timestamp as i64],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_downloads(&self) -> Result<Vec<DownloadEntry>, String> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT id, name, local_path, remote_path, connection_name, is_dir, size, downloaded_at \
                 FROM downloads ORDER BY downloaded_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_download_entry)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn clear_downloads(&self) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM downloads", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Remove one download history entry by local path (called when discarding a temporary copy left behind by a cancelled drag-out).
    pub fn remove_download(&self, local_path: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM downloads WHERE local_path = ?1", params![local_path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_download_id(&self, id: i64) -> Result<(), String> {
        self.conn().execute("DELETE FROM downloads WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// A download history entry (used by the download manager page under file management).
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEntry {
    pub id: i64,
    pub name: String,
    pub local_path: String,
    pub remote_path: String,
    pub connection_name: String,
    pub is_dir: bool,
    pub size: u64,
    pub downloaded_at: u64,
}

fn map_download_entry(row: &rusqlite::Row) -> rusqlite::Result<DownloadEntry> {
    Ok(DownloadEntry {
        id: row.get(0)?,
        name: row.get(1)?,
        local_path: row.get(2)?,
        remote_path: row.get(3)?,
        connection_name: row.get(4)?,
        is_dir: row.get::<_, i64>(5)? != 0,
        size: row.get::<_, i64>(6)? as u64,
        downloaded_at: row.get::<_, i64>(7)? as u64,
    })
}
