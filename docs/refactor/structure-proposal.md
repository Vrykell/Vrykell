# AI Terminal — 项目结构重构方案

> 版本：v1.0  
> 日期：2026-07-24  
> 状态：✅ **已执行**（分支 `refactor/project-structure`，8 阶段全部完成，`cargo test` 21 通过 / Vitest 140 通过 / E2E smoke+repro 通过）  
> 配套文档：[architecture.md](../architecture.md)

---

## 1. 重构目标

当前项目已完成 Phase 1 核心终端，并进入 Phase 2 富内容渲染。随着 Phase 3（AI 集成）、Phase 4（SSH + 持久化）、Phase 5（打包发布）推进，代码量与功能交叉将快速增长。本次重构目标是：

1. **消除当前结构中的命名冲突与职责混杂**（如两个 `TerminalView.tsx`）。
2. **按功能特征（feature-based）重新组织前端目录**，使 terminal / rich-content / ai / session 四大领域边界清晰。
3. **拆分 Rust 后端平铺模块**，建立 `app` / `core` / `pty` / `transport` / `ai` 分层。
4. **统一前后端共享协议位置**，避免类型与实现漂移。
5. **为每个核心模块提供独立的单元测试入口**，降低回归成本。
6. **保持 Tauri v2 + React 18 + TypeScript + Rust 技术栈不变**。

---

## 2. 现状分析

### 2.1 当前目录结构

```
ai-terminal/
├── src-tauri/src/
│   ├── main.rs
│   ├── lib.rs
│   ├── commands.rs          # 8 个 Tauri 命令
│   ├── pty.rs               # PtyManager + parser + payloads，约 350 行
│   ├── session.rs           # SessionStore + models
│   ├── settings.rs          # AppSettings + SettingsManager
│   └── terminal_parser.rs   # TerminalParser + TerminalEvent
├── src/
│   ├── api/index.ts         # 所有 invoke/listen 集中一处
│   ├── renderer/
│   │   ├── App.tsx          # 包含生命周期、事件监听、快捷键、对话框
│   │   ├── components/
│   │   │   ├── ai/AIChatPanel.tsx
│   │   │   ├── common/ConfirmDialog.tsx
│   │   │   ├── layout/StatusBar.tsx
│   │   │   ├── output/RichOutput.tsx ...
│   │   │   └── terminal/TerminalView.tsx   # 薄包装
│   │   ├── hooks/useRichContent.ts
│   │   ├── services/content-detector.ts
│   │   ├── stores/terminal-store.ts
│   │   ├── terminal/
│   │   │   ├── buffer.ts                  # VT 状态机
│   │   │   ├── TerminalView.tsx           # DomTerminalView
│   │   │   └── useDomTerminal.ts          # 终端 hook
│   │   └── ...
│   ├── shared/types.ts
│   ├── shared/terminal-events.ts
│   ├── shared/protocol.ts
│   └── test/fake-tauri.ts ...
├── e2e/
├── docs/
└── scripts/
```

### 2.2 主要痛点

| 痛点 | 影响 | 示例 |
|------|------|------|
| Rust 后端模块平铺 | `pty.rs` 同时承担管理、解析、事件载荷，随着 SSH/AI 加入会膨胀到难以维护 | `PtyManager` 与 `TerminalParser` 同文件 |
| 前端 `terminal/` 与 `components/terminal/` 命名冲突 | 新成员难以判断该改哪个文件 | `TerminalView.tsx` 同时出现在两个目录 |
| 单一 `api/index.ts` | 所有后端调用集中，未来命令增多后文件过长 | 当前已有 PTY / settings / menu / AI 事件 |
| 单一 `shared/types.ts` | 会话、设置、富内容、AI 类型混在一个文件 | 查找与同步困难 |
| 单一 `terminal-store.ts` | 会话、UI、AI、富输出、设置全部耦合 | 未来 slice 之间容易互相污染 |
| `App.tsx` 职责过重 | 包含事件监听、会话管理、快捷键、退出对话框 | 难以单独测试 |
| 测试文件与源码混放 | `terminal/` 下同时存在 `.ts`、`.tsx`、`.test.ts`、fixture | 视觉噪音大 |
| i18n 编译时切换 | 通过 `VITE_LOCALE` 选择语言，运行时无法切换 | 限制多语言体验 |

---

## 3. 重构原则

