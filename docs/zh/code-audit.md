# 代码审查与领域分包

> 分支 `refactor/audit-and-modularize`。本文记录一次全项目审查的结论、已修复的问题、以及按领域分包的当前结构。审查范围：前端 `src/`（TypeScript/React/zustand）与后端 `src-tauri/src/`（Rust/Tauri）。

---

## 1. 领域分包后的结构

### 前端（src/）

```
src/
├── App.tsx / main.tsx / commands.ts / vite-env.d.ts   # 应用外壳、命令注册
├── chat/            # AI 对话渲染（Markdown / CommandBlock）
├── components/      # 无领域依赖的通用 UI + 壳（TopDock/SidePanel/StatusBar/Toast/ConfirmDialog/ContextMenu/UiBtn/DockButton/ResizeHandle/ErrorBoundary/CommandPalette/NewTabModal/SessionHistoryView）
├── files/           # 本地文件管理领域
│   ├── fs.ts  fileOpen.ts  fileIcon.ts  fileTree.ts
│   ├── workspaceDirs.ts
│   └── PanelFiles.tsx  DownloadManager.tsx
├── hooks/           # useGlobalShortcuts
├── i18n/            # zh.ts（当前主要被 toast.*/dock.* 使用）
├── lib/             # 纯基础设施（pty/shells/platform/errorHandler/killForeground/searchApi/sessionManager/tabTypes/ai）
├── search/          # 全局搜索领域（engine/registry/sources/GlobalSearch…）
├── settings/        # 设置领域
│   ├── SettingsView.tsx
│   └── registry.ts
├── ssh/             # SSH 领域（连接 + 远程文件）
│   ├── api.ts  store.ts
│   └── PanelSsh.tsx  SshFormModal.tsx  RemoteFiles.tsx
├── stores/          # 跨领域共享 store（workspace/terminal/blocks/chat/dock/ui/history/search*）
├── terminal/        # 终端/块/会话领域（含 pipeline/）
└── theme/           # 主题 tokens + ThemeProvider
```

> 变更：把原本散落在 `components/lib/stores` 三处的 SSH（5 文件）、文件管理（7 文件）、设置（2 文件）归拢到 `ssh/`、`files/`、`settings/`。`lib/` 与 `stores/` 收敛为「纯基础设施」与「跨领域共享状态」。

### 后端（src-tauri/src/）

已按领域拆分为单文件模块（ai/fs/file_open/history/ssh/pty/search/scan/shells/shell_integration），`lib.rs` 只做 command 汇总与 AppState 组装。相对健康；主要问题是 `history.rs`（7 张表）与 `search.rs`（DB 转发层）偏大、SSH 模型定义在 `history.rs` 而非 `ssh.rs`（依赖倒置）。

---

## 2. 已修复的问题（本分支）

| 位置 | 问题 | 修复 |
|---|---|---|
| `terminal/InputEditor.tsx` | 「输出发给 AI」「清除对话」两按钮空状态静默无反馈 | 加 toast 反馈 |
| `components/` | `PromptDialog.tsx` 死代码 | 删除 |
| `ai.ts` / `StatusBar.tsx` | 模型名非响应式（模块级缓存） | 改 zustand store，状态栏订阅 |
| `stores/blocks.ts` | 命令块书签带来额外状态、Toast 和驱逐分支 | 移除书签功能及配套状态 |
| `i18n/zh.ts` | 缺 `dock.ssh`，SSH 按钮 tooltip 显示 key | 补 key |
| `fs.rs` | `fs_rename` 的 `new_name` 可含 `/`/`..` 路径遍历 | 校验单一 path component |
| `search.rs` | 内容匹配上下文切片未对齐 UTF-8 边界，中文文件搜索 panic | `floor/ceil_char_boundary` 对齐 |
| `ai.rs` | SSE 按 chunk 独立 `from_utf8_lossy` 导致多字节乱码 | 字节缓冲按 `\n` 切完整行再解码 |
| `ai.rs` | HTTP 请求无超时 | `connect_timeout(15s)` + `timeout(180s)` |
| `ai.rs` | `config.json` 存 API key 未收紧权限 | 目录 0700、文件 0600；key 现已移出文件，改存平台密钥存储（DPAPI / 钥匙串 / 0600 文件） |
| `fs.rs` | `which_cmd_sync` 硬编码 zsh | 改 `/bin/sh` |
| `search/registry.ts` | 筛选源启用集合非响应式，切换后结果不更新 | 改 zustand store + 切换后重搜 |
| `lib/sessionManager.ts` | 恢复会话丢失 shell/SSH 元数据 | `restore` 接受 `RestoreMeta`；撤销关闭路径回填 |
| `history.rs` | `create_session` 用 `INSERT OR IGNORE` 丢真信息 | 改 `ON CONFLICT DO UPDATE` |
| `stores/chat.ts` | 流式中关标签残留 per-tab 幽灵空条目 | `appendChunk`/`finally` 判 tab 存在 |
| `ssh/SshFormModal.tsx` | `doTest` 非数字端口传 NaN | 校验端口合法性 |
| `terminal/pipeline/sessionController.ts` | 块数上限包含书签保护分支 | 移除书签后统一淘汰最旧块并释放输出终端 |
| `stores/workspace.ts` | `_lastClosed` 隐藏状态靠强转读写 | 声明进接口 |
| `shells.rs` | `list_shells` 同步 command 在主线程跑探测 | 改 async + spawn_blocking |
| `pty.rs` | `KillState` 条目从不清理 | `pty_close`/`reap_session` 同步删除 |
| `chat/MessageItem.tsx` | 死代码 | 删除 |

