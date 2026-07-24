# AI Terminal — 项目结构重构方案

> **范围说明**：本方案只涉及目录与模块的重新组织，**不修改任何业务代码逻辑**。所有现有文件保持行为不变，仅改变存放位置与依赖关系，使项目在进入 Phase 3/4/5 之前具备清晰的边界和可维护性。

---

## 1. 现状诊断

### 1.1 当前目录树（核心部分）

```
src-tauri/src/
├── main.rs
├── lib.rs
├── commands.rs          # 8 个命令 + AppState 挤在一起
├── pty.rs               # PTY 管理器（350 行）+ payload 类型
├── session.rs           # 会话类型 + SessionStore
├── settings.rs          # 设置类型 + SettingsManager
└── terminal_parser.rs   # TerminalEvent + 解析器

src/
├── api/
│   └── index.ts         # 所有 invoke/listen 堆在一个文件
├── renderer/
│   ├── terminal/        # 终端引擎 + React 视图 + 大量测试混在一起
│   │   ├── buffer.ts
│   │   ├── useDomTerminal.ts
│   │   ├── TerminalView.tsx
│   │   └── *.test.ts(x)
│   ├── components/
│   │   ├── terminal/    # 只有 Tabs 和一个 15 行的 View 包装器
│   │   ├── output/      # Rich Output 渲染组件
│   │   ├── ai/
│   │   ├── layout/
│   │   └── common/
│   ├── hooks/
│   │   └── useRichContent.ts
│   ├── services/
│   │   └── content-detector.ts
│   ├── stores/
│   ├── i18n/
│   └── styles/
├── shared/
│   ├── types.ts         # 会话/富内容/AI/SSH/设置全部堆叠
│   ├── terminal-events.ts
│   └── protocol.ts      # OSC AI 协议，和 output 关系更近
└── test/
```

### 1.2 主要痛点

| 痛点 | 具体表现 | 影响 |
|------|---------|------|
| **抽象层混合** | `src/renderer/terminal/` 同时包含纯 `TerminalBuffer`、`useDomTerminal` Hook、`DomTerminalView` 组件、以及 12 个测试文件 | 终端引擎与 React 渲染耦合，难以单独测试/复用 |
| **命名冲突/歧义** | `src/renderer/terminal/TerminalView.tsx` 与 `src/renderer/components/terminal/TerminalView.tsx` 并存，后者只是前者的 15 行包装 | 新人很难找到真正的渲染实现 |
| **API 层单文件膨胀** | `src/api/index.ts` 已包含 PTY、会话、设置、AI、菜单事件 | Phase 3 AI、Phase 4 SSH 加入后会超过 300 行 |
| **共享类型大杂烩** | `src/shared/types.ts` 已包含 5 个领域类型 | 任一领域的修改都需要改动全量类型文件 |
| **后端模块扁平** | Rust `src-tauri/src/` 所有模块平铺 | 增加 SSH、AI、持久化后会难以定位 |
| **富内容功能分散** | 检测、协议、Hook、渲染组件分属 4 个不同目录 | 无法一眼看清 Phase 2 的完整链路 |
| **测试文件混杂** | 测试与源码并列，且无统一命名/放置规范 | 目录噪音大，影响核心文件查找 |
| **常量重复** | `LINE_HEIGHT = 16` 同时出现在 `TerminalView.tsx` 和 `useDomTerminal.ts`；`getCharWidth()` 逻辑散落在 hook | 主题/字体变更时需要多处同步 |

---

## 2. 重构目标

1. **按领域（feature）组织代码**：一个功能的所有代码（组件、Hook、服务、类型）尽量靠近。
2. **分离框架无关核心逻辑**：`TerminalBuffer`、字符宽度表、内容检测引擎等不依赖 React，应独立出来。
3. **清晰分层**：`core` → `api` / `shared` → `renderer features` → `shared-ui`。
4. **可扩展**：Phase 3 AI、Phase 4 SSH、Phase 5 打包各自有明确的目录落点，不污染现有模块。
5. **零行为变更**：只移动文件、更新 import、拆分单文件，不改动算法与 UI 行为。

---

## 3. 设计原则

