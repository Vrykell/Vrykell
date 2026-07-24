# AI Terminal — 架构设计文档

> 版本：v1.0  
> 日期：2026-07-24  
> 适用范围：当前代码库（Phase 1 完成，Phase 2 进行中）及后续 Phase 3~5 演进  
> 说明：本文档基于现有实现进行架构抽象，**不修改任何源代码**，仅作为重构与演进的顶层蓝图。

---

## 1. 设计目标与原则

### 1.1 核心目标

AI Terminal 是一个面向 AI 时代的桌面终端模拟器。其架构需要同时满足：

1. **低延迟终端 I/O**：PTY 输出以 60fps 推送前端，输入回显 <16ms。
2. **可扩展的富内容渲染**：LaTeX / Markdown / 代码高亮 / 图片的检测与渲染。
3. **AI 原生集成**：内嵌 AI 对话面板、命令建议、AI SDK。
4. **跨平台**：macOS / Windows / Linux 三端一致。
5. **长期可维护**：代码量随 Phase 增长时，模块边界依然清晰。

### 1.2 设计原则

| 原则 | 解释 |
|------|------|
| **后端抽象为接口** | 前端通过 `api/` 调用后端能力，不直接依赖 Tauri 细节，便于未来迁移或 mock。 |
| **引擎与 UI 分离** | 终端 VT 引擎、`TerminalBuffer`、内容检测器都是纯逻辑，可在 Web Worker 或测试中独立运行。 |
| **按功能特征组织（Feature-based）** | 前端按 `features/terminal`、`features/rich-content`、`features/ai` 组织，而非按文件类型组织。 |
| **显式依赖，禁止隐式跨层调用** | UI 层只调用本 feature 的 engine/hook；跨 feature 通信通过共享 store 或事件总线。 |
| **前后端共享协议** | `TerminalEvent`、会话模型、设置模型、OSC AI 协议在 `shared/` 中成对定义，保持同步。 |
| **可测试性优先** | 核心引擎与解析器必须能在无浏览器、无 Tauri 环境下单元测试。 |

---

## 2. 系统上下文

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI Terminal 桌面应用                            │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  前端 (React 18 + TypeScript + Vite)                                │   │
│   │                                                                     │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │   │
│   │   │ 终端面板     │  │ AI 对话面板  │  │ 富文本输出面板           │ │   │
│   │   │ (自研 DOM    │  │ (Phase 3)    │  │ (RichOutput)             │ │   │
│   │   │  终端引擎)   │  │              │  │                          │ │   │
│   │   └──────┬───────┘  └──────┬───────┘  └────────────┬───────────────┘ │   │
│   │          │                 │                       │                 │   │
│   │          └─────────────────┼───────────────────────┘                 │   │
│   │                            │                                         │   │
│   │                    全局状态 (Zustand)                                │   │
│   │          sessions · richOutputs · aiMessages · settings · UI        │   │
│   │                                                                     │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │  内容渲染管线：检测器 → KaTeX / Shiki / marked              │   │   │
│   │   │  可在主线程或 Web Worker 中运行                              │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                         Tauri IPC (invoke + event)                          │
│                                      │                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  后端 (Rust + Tauri v2)                                             │   │
│   │                                                                     │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │   │
│   │   │ PTY 子系统   │  │ SSH 子系统   │  │ AI 桥接 / 代理           │ │   │
│   │   │ portable-pty │  │ (Phase 4)    │  │ (Phase 3)                │ │   │
│   │   └──────┬───────┘  └──────┬───────┘  └────────────┬───────────────┘ │   │
│   │          │                 │                       │                 │   │
│   │          └─────────────────┼───────────────────────┘                 │   │
│   │                            │                                         │   │
│   │                   会话 / 设置核心 (SessionStore)                     │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 分层架构

### 3.1 后端分层（Rust）

```
src-tauri/src/
├── main.rs              # 进程入口：仅调用 lib::run()
├── lib.rs               # 模块树 + Tauri Builder + 命令注册
├── app/                 # 应用层：Tauri 与内部子系统的粘合
│   ├── state.rs         # AppState：PtyManager + SettingsManager 的容器
│   └── commands.rs      # #[tauri::command] 命令分发（薄层）
├── core/                # 核心域：会话与设置
│   ├── mod.rs
│   ├── models.rs        # SessionInfo / SessionOptions / SessionType
│   ├── store.rs         # SessionStore（内存 + 未来持久化）
│   └── settings.rs      # AppSettings + SettingsManager
├── pty/                 # PTY 子系统
│   ├── mod.rs
│   ├── manager.rs       # PtyManager：spawn / write / resize / close
│   ├── session.rs       # ManagedSession 内部结构
│   ├── events.rs        # PtyOutputPayload / PtyExitPayload / TitleChangePayload
│   └── parser.rs        # TerminalParser + TerminalEvent
├── transport/           # 远程传输（Phase 4）
│   ├── mod.rs
│   └── ssh.rs           # russh SSH 客户端
└── ai/                  # AI 桥接（Phase 3）
    └── mod.rs           # reqwest 代理 / SSE 转发
```

