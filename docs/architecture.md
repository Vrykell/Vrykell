# Vrykell 架构

> 当前 v2 chat-first 实现（分支 `dev`）的实际架构。终端主体把终端输出抽象为**命令块（Block）**，用「Rust StreamScanner 同步扫描 + SessionController 三场景状态机 + 每 block 单离屏 xterm」组织。
>
> 本文记录当前实现的实际架构。（最近更新：2026-08-31，扫描已下沉 Rust；分屏、Agent、主题见 §16-§18。）

---

## 目录

1. [概览与产品形态](#1-概览与产品形态)
2. [技术栈](#2-技术栈)
3. [顶层布局](#3-顶层布局)
4. [端到端分层](#4-端到端分层)
5. [同步派发与三场景状态机：PTY 输出到屏幕](#5-同步派发与三场景状态机pty-输出到屏幕)
6. [三场景切换](#6-三场景切换)
7. [Block 生命周期状态机](#7-block-生命周期状态机)
8. [滚动：普通 DOM + follow-bottom](#8-滚动普通-dom--follow-bottom)
9. [输入框可见性状态机](#9-输入框可见性状态机)
10. [渲染管线](#10-渲染管线)
11. [输出提取与颜色](#11-输出提取与颜色)
12. [状态管理](#12-状态管理)
13. [后端（Rust PTY 层）](#13-后端rust-pty-层)
14. [完整数据流时间线](#14-完整数据流时间线)
15. [关键文件索引](#15-关键文件索引)
16. [分屏与窗口布局](#16-分屏与窗口布局)
17. [Agent / AI 对话（代码代理）](#17-agent--ai-对话代码代理)
18. [主题系统](#18-主题系统)

---

## 1. 概览与产品形态

- **chat-first**：终端是主表面，输入栏在底部；AI 对话（Anthropic BYOK 直连）以内联面板显示在终端上方，无独立 Chat 侧栏。
- **Block 架构**：每个命令是一个 Block。已完成块由 React 渲染为真实 DOM（带颜色 HTML），只有**活跃命令**用隐藏的 xterm.js 处理。
- **禁止自研终端模拟器**：VT/ANSI 解析、grid 存储全部委托给 xterm.js，我们只做 block 边界与生命周期。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 |
| 后端 | Rust（`portable-pty` 做 PTY 会话、`rusqlite` 做持久化） |
| 前端 | React 19 + TypeScript + Vite |
| 终端 | `@xterm/xterm`（主终端 + 每块离屏 xterm） |
| 状态 | zustand |
| AI | `@anthropic-ai/sdk`（BYOK）+ react-markdown + KaTeX |
| 测试 | vitest（单测）、Playwright（e2e） |

## 3. 顶层布局

`src/App.tsx`（100vh flex column）：

```
App
├── TopDock            (28px 全宽顶栏，左右功能区 + 可拖拽按钮)
├── flex row
│   ├── SidePanel (left)   — 由 Dock 按钮控制
│   ├── TerminalView       — 终端主区域（核心）
│   └── SidePanel (right)  — 由 Dock 按钮控制
├── StatusBar
├── CommandPalette (overlay)
├── ToastContainer (overlay)
└── ApiKeyField     (fixed 右下角，不在文档流)
```

`TerminalView`（`src/terminal/TerminalView.tsx`）是终端主表面，内部由 SessionController 的**场景状态**驱动（见 §6）。

## 4. 端到端分层

```
┌──────────────────────────────────────────────────────────┐
│  Rust 后端 (src-tauri/src)                                │
│  pty.rs               portable-pty 会话生命周期           │
│  shell_integration.rs zsh ZDOTDIR / bash --rcfile 注入     │
│                        OSC 133 (block 边界) + OSC 7 (cwd) │
│  history.rs/search.rs rusqlite 持久化 / 全文搜索           │
└───────────────────────┬──────────────────────────────────┘
                        │ Tauri IPC (invoke + event emit/listen)
┌───────────────────────▼──────────────────────────────────┐
│  lib/*.ts (IPC 封装)                                      │
│  pty.ts  pty_spawn/write/resize/close + pty-output/exit   │
│  ai.ts   anthropicStream (BYOK 流式)                      │
│  sessionManager.ts  会话/块持久化编排                      │
└───────────────────────┬──────────────────────────────────┘
                        │ zustand stores + React
┌───────────────────────▼──────────────────────────────────┐
│  terminal/pipeline/*.ts（事件消费 + 三场景状态机，见 §5）  │
│  events.ts（ScanEvent 镜像）→ SessionController            │
│  → 主 xterm / 单离屏 xterm（executing block）             │
└───────────────────────┬──────────────────────────────────┘
                        │ React 组件
┌───────────────────────▼──────────────────────────────────┐
│  TerminalView → TerminalBlockList → BlockItem/RunningItem │
│  TerminalPanel (实时 xterm)  /  InputEditor (输入栏)       │
└──────────────────────────────────────────────────────────┘
```

## 5. 同步派发与三场景状态机：PTY 输出到屏幕

Rust PTY 输出的每个 chunk 不再先写主 xterm 再等 parser 异步回调，而是先在 **Rust 端同步扫描**，按字节顺序产生事件后经 Tauri IPC 一次性交付，前端 SessionController 同步消费。

### 5.1 Rust StreamScanner（`src-tauri/src/terminal/scan.rs`）

- 输入：`push(chunk)` 返回有序 `ScanEvent` 流，顺序与字节顺序一致；经 `pty.rs` 汇入 Tauri event `pty-output`。
- 事件形状（serde tag=kind, camelCase）：`{kind:'data', text}` / `{kind:'osc', code, payload, raw}` / `{kind:'altEnter'|'altExit', raw}`；前端镜像类型在 `src/terminal/pipeline/events.ts`（`DispatchEvent`）。
- OSC 解析：识别 `133;A` / `133;C` / `133;D;ec` / `133;E;b64` / `133;G;b64`、`7;path`、`0/2;title`；OSC 从 data 段剥离，但保留 `raw` 用于 classic / altScreen 场景下透传给主 xterm（保 OSC 8 超链接、OSC 52 剪贴板等）。
- alt-screen 观测：检测 `\x1b[?1049/1047/47[hl]`，只发事件，序列本身保留在 data 段。
- 跨 chunk 边界：不完整 ESC / OSC 序列存入 `pending`，与下一 chunk 拼接后再扫。
- 输入是 StreamDecoder 解码后的 UTF-8 字符串；扫描对象全是 ASCII 单字节控制字符，按字节索引安全。

### 5.2 SessionController（`src/terminal/pipeline/sessionController.ts`）

每 tab 一个实例（分屏时每 pane 一个），同步消费 `DispatchEvent`：

- **三场景状态机**
  - `classic`：默认，未收到 `133;A` 时主 xterm 全屏工作。
  - `blockList`：收到首个 `133;A` 后进入，主 xterm 隐藏，渲染 React block 列表。
  - `altScreen`：数据段检测到 alt-screen 进入序列后叠加在以上两场景之上，主 xterm 接管。

- **Block 生命周期**
  - `133;A` → 创建新 block（status=`pending`），上一 block 无 `D` 则标记 `interrupted`。
  - `133;E;<b64>` → 记录命令文本。
  - `133;G;<b64>` → 记录 git 分支。
  - `133;C` → block 转 `executing`，创建唯一离屏 xterm（`outputTerm`）。
  - `133;D;ec` → 提取 `outputHtml` / `outputText`，dispose `outputTerm`，status=`done`。
  - 普通输出段按当前场景路由：pending → `earlyBuf`；executing → `outputTerm`；classic / altScreen → 主 xterm。

- **Store 同步策略**
  - block 新建/完成/状态切换 → 即时推 `useBlockStore.setBlocks`。
  - executing block 输出 → ~250ms 节流同步，仅在有新输出时。
  - 场景切换 → 即时写 `useTerminalStore.scenes`。

### 5.3 xterm.js 实例职责

- **主 xterm**：`classic` 与 `altScreen` 场景下可见并接收键盘输入；`blockList` 场景下隐藏。
- **单离屏 xterm**：每个 `executing` block 一个 `outputTerm`，完成后立即 dispose，只保留 `outputHtml` 快照。

`terminalSnapshot.ts` 的 `createOffscreenTerm(cols)` 与 `extractSnapshotFromBuffer` 负责创建与快照提取。xterm.js 正确处理光标移动、清屏、`\r` 覆盖、256 色等全部 ANSI——这是「禁止自研终端模拟器」的落点。

## 6. 三场景切换

`TerminalView.tsx` 读取 `useTerminalStore.scenes`（由 SessionController 写入）决定当前渲染：

| 场景 | 条件 | 渲染 |
|------|------|------|
| `loading` | 当前 tab 尚无 PTY session | `LoadingState`（"正在启动 Shell…" 转圈） |
| `classic` | 未收到 `133;A`，或 shell integration 未生效 | 主 xterm 全屏（`TerminalPanel`） |
| `blockList` | 收到首个 `133;A` 后 | `TerminalBlockList` + 底部 `InputEditor` |
| `altScreen` | 数据段检测到 alt-screen 进入序列 | 主 xterm 覆盖全屏（zIndex 100）+ `TuiBanner` |

`altScreen` 叠加在 `classic` 或 `blockList` 之上；退出 alt-screen 后由 SessionController 恢复前一个场景。输入框可见性由 `inputVisibility.ts` 消费当前 scene 与是否有长运行命令决定（见 §9）。

## 7. Block 生命周期状态机

`TermBlock` 状态定义见 `src/terminal/pipeline/termBlock.ts`：

```
pending ──(133;C)──▶ executing ──(133;D)──▶ done
   │                      │
   └──── 无 D 直接 A ────┘           interrupted（由下一个 133;A 触发）
```

**Shell hook 驱动**（OSC 133 / Final Term shell integration）：

| 序列 | 语义 | 触发操作 |
|------|------|---------|
| `133;A` | precmd | 创建新 pending block；上一 block 无 `D` 则标记 `interrupted` |
| `133;E;<b64>` | 命令文本 | 记录 `command` |
| `133;G;<b64>` | git 分支 | 记录 `gitBranch` |
| `133;C` | preexec | status→executing，创建单离屏 `outputTerm`；`earlyBuf` 按 typeahead 启发式丢弃或写回 |
| `133;D;<code>` | command_finished | 提取最终 outputHtml/outputText，dispose `outputTerm`，status→done |

**完成推进**：
1. `finishBlock(exitCode)`：从 `outputTerm` buffer 提取快照，释放 xterm。
2. 更新 `useBlockStore`（status、exitCode、outputHtml/outputText/outputRaw、linesTruncated）。
3. 下一个 `133;A` 创建新 pending block。

## 8. 滚动：普通 DOM + follow-bottom

`blockList` 场景下删除 `ScrollStateMachine`，改为普通 DOM 滚动 + `useFollowBottom`（`src/terminal/useFollowBottom.ts`）：

- 列表距底部 < 2 行时，新输出自动滚动到底部。
- 用户上滚后解除跟随；手动回到底部时恢复跟随。
- `altScreen` / `classic` 场景的滚动由主 xterm 自身处理。

## 9. 输入框可见性状态机

对应 §7。`inputVisibility.ts` 的 `isInputBoxVisible`（简化为 4 条件）：

```
1. isReadOnly            → 隐藏
2. isAltScreenActive     → 隐藏
3. isLongRunning（非 agent 控制/tagged）→ 隐藏
4. 默认                  → 可见
```

暂未实现 agent 控制、共享会话、对话墓碑、AI block 确认等条件。长运行命令隐藏输入框时，`getLongRunningHint` 提供 "● <命令> 运行中 · 按 End 回到输入栏" 提示。

## 10. 渲染管线

当前渲染路径由 scene 决定：

**（A）主 xterm**（`TerminalPanel`）：`classic` / `altScreen` 场景下全屏接管，直接渲染 PTY 输出并接收键盘输入。

**（B）Block DOM**（`TerminalBlockList`）：`blockList` 场景下 React 渲染整个 block 列表。已完成块直接显示 `outputHtml` 快照；运行中块订阅 store 的节流快照；pending 块只显示上下文行。列表滚动为普通 DOM 滚动，不再做 viewport cropping。

`TerminalBlockList` 按状态分组：

| 分组 | 条件 | 渲染 |
|------|------|------|
| `completed` | `done` / `interrupted` | `BlockItem`（上下文行 + 命令 + outputHtml、hover 工具条、书签） |
| `running` | `executing` | `RunningItem`（脉冲点、实时输出、耗时、终止按钮） |
| `pending` | `pending` | `PendingItem`（只显示上下文行） |

## 11. 输出提取与颜色

`terminalSnapshot.ts` 是「从 xterm buffer 提取带颜色 HTML + 纯文本」的核心：

- `extractSnapshotFromBuffer(buf, cols)`：逐 cell 读前景/背景色，生成 `<span style="...">`，**相邻同样式 cell 合并**，去尾部空行，`<br>` 连接行。支持 bold/italic/underline/strikethrough/dim/inverse。
- `createOffscreenTerm`：隐藏 xterm（离屏）作为提取载体。
- `captureTerminalOutput(rawAnsi, cols)`：把原始 ANSI 回放到离屏 xterm 再提取——正确处理 anser/正则无法处理的光标移动、清屏、`\r` 覆盖。
- 颜色：`blockTypes.ts` 的 256 色 `PALETTE`（ANSI 16 + 6×6×6 cube + 24 灰阶），`indexToCss` 映射到 CSS 色值；默认色走 `var(--fg/--bg/--cursor)`。

## 12. 状态管理

zustand，按域拆分（`src/stores/`）：

| store | 关键状态 |
|-------|---------|
| `workspace` | tabs、activeId、激活/关闭、每 tab cwd |
| `terminal` | sessions（tabId→PTY id）、dims、`scenes`（tabId→classic/blockList/altScreen）、altScreenActive、keyboardTarget、pendingInput；`termInstances`（模块级 Map，不进 state） |
| `blocks` | `byTab: tabId → TermBlock[]`，setBlocks/updateBlock/clearBlocks/toggleBookmark |
| `chat` | 每 tab AI 消息、send、setDefaultStream |
| `history` | 命令历史 |
| `ui` / `dock` / `workspaceDirs` / `searchHistory` / `searchHighlight` | UI 面板、搜索等 |

`TermBlock`（`src/terminal/pipeline/termBlock.ts`）是 UI 层的块投影，字段：id/command/cwd/gitBranch/status/exitCode/startedAt/endedAt/wasLongRunning/outputHtml/outputText/outputRaw/linesTruncated/bookmarked。

## 13. 后端（Rust 层）

`src-tauri/src/`：

| 目录/文件 | 职责 |
|------|------|
| `terminal/pty.rs` | `portable-pty` 会话生命周期，命令注册 `pty_spawn/write/resize/close`，事件 `pty-output`/`pty-exit`（含 StreamDecoder + scan.rs 接线） |
| `terminal/scan.rs` | Rust StreamScanner（字节流同步扫描，见 §5.1） |
| `terminal/shell_integration.rs` | zsh（ZDOTDIR）/ bash（--rcfile）/ PowerShell 注入 OSC 133/7 的 shell integration 脚本 |
| `terminal/shells.rs` | shell 类型探测与 list_shells |
| `db/` | rusqlite 持久化：历史、会话、块、分组、工作区、下载、SSH 连接（`HistoryDb` 分层） |
| `commands/` | Tauri command 转发层（search/session/group/workspace/download） |
| `files/` | 文件系统操作（fs、file_open） |
| `remote/ssh.rs` | SSH/SFTP（connection CRUD、主机指纹 TOFU、SFTP 下载上传） |
| `agent/` | AI 流式（ai.rs）、Skills、记忆、MCP、调度、web 抓取、自定义 agent |
| `theme.rs` | 主题配置持久化 |
| `lib.rs` / `main.rs` | Tauri 命令注册、AppState 组装、启动/退出归档 |

前端通过 `src/lib/pty.ts` 的 `invoke`/`listen` 与后端交互。

## 14. 完整数据流时间线

以执行 `ls -la` 为例：

```
T0   用户在 InputEditor 输入 "ls -la" 回车
       → ptyWrite(sessionId, "ls -la\n")
       → Rust pty.rs 写入 PTY → shell 执行

T1   shell_integration 发出 OSC 133;E（命令文本）→ 133;C（preexec）
       → PTY chunk 进入 Rust StreamScanner，同步产生 osc 事件（经 pty-output 事件交付）
       → SessionController: 133;C 将 block status→executing，创建 outputTerm

T2   PTY 输出 "total 48\n..." 到达
       → Rust 扫描 → data 事件 → SessionController 路由到 outputTerm
       → ~250ms 节流：extractSnapshotFromBuffer 提取 outputHtml
       → useBlockStore.setBlocks 更新 RunningItem 实时输出

T3   shell 发出 OSC 133;D;0（command_finished, 退出码 0）
       → SessionController: 提取最终 outputHtml/outputText，dispose outputTerm
       → status→done，setBlocks 推送
       → 下一个 133;A 创建新 pending block

T4   渲染帧
       → TerminalView 读取 scene==='blockList'
       → TerminalBlockList 渲染 BlockItem（DOM + outputHtml）
```

## 15. 关键文件索引

### 终端核心

| 文件 | 内容 |
|------|------|
| `src/App.tsx` | 顶层布局（Dock + SidePanel + TerminalView + StatusBar + 壁纸背景层） |
| `src/terminal/TerminalView.tsx` | scene 驱动 UI：loading / classic / blockList / altScreen（含分屏） |
| `src/terminal/useTerminalSession.ts` | 事件接线 + controller 生命周期 + 主 xterm 生命周期 |
| `src/terminal/useFollowBottom.ts` | block 列表贴底跟随 hook |
| `src/terminal/pipeline/events.ts` | `DispatchEvent` 类型（Rust `ScanEvent` 的镜像） |
| `src/terminal/pipeline/sessionController.ts` | block 生命周期 + 三场景状态机（classic/blockList/altScreen） |
| `src/terminal/pipeline/termBlock.ts` | UI 可见的 TermBlock 类型 |
| `src/terminal/terminalSnapshot.ts` | 离屏 xterm + buffer→HTML/纯文本提取 |
| `src/terminal/blockTypes.ts` | 256 色调色板 + `indexToCss` |
| `src/terminal/inputVisibility.ts` | 输入框可见性状态机 |
| `src/terminal/TerminalBlockList.tsx` | block 列表 + BlockItem/RunningItem/PendingItem |
| `src/terminal/TerminalPanel.tsx` | 主 xterm 面板（classic / altScreen 全屏） |
| `src/terminal/InputEditor.tsx` | 底部输入栏（命令/AI 模式、可见性消费、附件/权限） |
| `src/terminal/BlockOutput.tsx` | 块输出渲染（HTML/文本/高亮） |
| `src/terminal/useTerminalFocus.ts` | 终端聚焦路由 |
| `src/stores/terminal.ts` | 会话/尺寸/键盘路由 store + `termInstances` |
| `src/stores/blocks.ts` | 块 store |
| `src/lib/pty.ts` | Tauri IPC 封装 |
| `src/lib/sessionManager.ts` | 会话/块持久化编排 |
| `src/lib/windowLayout.ts` | 分屏布局模型（TerminalSpec / pane 分裂） |
| `src-tauri/src/terminal/pty.rs` | portable-pty 会话生命周期 + 扫描接线 |
| `src-tauri/src/terminal/scan.rs` | **Rust StreamScanner**（PTY 字节流同步扫描器） |
| `src-tauri/src/terminal/shell_integration.rs` | OSC 133/7 shell integration 注入 |

### Agent / AI 与面板

| 文件 | 内容 |
|------|------|
| `src/agent/agentStream.ts` | chat store 的 AI SDK 流式实现（streamText + 工具） |
| `src/agent/messageParts.ts` | 消息部件模型（ToolRun 状态等） |
| `src/agent/tools/` | 工具集（runCommand/terminal/files/skill/webSearch/webFetch/subagent/memory/schedule） |
| `src/agent/permissions.ts` | 权限模式（标准/严格/放行） |
| `src/agent/context.ts` | 上下文策略（off/window/compact + 摘要压缩） |
| `src/agent/skills.ts` / `src/agent/mcp.ts` | Skills / MCP 工具装配 |
| `src/chat/PanelChat.tsx` | 全局 AI 对话面板（dock 侧栏） |
| `src/chat/AiBlock.tsx` / `ToolRunCard.tsx` | 内联 AI 块 / 工具运行卡片 |
| `src/settings/` | 设置页（AI 行为/模型/MCP/Skills/快捷键/终端打开模式/主题） |
| `src-tauri/src/agent/` | AI 流/配置/记忆/Skills/MCP/调度/web 抓取后端 |
| `src-tauri/src/remote/ssh.rs` | SSH/SFTP（主机指纹 TOFU、密码认证） |

### 主题

| 文件 | 内容 |
|------|------|
| `src/theme/tokens.ts` | 主题 CSS 变量（亮/暗） |
| `src/theme/terminalTheme.ts` | 终端主题 store（壁纸 data URL + 应用不透明度 + 导入导出） |
| `src-tauri/src/theme.rs` | 主题配置持久化（JSON 文件） |

---

## 16. 分屏与窗口布局

每个终端标签可左右/上下拆成多个独立 PTY pane；**每个 pane 拥有独立的 SessionController 与 blocks store 键**，共享底部输入栏（输入路由到当前聚焦 pane，`useTerminalStore.focusedPaneId`）。

- 布局模型在 `src/lib/windowLayout.ts`（`TerminalSpec` / `layoutLeaves` / `firstLeaf`）：标签的 layout 是一棵**分裂树**（N/S/E/W 边），叶子即 pane。
- `TerminalView.tsx` 按叶子渲染：每个叶子挂一个 `TerminalPanel` + scene 驱动视图，统一由 `useTerminalSession` 管理 PTY/xterm/controller。
- 分屏启动流程：NewTabModal（TopDock `+`）选择类型 → `beginSplit`（进入落点选择，在原 pane 上哪侧分裂）→ 创建新 pane。
- 连续 pane 尺寸用绝对定位 + 百分比，拖拽经 ResizeHandle 调 `windowLayout` 更新树。

## 17. Agent / AI 对话（代码代理）

AI 对话以**两种形态消费同一份 chat store**：

- **内联**：`InputEditor` ⚡ 模式，回答渲染为终端上方的 `AiBlock`（AI 块，随负载分级渲染）。
- **面板**：`PanelChat`（dock 侧栏「AI」面板，跨 pane 的会话转录，按来源 pane 分段）。

### 流式管线（`src/agent/`）

```
chat store send → agentStream（AI SDK streamText）
  ├─ createChatModel（provider 封装：Anthropic/Gemini/OpenAI 兼容）
  ├─ buildSystemPrompt + buildSkillsContext + 记忆/agent 列表（platform IPC）
  ├─ buildTools（terminal/runCommand/files/*/skill/subagent/memory/schedule/webSearch/webFetch/webCrawl）
  ├─ buildMcpTool（每 MCP server 一个工具，Rust 侧 mcp.rs 启停连接）
  ├─ 文本 delta → onChunk（store 50ms 合批）；工具事件 → ToolRun（rail 节点卡片）
  └─ stepCountIs(maxSteps) 循环，run_command 把命令下发到当前聚焦 pane
```

- **权限模式**（`permissions.ts`）：标准（按设置页逐工具判定）/ 严格（逐次问）/ 放行（危险命令仍逐次问）；Shield 状态栏 chip 循环切换。
- **上下文策略**（`context.ts`）：off（全量）/ window（token 预算）/ compact（预算 + 自动摘要压缩），估算用 `estimateTokens`。
- **设置分层**（`agentSettings.ts`）：global 默认 + per-model overrides（`resolve(modelId)` 合并），localStorage 持久化；key/provider/模型等连接配置仍在 Rust `config.json`。
- **智能标题**（`agent/title.ts`）：块/对话活动足够时调用 LLM 生成标签标题（App 启动 `initAutoTitle()`）。
- **后端**：`src-tauri/src/agent/`（`ai.rs` SSE 流式、`skills.rs`、`memory.rs`、`mcp.rs`、`schedules.rs`、`web.rs` 抓取、`agents.rs` 自定义 agent）。

## 18. 主题系统

主题分两层，都在 `src/theme/`：

| 层 | 内容 |
|---|---|
| 设计 tokens（`tokens.ts`） | 亮/暗两套 CSS 变量（`--canvas/--text-primary/--border/...`），`applyTheme` 首帧同步写入防 FOUC |
| 外观主题（`terminalTheme.ts` + Rust `theme.rs`） | 壁纸（data URL，背景层固定铺满 zIndex 0）+ 应用不透明度（有壁纸才生效）+ 主题导入/导出 JSON |

- 配置持久化在 Rust 侧（`theme_config` 命令，JSON 文件），启动先 `applyCachedWallpaper()` 再异步 `load()`。
- 终端配色（ANSI 调色板）在 `src/terminal/blockTypes.ts`，独立于设计 token。