| 原则 | 说明 |
|------|------|
| **Feature-first** | 代码先按功能领域（terminal、rich-content、ai、ssh、settings）分组，再按技术角色（components/hooks/services）分组。 |
| **Single source of truth** | 共享类型、协议、常量只存在一份；前后端镜像类型通过目录邻近暗示同步关系。 |
| **Engine vs Shell** | `core` 是引擎（可单元测试），`renderer` 是 UI Shell（依赖 React + DOM）。 |
| **Barrel exports** | 每个 feature 目录提供 `index.ts`，外部只通过 barrel 引用，降低重构时的 import 扩散。 |
| **Test co-location** | 单元测试与源码同目录，后缀 `.test.ts`；集成测试与 fixtures 放 `src/test/integration/`。 |
| **Backend layering** | Rust 端区分 `commands`（Tauri 入口）、`core`（领域逻辑）、`features`（未来扩展）。 |

---

## 4. 目标目录结构

### 4.1 Rust 后端

```
src-tauri/src/
├── main.rs                              # Tauri 入口（不变）
├── lib.rs                               # Builder + 命令注册（不变）
├── commands/                            # IPC 命令处理器
│   ├── mod.rs                           # AppState + 命令聚合
│   ├── pty.rs                           # create/write/resize/close/list_pty
│   ├── session.rs                       # （预留）会话级命令
│   └── settings.rs                      # load/save settings
├── core/                                # 框架无关领域逻辑
│   ├── pty/
│   │   ├── mod.rs
│   │   ├── manager.rs                   # PtyManager（原 pty.rs 主体）
│   │   ├── types.rs                     # ManagedSession、PtyOutputPayload 等
│   │   └── events.rs                    # PtyExitPayload、TitleChangePayload 等
│   ├── terminal/
│   │   ├── mod.rs
│   │   ├── parser.rs                    # TerminalParser（原 terminal_parser.rs）
│   │   └── events.rs                    # TerminalEvent 枚举
│   ├── session/
│   │   ├── mod.rs
│   │   ├── store.rs                     # SessionStore
│   │   └── types.rs                     # SessionInfo、SessionType、SessionOptions
│   └── settings/
│       ├── mod.rs
│       ├── manager.rs                   # SettingsManager
│       └── types.rs                     # AppSettings 及子设置
└── features/                            # 未来特性模块（Phase 3/4 落地）
    ├── ai/                              # AI 桥接、Claude API 调用
    └── ssh/                             # SSH 客户端、russh 封装
```

> **说明**：`commands/mod.rs` 仍然通过 `tauri::generate_handler!` 聚合命令；`core` 中的模块不直接依赖 Tauri 的 `Emitter`，其事件 payload 类型在 `core/*/events.rs` 中定义，由 `PtyManager` 在生成时传入 `AppHandle`。

### 4.2 前端

```
src/
├── core/                                # 框架无关业务逻辑
│   ├── terminal/
│   │   ├── buffer.ts                    # TerminalBuffer（不变）
│   │   ├── width.ts                     # charWidth 查表函数
│   │   ├── constants.ts                 # 默认行列、滚动条上限、LINE_HEIGHT 等
│   │   └── index.ts
│   └── rich-content/
│       ├── detector.ts                  # 内容检测引擎（原 services/content-detector.ts）
│       ├── patterns.ts                  # 所有正则模式（未来可抽给 Web Worker）
│       ├── protocol.ts                  # OSC AI 协议（原 shared/protocol.ts）
│       └── index.ts
├── api/                                 # Tauri IPC 桥接，按领域拆分
│   ├── index.ts                         # barrel export
│   ├── pty.ts                           # PTY 命令 + pty:output/pty:exit/title-change
│   ├── session.ts                       # session:created/closed
│   ├── settings.ts                      # load/save settings
│   ├── ai.ts                            # ai:response（Phase 3）
│   └── menu.ts                          # app:menu-action
├── shared/                              # 前后端共享契约
│   ├── types/
│   │   ├── index.ts                     # barrel export
│   │   ├── session.ts                   # SessionInfo / SessionOptions / SSHConnectOptions
│   │   ├── settings.ts                  # AppSettings / DEFAULT_SETTINGS
│   │   ├── rich-content.ts              # DetectedBlock / RichOutputItem
│   │   ├── ai.ts                        # Message（Phase 3）
│   │   └── ssh.ts                       # SavedSSHConnection（Phase 4）
│   ├── terminal-events.ts               # 镜像 Rust TerminalEvent
│   └── constants.ts                     # 前后端通用常量（如 max sessions = 20）
└── renderer/                            # React 应用
    ├── app/
    │   ├── App.tsx                      # 根布局（不变）
    │   ├── main.tsx                     # React 入口（不变）
    │   └── global.css                   # 全局样式（从 styles/ 移入）
    ├── features/                        # 按领域组织的 UI 功能
    │   ├── terminal/
    │   │   ├── index.ts
    │   │   ├── components/
    │   │   │   ├── TerminalView.tsx     # 15 行包装组件（原 components/terminal/TerminalView.tsx）
    │   │   │   ├── DomTerminalView.tsx  # 虚拟滚动渲染（原 terminal/TerminalView.tsx）
    │   │   │   └── TerminalTabs.tsx     # 标签栏
    │   │   ├── hooks/
    │   │   │   └── useDomTerminal.ts    # 输入/渲染生命周期
    │   │   └── __tests__/
    │   │       └── useDomTerminal.test.tsx
    │   ├── rich-content/
    │   │   ├── index.ts
    │   │   ├── components/
    │   │   │   ├── RichOutput.tsx
    │   │   │   ├── LatexRenderer.tsx
    │   │   │   ├── MarkdownRenderer.tsx
    │   │   │   └── CodeBlock.tsx
    │   │   ├── hooks/
    │   │   │   └── useRichContent.ts
    │   │   └── __tests__/
    │   │       └── useRichContent.test.tsx
    │   ├── ai/
    │   │   └── components/
    │   │       └── AIChatPanel.tsx
    │   └── layout/
    │       └── components/
    │           └── StatusBar.tsx
    ├── shared-ui/                       # 跨 feature 的纯 UI 组件
    │   └── ConfirmDialog.tsx
    ├── stores/
    │   └── terminal-store.ts            # Zustand 全局状态
    ├── i18n/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── en.ts
    │   └── zh.ts
    └── test/                            # 渲染器测试工具
        └── setup.ts
```

