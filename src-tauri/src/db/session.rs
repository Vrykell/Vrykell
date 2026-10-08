use super::HistoryDb;
use rusqlite::params;
use serde::Serialize;

impl HistoryDb {
    // ── 会话 CRUD ──

    pub fn create_session(&self, id: &str, title: &str, timestamp: u64, cwd: &str, kind: &str, payload: &str) -> Result<(), String> {
        // 用 UPSERT：若 record_block/append_chat_message 先以兜底行（title=''、created_at=0）
        // 落库，这里要把真实 title/created_at/cwd/kind/payload 补回，避免「INSERT OR IGNORE」静默丢弃真信息。
        self.conn()
            .execute(
                "INSERT INTO sessions (id, title, status, created_at, cwd, kind, payload) VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET title=excluded.title, status='active', created_at=excluded.created_at, cwd=excluded.cwd, kind=excluded.kind, payload=excluded.payload",
                params![id, title, timestamp as i64, cwd, kind, payload],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn archive_session(&self, id: &str, timestamp: u64) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET status = 'historical', closed_at = ?1 WHERE id = ?2",
                params![timestamp as i64, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 追加/更新一条 AI 对话消息（助手流式完成时按 id 覆盖）。
    /// parts = 消息 parts 渲染层的 JSON 串（'' = 无，见前端 messageParts.ts）。
    // 参数与前端 IPC 调用契约一一对应，折叠结构体需同步改前端
    #[allow(clippy::too_many_arguments)]
    pub fn append_chat_message(
        &self,
        id: &str,
        session_id: &str,
        role: &str,
        content: &str,
        created_at: u64,
        parts: &str,
        attachments: &str,
    ) -> Result<(), String> {
        // 会话行兜底（同 record_block）
        self.conn()
            .execute(
                "INSERT OR IGNORE INTO sessions (id, title, status, created_at) VALUES (?1, '', 'active', 0)",
                params![session_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "INSERT INTO chat_messages (id, session_id, role, content, created_at, parts, attachments) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET content=excluded.content, created_at=excluded.created_at, parts=excluded.parts, attachments=excluded.attachments",
                params![id, session_id, role, content, created_at as i64, parts, attachments],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 读取某会话的 AI 对话消息（按时间升序）。
    pub fn get_chat_messages(&self, session_id: &str) -> Result<Vec<ChatMessageEntry>, String> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT id, role, content, created_at, parts, attachments FROM chat_messages WHERE session_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], map_chat_message)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// 删除单条 AI 对话消息（M4：重新生成/编辑重发/删除交换）。
    /// 幂等：id 不存在不报错。
    pub fn delete_chat_message(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM chat_messages WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn restore_session(&self, id: &str) -> Result<(), String> {
        // 确保 session 行存在（可能因在 sessionManager 集成之前创建而不存在）
        self.conn()
            .execute(
                "INSERT OR IGNORE INTO sessions (id, title, status, created_at) VALUES (?1, '', 'active', 0)",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "UPDATE sessions SET status = 'active', closed_at = NULL WHERE id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_session_title(&self, id: &str, title: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET title = ?1 WHERE id = ?2",
                params![title, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 更新会话当前工作目录（cd 后 OSC 7 上报）。
    pub fn update_session_cwd(&self, id: &str, cwd: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET cwd = ?1 WHERE id = ?2",
                params![cwd, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 覆盖会话 payload JSON（分屏布局等变体状态的持久化）。
    pub fn update_session_payload(&self, id: &str, payload: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET payload = ?1 WHERE id = ?2",
                params![payload, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 读取单个会话（含 cwd），供恢复时取回工作目录。
    pub fn get_session(&self, id: &str) -> Result<SessionEntry, String> {
        self.conn()
            .query_row(
                "SELECT s.id, s.title, s.status, s.created_at, s.closed_at,\
                        (SELECT COUNT(*) FROM blocks WHERE session_id = s.id) AS block_count, s.cwd, s.group_id, s.sort_order, s.kind, s.payload \
                 FROM sessions s WHERE s.id = ?1",
                params![id],
                map_session_entry,
            )
            .map_err(|e| e.to_string())
    }

    /// ⚠ 预留：删除会话及关联 block
    #[allow(dead_code)]
    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        // ON DELETE CASCADE 自动清理 blocks
        self.conn()
            .execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── 块持久化 ──

    // 参数与前端 IPC 调用契约一一对应，折叠结构体需同步改前端
    #[allow(clippy::too_many_arguments)]
    pub fn record_block(
        &self,
        id: &str,
        session_id: &str,
        pane_id: Option<&str>,
        command: &str,
        output_raw: &str,
        output_clean: &str,
        output_html: &str,
        exit_code: Option<i32>,
        status: &str,
        started_at: u64,
        ended_at: Option<u64>,
    ) -> Result<(), String> {
        // 会话行可能因 create_session 的异步时序尚未落库（首个命令先于 create 到达），
        // 此处兜底 INSERT OR IGNORE 保证外键满足，块不会被静默丢弃。
        self.conn()
            .execute(
                "INSERT OR IGNORE INTO sessions (id, title, status, created_at) VALUES (?1, '', 'active', 0)",
                params![session_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "INSERT INTO blocks (id, session_id, pane_id, command, output_raw, output_clean, output_html, exit_code, status, started_at, ended_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                   command=excluded.command,
                   output_raw=excluded.output_raw,
                   output_clean=excluded.output_clean,
                   output_html=excluded.output_html,
                   exit_code=excluded.exit_code,
                   status=excluded.status,
                   ended_at=excluded.ended_at",
                params![id, session_id, pane_id, command, output_raw, output_clean, output_html, exit_code, status, started_at as i64, ended_at.map(|v| v as i64)],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── 搜索 ──

    pub fn search_blocks(
        &self,
        query: &str,
        max_results: usize,
        filter_session_status: Option<&str>,
    ) -> Result<Vec<BlockEntry>, String> {
        let pattern = format!("%{}%", query);

        // 参数化构建，避免把用户可控的 filter_session_status 拼进 SQL（SQL 注入）
        let mut conditions = vec!["(b.command LIKE ?1 OR b.output_raw LIKE ?1)".to_string()];
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        params_vec.push(Box::new(pattern));

        if let Some(status) = filter_session_status {
            let idx = params_vec.len() + 1;
            conditions.push(format!("s.status = ?{}", idx));
            params_vec.push(Box::new(status.to_string()));
        }

        let limit_idx = params_vec.len() + 1;
        let sql = format!(
            "SELECT b.id, b.session_id, b.pane_id, b.command, b.output_raw, b.output_clean, b.output_html, b.exit_code,\
                    b.status, b.started_at, b.ended_at, s.title, s.status \
             FROM blocks b JOIN sessions s ON b.session_id = s.id \
             WHERE {} \
             ORDER BY b.started_at DESC LIMIT ?{}",
            conditions.join(" AND "),
            limit_idx,
        );
        params_vec.push(Box::new(max_results as i64));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = self.conn().prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(param_refs.as_slice(), map_block_entry)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn search_sessions(
        &self,
        query: &str,
        max_results: usize,
    ) -> Result<Vec<SessionEntry>, String> {
        let pattern = format!("%{}%", query);
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT s.id, s.title, s.status, s.created_at, s.closed_at,\
                        (SELECT COUNT(*) FROM blocks WHERE session_id = s.id) AS block_count, s.cwd, s.group_id, s.sort_order, s.kind, s.payload \
                 FROM sessions s \
                 WHERE s.title LIKE ?1 \
                 ORDER BY s.created_at DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pattern, max_results as i64], map_session_entry)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// 列出全部会话（活跃 + 历史），按创建时间倒序，带 block 计数。
    pub fn list_sessions(&self) -> Result<Vec<SessionEntry>, String> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT s.id, s.title, s.status, s.created_at, s.closed_at,\
                        (SELECT COUNT(*) FROM blocks WHERE session_id = s.id) AS block_count, s.cwd, s.group_id, s.sort_order, s.kind, s.payload \
                 FROM sessions s \
                 ORDER BY s.created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_session_entry)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_session_blocks(&self, session_id: &str) -> Result<Vec<BlockEntry>, String> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT b.id, b.session_id, b.pane_id, b.command, b.output_raw, b.output_clean, b.output_html, b.exit_code,\
                        b.status, b.started_at, b.ended_at, s.title, s.status \
                 FROM blocks b JOIN sessions s ON b.session_id = s.id \
                 WHERE b.session_id = ?1 \
                 ORDER BY b.started_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], map_block_entry)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ── 分组 CRUD ──

    pub fn create_group(&self, id: &str, title: &str, timestamp: u64) -> Result<(), String> {
        let next: i64 = self
            .conn()
            .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM groups", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "INSERT INTO groups (id, title, sort_order, collapsed, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
                params![id, title, next, timestamp as i64],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn rename_group(&self, id: &str, title: &str) -> Result<(), String> {
        self.conn()
            .execute("UPDATE groups SET title = ?1 WHERE id = ?2", params![title, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_group_collapsed(&self, id: &str, collapsed: bool) -> Result<(), String> {
        self.conn()
            .execute("UPDATE groups SET collapsed = ?1 WHERE id = ?2", params![collapsed as i64, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 删除分组：组内会话回到未分组（保留会话），仅删分组容器。
    pub fn delete_group(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("UPDATE sessions SET group_id = NULL WHERE group_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute("DELETE FROM groups WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 删除分组及其组内全部会话（blocks/chat 级联删除）。
    pub fn delete_group_with_sessions(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM sessions WHERE group_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute("DELETE FROM groups WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_groups(&self) -> Result<Vec<GroupEntry>, String> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT g.id, g.title, g.sort_order, g.collapsed, g.created_at, g.archived,\
                        (SELECT COUNT(*) FROM sessions s WHERE s.group_id = g.id AND s.status = 'active') AS session_count \
                 FROM groups g ORDER BY g.sort_order ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], map_group_entry).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// 重排分组：按 ids 顺序写回 sort_order。
    pub fn groups_reorder(&self, ids: &[String]) -> Result<(), String> {
        for (i, id) in ids.iter().enumerate() {
            self.conn()
                .execute("UPDATE groups SET sort_order = ?1 WHERE id = ?2", params![i as i64, id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 把会话移到某分组（或未分组，group_id=None），追加到末尾。
    pub fn session_set_group(&self, session_id: &str, group_id: Option<&str>) -> Result<(), String> {
        let next: i64 = self
            .conn()
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sessions WHERE group_id IS ?1",
                params![group_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "UPDATE sessions SET group_id = ?1, sort_order = ?2 WHERE id = ?3",
                params![group_id, next, session_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 重排某分组（或未分组）内的会话：按 ids 顺序写回 sort_order。
    pub fn sessions_reorder(&self, group_id: Option<&str>, ids: &[String]) -> Result<(), String> {
        for (i, id) in ids.iter().enumerate() {
            self.conn()
                .execute(
                    "UPDATE sessions SET sort_order = ?1 WHERE id = ?2 AND group_id IS ?3",
                    params![i as i64, id, group_id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 恢复分组内所有历史会话为 active（前端随后重建标签页）。
    pub fn restore_group(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET status = 'active', closed_at = NULL WHERE group_id = ?1 AND status = 'historical'",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute("UPDATE groups SET archived = 0 WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 归档分组：把组内所有活跃会话标记为历史（关闭），组本身保留并标记为已归档。
    pub fn archive_group(&self, id: &str, timestamp: u64) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET status = 'historical', closed_at = ?1 WHERE group_id = ?2 AND status = 'active'",
                params![timestamp as i64, id],
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute("UPDATE groups SET archived = 1 WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// 块记录（来自 blocks 表 JOIN sessions）
#[derive(Clone, Serialize, Debug)]
pub struct BlockEntry {
    pub id: String,
    pub session_id: String,
    pub pane_id: Option<String>,
    pub command: String,
    pub output_raw: String,
    pub output_clean: String,
    pub output_html: String,
    pub exit_code: Option<i32>,
    pub status: String,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub session_title: String,
    pub session_status: String,
}

fn map_block_entry(row: &rusqlite::Row) -> rusqlite::Result<BlockEntry> {
    Ok(BlockEntry {
        id: row.get(0)?,
        session_id: row.get(1)?,
        pane_id: row.get(2)?,
        command: row.get(3)?,
        output_raw: row.get(4)?,
        output_clean: row.get(5)?,
        output_html: row.get(6)?,
        exit_code: row.get(7)?,
        status: row.get(8)?,
        started_at: row.get::<_, i64>(9)? as u64,
        ended_at: row.get::<_, Option<i64>>(10)?.map(|v| v as u64),
        session_title: row.get(11)?,
        session_status: row.get(12)?,
    })
}

/// 会话记录
#[derive(Clone, Serialize, Debug)]
pub struct SessionEntry {
    pub id: String,
    pub title: String,
    pub status: String,
    pub created_at: u64,
    pub closed_at: Option<u64>,
    pub block_count: u64,
    pub cwd: String,
    pub group_id: Option<String>,
    pub sort_order: u64,
    pub kind: String,
    pub payload: String,
}

fn map_session_entry(row: &rusqlite::Row) -> rusqlite::Result<SessionEntry> {
    Ok(SessionEntry {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        created_at: row.get::<_, i64>(3)? as u64,
        closed_at: row.get::<_, Option<i64>>(4)?.map(|v| v as u64),
        block_count: row.get(5)?,
        cwd: row.get(6)?,
        group_id: row.get(7)?,
        sort_order: row.get::<_, i64>(8)? as u64,
        kind: row.get(9)?,
        payload: row.get(10)?,
    })
}

/// 分组记录
#[derive(Clone, Serialize, Debug)]
pub struct GroupEntry {
    pub id: String,
    pub title: String,
    pub sort_order: u64,
    pub collapsed: bool,
    pub created_at: u64,
    pub session_count: u64,
    pub archived: bool,
}

fn map_group_entry(row: &rusqlite::Row) -> rusqlite::Result<GroupEntry> {
    Ok(GroupEntry {
        id: row.get(0)?,
        title: row.get(1)?,
        sort_order: row.get::<_, i64>(2)? as u64,
        collapsed: row.get::<_, i64>(3)? != 0,
        created_at: row.get::<_, i64>(4)? as u64,
        archived: row.get::<_, i64>(5)? != 0,
        session_count: row.get::<_, i64>(6)? as u64,
    })
}

/// AI 对话消息记录（会话恢复时回填聊天区）。
#[derive(Clone, Serialize, Debug)]
pub struct ChatMessageEntry {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: u64,
    pub parts: String,
    /// 附件元数据 JSON（M5，'' = 无/旧数据）
    pub attachments: String,
}

fn map_chat_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessageEntry> {
    Ok(ChatMessageEntry {
        id: row.get(0)?,
        role: row.get(1)?,
        content: row.get(2)?,
        created_at: row.get::<_, i64>(3)? as u64,
        parts: row.get(4)?,
        attachments: row.get(5)?,
    })
}
