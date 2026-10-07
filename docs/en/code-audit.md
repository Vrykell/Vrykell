# Code Audit and Domain Modularization

> Branch `refactor/audit-and-modularize`. This document records the conclusions of a full-project audit, the issues that have been fixed, and the current structure after domain-based modularization. Audit scope: the frontend `src/` (TypeScript/React/zustand) and the backend `src-tauri/src/` (Rust/Tauri).

---

## 1. Structure After Domain Modularization

### Frontend (src/)

```
src/
├── App.tsx / main.tsx / commands.ts / vite-env.d.ts   # App shell, command registration
├── chat/            # AI conversation rendering (Markdown / CommandBlock)
├── components/      # Domain-independent generic UI + shell (TopDock/SidePanel/StatusBar/Toast/ConfirmDialog/ContextMenu/UiBtn/DockButton/ResizeHandle/ErrorBoundary/CommandPalette/NewTabModal/SessionHistoryView)
├── files/           # Local file management domain
│   ├── fs.ts  fileOpen.ts  fileIcon.ts  fileTree.ts
│   ├── workspaceDirs.ts
│   └── PanelFiles.tsx  DownloadManager.tsx
├── hooks/           # useGlobalShortcuts
├── i18n/            # zh.ts (currently mainly used by toast.*/dock.*)
├── lib/             # Pure infrastructure (pty/shells/platform/errorHandler/killForeground/searchApi/sessionManager/tabTypes/ai)
├── search/          # Global search domain (engine/registry/sources/GlobalSearch…)
├── settings/        # Settings domain
│   ├── SettingsView.tsx
│   └── registry.ts
├── ssh/             # SSH domain (connections + remote files)
│   ├── api.ts  store.ts
│   └── PanelSsh.tsx  SshFormModal.tsx  RemoteFiles.tsx
├── stores/          # Cross-domain shared stores (workspace/terminal/blocks/chat/dock/ui/history/search*)
├── terminal/        # Terminal/block/session domain (includes pipeline/)
└── theme/           # Theme tokens + ThemeProvider
```

> Change: SSH (5 files), file management (7 files), and settings (2 files), formerly scattered across the three locations `components/lib/stores`, were consolidated into `ssh/`, `files/`, and `settings/`. `lib/` and `stores/` were narrowed to "pure infrastructure" and "cross-domain shared state".

### Backend (src-tauri/src/)

Already split into single-file modules by domain (ai/fs/file_open/history/ssh/pty/search/scan/shells/shell_integration); `lib.rs` only aggregates commands and assembles AppState. Relatively healthy; the main problems are that `history.rs` (7 tables) and `search.rs` (DB forwarding layer) are somewhat large, and the SSH model is defined in `history.rs` rather than `ssh.rs` (dependency inversion).

---

## 2. Fixed Issues (This Branch)

| Location | Issue | Fix |
|---|---|---|
| `terminal/InputEditor.tsx` | The "Send output to AI" and "Clear conversation" buttons gave no feedback in the empty state | Added toast feedback |
| `components/` | `PromptDialog.tsx` dead code | Deleted |
| `ai.ts` / `StatusBar.tsx` | Model name was non-reactive (module-level cache) | Changed to a zustand store; the status bar subscribes |
| `stores/blocks.ts` | Command block bookmarks introduced extra state, a Toast, and eviction branches | Removed the bookmark feature and its supporting state |
| `i18n/zh.ts` | Missing `dock.ssh`; the SSH button tooltip showed the key | Added the key |
| `fs.rs` | `fs_rename`'s `new_name` could contain `/`/`..` path traversal | Validate a single path component |
| `search.rs` | The content-match context slice was not aligned to UTF-8 boundaries, causing a panic when searching Chinese files | Align with `floor/ceil_char_boundary` |
| `ai.rs` | SSE decoded each chunk independently with `from_utf8_lossy`, causing multibyte corruption | Buffer bytes, split complete lines on `\n`, then decode |
| `ai.rs` | HTTP requests had no timeout | `connect_timeout(15s)` + `timeout(180s)` |
| `ai.rs` | Permissions were not tightened for the API key stored in `config.json` | Directory 0700, file 0600 |
| `fs.rs` | `which_cmd_sync` hardcoded zsh | Changed to `/bin/sh` |
| `search/registry.ts` | The enabled set of filter sources was non-reactive; results did not update after toggling | Changed to a zustand store + re-search after toggling |
| `lib/sessionManager.ts` | Restoring a session lost shell/SSH metadata | `restore` accepts `RestoreMeta`; the undo-close path backfills it |
| `history.rs` | `create_session` used `INSERT OR IGNORE`, losing real information | Changed to `ON CONFLICT DO UPDATE` |
| `stores/chat.ts` | Closing a tab during streaming left a per-tab ghost empty entry | `appendChunk`/`finally` check that the tab exists |
| `ssh/SshFormModal.tsx` | `doTest` passed NaN for a non-numeric port | Validate port validity |
| `terminal/pipeline/sessionController.ts` | The block-count limit included a bookmark-protection branch | After removing bookmarks, uniformly evict the oldest block and release its output terminal |
| `stores/workspace.ts` | The hidden `_lastClosed` state was read/written via casts | Declared it in the interface |
| `shells.rs` | The synchronous `list_shells` command ran probing on the main thread | Changed to async + spawn_blocking |
| `pty.rs` | `KillState` entries were never cleaned up | `pty_close`/`reap_session` delete them in sync |
| `chat/MessageItem.tsx` | Dead code | Deleted |