### 4.3 测试与 E2E

```
src/
├── core/terminal/__tests__/             # 引擎单元测试
│   ├── buffer.test.ts                   # 原 terminal/buffer.test.ts
│   ├── resize.test.ts
│   └── ...
├── test/
│   ├── setup.ts                         # Vitest 全局 setup
│   ├── fake-tauri.ts                    # Tauri 测试桩
│   └── fixtures/                        # 二进制/文本 fixture
│       ├── bs-cjk.fixture.bin
│       └── claude-ui.fixture.bin

e2e/
├── bridge/
│   └── server.ts                        # node-pty WebSocket 桥
├── specs/
└── fixtures/
```

---

## 5. 关键改动详解

### 5.1 终端引擎从 React 中剥离 → `src/core/terminal/`

**原因**：`TerminalBuffer` 是一个完整的 VT 屏幕模型，不依赖 React、DOM 或 Tauri。当前它与 `useDomTerminal`、`DomTerminalView` 放在同一目录，容易被误认为是 React 专属。

**移动内容**：
- `src/renderer/terminal/buffer.ts` → `src/core/terminal/buffer.ts`
- 将 `buffer.ts` 中的 `charWidth` 抽出 → `src/core/terminal/width.ts`
- 将 `TerminalBuffer` 默认配置抽出 → `src/core/terminal/constants.ts`

**依赖调整**：
- `src/core/terminal/buffer.ts` 只依赖 `src/shared/terminal-events.ts`。
- `src/renderer/features/terminal/hooks/useDomTerminal.ts` 从 `core/terminal` 导入 `TerminalBuffer`、`getCharWidth`、`TERMINAL_CONSTANTS`。

### 5.2 消除 `TerminalView.tsx` 命名歧义

**原因**：目前两个 `TerminalView.tsx` 分别代表“包装组件”和“实际渲染组件”。

**新命名**：
- `src/renderer/features/terminal/components/DomTerminalView.tsx`：虚拟滚动 + `L` 行渲染。
- `src/renderer/features/terminal/components/TerminalView.tsx`：调用 `useDomTerminal` 并传给 `DomTerminalView` 的薄包装。

### 5.3 `src/api/index.ts` 按领域拆分

**当前问题**：所有 IPC 调用在一个文件，import 路径和命令名混杂。

**拆分后**：
- `api/pty.ts`：`createPTY`、`writeToPTY`、`resizePTY`、`closePTY`、`onPTYOutput`、`onPTYExit`、`onPTYTitleChange`
- `api/session.ts`：`onSessionCreated`、`onSessionClosed`
- `api/settings.ts`：`loadSettings`、`saveSettings`
- `api/ai.ts`：`onAIResponse`
- `api/menu.ts`：`onMenuAction`
- `api/index.ts`：统一 re-export，旧 import 路径保持可用

### 5.4 `src/shared/types.ts` 按领域拆分

**原因**：单一文件包含多个未来会独立演进的领域，合并提交时冲突率高。

