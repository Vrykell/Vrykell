use super::HistoryDb;
use rusqlite::params;
use serde::Serialize;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupAssignment { pub id: String, pub title: String, pub item_ids: Vec<String> }

impl HistoryDb {
    /// Apply reviewed membership in one transaction, preserving unrelated sessions.
    pub fn apply_group_plan(&self, groups: &[GroupAssignment]) -> Result<(), String> {
        if groups.is_empty() || groups.len() > 20 { return Err("Invalid group plan".into()); }
        let tx = self.conn().unchecked_transaction().map_err(|e| e.to_string())?;
        let next: i64 = tx.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM groups", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        let mut ids = std::collections::HashSet::new();
        let mut members = std::collections::HashSet::new();
        for (offset, group) in groups.iter().enumerate() {
            if group.id.is_empty() || !ids.insert(&group.id) || group.title.trim().is_empty() || group.title.len() > 320 { return Err("Invalid group plan".into()); }
            tx.execute("INSERT INTO groups(id,title,sort_order,collapsed,created_at) VALUES(?1,?2,?3,0,CAST(strftime('%s','now') AS INTEGER)*1000)
                ON CONFLICT(id) DO UPDATE SET title=excluded.title", params![group.id, group.title.trim(), next + offset as i64]).map_err(|e| e.to_string())?;
            let start: i64 = tx.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sessions WHERE group_id=?1", [&group.id], |row| row.get(0)).map_err(|e| e.to_string())?;
            for (index, id) in group.item_ids.iter().enumerate() {
                if !members.insert(id) || members.len() > 200 { return Err("Invalid group membership".into()); }
                let changed = tx.execute("UPDATE sessions SET group_id=?1,sort_order=?2 WHERE id=?3 AND status='active'", params![group.id, start + index as i64, id]).map_err(|e| e.to_string())?;
                if changed != 1 { return Err("A session changed. Generate a new grouping plan.".into()); }
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }
    // -- Session CRUD --

    pub fn create_session(&self, id: &str, title: &str, timestamp: u64, cwd: &str, kind: &str, payload: &str) -> Result<(), String> {
        // Use UPSERT: if record_block/append_chat_message inserted a fallback row first
        // (title='', created_at=0), restore the real title/created_at/cwd/kind/payload instead of
        // letting INSERT OR IGNORE silently discard it.
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

    /// Insert or update an AI message; a completed assistant stream overwrites by id.
    /// `parts` is the renderer JSON for message parts (empty means none; see messageParts.ts).
    // Arguments mirror the frontend IPC contract one-to-one; update both when collapsing the struct.
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
        self.append_chat_message_for_pane(id, session_id, role, content, created_at, parts, attachments, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn append_chat_message_for_pane(
        &self, id: &str, session_id: &str, role: &str, content: &str,
        created_at: u64, parts: &str, attachments: &str, pane_id: Option<&str>,
    ) -> Result<(), String> {
        // Same redaction policy as command blocks: a message is persisted history too.
        let (content, parts, attachments) = (
            crate::redact::redact_text(content),
            crate::redact::redact_json(parts),
            crate::redact::redact_json(attachments),
        );
        // Session-row fallback, matching record_block.
        self.conn()
            .execute(
                "INSERT OR IGNORE INTO sessions (id, title, status, created_at) VALUES (?1, '', 'active', 0)",
                params![session_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "INSERT INTO chat_messages (id, session_id, role, content, created_at, parts, attachments, pane_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET content=excluded.content, created_at=excluded.created_at, parts=excluded.parts, attachments=excluded.attachments, pane_id=COALESCE(excluded.pane_id, chat_messages.pane_id)",
                params![id, session_id, role, content, created_at as i64, parts, attachments, pane_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Read a session's AI messages in ascending time order.
    pub fn get_chat_messages(&self, session_id: &str) -> Result<Vec<ChatMessageEntry>, String> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT id, role, content, created_at, parts, attachments, pane_id FROM chat_messages WHERE session_id = ?1 ORDER BY created_at ASC, rowid ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], map_chat_message)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Delete one AI message (regenerate, edit-and-resend, or delete exchange).
    /// Idempotent: a missing id is not an error.
    pub fn delete_chat_message(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM chat_messages WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn restore_session(&self, id: &str) -> Result<(), String> {
        let transaction = self.conn().unchecked_transaction().map_err(|e| e.to_string())?;
        // Legacy sessions may predate persistent session rows.
        transaction
            .execute(
                "INSERT OR IGNORE INTO sessions (id, title, status, created_at) VALUES (?1, '', 'active', 0)",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        transaction
            .execute(
                "UPDATE sessions SET status = 'active', closed_at = NULL WHERE id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        // Reopen the container without restoring its other historical members.
        transaction
            .execute(
                "UPDATE groups SET archived = 0 WHERE id = (SELECT group_id FROM sessions WHERE id = ?1)",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())
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

    /// Update the session working directory from an OSC 7 report after cd.
    pub fn update_session_cwd(&self, id: &str, cwd: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET cwd = ?1 WHERE id = ?2",
                params![cwd, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Overwrite the session payload JSON (split layouts and other variant state).
    pub fn update_session_payload(&self, id: &str, payload: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET payload = ?1 WHERE id = ?2",
                params![payload, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Read one session, including cwd, so restoration can recover its working directory.
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

    /// Reserved: delete a session and its blocks.
    #[allow(dead_code)]
    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        // ON DELETE CASCADE removes blocks.
        self.conn()
            .execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // -- Block persistence --

    // Arguments mirror the frontend IPC contract one-to-one; update both when collapsing the struct.
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
        cwd: &str,
    ) -> Result<(), String> {
        // Use the parsed plain snapshot when it contains a recognizable secret. ANSI style
        // sequences can split the secret in raw output, so independently matching raw bytes
        // would leave a second copy in storage.
        let clean = crate::redact::redact_text(output_clean);
        let clean_changed = clean != output_clean;
        let raw = if clean_changed { clean.clone() } else { crate::redact::redact_text(output_raw) };
        let safe_html = if clean_changed || raw != output_raw
            || crate::redact::redact_text(output_html) != output_html {
            String::new()
        } else { output_html.to_owned() };
        let (command, output_raw, output_clean, output_html) = (
            crate::redact::redact_text(command), raw, clean, safe_html,
        );
        // The session row may not exist yet because create_session is asynchronous (the first command
        // can arrive before create). This INSERT OR IGNORE fallback satisfies the foreign key so blocks
        // are never silently dropped.
        self.conn()
            .execute(
                "INSERT OR IGNORE INTO sessions (id, title, status, created_at) VALUES (?1, '', 'active', 0)",
                params![session_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "INSERT INTO blocks (id, session_id, pane_id, command, output_raw, output_clean, output_html, exit_code, status, started_at, ended_at, cwd)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                   command=excluded.command,
                   cwd=CASE WHEN excluded.cwd = '' THEN blocks.cwd ELSE excluded.cwd END,
                   output_raw=excluded.output_raw,
                   output_clean=excluded.output_clean,
                   output_html=excluded.output_html,
                   exit_code=excluded.exit_code,
                   status=excluded.status,
                   ended_at=excluded.ended_at",
                params![id, session_id, pane_id, command, output_raw, output_clean, output_html, exit_code, status, started_at as i64, ended_at.map(|v| v as i64), cwd],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // -- Search --

    pub fn search_blocks(
        &self,
        query: &str,
        max_results: usize,
        filter_session_status: Option<&str>,
    ) -> Result<Vec<BlockEntry>, String> {
        let pattern = format!("%{}%", query);

        // Build parameterized SQL so caller-controlled filter_session_status cannot inject SQL.
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
                    b.status, b.started_at, b.ended_at, s.title, s.status, b.cwd \
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

    /// List every session (active and historical) newest first, with block counts.
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
                        b.status, b.started_at, b.ended_at, s.title, s.status, b.cwd \
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

    // -- Group CRUD --

    pub fn create_group(&self, id: &str, title: &str, timestamp: u64) -> Result<(), String> {
        let next: i64 = self
            .conn()
            .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM groups", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "INSERT INTO groups (id, title, sort_order, collapsed, created_at) VALUES (?1, ?2, ?3, 0, ?4) ON CONFLICT(id) DO NOTHING",
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

    /// Delete a group: its sessions become ungrouped and only the container is removed.
    pub fn delete_group(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("UPDATE sessions SET group_id = NULL WHERE group_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute("DELETE FROM groups WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Delete a group and every session in it; blocks and chat cascade.
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

    /// Reorder selected groups within saved slots, retaining other scopes and archived groups.
    pub fn groups_reorder(&self, ids: &[String]) -> Result<(), String> {
        let mut statement = self.conn().prepare("SELECT id FROM groups ORDER BY sort_order, id")
            .map_err(|e| e.to_string())?;
        let current = statement.query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
        let current_ids: std::collections::HashSet<_> = current.iter().collect();
        let mut selected = std::collections::HashSet::new();
        let requested: Vec<_> = ids.iter().filter(|id| current_ids.contains(id) && selected.insert(*id)).collect();
        let mut requested = requested.into_iter();
        let ordered = current.iter().map(|id| if selected.contains(id) { requested.next().unwrap() } else { id });
        for (i, id) in ordered.enumerate() {
            self.conn()
                .execute("UPDATE groups SET sort_order = ?1 WHERE id = ?2", params![i as i64, id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Move a session into a group (or ungroup with group_id=None) at the end.
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
                "UPDATE sessions SET group_id = ?1, sort_order = ?2 WHERE id = ?3 AND group_id IS NOT ?1",
                params![group_id, next, session_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Reorder selected members within their saved slots, retaining hidden historical members.
    pub fn sessions_reorder(&self, group_id: Option<&str>, ids: &[String]) -> Result<(), String> {
        let mut statement = self.conn().prepare("SELECT id FROM sessions WHERE group_id IS ?1 ORDER BY sort_order, id")
            .map_err(|e| e.to_string())?;
        let current = statement.query_map(params![group_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
        let current_ids: std::collections::HashSet<_> = current.iter().collect();
        let mut selected = std::collections::HashSet::new();
        let requested: Vec<_> = ids.iter().filter(|id| current_ids.contains(id) && selected.insert(*id)).collect();
        let mut requested = requested.into_iter();
        let ordered = current.iter().map(|id| if selected.contains(id) { requested.next().unwrap() } else { id });
        for (i, id) in ordered.enumerate() {
            self.conn()
                .execute(
                    "UPDATE sessions SET sort_order = ?1 WHERE id = ?2 AND group_id IS ?3",
                    params![i as i64, id, group_id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Restore every historical session in a group to active; the frontend then rebuilds the tabs.
    pub fn restore_group(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE sessions SET status = 'active', closed_at = NULL WHERE group_id = ?1 AND status = 'historical' AND kind != 'workspace'",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        self.conn()
            .execute("UPDATE groups SET archived = 0 WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Archive a group: mark its active sessions historical, keep the group and mark it archived.
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

/// Block record (blocks joined with sessions).
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
    pub cwd: String,
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
        cwd: row.get(13)?,
    })
}

/// Session record.
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

/// Group record.
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

/// AI message record used to refill the chat when a session is restored.
#[derive(Clone, Serialize, Debug)]
pub struct ChatMessageEntry {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: u64,
    pub parts: String,
    /// Attachment metadata JSON (empty means none or legacy data).
    pub attachments: String,
    pub pane_id: Option<String>,
}

fn map_chat_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessageEntry> {
    Ok(ChatMessageEntry {
        id: row.get(0)?,
        role: row.get(1)?,
        content: row.get(2)?,
        created_at: row.get::<_, i64>(3)? as u64,
        parts: row.get(4)?,
        attachments: row.get(5)?,
        pane_id: row.get(6)?,
    })
}

#[cfg(test)]
mod grouping_tests {
    use super::*;
    #[test]
    fn group_creation_retries_keep_existing_metadata_and_order() {
        let db = HistoryDb::open_in_memory();
        db.create_group("retry", "Original", 1).unwrap();
        db.set_group_collapsed("retry", true).unwrap();
        db.create_group("other", "Other", 2).unwrap();
        db.create_group("retry", "Stale retry", 3).unwrap();
        let groups = db.list_groups().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].title, "Original");
        assert_eq!(groups[0].created_at, 1);
        assert!(groups[0].collapsed);
        assert_eq!(groups[1].id, "other");
    }

    #[test]
    fn partial_group_reordering_preserves_other_scopes_and_archived_slots() {
        let db = HistoryDb::open_in_memory();
        for id in ["one", "hidden", "two"] { db.create_group(id, id, 1).unwrap(); }
        db.archive_group("hidden", 2).unwrap();
        db.groups_reorder(&["two".into(), "missing".into(), "two".into(), "one".into()]).unwrap();
        assert_eq!(db.list_groups().unwrap().iter().map(|group| group.id.as_str()).collect::<Vec<_>>(), ["two", "hidden", "one"]);
        db.groups_reorder(&[]).unwrap();
        assert_eq!(db.list_groups().unwrap()[1].id, "hidden");
    }

    #[test]
    fn reviewed_groups_can_hold_only_unpersisted_draft_tabs() {
        let db = HistoryDb::open_in_memory();
        db.apply_group_plan(&[GroupAssignment { id: "draft-group".into(), title: "Drafts".into(), item_ids: Vec::new() }]).unwrap();
        assert_eq!(db.list_groups().unwrap()[0].title, "Drafts");
        let count: i64 = db.conn().query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
    #[test]
    fn reviewed_grouping_is_atomic_and_preserves_other_sessions() {
        let db = HistoryDb::open_in_memory();
        for id in ["one", "two"] { db.create_session(id, id, 1, "/app", "local", "{}").unwrap(); }
        let proposal = |ids: Vec<&str>| GroupAssignment { id: "work".into(), title: "Work".into(), item_ids: ids.into_iter().map(str::to_owned).collect() };
        assert!(db.apply_group_plan(&[proposal(vec!["one", "missing"])]).is_err());
        assert!(db.list_groups().unwrap().is_empty());
        let group: Option<String> = db.conn().query_row("SELECT group_id FROM sessions WHERE id='one'", [], |row| row.get(0)).unwrap();
        assert!(group.is_none());
        db.apply_group_plan(&[proposal(vec!["one"])]).unwrap();
        assert_eq!(db.list_groups().unwrap()[0].title, "Work");
        let other: Option<String> = db.conn().query_row("SELECT group_id FROM sessions WHERE id='two'", [], |row| row.get(0)).unwrap();
        assert!(other.is_none());
    }
}