1. **不改代码，只改位置**：本次方案只做目录与模块边界调整，不改动业务逻辑、API 签名、组件行为。
2. **按领域分 feature**：前端以 `features/terminal`、`features/rich-content`、`features/ai`、`features/session` 为核心单元。
3. **引擎与 UI 分离**：纯逻辑模块不得依赖 React / Tauri / DOM；UI 模块只依赖本 feature 的引擎与共享 store。
4. **后端分层清晰**：`app`（Tauri 粘合）→ `core`（会话/设置）→ `pty` / `transport` / `ai`（子系统）。
5. **共享协议集中**：`shared/` 只放类型与纯函数，按子域拆分为 `types/*`、`protocol/*`、`terminal/*`。
6. **逐步迁移**：每个 PR 只迁移一个 feature 或一层，确保测试随时通过。

---

## 4. 目标项目结构

```
ai-terminal/
├── src-tauri/                          # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── icons/
│   └── src/
│       ├── main.rs                     # 入口
│       ├── lib.rs                      # 模块树 + Tauri Builder
│       ├── app/                        # Tauri 应用层粘合
│       │   ├── state.rs                # AppState
│       │   └── commands.rs             # #[tauri::command] 薄层
│       ├── core/                       # 核心域：会话 + 设置
│       │   ├── mod.rs
│       │   ├── models.rs               # SessionInfo / SessionOptions / SessionType
│       │   ├── store.rs                # SessionStore
│       │   └── settings.rs             # AppSettings + SettingsManager
│       ├── pty/                        # PTY 子系统
│       │   ├── mod.rs
│       │   ├── manager.rs              # PtyManager
│       │   ├── session.rs              # ManagedSession
│       │   ├── events.rs               # PtyOutputPayload / PtyExitPayload / TitleChangePayload
│       │   └── parser.rs               # TerminalParser + TerminalEvent
│       ├── transport/                  # 远程传输（Phase 4）
│       │   ├── mod.rs
│       │   └── ssh.rs                  # SSH 客户端
│       └── ai/                         # AI 桥接（Phase 3）
│           └── mod.rs
│
├── src/                                # TypeScript 前端
│   ├── shared/                         # 前后端共享协议
│   │   ├── types/
│   │   │   ├── index.ts                # 统一 re-export
│   │   │   ├── session.ts
│   │   │   ├── settings.ts
│   │   │   ├── rich-content.ts
│   │   │   └── ai.ts
│   │   ├── protocol/
│   │   │   └── osc-ai.ts               # OSC 6969 协议
│   │   └── terminal/
│   │       └── events.ts               # TerminalEvent 镜像
│   │
│   ├── api/                            # 后端通信抽象（唯一入口）
│   │   ├── index.ts                    # 统一 re-export
│   │   ├── core.ts                     # PTY / 会话命令
│   │   ├── settings.ts                 # 设置命令
│   │   └── events.ts                   # 事件监听器工厂
│   │
│   ├── renderer/                       # React UI
│   │   ├── main.tsx
│   │   ├── index.html
│   │   ├── App.tsx                     # 根组件（仅挂载 Shell）
│   │   ├── app/                        # 应用壳
│   │   │   ├── Shell.tsx               # 全局布局 + 生命周期 + 事件监听
│   │   │   └── providers/              # 未来：ThemeProvider、I18nProvider
│   │   │
│   │   ├── features/                   # 按功能特征组织
│   │   │   ├── terminal/
│   │   │   │   ├── engine/             # 纯 VT 引擎（无 React）
│   │   │   │   │   ├── buffer.ts
│   │   │   │   │   ├── char-width.ts
│   │   │   │   │   ├── events.ts       # applyEvents 适配
│   │   │   │   │   └── index.ts
│   │   │   │   ├── ui/                 # 终端 UI
│   │   │   │   │   ├── TerminalView.tsx
│   │   │   │   │   ├── TerminalTabs.tsx
│   │   │   │   │   └── hooks/
│   │   │   │   │       └── useTerminal.ts
│   │   │   │   └── index.ts            # feature 公共入口
│   │   │   │
│   │   │   ├── rich-content/
│   │   │   │   ├── pipeline/           # 纯检测/渲染逻辑
│   │   │   │   │   ├── detector.ts
│   │   │   │   │   ├── renderers/
│   │   │   │   │   │   ├── Latex.tsx
│   │   │   │   │   │   ├── Markdown.tsx
│   │   │   │   │   │   └── Code.tsx
│   │   │   │   │   └── index.ts
│   │   │   │   ├── ui/
│   │   │   │   │   ├── RichOutput.tsx
│   │   │   │   │   └── hooks/
│   │   │   │   │       └── useRichContent.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── ai/
│   │   │   │   ├── ui/
│   │   │   │   │   └── AIChatPanel.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── session/
│   │   │       ├── store/
│   │   │       │   └── session-slice.ts
│   │   │       └── ui/
│   │   │           └── hooks/
│   │   │               └── useSessionLifecycle.ts
│   │   │
│   │   ├── components/                 # 跨 feature 共享展示组件
│   │   │   ├── common/
│   │   │   │   └── ConfirmDialog.tsx
│   │   │   └── layout/
│   │   │       └── StatusBar.tsx
│   │   │
│   │   ├── stores/                     # 组合式全局状态
│   │   │   ├── root-store.ts
│   │   │   └── slices/
│   │   │       ├── session-slice.ts
│   │   │       ├── rich-content-slice.ts
│   │   │       ├── ai-slice.ts
│   │   │       ├── settings-slice.ts
│   │   │       └── ui-slice.ts
│   │   │
│   │   ├── services/                   # 跨 feature 服务
│   │   ├── i18n/
│   │   ├── styles/
│   │   └── test/                       # 渲染层测试辅助
│   │
│   └── test/                           # 共享测试桩与 fixture
│       ├── fake-tauri.ts
│       ├── setup.ts
│       └── fixtures/
│
├── e2e/                                # Playwright E2E
│   ├── bridge/
│   │   └── server.ts
│   ├── specs/
│   └── fixtures/
│
├── scripts/                            # 调试/辅助脚本
├── docs/                               # 文档
│   ├── index.md
│   ├── plan.md
│   ├── architecture.md                 # 架构设计文档
│   └── refactor/                       # 重构相关文档
│       └── structure-proposal.md       # 本文件
└── package.json / Cargo.toml / tsconfig.* / vite.config.* / vitest.config.*
```

