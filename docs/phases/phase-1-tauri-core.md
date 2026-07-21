# Phase 1: Tauri 核心终端

**日期**: 2026-07-22
**状态**: ✅ Rust 后端编译通过 (cargo check 0 errors 0 warnings)，待运行时验证
**版本**: v0.2.0-tauri

---

## 目标

从 Electron 迁移到 Tauri v2，构建可用的桌面终端应用。

## 后端 (Rust)

### pty.rs — PTY 管理器

- 依赖: `portable-pty` 0.9（WezTerm 同款）
- 能力: spawn shell、stdin 写入、stdout 读取（后台线程）、resize
- 每个会话一个 `std::thread` 读循环，检测 OSC 标题变更
- 使用 `take_writer()` / `try_clone_reader()` 分离读写句柄
- 最大 20 并发会话

### session.rs — 会话存储

- `HashMap<String, SessionInfo>` 内存存储
- `SessionInfo` 结构体 #[serde] 对齐前端 TypeScript 类型
- Phase 4 添加 `~/.ai-terminal/sessions.json` 持久化

### commands.rs — Tauri IPC

5 个命令全部用 `#[tauri::command]` 注册：
- `create_pty` → SessionInfo
- `write_pty` → ()
- `resize_pty` → ()
- `close_pty` → ()
- `list_pty` → Vec<SessionInfo>

PTY 输出通过 `app_handle.emit("pty:output", ...)` 推送前端。

## 前端

### api/index.ts — Tauri 桥接

- `invoke()` 调用 Rust 命令（替代 `ipcRenderer.invoke`）
- `listen()` 监听 Rust 事件（替代 `ipcRenderer.on`）
- 接口保持与旧 `electronAPI` 一致

### 适配的组件

| 文件 | 变更 |
|------|------|
| App.tsx | `window.electronAPI` → `import from ../../api` |
| useTerminal.ts | 同上 + WebGL → DOM 渲染器（macOS WKWebView 兼容） |
| useRichContent.ts | 同上 |
| TerminalTabs.tsx | 同上 |

## 删除的文件

所有 Electron 专属文件已删除：
- `src/main/` (7 files)
- `src/preload/` (1 file)
- `main-wrapper.mjs`, `electron-builder.yml`, `tsconfig.main.json`

## 编译验证

```bash
cargo check   # ✅ 0 errors, 0 warnings
npx tsc --noEmit  # 前端类型检查
```

## 运行时验证（待执行）

```bash
cargo tauri dev
# 预期: 窗口打开 → zsh/bash 可用 → 输入命令有回显
```