---

## 3. 已知待办（按优先级，尚未处理）

> 注：下列部分条目已在后续 round 修复（见 §2 表），此处保留原始审查记录以反映全貌；未标注的即为仍未处理。

### 后端 · 高

- `pty.rs` — `pty_write` 持会话锁做无超时阻塞写，缓冲区满时「结束」也被卡死。→ **已修复**：writer 拆出独立锁，`pty_resize` / `pty_close` / `pty_kill_foreground` 改 async + `spawn_blocking`（见 `docs/zh/pitfalls.md` §3.5）。
- `history.rs` — 迁移靠吞 `ALTER TABLE ADD COLUMN` 错误「碰运气」。→ `PRAGMA user_version` 版本化迁移。
- `history.rs` — `create_session` 用 `INSERT OR IGNORE`，先落库的兜底行会把真 title/cwd/created_at 丢掉。→ `ON CONFLICT DO UPDATE`。
- `ssh.rs` — 首次连接 TOFU 无确认即写 known_hosts，且 `write_file` 会覆盖整个文件破坏其它主机记录。→ 首次确认指纹 + 完整读入 + 并发锁。
- `ssh.rs` — 密码明文落 SQLite（`ssh_connections.password`）。→ 系统 keychain / 加密。
- `pty.rs` — `KillState` 条目从不清理；`pty_spawn` 部分失败泄漏子进程；`reap_session` emit 失败路径阻塞 wait。

### 后端 · 中

- `shells.rs` — `list_shells` 同步 command 在主线程跑多个 `Command::output`。
- `search.rs` — 大量 DB command 同步在主线程做 SQLite I/O（`LIKE` 全表扫描）。
- `ssh.rs` — user 为空默认 root；`port=None` 读回成 `Some(22)`。
- `history.rs` — `record` 去重忽略 cwd；`LIKE` 通配符未转义。
- `lib.rs` — `HistoryDb::open().expect` 启动即 panic。

### 前端 · 高

- `search/registry.ts` — 筛选源启用集合是模块级变量，非响应式；切换后结果不更新直到重新输入。
- `lib/sessionManager.ts` — `restore()` 只写 `{id,title,kind,cwd}`，丢失 shellType/ssh 元数据，SSH/指定 shell 标签恢复后 spawn 成默认 shell。

### 前端 · 中

- `stores/chat.ts` — 流式回复中关标签会残留 per-tab 幽灵空条目。
- `terminal/InputEditor.tsx` — selector 内跨 store 读 activeId（脆弱模式）。
- `components/SshFormModal.tsx` — `doTest` 不校验端口，非数字传 NaN。
- `stores/workspace.ts` — `_lastClosed` 未声明在接口，靠强转读写。
- `files/PanelFiles.tsx` — `waitForSession` 8s 超时静默丢弃命令。
- 重复逻辑可抽取：字号缩放、时长/大小格式化、高亮片段、面包屑 `Crumb`、内联重命名流（本地/远程两份）。
- 死代码：`chat/MessageItem.tsx`、`UiBtn.tsx` 的 `HBtn/InputBtn`、`ShellIndicator` 的 `detectShell`、`searchApi` 的 `historyStats/getSearchContext`。
- `i18n` 名存实亡：大量 key 无引用，多数 UI 文案硬编码中文。

---

## 4. 后续分包建议（渐进式）

- `ui/`：把 `UiBtn/DockButton/ResizeHandle/ConfirmDialog/ContextMenu/Toast/CommandPalette/TopDock/SidePanel/StatusBar` 从 `components/` 独立成无领域依赖的 `ui/`。
- `downloads/`：把下载历史（`DownloadEntry` + `downloadsList/Clear` + `DownloadManager`）从 `ssh/api.ts` 与 `files/` 独立出来。
- `lib/format.ts`、`lib/highlight.tsx`：单点实现 `fmtDuration/fmtSize/fmtTimeAgo` 与高亮片段。
- `stores/workspace.ts` 瘦身：会话持久化归 `sessionManager`，SSH 元数据归 `ssh/`。
- 后端：`history.rs` 拆 `db/` + `repo/`；`search.rs` 改名/拆分「DB command 转发层」；`which` 命令探测三套合一。
