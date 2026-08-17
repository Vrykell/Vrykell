use super::HistoryDb;
use rusqlite::params;
use serde::{Deserialize, Serialize};

impl HistoryDb {
    // ── SSH 连接 CRUD ──

    /// 列出全部 SSH 连接（密码脱敏：password 置空，has_password 标记是否已存）。
    pub fn list_ssh_connections(&self) -> Result<Vec<SshConnection>, String> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT id, name, host, port, user, password, auth_method, last_opened_at \
                 FROM ssh_connections ORDER BY last_opened_at DESC, name ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| map_ssh_connection(row, true))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// 按 id 取连接（含密码，供后端执行 ssh 命令）。
    pub fn get_ssh_connection(&self, id: &str) -> Result<SshConnection, String> {
        self.conn()
            .query_row(
                "SELECT id, name, host, port, user, password, auth_method, last_opened_at \
                 FROM ssh_connections WHERE id = ?1",
                params![id],
                |row| map_ssh_connection(row, false),
            )
            .map_err(|e| e.to_string())
    }

    /// 新增或更新连接。密码为空且连接已存在时保留旧密码（编辑不回显密码）。
    pub fn save_ssh_connection(&self, conn: &SshConnection) -> Result<(), String> {
        let existing_password: Option<String> = self
            .conn()
            .query_row(
                "SELECT password FROM ssh_connections WHERE id = ?1",
                params![conn.id],
                |row| row.get(0),
            )
            .ok();
        let password = if conn.password.is_empty() {
            existing_password.unwrap_or_default()
        } else {
            conn.password.clone()
        };
        self.conn()
            .execute(
                "INSERT INTO ssh_connections (id, name, host, port, user, password, auth_method, last_opened_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
                 ON CONFLICT(id) DO UPDATE SET \
                   name=excluded.name, host=excluded.host, port=excluded.port, user=excluded.user, \
                   password=excluded.password, auth_method=excluded.auth_method, \
                   last_opened_at=excluded.last_opened_at",
                params![
                    conn.id,
                    conn.name,
                    conn.host,
                    conn.port.unwrap_or(22) as i64,
                    conn.user,
                    password,
                    conn.auth_method,
                    conn.last_opened_at.map(|v| v as i64),
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_ssh_connection(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM ssh_connections WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn touch_ssh_connection(&self, id: &str, at: u64) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE ssh_connections SET last_opened_at = ?1 WHERE id = ?2",
                params![at as i64, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// SSH 连接记录。`password` 仅在「保存输入」与「后端执行」时使用；
/// 列表输出（mask=true）时置空，用 `has_password` 标记是否已存密码。
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SshConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub auth_method: String,
    pub last_opened_at: Option<u64>,
    #[serde(default)]
    pub has_password: bool,
}

fn map_ssh_connection(row: &rusqlite::Row, mask: bool) -> rusqlite::Result<SshConnection> {
    let password: String = row.get(5)?;
    Ok(SshConnection {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get::<_, i64>(3)?.try_into().ok(),
        user: row.get(4)?,
        password: if mask { String::new() } else { password.clone() },
        auth_method: row.get(6)?,
        last_opened_at: row.get::<_, Option<i64>>(7)?.map(|v| v as u64),
        has_password: !password.is_empty(),
    })
}