---

## 5. 文件迁移映射表

### 5.1 Rust 后端

| 当前文件 | 目标路径 | 拆分/迁移说明 |
|---------|---------|--------------|
| `src-tauri/src/main.rs` | `src-tauri/src/main.rs` | 不变 |
| `src-tauri/src/lib.rs` | `src-tauri/src/lib.rs` | 调整 `mod` 声明 |
| `src-tauri/src/commands.rs` | `src-tauri/src/app/commands.rs` | 只保留命令薄层 |
| `src-tauri/src/pty.rs` | 拆分为 4 个文件 | 见下表 |
| `src-tauri/src/session.rs` | `src-tauri/src/core/models.rs` + `src-tauri/src/core/store.rs` | 模型与存储分离 |
| `src-tauri/src/settings.rs` | `src-tauri/src/core/settings.rs` | 迁移 |
| `src-tauri/src/terminal_parser.rs` | `src-tauri/src/pty/parser.rs` | 迁移 |

`pty.rs` 拆分细节：

| 当前 `pty.rs` 中的内容 | 目标文件 | 说明 |
|----------------------|---------|------|
| `PtyOutputPayload` / `PtyExitPayload` / `SessionCreatedPayload` / `SessionClosedPayload` / `TitleChangePayload` | `pty/events.rs` | 所有事件载荷集中 |
| `ManagedSession` | `pty/session.rs` | 内部会话结构 |
| `PtyManager` | `pty/manager.rs` | 对外管理接口 |
| 无（解析器已独立） | `pty/parser.rs` | 现有 `terminal_parser.rs` 迁移 |

### 5.2 前端