**分层规则**：

- `app/commands.rs` 只负责反序列化参数、加锁、调用下层方法，**不包含业务逻辑**。
- `core/` 不依赖 `pty/`、`transport/`、`ai/`，只定义模型与存储接口。
- `pty/` 依赖 `core::models` 与 `core::store`，输出结构化 `TerminalEvent`。
- `transport/` 与 `ai/` 未来通过实现相同接口接入会话系统。

### 3.2 前端分层（TypeScript / React）

```
src/
├── shared/                    # 前后端共享的“协议层”
│   ├── types/                 # 纯类型定义
│   │   ├── session.ts
│   │   ├── settings.ts
│   │   ├── rich-content.ts
│   │   └── ai.ts
│   ├── protocol/
│   │   └── osc-ai.ts          # OSC 6969 AI 标记协议
│   └── terminal/
│       └── events.ts          # TerminalEvent 镜像
├── api/                       # 后端通信抽象
│   ├── core.ts                # PTY / 会话命令
│   ├── settings.ts
│   └── events.ts              # 事件监听器工厂
├── renderer/                  # React UI
│   ├── main.tsx               # 入口
│   ├── App.tsx                # 根组件
│   ├── app/                   # 应用壳
│   │   ├── Shell.tsx          # 根布局 + 全局生命周期
│   │   └── providers/         # 如有需要，放置 ThemeProvider 等
│   ├── features/              # 按功能特征组织
│   │   ├── terminal/
│   │   │   ├── engine/        # 纯 VT 引擎（无 React）
│   │   │   │   ├── buffer.ts
│   │   │   │   ├── char-width.ts
│   │   │   │   ├── events.ts  # applyEvents 适配
│   │   │   │   └── index.ts
│   │   │   ├── ui/            # 终端 UI
│   │   │   │   ├── TerminalView.tsx
│   │   │   │   ├── TerminalTabs.tsx
│   │   │   │   └── hooks/
│   │   │   │       └── useTerminal.ts
│   │   │   └── index.ts
│   │   ├── rich-content/
│   │   │   ├── pipeline/      # 纯检测/渲染逻辑
│   │   │   │   ├── detector.ts
│   │   │   │   ├── renderers/
│   │   │   │   │   ├── Latex.tsx
│   │   │   │   │   ├── Markdown.tsx
│   │   │   │   │   └── Code.tsx
│   │   │   │   └── index.ts
│   │   │   ├── ui/
│   │   │   │   ├── RichOutput.tsx
│   │   │   │   └── hooks/
│   │   │   │       └── useRichContent.ts
│   │   │   └── index.ts
│   │   ├── ai/
│   │   │   ├── ui/
│   │   │   │   └── AIChatPanel.tsx
│   │   │   └── index.ts
│   │   └── session/
│   │       ├── store/
│   │       │   └── session-slice.ts
│   │       └── ui/
│   │           └── hooks/
│   │               └── useSessionLifecycle.ts
│   ├── components/            # 共享展示组件
│   │   ├── common/
│   │   │   └── ConfirmDialog.tsx
│   │   └── layout/
│   │       └── StatusBar.tsx
│   ├── stores/                # 全局组合 store
│   │   └── root-store.ts
│   ├── services/              # 跨 feature 服务
│   ├── i18n/
│   ├── styles/
│   └── test/                  # 渲染层测试辅助
└── test/                      # 共享测试桩与 fixture
    ├── fake-tauri.ts
    ├── setup.ts
    └── fixtures/
```

**分层规则**：

- `shared/` 中**只放类型与纯函数**，禁止引入 React、Tauri API、DOM API。
- `api/` 是前端访问后端的唯一入口；`renderer/` 中任何文件不得直接 `import { invoke }`。
- `features/*/engine/` 或 `features/*/pipeline/` 是纯逻辑，必须能在 Node.js / Vitest 中独立测试。
- `features/*/ui/` 是 React 组件与 hooks，只依赖本 feature 的 engine/pipeline 与 `stores/`。
- `components/` 只放跨 feature 复用的展示组件，不持有业务状态。

---

## 4. 后端架构详述

### 4.1 模块依赖图

