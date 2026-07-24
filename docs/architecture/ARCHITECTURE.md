# AI Terminal — 架构文档

> **版本**：v1.0（对应代码现状 2026-07-24，分支 `refactor/terminal-screen-model`）  
> **范围**：描述 AI Terminal 的总体架构、核心模块职责、数据流、接口契约及未来扩展方向。本文档与当前代码实现一一对应，可作为后续重构与开发的权威参考。

---

## 1. 项目概述

AI Terminal 是一款面向 AI 时代的桌面终端模拟器，核心差异点在于：

- **自研 DOM 终端**：不依赖 xterm.js，基于 VT 屏幕模型直接渲染到 DOM，解决系统 WebView 兼容性痛点。
- **结构化事件流**：ANSI/CSI/OSC 序列在 Rust 后端解析为 `TerminalEvent`，前端按事件更新屏幕模型，而非解析原始字节。
- **富内容渲染**：自动检测并渲染终端输出中的 LaTeX、Markdown、代码块、表格等内容到独立面板。
- **AI 原生**：内嵌 AI 对话面板，未来深度集成 Claude API。

**技术栈**：Tauri v2 + Rust (`portable-pty`) + React 18 + TypeScript + Vite + Zustand + KaTeX + Shiki + marked。

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI Terminal 桌面应用                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         前端 (React + TypeScript)                    │    │
│  │                                                                      │    │
│  │   ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐   │    │
│  │   │ 终端面板     │   │ AI 对话面板  │   │ 富内容输出面板 (Rich)    │   │    │
│  │   │ DomTerminal │   │ AIChatPanel │   │ RichOutput              │   │    │
│  │   └──────┬──────┘   └─────────────┘   └─────────────────────────┘   │    │
│  │          │                                                           │    │
│  │   ┌──────┴─────────────────────────────────────────────────────┐    │    │
│  │   │  Zustand Store (sessions / richOutputs / settings / ai)      │    │    │
│  │   └─────────────────────────────────────────────────────────────┘    │    │
│  │          ▲                                                           │    │
│  │          │ Tauri Event / Invoke                                       │    │
│  └──────────┼───────────────────────────────────────────────────────────┘    │
│             │                                                                 │
│  ┌──────────┼───────────────────────────────────────────────────────────┐    │
│  │          │                    Tauri IPC                               │    │
│  │          ▼                                                           │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │    │
│  │  │                        Rust 后端                                 │ │    │
│  │  │                                                                  │ │    │
│  │  │   ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │ │    │
│  │  │   │ PTY Manager  │  │ ANSI Parser  │  │ Session Store       │  │ │    │
│  │  │   │ (portable-pty)│  │ (terminal_parser)│  │ (in-memory)        │  │ │    │
│  │  │   └──────┬───────┘  └──────┬───────┘  └─────────────────────┘  │ │    │
│  │  │          │                  │                                    │ │    │
│  │  │          └──────────────────┘                                    │ │    │
│  │  │                     │                                            │ │    │
│  │  │                     ▼                                            │ │    │
│  │  │         TerminalEvent[] ──emit──▶ 前端                           │ │    │
│  │  └─────────────────────────────────────────────────────────────────┘ │    │
│  └───────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 核心设计决策

| 决策 | 选型 | 理由 |
|------|------|------|
| 桌面框架 | Tauri v2 | 包体积小、内存占用低、portable-pty 生产级、修复了 Electron `require` 阻塞 Bug。 |
| 终端渲染 | 自研 DOM 终端 | 系统 WebView 下 xterm.js 出现渲染异常；自研可控性高，便于集成富内容。 |
| ANSI 解析位置 | Rust 后端 | 前端不处理原始转义序列，减少 IPC 数据量，避免前后端重复解析。 |
| 事件协议 | `TerminalEvent` (tag/payload) | 紧凑、可序列化、前后端类型镜像，便于调试与扩展。 |
| 状态管理 | Zustand | 轻量、无样板代码，适合以会话为中心的状态。 |
| 富内容检测 | 双层策略 | OSC 显式标记（AI 工具）+ 正则自动检测（遗留输出），兼顾确定性与兼容性。 |

---

## 3. 分层架构

代码按职责分为五层，从上到下依赖关系递减：