**拆分后**：
- `shared/types/session.ts`：会话相关
- `shared/types/settings.ts`：应用设置
- `shared/types/rich-content.ts`：富内容
- `shared/types/ai.ts`：AI 消息
- `shared/types/ssh.ts`：SSH 连接
- `shared/types/index.ts`：barrel export

**与 Rust 的同步**：Rust 端 `core/session/types.rs`、`core/settings/types.rs` 与前端 `shared/types/*` 保持镜像关系，每次修改需同时更新两边并在 PR 描述中标注。

### 5.5 Rust 后端分层

**当前问题**：`commands.rs` 既含 `AppState` 又含 8 个命令；`pty.rs` 同时是领域模型 + Tauri 事件 payload + 管理器。

**分层后**：
- `commands/` 只负责：从 Tauri state 解包、调用 core、返回结果。
- `core/pty/manager.rs` 只负责：进程生命周期、读写、resize。
- `core/pty/types.rs` / `events.rs`：payload 类型与事件定义。
- `core/terminal/parser.rs` / `events.rs`：ANSI 解析与事件枚举。

这样 Phase 4 加入 SSH 时，只需新增 `core/ssh/` 和 `commands/ssh.rs`，不影响 PTY 模块。

### 5.6 富内容功能内聚 → `src/renderer/features/rich-content/`

**当前链路**：
```
shared/protocol.ts
  ↓
services/content-detector.ts
  ↓
hooks/useRichContent.ts
  ↓
components/output/*.tsx
```

**重构后链路**：
```
core/rich-content/protocol.ts
  ↓
core/rich-content/detector.ts
  ↓
renderer/features/rich-content/hooks/useRichContent.ts
  ↓
renderer/features/rich-content/components/*.tsx
```

所有代码在一个 feature 目录内，新人能快速理解“检测 → 协议 → Hook → 渲染”完整流程。

### 5.7 常量集中

**新增** `src/shared/constants.ts`：
```ts
export const MAX_SESSIONS = 20;
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const PTY_OUTPUT_CHUNK_SIZE = 128;
export const MAX_SCROLLBACK = 5000;
```

**新增** `src/core/terminal/constants.ts`：
```ts
export const LINE_HEIGHT = 16;
export const DEFAULT_FONT_SIZE = 14;
export const OVERSCAN = 15;
export const DEFAULT_FOREGROUND = '#f0f0f0';
export const DEFAULT_BACKGROUND = '#000000';
```

前端 `DomTerminalView` 与 `useDomTerminal` 统一从 `core/terminal/constants.ts` 导入 `LINE_HEIGHT`，消除重复定义。

---

## 6. 迁移路径（按优先级排序）

### Phase A：低风险整理（可一次性完成）

1. **创建新目录骨架**：`src/core/`、`src/renderer/features/`、`src/api/*`、`src/shared/types/`、`src-tauri/src/commands/`、`src-tauri/src/core/`。
2. **拆分 `src/shared/types.ts`**：按领域拆分为 `shared/types/*.ts`，`shared/types/index.ts` 做 barrel export；同步更新所有 import。
3. **拆分 `src/api/index.ts`**：创建 `api/pty.ts`、`api/session.ts`、`api/settings.ts`、`api/ai.ts`、`api/menu.ts`，`api/index.ts` 保持 re-export。
4. **移动 `src/shared/protocol.ts`** → `src/core/rich-content/protocol.ts`；更新 import。
5. **移动 `src/renderer/services/content-detector.ts`** → `src/core/rich-content/detector.ts`。
6. **创建 `src/core/rich-content/patterns.ts`**：将 `content-detector.ts` 中的正则常量迁移。
7. **创建 `src/shared/constants.ts`** 与 `src/core/terminal/constants.ts`。

### Phase B：终端引擎剥离

8. **移动终端引擎**：
   - `src/renderer/terminal/buffer.ts` → `src/core/terminal/buffer.ts`
   - 抽出 `width.ts`、`constants.ts`
9. **移动测试**：
   - `src/renderer/terminal/buffer.test.ts` → `src/core/terminal/__tests__/buffer.test.ts`
   - 其他终端引擎测试一并迁移
10. **重命名视图组件**：
    - `src/renderer/terminal/TerminalView.tsx` → `src/renderer/features/terminal/components/DomTerminalView.tsx`
    - `src/renderer/components/terminal/TerminalView.tsx` → `src/renderer/features/terminal/components/TerminalView.tsx`
11. **移动 Hook 与 Tabs**：
    - `src/renderer/terminal/useDomTerminal.ts` → `src/renderer/features/terminal/hooks/useDomTerminal.ts`
    - `src/renderer/components/terminal/TerminalTabs.tsx` → `src/renderer/features/terminal/components/TerminalTabs.tsx`