```
main.rs
  │
  ▼
lib.rs ──► app/state.rs ──► core/settings.rs
  │            │            core/store.rs
  │            │            core/models.rs
  │            ▼
  │      app/commands.rs ◄── 被 Tauri 注册
  │            │
  ├────────────┼────────────┐
  ▼            ▼            ▼
pty/        transport/     ai/
```

### 4.2 PTY 子系统

后端最核心的职责是把 PTY 字节流转换为**结构化终端事件流**，而不是把原始 ANSI 转义序列抛给前端。

```
PTY stdout bytes
    │
    ▼
┌─────────────────┐
│  TerminalParser │  (parser.rs)
│  push() /       │
│  take_events()  │
└────────┬────────┘
         │ Vec<TerminalEvent>
         ▼
┌─────────────────┐
│  PtyManager     │  (manager.rs)
│  批量 emit      │
│  "pty:output"   │
└─────────────────┘
```

**关键设计决策**（已在当前代码中实现）：

- Rust 侧解析，前端只处理高层 `TerminalEvent`，避免重复解析与 WebView 兼容问题。
- 每个输出批次附带 `cols`/`rows`，解决窗口拖拽期间的 resize 竞争。
- 单会话读线程 + `Arc<Mutex<ManagedSession>>`，保证 `write` / `resize` / `close` 并发安全。

### 4.3 会话与设置核心

- `SessionStore` 是内存中的会话元数据中心；未来 Phase 4 持久化时，只需扩展 `store.rs`，不影响 `pty/`。
- `SettingsManager` 负责 `app_data_dir/settings.json` 读写，提供默认配置。

### 4.4 未来扩展点

| Phase | 扩展 | 方式 |
|-------|------|------|
| Phase 3 | AI 桥接 | 新增 `ai/` 模块，提供 `ai:response` 事件 |
| Phase 4 | SSH | 新增 `transport/ssh.rs`，会话类型扩展 `SessionType::Ssh` |
| Phase 4 | 会话持久化 | 扩展 `core/store.rs`，读写 `~/.ai-terminal/sessions.json` |
| Phase 5 | 自动更新 | Tauri Updater 插件，在 `lib.rs` 初始化 |

---

## 5. 前端架构详述

### 5.1 终端引擎

前端终端引擎由两部分组成：

1. **VT 状态机**：`TerminalBuffer`
   - 维护 screen + scrollback 两层模型。
   - 处理 `TerminalEvent`，支持 DEC 1047/1048/1049 alternate screen。
   - 实现 CJK / emoji 宽度表，与 Ink / string-width 对齐。
   - 提供 `resize(cols)` / `setRows(rows)`，严格按 PTY 批次标签尺寸应用。

2. **渲染器**：`DomTerminalView`
   - 虚拟滚动 + overscan。
   - 按行 memo 渲染（`L` 组件），通过 `line.dirty` 触发更新。
   - span 合并减少 DOM 节点数。
   - 隐藏 textarea 作为 IME 代理。

```
pty:output event
    │
    ▼
useDomTerminal()
    │
    ├──► buf.resize(cols) / buf.setRows(rows)
    ├──► buf.applyEvents(events)
    └──► scheduleRender() (RAF throttle)
              │
              ▼
       DomTerminalView
              │
              ├──► 虚拟滚动切片
              ├──► L 行组件（memo + dirty）
              └──► 光标/IME 定位
```

### 5.2 富内容管线

```
终端输出文本
    │
    ▼
useRichContent() 缓冲 50KB + debounce 300ms
    │
    ▼
detectRichContent() 双层检测
    │
    ├──► OSC AI 标记（显式）
    └──► 正则自动检测（LaTeX / Code / Table / URL）
              │
              ▼
       Zustand richOutputs
              │
              ▼
       RichOutput 面板
              │
              ├──► LatexRenderer (KaTeX)
              ├──► MarkdownRenderer (marked)
              └──► CodeBlock (Shiki)
```

**未来优化**：检测器可迁移到 Web Worker，避免大输出阻塞主线程。

### 5.3 状态管理

当前使用单一 Zustand store。建议演进为 **组合式 slice**：

```typescript
// stores/root-store.ts
export const useRootStore = create<RootStore>()((...args) => ({
  ...createSessionSlice(...args),
  ...createRichContentSlice(...args),
  ...createAISlice(...args),
  ...createSettingsSlice(...args),
  ...createUISlice(...args),
}));
```

每个 slice 只负责本 feature 的状态与 action，跨 slice action 通过 `getState()` 调用。

### 5.4 输入流程

以用户输入 `ls` 为例：