```
┌────────────────────────────────────────┐
│  Layer 5: UI Shell (React components)  │
│  renderer/features/* / shared-ui       │
├────────────────────────────────────────┤
│  Layer 4: UI State & Hooks             │
│  renderer/stores / renderer/features/*/hooks│
├────────────────────────────────────────┤
│  Layer 3: API Bridge                   │
│  api/*                                 │
├────────────────────────────────────────┤
│  Layer 2: Shared Contracts             │
│  shared/types / shared/terminal-events │
├────────────────────────────────────────┤
│  Layer 1: Core Engine                  │
│  core/* / src-tauri/src/core/*         │
└────────────────────────────────────────┘
```

**依赖规则**：
- `core` 不依赖 `renderer`、`api` 或 Tauri（Rust 中 `core/terminal` 不依赖 `AppHandle`）。
- `api` 只依赖 `shared` 和 Tauri runtime。
- `renderer` 通过 `api` 与后端通信，通过 `core` 使用业务逻辑。
- `shared` 是最底层契约，被所有层引用。

---

## 4. 模块职责

### 4.1 Rust 后端

#### `src-tauri/src/main.rs`
Tauri 应用入口，调用 `ai_terminal_lib::run()`。

#### `src-tauri/src/lib.rs`
- 初始化 `AppState`（`PtyManager` + `SettingsManager`）。
- 注册 Tauri 命令。
- 配置 `tauri_plugin_shell`。

#### `src-tauri/src/commands/`
IPC 命令处理器，是前端 `api/` 的镜像。每个函数只做三件事：
1. 从 Tauri state 获取锁。
2. 调用 `core` 中的领域方法。
3. 返回结果或错误字符串。

当前命令：
- `create_pty` → `PtyManager::create_session`
- `write_pty` → `PtyManager::write_to_session`
- `resize_pty` → `PtyManager::resize_session`
- `close_pty` → `PtyManager::close_session`
- `list_pty` → `PtyManager::list_sessions`
- `load_settings` → `SettingsManager::load`
- `save_settings` → `SettingsManager::save`
- `exit_app` → `std::process::exit(0)`

#### `src-tauri/src/core/pty/manager.rs`
PTY 生命周期管理中心：
- `create_session`：解析 shell/cwd、分配 ID、spawn PTY、启动读线程、发射事件。
- `write_to_session`：向 PTY stdin 写入数据。
- `resize_session`：调整 PTY 尺寸并同步维度标签。
- `close_session`：kill 子进程并清理资源。
- `list_sessions`：返回会话列表。

**关键机制**：读线程每次读取后，将事件批次与当前 PTY 尺寸一起作为 `pty:output` 事件发射。前端先按该尺寸调整 buffer，再应用事件，从而避免 resize 竞争导致的残影。

#### `src-tauri/src/core/terminal/parser.rs`
流式 ANSI / CSI / OSC 解析器：
- 输入：原始 PTY 字节流。
- 输出：`Vec<TerminalEvent>`。
- 处理：文本累积、光标移动、擦除、SGR、DEC 私有模式、OSC title、字符集选择等。
- 特性：维护 `pending` 缓冲区，处理跨 chunk 的转义序列。

#### `src-tauri/src/core/terminal/events.rs`
`TerminalEvent` 枚举，与前端 `src/shared/terminal-events.ts` 1:1 对应。

```rust
pub enum TerminalEvent {
    Text(String),
    Cuu(u16), Cud(u16), Cuf(u16), Cub(u16),
    Cup(u16, u16), Cha(u16), Vpa(u16),
    SaveCursor, RestoreCursor,
    EraseDisplay(u8), EraseLine(u8),
    Sgr(Vec<u16>),
    DecPrivateMode(u16, bool),
    Cr, Lf, Bs, Tab,
    OscTitle(String),
}
```

序列化格式：`{ "t": "txt", "p": "hello" }`。

#### `src-tauri/src/core/session/`
- `types.rs`：`SessionInfo`、`SessionType`、`SessionOptions`，与前端 `shared/types/session.ts` 镜像。
- `store.rs`：内存会话存储，提供 add/remove/get/list/update_title。

#### `src-tauri/src/core/settings/`
- `types.rs`：`AppSettings` 及子设置结构。
- `manager.rs`：基于 `app_data_dir/settings.json` 的读写。

### 4.2 前端核心 (`src/core/`)

#### `src/core/terminal/buffer.ts`
`TerminalBuffer` 是 VT 屏幕模型：
- **主屏（screen）**：固定 `rows` 行，光标 screen-relative。
- **滚动缓冲区（scrollback）**：主屏上方，容量 `maxLines`。
- **交替屏（alt screen）**：vim/htop 全屏程序使用，无 scrollback。
- **事件应用**：`applyEvents(events)` 按顺序处理 `TerminalEvent`。
- **resize**：支持列宽变化时的行合并与拆分。
- **光标与样式**：维护 SGR 状态、保存/恢复光标、自动换行标志。