| 当前文件 | 目标路径 | 拆分/迁移说明 |
|---------|---------|--------------|
| `src/api/index.ts` | `src/api/core.ts` + `src/api/settings.ts` + `src/api/events.ts` + `src/api/index.ts` | 按域拆分，index 统一 re-export |
| `src/shared/types.ts` | `src/shared/types/session.ts` + `settings.ts` + `rich-content.ts` + `ai.ts` + `index.ts` | 按域拆分 |
| `src/shared/terminal-events.ts` | `src/shared/terminal/events.ts` | 迁移 |
| `src/shared/protocol.ts` | `src/shared/protocol/osc-ai.ts` | 迁移 |
| `src/renderer/App.tsx` | `src/renderer/app/Shell.tsx` + 精简 `src/renderer/App.tsx` | Shell 接管生命周期与布局 |
| `src/renderer/terminal/buffer.ts` | `src/renderer/features/terminal/engine/buffer.ts` | 迁移 |
| `src/renderer/terminal/useDomTerminal.ts` | `src/renderer/features/terminal/ui/hooks/useTerminal.ts` | 迁移并更名 |
| `src/renderer/terminal/TerminalView.tsx` | 合并到 `src/renderer/features/terminal/ui/TerminalView.tsx` | 消除命名冲突 |
| `src/renderer/components/terminal/TerminalView.tsx` | 删除，逻辑合并到 feature | 消除命名冲突 |
| `src/renderer/components/terminal/TerminalTabs.tsx` | `src/renderer/features/terminal/ui/TerminalTabs.tsx` | 迁移 |
| `src/renderer/services/content-detector.ts` | `src/renderer/features/rich-content/pipeline/detector.ts` | 迁移 |
| `src/renderer/hooks/useRichContent.ts` | `src/renderer/features/rich-content/ui/hooks/useRichContent.ts` | 迁移 |
| `src/renderer/components/output/RichOutput.tsx` | `src/renderer/features/rich-content/ui/RichOutput.tsx` | 迁移 |
| `src/renderer/components/output/LatexRenderer.tsx` | `src/renderer/features/rich-content/pipeline/renderers/Latex.tsx` | 迁移 |
| `src/renderer/components/output/MarkdownRenderer.tsx` | `src/renderer/features/rich-content/pipeline/renderers/Markdown.tsx` | 迁移 |
| `src/renderer/components/output/CodeBlock.tsx` | `src/renderer/features/rich-content/pipeline/renderers/Code.tsx` | 迁移 |
| `src/renderer/components/ai/AIChatPanel.tsx` | `src/renderer/features/ai/ui/AIChatPanel.tsx` | 迁移 |
| `src/renderer/components/common/ConfirmDialog.tsx` | `src/renderer/components/common/ConfirmDialog.tsx` | 不变（跨 feature） |
| `src/renderer/components/layout/StatusBar.tsx` | `src/renderer/components/layout/StatusBar.tsx` | 不变（跨 feature） |
| `src/renderer/stores/terminal-store.ts` | `src/renderer/stores/root-store.ts` + `src/renderer/stores/slices/*.ts` | 拆分为组合 slice |
| `src/renderer/i18n/*` | `src/renderer/i18n/*` | 不变，未来可加入 runtime 切换 |
| `src/renderer/styles/*` | `src/renderer/styles/*` | 不变 |
| `src/test/fake-tauri.ts` | `src/test/fake-tauri.ts` | 不变 |
| `src/test/setup.ts` | `src/test/setup.ts` | 不变 |

---

## 6. 模块边界与依赖规则

### 6.1 Rust 后端依赖规则

```
app/commands.rs  ──►  app/state.rs
                          │
                          ├──► core/models.rs
                          ├──► core/store.rs
                          ├──► core/settings.rs
                          ├──► pty/manager.rs
                          │         ├──► pty/session.rs
                          │         ├──► pty/parser.rs
                          │         └──► pty/events.rs
                          ├──► transport/ssh.rs  (Phase 4)
                          └──► ai/mod.rs          (Phase 3)
```

**规则**：

- `app/` 可以依赖所有下层模块。
- `core/` 不依赖 `pty` / `transport` / `ai`。
- `pty/` 依赖 `core::models` 和 `core::store`。
- `transport/` / `ai/` 只依赖 `core::models` 与 `app::state` 的抽象接口。

### 6.2 前端依赖规则

```
renderer/App.tsx
    │
    ▼
renderer/app/Shell.tsx
    │
    ├──► features/terminal/ui/*
    │         ├──► features/terminal/engine/*
    │         └──► stores/root-store
    │
    ├──► features/rich-content/ui/*
    │         ├──► features/rich-content/pipeline/*
    │         └──► stores/root-store
    │
    ├──► features/ai/ui/*
    │         └──► stores/root-store
    │
    ├──► components/common/*
    ├──► components/layout/*
    └──► api/*
              └──► shared/*
```

**规则**：

- `api/` 是前端与后端通信的唯一入口；UI 层不得直接引入 `@tauri-apps/api/core`。
- `shared/` 中不得引入 React、Tauri、DOM API。
- `features/*/engine/` 与 `features/*/pipeline/` 不得引入 React、Tauri、DOM API。
- `features/*/ui/` 只依赖本 feature 的 engine/pipeline、`stores/`、`components/`、`api/`。
- `components/` 只依赖 `shared/` 与 `i18n/`，不持有业务状态。

