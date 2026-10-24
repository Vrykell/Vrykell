use super::HistoryDb;
use crate::secret;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use crate::terminal::ssh_command::{SshOptions, validate_options, validate_ssh_host};

impl HistoryDb {
    // ── SSH 连接 CRUD ──

    /// 列出全部 SSH 连接（密码脱敏：password 置空，has_password 标记是否已存）。
    pub fn list_ssh_connections(&self) -> Result<Vec<SshConnection>, String> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT id, name, host, port, user, password, auth_method, last_opened_at, options_json \
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
        let mut conn = self
            .conn()
            .query_row(
                "SELECT id, name, host, port, user, password, auth_method, last_opened_at, options_json \
                 FROM ssh_connections WHERE id = ?1",
                params![id],
                |row| map_ssh_connection(row, false),
            )
            .map_err(|e| e.to_string())?;
        if conn.auth_method != "password" { conn.password.clear(); conn.has_password = false; return Ok(conn); }
        // Migrate legacy credentials to separate storage.
        if !conn.password.is_empty() && secret::get_secret(id).is_none() {
            if secret::set_secret(id, &conn.password).is_ok() {
                conn.password = secret::get_secret(id).unwrap_or_default();
            }
        } else if conn.password.is_empty() {
            conn.password = secret::get_secret(id).unwrap_or_default();
        }
        conn.has_password = !conn.password.is_empty();
        Ok(conn)
    }

    /// 新增或更新连接。密码为空且连接已存在时保留旧密码（编辑不回显密码）。
    /// 密码不落 SQLite：非空时写入密钥存储（macOS 钥匙串 / 平台回退文件）。
    pub fn save_ssh_connection(&self, conn: &SshConnection) -> Result<(), String> {
        validate_ssh_host(&conn.host)?;
        validate_options(&conn.options)?;
        let options_json = serde_json::to_string(&conn.options).map_err(|e| e.to_string())?;
        if !conn.password.is_empty() {
            secret::set_secret(&conn.id, &conn.password)?;
        } else {
            // 空密码：编辑未改密码 → 迁移旧库列里的明文遗留（如有）
            let legacy: String = self
                .conn()
                .query_row(
                    "SELECT password FROM ssh_connections WHERE id = ?1",
                    params![conn.id],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            if !legacy.is_empty() && secret::get_secret(&conn.id).is_none() {
                secret::set_secret(&conn.id, &legacy)?;
            }
        }
        // 库内一律不存明文密码
        self.conn()
            .execute(
                "INSERT INTO ssh_connections (id, name, host, port, user, password, auth_method, last_opened_at, options_json) \
                 VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, ?8) \
                 ON CONFLICT(id) DO UPDATE SET \
                   name=excluded.name, host=excluded.host, port=excluded.port, user=excluded.user, \
                   password='', auth_method=excluded.auth_method, \
                   last_opened_at=excluded.last_opened_at, options_json=excluded.options_json",
                params![
                    conn.id,
                    conn.name,
                    conn.host,
                    conn.port.unwrap_or(22) as i64,
                    conn.user,
                    conn.auth_method,
                    conn.last_opened_at.map(|v| v as i64),
                    options_json,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_ssh_connection(&self, id: &str) -> Result<(), String> {
        secret::delete_secret(id);
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
    #[serde(flatten)]
    pub options: SshOptions,
}

fn map_ssh_connection(row: &rusqlite::Row, mask: bool) -> rusqlite::Result<SshConnection> {
    let id: String = row.get(0)?;
    let password: String = row.get(5)?;
    let has_secret = secret::get_secret(&id).is_some();
    Ok(SshConnection {
        id,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get::<_, i64>(3)?.try_into().ok(),
        user: row.get(4)?,
        password: if mask { String::new() } else { password.clone() },
        auth_method: row.get(6)?,
        last_opened_at: row.get::<_, Option<i64>>(7)?.map(|v| v as u64),
        has_password: !password.is_empty() || has_secret,
        options: serde_json::from_str(&row.get::<_, String>(8)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(error))
        })?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advanced_options_survive_save_and_update() {
        let db = HistoryDb::open_in_memory();
        let mut conn: SshConnection = serde_json::from_value(serde_json::json!({
            "id":"options-roundtrip", "name":"测试", "host":"target", "user":"tester",
            "authMethod":"key", "identityFile":"C:/keys/private", "jumpHost":"user@jump:2222",
            "serverAliveInterval":45, "shellIntegration":false,
            "proxyId":"office-proxy", "environment":{"LANG":"en_US.UTF-8"}, "notes":"Inventory", "aiNotes":"Do not restart the database."
        })).unwrap();
        db.save_ssh_connection(&conn).unwrap();
        let saved = serde_json::to_value(db.list_ssh_connections().unwrap().remove(0)).unwrap();
        assert_eq!(saved["identityFile"], "C:/keys/private");
        assert_eq!(saved["jumpHost"], "user@jump:2222");
        assert_eq!(saved["serverAliveInterval"], 45);
        assert_eq!(saved["shellIntegration"], false);
        assert_eq!(saved["proxyId"], "office-proxy");
        assert_eq!(saved["environment"]["LANG"], "en_US.UTF-8");
        assert_eq!(saved["notes"], "Inventory");
        assert_eq!(saved["aiNotes"], "Do not restart the database.");
        conn.name = "更新".into();
        db.save_ssh_connection(&conn).unwrap();
        assert_eq!(serde_json::to_value(db.get_ssh_connection(&conn.id).unwrap()).unwrap()["jumpHost"], "user@jump:2222");
    }
}