```
按键 'l'
  │
  ▼
隐藏的 textarea onInput / onKeyDown
  │
  ▼
useDomTerminal() writeToPTY(sessionId, 'l')
  │
  ▼
api/core.ts → invoke('write_pty')
  │
  ▼
Rust PtyManager → writer.write_all(b'l')
  │
  ▼
Shell 回显 → PTY stdout
  │
  ▼
Rust TerminalParser → TerminalEvent::Text('l')
  │
  ▼
emit("pty:output") → 前端 applyEvents → render
  │
  ▼
useRichContent() debounce 检测富内容
```

---

## 6. IPC 协议

### 6.1 命令（invoke）

| 命令 | 方向 | 说明 |
|------|------|------|
| `create_pty` | R → B | 创建本地 PTY 会话 |
| `write_pty` | R → B | 写入 stdin |
| `resize_pty` | R → B | 调整 PTY 尺寸 |
| `close_pty` | R → B | 关闭并 kill 子进程 |
| `list_pty` | R → B | 列出活跃会话 |
| `load_settings` | R → B | 加载设置 |
| `save_settings` | R → B | 保存设置 |
| `exit_app` | R → B | 退出应用 |

### 6.2 事件（emit/listen）

| 事件 | 方向 | Payload | 说明 |
|------|------|---------|------|
| `pty:output` | B → R | `{sessionId, events: TerminalEvent[], cols, rows}` | 结构化终端事件流 |
| `pty:exit` | B → R | `{sessionId, exitCode}` | 子进程退出 |
| `pty:title-change` | B → R | `{sessionId, title}` | OSC 标题变更 |
| `session:created` | B → R | `{session}` | 新会话（预留） |
| `session:closed` | B → R | `{sessionId}` | 会话关闭（预留） |
| `ai:response` | B → R | `{chunk?, done?, error?}` | AI 流式响应（Phase 3） |

### 6.3 TerminalEvent 序列化格式

Rust 端使用 `#[serde(tag = "t", content = "p")]`，前端 TypeScript 类型一一对应：

```typescript
export type TerminalEvent =
  | { t: 'txt'; p: string }
  | { t: 'A'; p: number }      // CUU
  | { t: 'B'; p: number }      // CUD
  | { t: 'C'; p: number }      // CUF
  | { t: 'D'; p: number }      // CUB
  | { t: 'H'; p: [number, number] } // CUP
  | { t: 'G'; p: number }      // CHA
  | { t: 'd'; p: number }      // VPA
  | { t: 's' }                 // SaveCursor
  | { t: 'u' }                 // RestoreCursor
  | { t: 'J'; p: number }      // ED
  | { t: 'K'; p: number }      // EL
  | { t: 'm'; p: number[] }    // SGR
  | { t: 'dec'; p: [number, boolean] } // DECSET/DECRST
  | { t: 'cr' }
  | { t: 'lf' }
  | { t: 'bs' }
  | { t: 'tab' }
  | { t: 'osc'; p: string };   // Title
```

---

## 7. 测试策略

| 层级 | 范围 | 工具 | 关键覆盖 |
|------|------|------|---------|
| 单元测试（Rust） | `pty/parser.rs`、`core/store.rs` | `cargo test` | ANSI 解析、会话 CRUD、OSC 检测 |
| 单元测试（TS） | `features/terminal/engine`、`features/rich-content/pipeline` | Vitest | buffer 状态机、内容检测、协议序列化 |
| 组件测试 | `features/*/ui` | @testing-library/react | TerminalTabs、RichOutput、ConfirmDialog |
| E2E | 完整应用流 | Playwright + node-pty bridge | 启动 → 输入命令 → 验证输出 / resize |
| 安全 | 依赖审计 | cargo audit / npm audit | 漏洞检查 |

---

## 8. 性能目标

| 指标 | 目标 | 实现手段 |
|------|------|---------|
| 输入延迟 | <16ms | RAF throttle、批量事件、避免 React 每次写入都渲染 |
| 富渲染延迟 | <50ms | debounce 检测、KaTeX/Shiki LRU |
| 空闲内存 | <50MB | 虚拟滚动、scrollback 上限、无隐藏 Chromium |
| 活跃内存 | <200MB（10 标签） | buffer 缓存、限制并发会话 20 |
| 冷启动 | <1s | Tauri 原生 + 小体积前端 bundle |
| 安装包 | <10MB (macOS .dmg) | Tauri 打包 |

---

## 9. 演进路线图

### Phase 1 → 当前
- 本地 PTY、自研 DOM 终端、多标签、i18n、设置持久化、关闭确认。

### Phase 2 → 进行中
- 富内容检测与渲染：LaTeX / Markdown / 代码高亮 / 表格。

