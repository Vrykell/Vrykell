use super::HistoryDb;
use crate::remote::transfer::TransferJob;

impl HistoryDb {
    fn transfer_schema(&self) -> Result<(), String> {
        self.conn().execute_batch("CREATE TABLE IF NOT EXISTS transfer_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            .map_err(|e| e.to_string())
    }

    pub fn save_transfer(&self, job: &TransferJob) -> Result<(), String> {
        self.transfer_schema()?;
        let payload = serde_json::to_string(job).map_err(|e| e.to_string())?;
        self.conn().execute("INSERT INTO transfer_jobs (id, payload) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", rusqlite::params![job.id, payload])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_transfers(&self) -> Result<Vec<TransferJob>, String> {
        self.transfer_schema()?;
        let mut stmt = self.conn().prepare("SELECT payload FROM transfer_jobs ORDER BY rowid DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.map(|row| serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect()
    }

    pub fn clear_completed_transfers(&self, direction: &str) -> Result<(), String> {
        for job in self.list_transfers()? {
            if job.direction == direction && job.status == "completed" {
                self.conn().execute("DELETE FROM transfer_jobs WHERE id=?1", [&job.id]).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn remove_transfer(&self, id: &str) -> Result<(), String> {
        self.transfer_schema()?;
        self.conn().execute("DELETE FROM transfer_jobs WHERE id=?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoints_survive_reopening_and_clearing_preserves_unfinished_jobs() {
        let path = std::env::temp_dir().join(format!("transfer-{}.db", uuid::Uuid::new_v4()));
        let payload = serde_json::json!({
            "id": "one", "connectionId": "server", "connectionName": "Server", "host": "localhost", "port": 22, "user": "tester",
            "direction": "upload", "name": "data.bin", "localPath": "/local/data.bin", "remotePath": "/remote/data.bin",
            "isDir": false, "status": "paused", "bytes": 512, "total": 1024, "speed": 0, "error": "", "createdAt": 1,
            "files": [], "prepared": false
        });
        let job: TransferJob = serde_json::from_value(payload).unwrap();
        {
            let db = HistoryDb { conn: rusqlite::Connection::open(&path).unwrap() };
            db.save_transfer(&job).unwrap();
        }
        {
            let db = HistoryDb { conn: rusqlite::Connection::open(&path).unwrap() };
            let recovered = db.list_transfers().unwrap();
            assert_eq!(recovered.len(), 1);
            assert_eq!(recovered[0].bytes, 512);
            assert_eq!(recovered[0].status, "paused");
            let mut completed = recovered[0].clone();
            completed.id = "two".into(); completed.status = "completed".into();
            db.save_transfer(&completed).unwrap();
            db.clear_completed_transfers("download").unwrap();
            assert_eq!(db.list_transfers().unwrap().len(), 2);
            db.clear_completed_transfers("upload").unwrap();
            assert_eq!(db.list_transfers().unwrap()[0].id, "one");
        }
        std::fs::remove_file(path).unwrap();
    }
}