---

## 7. 分阶段迁移计划

本方案建议按以下顺序逐步实施，每个阶段结束后运行 `npm run test:all` 与 `cargo test` 验证。

### 阶段 1：Rust 后端分层（低风险）

1. 新建目录 `src-tauri/src/app/`、`src-tauri/src/core/`、`src-tauri/src/pty/`。
2. 将 `commands.rs` 移动到 `app/commands.rs`。
3. 将 `session.rs` 拆分为 `core/models.rs` 与 `core/store.rs`。
4. 将 `settings.rs` 移动到 `core/settings.rs`。
5. 将 `pty.rs` 拆分为 `pty/manager.rs`、`pty/session.rs`、`pty/events.rs`。
6. 将 `terminal_parser.rs` 移动到 `pty/parser.rs`。
7. 更新 `lib.rs` 中的 `mod` 声明与 `use` 路径。
8. 运行 `cargo test` 与 `cargo check`。

**预期影响**：仅 Rust 侧文件路径变化，前端无感知。

### 阶段 2：共享协议拆分（低风险）

1. 新建目录 `src/shared/types/`、`src/shared/protocol/`、`src/shared/terminal/`。
2. 将 `types.ts` 拆分为 `types/session.ts`、`types/settings.ts`、`types/rich-content.ts`、`types/ai.ts`，并新建 `types/index.ts` 统一 re-export。
3. 将 `protocol.ts` 移动到 `shared/protocol/osc-ai.ts`。
4. 将 `terminal-events.ts` 移动到 `shared/terminal/events.ts`。
5. 更新所有 import 路径（可借助 IDE 批量重构）。
6. 运行 `npm test`。

**预期影响**：TypeScript import 路径变更，无行为变化。

### 阶段 3：API 层拆分（低风险）

1. 将 `src/api/index.ts` 拆分为 `api/core.ts`、`api/settings.ts`、`api/events.ts`。
2. `api/index.ts` 保留为统一 re-export，保持下游 `import { createPTY } from '../api'` 继续工作。
3. 运行 `npm test`。

**预期影响**：外部调用方式不变，内部结构清晰。

### 阶段 4：终端 feature 重构（中风险）

1. 新建 `src/renderer/features/terminal/`。
2. 将 `renderer/terminal/buffer.ts` 移动到 `features/terminal/engine/buffer.ts`。
3. 从 `buffer.ts` 拆分 `charWidth()` 到 `features/terminal/engine/char-width.ts`。
4. 将 `renderer/terminal/useDomTerminal.ts` 移动到 `features/terminal/ui/hooks/useTerminal.ts`。
5. 合并 `renderer/terminal/TerminalView.tsx` 与 `renderer/components/terminal/TerminalView.tsx` 为 `features/terminal/ui/TerminalView.tsx`。
6. 将 `renderer/components/terminal/TerminalTabs.tsx` 移动到 `features/terminal/ui/TerminalTabs.tsx`。
7. 删除空的 `renderer/terminal/` 与 `renderer/components/terminal/` 目录。
8. 运行 `npm test`。

**预期影响**：消除命名冲突，终端相关代码集中。

### 阶段 5：富内容 feature 重构（中风险）

1. 新建 `src/renderer/features/rich-content/`。
2. 将 `renderer/services/content-detector.ts` 移动到 `features/rich-content/pipeline/detector.ts`。
3. 将 `renderer/hooks/useRichContent.ts` 移动到 `features/rich-content/ui/hooks/useRichContent.ts`。
4. 将 `renderer/components/output/RichOutput.tsx` 移动到 `features/rich-content/ui/RichOutput.tsx`。
5. 将 `renderer/components/output/LatexRenderer.tsx`、`MarkdownRenderer.tsx`、`CodeBlock.tsx` 移动到 `features/rich-content/pipeline/renderers/`。
6. 删除空的 `renderer/components/output/` 目录。
7. 运行 `npm test`。

**预期影响**：检测逻辑与渲染逻辑归属清晰。

### 阶段 6：AI feature 与全局状态拆分（中高风险）

1. 新建 `src/renderer/features/ai/ui/AIChatPanel.tsx`，迁移现有组件。
2. 新建 `src/renderer/features/session/`。
3. 将 `renderer/stores/terminal-store.ts` 拆分为：
   - `stores/root-store.ts`
   - `stores/slices/session-slice.ts`
   - `stores/slices/rich-content-slice.ts`
   - `stores/slices/ai-slice.ts`
   - `stores/slices/settings-slice.ts`
   - `stores/slices/ui-slice.ts`