#### `src/core/terminal/width.ts`
字符宽度查表，精确匹配 `string-width@7` 的语义：
- 0 宽度：组合字符、变体选择器、零宽空格等。
- 1 宽度：ASCII、普通拉丁字符。
- 2 宽度：CJK、emoji、部分符号。

这是终端与 TUI 程序列数对齐的关键。

#### `src/core/rich-content/detector.ts`
富内容检测引擎：
- **Layer 1**：OSC AI 标记（显式协议）。
- **Layer 2**：正则自动检测（LaTeX、代码块、Markdown 表格、URL）。
- 输出：`DetectedBlock[]` + `cleanedText`。

#### `src/core/rich-content/protocol.ts`
OSC AI 协议：
- `OSC_AI_CODE = 6969`
- 标记格式：`\x1b]AI;TYPE;PARAM\x1b\\content\x1b]AI;END\x1b\\`
- 支持类型：`LATEX`、`MARKDOWN`、`CODE`、`IMAGE`。

### 4.3 前端 API 桥接 (`src/api/`)

按领域拆分：
- `pty.ts`：PTY 命令与事件监听。
- `session.ts`：会话生命周期事件。
- `settings.ts`：设置持久化。
- `ai.ts`：AI 响应事件（Phase 3）。
- `menu.ts`：应用菜单动作。

每个文件返回 `Promise<UnlistenFn>`，便于 React `useEffect` 清理。

### 4.4 前端渲染器 (`src/renderer/`)

#### `src/renderer/app/App.tsx`
应用根组件：
- 监听 Tauri 事件并同步到 Zustand。
- 管理标签页创建/关闭、退出确认对话框。
- 布局：Tabs + Terminal + RichOutput + AIChatPanel + StatusBar。

#### `src/renderer/features/terminal/`
- `components/DomTerminalView.tsx`：虚拟滚动终端渲染。
- `components/TerminalView.tsx`：`useDomTerminal` + `DomTerminalView` 包装。
- `components/TerminalTabs.tsx`：标签栏。
- `hooks/useDomTerminal.ts`：终端输入生命周期、IME 处理、RAF 节流渲染、ResizeObserver。

**渲染优化**：
- `L` 组件按行 memo，通过 `line.dirty` 标记触发重渲染。
- 同样式单元格合并为 span，减少 DOM 节点数。
- `requestAnimationFrame` 节流，将多次 PTY 写入合并为单次 React 渲染。

#### `src/renderer/features/rich-content/`
- `hooks/useRichContent.ts`：监听 `pty:output`，累积文本，debounce 检测，写入 store。
- `components/RichOutput.tsx`：富内容列表面板。
- `components/LatexRenderer.tsx`：KaTeX 渲染。
- `components/MarkdownRenderer.tsx`：marked 渲染。
- `components/CodeBlock.tsx`：Shiki 语法高亮。

#### `src/renderer/stores/terminal-store.ts`
Zustand 全局状态：
- `sessions`、`activeSessionId`
- `richOutputs`（按 sessionId 分组）
- `settings`
- `aiMessages`、`aiStreaming`
- `sidebarOpen`、`outputPanelOpen`、`outputPanelHeight`

---

## 5. 数据流

### 5.1 PTY 输出流（核心路径）

```
用户程序输出 ANSI 字节
        │
        ▼
portable-pty 读取字节
        │
        ▼
TerminalParser::push(bytes) ──▶ TerminalEvent[]
        │
        ▼
PtyManager 读线程按 chunk(128) 发射 pty:output
        │
        ▼
前端 api/pty.ts onPTYOutput
        │
        ▼
useDomTerminal：按 cols/rows 标签调整 buffer
        │
        ▼
TerminalBuffer.applyEvents(events)
        │
        ▼
scheduleRender (RAF) ──▶ DomTerminalView 重绘
        │
        ▼
用户看到更新后的终端内容
```

### 5.2 用户输入流

```
用户按键 / IME 输入
        │
        ▼
DomTerminalView 的 textarea
        │
        ▼
onKeyDown / onInput / onCompositionEnd
        │
        ▼
useDomTerminal 将输入转为字节序列
        │
        ▼
api/pty.ts writeToPTY ──invoke──▶ commands::write_pty
        │
        ▼
PtyManager.write_to_session ──▶ PTY stdin
        │
        ▼
用户程序读取输入
```