### Phase 3
- AI 对话面板：SSE 流式调用 Claude API。
- API Key 加密存储（Tauri Store 插件）。
- AI SDK：通过 OSC 6969 序列化富内容。

### Phase 4
- SSH 远程连接（russh）。
- 会话磁盘持久化。
- 分屏（React flexbox + 多 buffer）。

### Phase 5
- 三平台打包、代码签名、自动更新。

---

## 10. 附录：当前文件到目标模块的映射

| 当前文件 | 当前职责 | 目标位置（建议） |
|---------|---------|----------------|
| `src-tauri/src/main.rs` | 入口 | 不变 |
| `src-tauri/src/lib.rs` | 模块注册 | 不变 |
| `src-tauri/src/commands.rs` | Tauri 命令 | `src-tauri/src/app/commands.rs` |
| `src-tauri/src/pty.rs` | PtyManager + parser + payloads | 拆分为 `pty/manager.rs`、`pty/session.rs`、`pty/parser.rs`、`pty/events.rs` |
| `src-tauri/src/session.rs` | SessionStore + models | `core/store.rs` + `core/models.rs` |
| `src-tauri/src/settings.rs` | AppSettings + SettingsManager | `core/settings.rs` |
| `src-tauri/src/terminal_parser.rs` | TerminalParser + TerminalEvent | `pty/parser.rs` |
| `src/api/index.ts` | 全部 invoke/listen | 拆分为 `api/core.ts`、`api/settings.ts`、`api/events.ts` |
| `src/shared/types.ts` | 所有类型 | 拆分为 `shared/types/*.ts` |
| `src/shared/terminal-events.ts` | TerminalEvent | `shared/terminal/events.ts` |
| `src/shared/protocol.ts` | OSC AI 协议 | `shared/protocol/osc-ai.ts` |
| `src/renderer/terminal/buffer.ts` | VT 状态机 | `features/terminal/engine/buffer.ts` |
| `src/renderer/terminal/useDomTerminal.ts` | 终端 hook | `features/terminal/ui/hooks/useTerminal.ts` |
| `src/renderer/terminal/TerminalView.tsx` | DomTerminalView | `features/terminal/ui/TerminalView.tsx` |
| `src/renderer/components/terminal/TerminalView.tsx` | 薄包装 | 合并到 `features/terminal/ui/TerminalView.tsx` |
| `src/renderer/components/terminal/TerminalTabs.tsx` | 标签栏 | `features/terminal/ui/TerminalTabs.tsx` |
| `src/renderer/services/content-detector.ts` | 内容检测 | `features/rich-content/pipeline/detector.ts` |
| `src/renderer/hooks/useRichContent.ts` | 富内容 hook | `features/rich-content/ui/hooks/useRichContent.ts` |
| `src/renderer/components/output/*.tsx` | 渲染组件 | `features/rich-content/ui/` 与 `features/rich-content/pipeline/renderers/` |
| `src/renderer/components/ai/AIChatPanel.tsx` | AI 面板 | `features/ai/ui/AIChatPanel.tsx` |
| `src/renderer/stores/terminal-store.ts` | 单一 store | 拆分为 `stores/root-store.ts` + `features/*/store/*-slice.ts` |
| `src/renderer/App.tsx` | 根组件 | `app/Shell.tsx` + 精简 `App.tsx` |

---

## 11. 关键决策记录（ADR）

### ADR-001：终端引擎自研而非 xterm.js
- **状态**：已采纳。
- **原因**：macOS WKWebView 下 xterm.js WebGL/DOM 渲染出现乱码与布局异常；自研引擎可精确控制宽度表、resize 竞争、alternate screen。
- **代价**：需要持续维护 ANSI 解析与 VT 状态机。

### ADR-002：ANSI 解析放在 Rust 侧
- **状态**：已采纳。
- **原因**：避免前后端重复解析；Rust 侧可批量处理、减少 IPC payload 波动；前端引擎只处理结构化事件。
- **代价**：前后端必须严格同步 `TerminalEvent` 定义。

### ADR-003：输出批次附带 cols/rows
- **状态**：已采纳。
- **原因**：解决窗口拖拽期间旧宽度输出被新宽度解释导致的残影与换行错位。
- **代价**：每次 emit 增加两个 u16 字段，可忽略。

### ADR-004：单一 Zustand store → 组合 slice
- **状态**：建议演进。
- **原因**：当前 store 混合会话、UI、AI、富输出、设置，随着 Phase 增长会变得臃肿。
- **方案**：保留 Zustand，按 feature 拆分为 slice，通过 `stores/root-store.ts` 组合。

---

*文档结束*