### Phase C：Rust 后端分层

12. **拆分 `commands.rs`**：
    - `commands/mod.rs` 保留 `AppState` 与命令聚合
    - `commands/pty.rs` 保留 PTY 相关命令
    - `commands/settings.rs` 保留设置命令
13. **拆分 `pty.rs`**：
    - `core/pty/manager.rs`：PtyManager 实现
    - `core/pty/types.rs`：ManagedSession、PtyOutputPayload 等
    - `core/pty/events.rs`：PtyExitPayload、TitleChangePayload 等
14. **拆分 `session.rs`**：
    - `core/session/types.rs`：SessionInfo、SessionType、SessionOptions
    - `core/session/store.rs`：SessionStore
15. **拆分 `settings.rs`**：
    - `core/settings/types.rs`：AppSettings 及子类型
    - `core/settings/manager.rs`：SettingsManager
16. **拆分 `terminal_parser.rs`**：
    - `core/terminal/parser.rs`：TerminalParser
    - `core/terminal/events.rs`：TerminalEvent

### Phase D：收尾与清理

17. **移动 `global.css`**：`src/renderer/styles/global.css` → `src/renderer/app/global.css`（样式跟随应用入口）。
18. **移动 `ConfirmDialog`**：`src/renderer/components/common/ConfirmDialog.tsx` → `src/renderer/shared-ui/ConfirmDialog.tsx`。
19. **移动布局组件**：`src/renderer/components/layout/StatusBar.tsx` → `src/renderer/features/layout/components/StatusBar.tsx`。
20. **移动 AI 面板**：`src/renderer/components/ai/AIChatPanel.tsx` → `src/renderer/features/ai/components/AIChatPanel.tsx`。
21. **删除空目录**：`src/renderer/components/`、`src/renderer/services/`、`src/renderer/styles/`、`src/renderer/terminal/`。
22. **更新 `tsconfig.json` / `vite.config.ts` 别名**：保留 `@shared`、`@renderer`，新增 `@core`、`@api`。
23. **运行完整测试矩阵**：`npm run test:all` + `cargo test`。

---

## 7. 检查清单

- [ ] 所有 import 路径已更新，无 `./../../..` 超过 3 层的相对路径（使用 alias）。
- [ ] `npm run test` 通过。
- [ ] `npm run test:rust` 通过。
- [ ] `npm run test:e2e` 通过。
- [ ] `npm run build` 通过。
- [ ] `npm run dev` 可正常启动并创建标签页。
- [ ] 终端 resize、CJK、emoji、alt-screen（vim/htop）行为与重构前一致。
- [ ] Rich Output 检测与渲染行为与重构前一致。
- [ ] 新目录下无孤立空文件/空目录。
- [ ] `docs/architecture/ARCHITECTURE.md` 已同步更新目录引用。

---

## 8. 风险与回滚

| 风险 | 缓解措施 |
|------|---------|
| 移动文件导致 git history 丢失 | 使用 `git mv` 逐文件移动，保留 blame；或在一次 commit 中完成全部重命名。 |
| import 路径遗漏导致构建失败 | 使用 `tsc --noEmit` 和 `vite build` 做全量类型检查；E2E 做运行时覆盖。 |
| Rust 模块路径变更导致编译失败 | 按模块逐个拆分，每次 `cargo check`；优先完成 `core` 再改 `commands`。 |
| 测试文件路径变更导致 coverage 工具失效 | 同步更新 `vitest.config.ts` 的 `coverage.include`。 |
| 重构范围过大难以 review | 按 Phase A/B/C/D 分 4 个 PR 提交，每个 PR 只完成一个阶段。 |

---

## 9. 预期收益

1. **新功能落地成本降低**：Phase 3 AI 只需在 `src/renderer/features/ai/` 和 `src-tauri/src/features/ai/` 中新增文件，不触碰终端核心。
2. **终端引擎可独立演进**：`src/core/terminal/` 可作为独立包抽出或用于其他渲染目标（如 WebGL、Canvas）。
3. **代码定位时间缩短**：通过 barrel export 和 feature 目录，平均定位文件时间从“在多个目录间跳转”变为“直接进入对应 feature”。
4. **测试边界清晰**：引擎测试在 `core`，UI 测试在 `renderer/features`，E2E 在 `e2e/`，互不干扰。
5. **类型契约可维护**：前后端镜像类型文件同名同目录结构，降低同步遗漏风险。