### 5.3 富内容检测流

```
pty:output 事件
        │
        ▼
useRichContent 过滤 Text 事件并拼接文本
        │
        ▼
累积到 bufferRef（上限 50KB）
        │
        ▼
300ms debounce ──▶ detectRichContent(text)
        │
        ▼
Layer 1: OSC AI markers ──或── Layer 2: 正则自动检测
        │
        ▼
生成 RichOutputItem ──▶ terminal-store.appendOutput
        │
        ▼
RichOutput 组件订阅并渲染
```

---

## 6. 接口契约

### 6.1 IPC 命令（invoke）

| 命令 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `create_pty` | `{ shell?, cwd?, cols?, rows? }` | `SessionInfo` | 创建本地 PTY 会话 |
| `write_pty` | `{ sessionId, data }` | `void` | 写入 PTY stdin |
| `resize_pty` | `{ sessionId, cols, rows }` | `void` | 调整 PTY 尺寸 |
| `close_pty` | `{ sessionId }` | `void` | 强制结束会话 |
| `list_pty` | — | `SessionInfo[]` | 列出活跃会话 |
| `load_settings` | — | `AppSettings` | 加载设置 |
| `save_settings` | `AppSettings` | `void` | 保存设置 |
| `exit_app` | — | `void` | 立即退出 |

### 6.2 IPC 事件（listen）

| 事件 | Payload | 方向 | 说明 |
|------|---------|------|------|
| `pty:output` | `{ sessionId, events: TerminalEvent[], cols, rows }` | 后端 ▶ 前端 | 终端输出批次 |
| `pty:exit` | `{ sessionId, exitCode }` | 后端 ▶ 前端 | 子进程退出 |
| `pty:title-change` | `{ sessionId, title }` | 后端 ▶ 前端 | 窗口标题变化 |
| `session:created` | `{ session: SessionInfo }` | 后端 ▶ 前端 | 会话创建（预留） |
| `session:closed` | `{ sessionId }` | 后端 ▶ 前端 | 会话关闭（预留） |
| `ai:response` | `{ chunk?, done?, error? }` | 后端 ▶ 前端 | AI 流式响应（Phase 3） |
| `app:menu-action` | `{ action }` | 后端 ▶ 前端 | 菜单动作 |

### 6.3 TerminalEvent 序列化

Rust 侧使用 `#[serde(tag = "t", content = "p")]`，TypeScript 侧镜像：

```ts
export type TerminalEvent =
  | { t: 'txt'; p: string }
  | { t: 'A'; p: number }
  | { t: 'H'; p: [number, number] }
  | { t: 'm'; p: number[] }
  | { t: 'osc'; p: string }
  // ...
```

### 6.4 OSC AI 协议

格式：
```
ESC ] AI ; TYPE [ ; PARAM ] ESC \\ content ESC ] AI ; END ESC \\
```

示例：
```ts
const latex = '\x1b]AI;LATEX;inline\x1b\\E=mc^2\x1b]AI;END\x1b\\';
```

---

## 7. 关键技术细节

### 7.1 Resize 竞争避免

问题：窗口拖拽时，PTY 尺寸在变化，但读线程可能仍在读取旧尺寸产生的字节。如果前端立即按新尺寸解析，会出现折行错位。

解决方案：
1. Rust 读线程在每次读取时获取当前 `cols/rows` 原子值。
2. `pty:output` payload 携带该批次产生时的 `cols/rows`。
3. 前端 `useDomTerminal` 在 `applyEvents` 之前先 `buf.resize(cols)`。
4. 容器 ResizeObserver 只调用 `resizePTY`，不直接调整 buffer。

### 7.2 光标与全宽字符

- 光标列 `cx` 是单元格索引。
- 全宽字符占用两列：主单元格存储字符，下一单元格标记 `wide: true` 作为延续。
- 渲染时跳过 `wide` 单元格，避免重复输出。
- 光标落在全宽字符第二列时，回退到第一列显示光标。

### 7.3 行样式合并（Span 合并）

`DomTerminalView` 的 `L` 组件在渲染时合并连续同样式单元格：
- 减少 span 数量（从 ~6000 降至 ~50-200）。
- 光标所在位置拆分 run，仅光标字符闪烁，避免整段文本闪烁。

### 7.4 RAF 节流渲染