---

## 3. Known TODOs (By Priority, Not Yet Addressed)

> Note: Some of the items below were fixed in later rounds (see the §2 table); the original audit record is kept here to reflect the full picture. Items not marked otherwise are still unaddressed.

### Backend · High

- `pty.rs` — `pty_write` held the session lock for a blocking write with no timeout; when the buffer was full, even "end" got stuck. → **Fixed**: the writer has its own lock, and `pty_resize` / `pty_close` / `pty_kill_foreground` now run async on `spawn_blocking` (see `docs/en/pitfalls.md` §3.5).
- `history.rs` — Migrations rely on swallowing `ALTER TABLE ADD COLUMN` errors and hoping for the best. → Versioned migrations via `PRAGMA user_version`.
- `history.rs` — `create_session` uses `INSERT OR IGNORE`, so a fallback row written first discards the real title/cwd/created_at. → `ON CONFLICT DO UPDATE`.
- `ssh.rs` — On first connection, TOFU writes known_hosts without confirmation, and `write_file` overwrites the entire file, corrupting other hosts' records. → Confirm the fingerprint on first use + read the whole file + a concurrency lock.
- `ssh.rs` — Passwords are stored in plaintext in SQLite (`ssh_connections.password`). → System keychain / encryption.
- `pty.rs` — `KillState` entries are never cleaned up; a partial failure in `pty_spawn` leaks child processes; the `reap_session` emit-failure path blocks wait.

### Backend · Medium

- `shells.rs` — The synchronous `list_shells` command runs multiple `Command::output` calls on the main thread.
- `search.rs` — Many DB commands do SQLite I/O synchronously on the main thread (`LIKE` full-table scans).
- `ssh.rs` — An empty user defaults to root; `port=None` reads back as `Some(22)`.
- `history.rs` — `record` deduplication ignores cwd; `LIKE` wildcards are not escaped.
- `lib.rs` — `HistoryDb::open().expect` panics on startup.

### Frontend · High

- `search/registry.ts` — The enabled set of filter sources is a module-level variable and non-reactive; after toggling, results do not update until you re-enter input.
- `lib/sessionManager.ts` — `restore()` writes only `{id,title,kind,cwd}`, losing shellType/ssh metadata; SSH tabs or tabs with a specified shell spawn the default shell after restore.

### Frontend · Medium

- `stores/chat.ts` — Closing a tab during a streaming reply leaves a per-tab ghost empty entry.
- `terminal/InputEditor.tsx` — Reading activeId across stores inside a selector (fragile pattern).
- `components/SshFormModal.tsx` — `doTest` does not validate the port and passes NaN for non-numeric input.
- `stores/workspace.ts` — `_lastClosed` is not declared in the interface and is read/written via casts.
- `files/PanelFiles.tsx` — `waitForSession` silently drops commands after an 8s timeout.
- Duplicated logic that could be extracted: font-size scaling, duration/size formatting, highlight snippets, the breadcrumb `Crumb`, and the inline rename flow (two copies, local/remote).
- Dead code: `chat/MessageItem.tsx`, `HBtn/InputBtn` in `UiBtn.tsx`, `detectShell` in `ShellIndicator`, and `historyStats/getSearchContext` in `searchApi`.
- `i18n` exists in name only: many keys are unreferenced, and most UI copy is hardcoded Chinese.

---

## 4. Follow-up Modularization Suggestions (Incremental)

- `ui/`: Extract `UiBtn/DockButton/ResizeHandle/ConfirmDialog/ContextMenu/Toast/CommandPalette/TopDock/SidePanel/StatusBar` from `components/` into a domain-independent `ui/`.
- `downloads/`: Extract download history (`DownloadEntry` + `downloadsList/Clear` + `DownloadManager`) out of `ssh/api.ts` and `files/`.
- `lib/format.ts`, `lib/highlight.tsx`: Single-point implementations of `fmtDuration/fmtSize/fmtTimeAgo` and highlight snippets.
- Slim down `stores/workspace.ts`: session persistence goes to `sessionManager`, SSH metadata goes to `ssh/`.
- Backend: Split `history.rs` into `db/` + `repo/`; rename/split the "DB command forwarding layer" in `search.rs`; merge the three `which` command-detection implementations into one.
