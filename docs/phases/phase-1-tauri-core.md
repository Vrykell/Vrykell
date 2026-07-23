# Phase 1: Tauri 核心终端

**日期**: 2026-07-22（2026-07-24 更新）
**状态**: ✅ 完成 — 自研 DOM 终端已替换 xterm.js，结构化终端事件流上线，关闭/主题/i18n 体验完善
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

## 运行时验证

```bash
cargo tauri dev  # ✅ 窗口打开，Rust 后端启动正常
```

## 已知问题（历史，已解决）

> 以下问题均出现在 xterm.js 渲染时期。**后续通过自研 DOM 终端重写已全部解决**（见下方"后续进展"）。

### 1. 白色可拖拽区域（已解决）
**现象**: 终端上方存在白色可拖拽区域，可随意调整大小。中文输入法候选框定位到此区域。
**排查记录**:
- 已排除: `titleBarStyle: Overlay`（开关均无效）
- 已排除: `-webkit-app-region: drag`（已移除）
- 已排除: CSS 背景色（硬编码 `#0a0a0c` 无效）
- 已排除: 字体问题（已换 Menlo 内置字体）
- 根因: WKWebView + xterm.js 渲染兼容问题 → **随自研 DOM 终端替换 xterm.js 而消失**

### 2. 终端字符乱码 `wwwwww` / `%%%%%%`（已解决）
**现象**: 终端启动时出现重复乱码，复制后显示正常提示符文本。
**排查记录**:
- 已排除: ANSI 转义序列（已添加 `stripAnsi` 过滤）
- 已排除: 字体（已换 Menlo）
- 根因: WKWebView + xterm.js 渲染兼容问题 → **随自研 DOM 终端替换 xterm.js 而消失**

### 3. RichOutput 面板
- 当前: 默认隐藏，`Ctrl+Shift+R` 切换
- 目标: 数据层检测 + 终端内联渲染（见 Phase 2 报告）

---

## 后续进展（2026-07-22 → 2026-07-24）

### 自研 DOM 终端（替换 xterm.js）
- `src/renderer/terminal/buffer.ts` — `TerminalBuffer` 单元格网格：auto-wrap、CJK 宽字符、CHA/CUP 光标 clamping、resize 同步
- `src/renderer/terminal/useDomTerminal.ts` — 键盘输入、IME 组合输入（中文输入法）、PTY I/O 绑定、字符宽度实测
- `src/renderer/terminal/TerminalView.tsx` — `DomTerminalView` 虚拟滚动渲染、span 合并、光标闪烁

### 结构化终端事件流
- `src-tauri/src/terminal_parser.rs` — Rust 侧 ANSI 解析器，输出 `TerminalEvent`（serde `{t, p}`）
- `pty:output` payload 携带事件产生时的终端尺寸（`cols?/rows?`），前端按该尺寸应用事件，避免 resize 竞态
- 大事件批次自动拆分，避免 Tauri IPC 截断

### Resize 稳定性修复（多个 commit）
- CUP/CHA 处理器在 resize 后 clamp 光标位置
- 按事件产生时的尺寸应用 PTY 输出
- 容器 resize 时重新钉住 DOM 滚动位置
- 初始 PTY 尺寸从窗口大小估算

### 关闭流程与主题（fix/tab-close-and-terminal-theme 分支）
- 关闭会话时 Rust 端强制 `child.kill()`，前台程序（vim/top/htop）立即终止
- 关闭标签前弹出确认对话框（复用 `ConfirmDialog`），最后一个标签关闭时只弹一次退出对话框
- i18n：中/英文案（`src/renderer/i18n/`）
- 终端主题切换为纯黑背景 `#000000` + 亮白前景 `#f0f0f0`，CSS 变量驱动
- 详见 [设计文档](../superpowers/specs/2026-07-24-tab-close-and-terminal-theme-design.md)

### 设置持久化
- `src-tauri/src/settings.rs` — `load_settings` / `save_settings` 命令，持久化到 app_data_dir