PTY 输出可能一帧内触发多次更新。`useDomTerminal` 使用 `requestAnimationFrame`：
- 同一帧内多次 `scheduleRender()` 只排队一次。
- 下一帧统一触发 React 渲染。
- 减少约 90% 的无效重渲染。

---

## 8. 状态管理

### 8.1 Zustand Store 结构

```ts
interface TerminalStore {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  richOutputs: Record<string, RichOutputItem[]>;
  settings: AppSettings;
  aiMessages: Message[];
  aiStreaming: boolean;
  sidebarOpen: boolean;
  outputPanelOpen: boolean;
  outputPanelHeight: number;
  // actions...
}
```

### 8.2 状态来源

| 状态 | 来源 | 说明 |
|------|------|------|
| sessions | `createPTY` / `onSessionCreated` / `onPTYExit` | 会话列表 |
| activeSessionId | 用户点击标签页 | 当前激活会话 |
| richOutputs | `useRichContent` 检测 | 按 sessionId 分组 |
| settings | `load_settings` | 持久化设置 |
| aiMessages | `onAIResponse` | AI 对话历史 |

### 8.3 会话生命周期

```
创建：App.createAndAddSession() ──invoke──▶ create_pty ──▶ addSession()
关闭：用户点击关闭 ──invoke──▶ close_pty ──kill──▶ 读线程 EOF
       │                              │
       │                              ▼
       │                    pty:exit ──▶ removeSession()
       ▼
最后一个标签关闭 ──▶ 退出确认对话框
```

---

## 9. 测试策略

### 9.1 单元测试

- **Rust**：`cargo test`，重点测试 `SessionStore`、`TerminalParser`。
- **TS 引擎**：`src/core/terminal/__tests__/*.test.ts`，覆盖：
  - Buffer 基本写入、光标移动、擦除
  - Resize 行为
  - 全宽字符、emoji 宽度
  - 交替屏幕切换
  - 滚动条上限

### 9.2 组件测试

- `src/renderer/features/*/__tests__/*.test.tsx`
- 使用 `@testing-library/react` + `jsdom` + `fake-tauri` 桩。

### 9.3 E2E 测试

- `e2e/specs/*.spec.ts`
- `e2e/bridge/server.ts` 提供 node-pty WebSocket 桥，模拟 Rust 后端行为。
- 关键用例：
  - 启动、创建标签页、输入命令
  - Resize 不残留字符
  - Claude TUI 输出正确渲染

---

## 10. 安全与性能

### 10.1 安全

- Tauri v2 deny-by-default：前端无法访问文件系统、shell、网络，除非在 `capabilities/default.json` 中显式声明。
- 富内容渲染使用 DOMPurify（建议 Phase 2 后期引入）过滤 Markdown/LaTeX 输出。
- AI API Key 仅在 Rust 后端使用，不暴露给前端。

### 10.2 性能

- ANSI 解析在 Rust 后端完成，减少前端 CPU 占用。
- `TerminalEvent` 批次 chunk 为 128，避免单条 IPC 消息过大。
- RAF 节流 + 行级 memo + span 合并，确保 TUI 程序（如 Claude Code）流畅。
- 滚动条上限 5000 行，防止内存无限增长。
- 富内容检测 debounce 300ms，避免每帧扫描大文本。

---

## 11. 扩展路线图

### Phase 3 — AI 集成

新增模块：
- `src-tauri/src/features/ai/`：Claude API 调用、流式响应管理。
- `src/renderer/features/ai/`：AI 对话面板、命令建议组件。
- `src/api/ai.ts`：扩展 AI 相关命令与事件。

### Phase 4 — 远程功能

新增模块：
- `src-tauri/src/features/ssh/`：`russh` 客户端封装、连接管理。
- `src/core/ssh/`（可选）：前端 SSH 配置验证。
- `src/renderer/features/ssh/`：连接对话框、会话列表。
- `src/shared/types/ssh.ts`：SSH 连接类型。

### Phase 5 — 打包发布

- 更新 `src-tauri/tauri.conf.json` 签名与更新配置。
- CI/CD 构建三平台安装包。
- 自动更新服务集成。

---

## 12. 相关文档

- [项目结构重构方案](PROJECT-STRUCTURE-REFACTOR.md) — 零代码改动的目录重构计划
- [docs/plan.md](../plan.md) — 原始总体规划
- [docs/phases/phase-1-tauri-core.md](../phases/phase-1-tauri-core.md) — Phase 1 实现报告
- [docs/phases/phase-2-rich-content.md](../phases/phase-2-rich-content.md) — Phase 2 实现报告