4. 创建 `stores/root-store.ts` 使用 `zustand` 组合 slice，并导出 `useRootStore`。
5. 为兼容旧代码，可保留 `useTerminalStore` 作为 `useRootStore` 的别名一段时间，逐步替换。
6. 将 `App.tsx` 中的生命周期逻辑抽离到 `app/Shell.tsx`。
7. 运行 `npm test`。

**预期影响**：状态管理结构优化，为未来 AI / SSH 提供独立 slice。

### 阶段 7：测试文件整理（低风险）

1. 将 `src/renderer/terminal/*.test.ts` 按对应源码位置移动到 `features/terminal/engine/__tests__/` 或 `features/terminal/ui/__tests__/`。
2. 将 `src/renderer/terminal/__fixtures__/` 移动到 `src/test/fixtures/terminal/`。
3. 更新 Vitest 配置中的路径别名与测试匹配规则。
4. 运行 `npm test`。

### 阶段 8：E2E 与文档收尾

1. 确认 `e2e/bridge/server.ts` 路径是否需要调整（建议保留当前位置，因为 E2E 是独立入口）。
2. 更新 `README.md`、`docs/index.md` 中的项目结构描述。
3. 更新 `docs/plan.md` 中过时的目录引用。
4. 运行 `npm run test:all`。

---

## 8. 验证清单

每阶段完成后执行：

- [ ] `cargo check` 无错误、无警告。
- [ ] `cargo test` 通过。
- [ ] `npm run test`（Vitest）通过。
- [ ] `npm run build:renderer` 成功。
- [ ] `npm run test:e2e` 通过（或至少 `npm run dev` 可启动并正常输入命令）。
- [ ] 没有循环依赖（可借助 `madge` 或 `dpdm` 检查）。
- [ ] 所有 import 路径正确（TypeScript 编译无错误）。

---

## 9. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 路径迁移导致 import 遗漏 | 中 | 编译失败 | 每阶段只迁移少量文件；使用 IDE 批量重构；TypeScript 编译兜底。 |
| Rust 模块拆分引入命名冲突 | 低 | 编译失败 | 使用 `pub use` 保持旧名称可用；单元测试覆盖。 |
| Store 拆分导致组件重渲染 | 中 | 性能退化 | 保留 Zustand selector 模式；使用 slice 组合而非多个 store。 |
| 文件移动导致 git 历史丢失 | 低 | 可追溯性下降 | 使用 `git mv` 移动文件，保留历史。 |
| 测试路径变更导致 CI 失败 | 低 | CI 阻塞 | 同步更新 `vitest.config.ts` 与测试 import。 |
| 一次性重构过大 | 高 | 难以 review | 严格按阶段执行，每个阶段一个独立 PR。 |

---

## 10. 不推荐的方案

以下做法虽然常见于其他项目，但**不适合当前 AI Terminal**：

1. **按文件类型组织前端目录**（如 `components/`、`hooks/`、`services/` 平铺）：当前项目已有此问题，会导致 feature 之间边界模糊。
2. **引入 Redux / RTK**：Zustand 已满足需求，Redux 会增加样板代码。
3. **将 Rust 解析器移回前端**：会破坏已验证的 resize 竞争修复与批量解析优势。
4. **过早抽象后端 trait 接口**：当前只有 PTY 一种会话类型，抽象接口可等到 Phase 4 SSH 实现时再进行。

---

## 11. 预期收益

| 维度 | 重构前 | 重构后 |
|------|--------|--------|
| 后端模块粒度 | 6 个平铺文件，职责混杂 | 分层清晰，PTY / core / app / transport / ai 独立 |
| 终端代码位置 | `terminal/` 与 `components/terminal/` 命名冲突 | 统一在 `features/terminal/` |
| 富内容代码位置 | 分散在 `services/`、`hooks/`、`components/output/` | 统一在 `features/rich-content/` |
| 全局状态 | 单一 store 混合所有领域 | 组合 slice，按 feature 隔离 |
| 新增一个 feature | 需要判断放哪个目录 | 直接新建 `features/<feature>/` |
| 单元测试入口 | 与源码混放 | engine/pipeline 可独立测试 |
| 新成员上手 | 需要理解命名冲突与隐式约定 | 按 feature 自解释 |

---

*方案结束*
