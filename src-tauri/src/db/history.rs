use super::HistoryDb;
use rusqlite::params;
use serde::Serialize;

impl HistoryDb {
    /// 记录一条命令。如果同命令已存在则更新 run_count 和时间戳。
    pub fn record(
        &self,
        command: &str,
        cwd: &str,
        exit_code: Option<i32>,
        timestamp: u64,
    ) -> Result<(), String> {
        // 先查是否已有相同命令
        let existing: Option<(i64, u32)> = self
            .conn()
            .query_row(
                "SELECT id, run_count FROM history WHERE command = ?1 ORDER BY timestamp DESC LIMIT 1",
                params![command],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        if let Some((id, count)) = existing {
            self.conn()
                .execute(
                    "UPDATE history SET cwd = ?1, exit_code = ?2, timestamp = ?3, run_count = ?4 WHERE id = ?5",
                    params![cwd, exit_code, timestamp, count + 1, id],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.conn()
                .execute(
                    "INSERT INTO history (command, cwd, exit_code, timestamp) VALUES (?1, ?2, ?3, ?4)",
                    params![command, cwd, exit_code, timestamp],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 搜索命令历史
    pub fn search(
        &self,
        query: &str,
        max_results: usize,
        filter_exit_code: Option<i32>,
        since: Option<u64>,
        cwd: Option<&str>,
    ) -> Result<Vec<HistoryEntry>, String> {
        let pattern = format!("%{}%", query);
        let max = max_results as i64;

        // Build SQL dynamically based on which filters are provided
        let mut conditions = Vec::new();
        conditions.push("command LIKE ?1".to_string());
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        params_vec.push(Box::new(pattern));

        if let Some(ec) = filter_exit_code {
            let idx = params_vec.len() + 1;
            conditions.push(format!("exit_code = ?{}", idx));
            params_vec.push(Box::new(ec));
        }

        if let Some(ts) = since {
            let idx = params_vec.len() + 1;
            conditions.push(format!("timestamp >= ?{}", idx));
            params_vec.push(Box::new(ts as i64));
        }

        if let Some(dir) = cwd {
            let idx = params_vec.len() + 1;
            conditions.push(format!("cwd = ?{}", idx));
            params_vec.push(Box::new(dir.to_string()));
        }

        let limit_idx = params_vec.len() + 1;
        let sql = format!(
            "SELECT id, command, cwd, exit_code, timestamp, run_count FROM history WHERE {} ORDER BY timestamp DESC LIMIT ?{}",
            conditions.join(" AND "),
            limit_idx,
        );
        params_vec.push(Box::new(max));

        // Convert params to rusqlite param slice
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = self.conn().prepare(&sql).map_err(|e| e.to_string())?;
        let result: Vec<HistoryEntry> = stmt
            .query_map(param_refs.as_slice(), map_entry)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(result)
    }

    /// 获取命令统计：按执行次数降序，返回 top N
    pub fn stats(&self, top_n: usize) -> Result<Vec<HistoryEntry>, String> {
        let mut stmt = self
            .conn()
            .prepare("SELECT id, command, cwd, exit_code, timestamp, run_count FROM history ORDER BY run_count DESC LIMIT ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![top_n as i64], map_entry)
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>().into_iter().map(|r| Ok(r)).collect()
    }

    /// 清空命令历史（与前端 in-memory 缓存一致，消除双写漂移）。
    pub fn clear_history(&self) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM history", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn map_entry(row: &rusqlite::Row) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        command: row.get(1)?,
        cwd: row.get(2)?,
        exit_code: row.get(3)?,
        timestamp: row.get(4)?,
        run_count: row.get(5)?,
    })
}

#[derive(Clone, Serialize, Debug)]
pub struct HistoryEntry {
    pub id: i64,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub timestamp: u64,
    pub run_count: u32,
}
