# Vrykell 架构

> 当前 v2 chat-first 实现（分支 `dev`）的实际架构。终端主体把终端输出抽象为**命令块（Block）**，用「Rust StreamScanner 同步扫描 + SessionController 三场景状态机 + 每 block 单离屏 xterm」组织。
>
> 本文记录当前实现的实际架构。（最近更新：2026-10-13；分屏、Agent、主题与独立 AI 对话见 §16-§19。）

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
19. [独立 AI 对话与终端关联](#19-独立-ai-对话与终端关联)

---

## 1. 概览与产品形态

- **终端与 AI 对话**：终端仍是命令操作主表面；AI 面板管理独立对话，没有终端也可使用。每个对话可明确选择终端作为执行环境。
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

`src/app/layout/WorkspaceShell.tsx` 负责应用全高网格：

```
WorkspaceShell
├── WorkspaceSidebar (full height, resizable and completely collapsible)
│   ├── Functional navigation
│   ├── Left auxiliary actions and panel slot
│   └── Settings
├── TopDock (42px, beside the sidebar)
└── Workspace body
    ├── Primary column
    │   ├── Horizontal instance tabs (34px)
    │   └── Terminal, code, AI or host-resource content
    ├── Right auxiliary panel slot
    ├── Conditional SSH status slot
    └── Settings overlay
```

`TerminalView`（`src/features/terminal/components/TerminalView.tsx`）是终端主表面，内部由 SessionController 的**场景状态**驱动（见 §6）。

左侧中部与右上方操作区共用 `DockNavigation`。`dock.ts` 的 `leftZone` / `rightZone` 决定按钮顺序和面板位置，左右各打开一个不同面板。第 6 版布局独立保存两侧，旧版本仍沿用原来的右侧迁移方式且不覆盖原存储。`PanelSurfaces` 为访问过的每个面板保留一个 DOM 宿主，在两个插槽之间移动；门户身份保持稳定，移动、关闭和重开都保留功能状态。收起导航仅隐藏左侧宿主，不删除打开状态；条件 SSH 状态面板仅替换右侧面板。设置固定在导航底部，窗口按钮固定在顶栏。

导航按钮由 `useNavigationButtonDrag` 通过 Pointer Events 拖动，移动超过 6px 后才开始。来源按钮保留挂载但移出排列，图标通过 `NavigationDragPreview` 跟随指针；目标位置插入 32px 实际占位，其他按钮重新排列让位。占位区域保留对应插入索引，避免让位后重复命中导致落点跳动；按钮之间的间隙按邻近位置计算。预览不修改布局或持久化，松手才提交，取消时恢复原排列。禁止使用 HTML5 Drag and Drop：Windows 桌面窗口的原生文件拖放会拦截这些事件，浏览器预览无法直接验证该行为。保留原生文件拖入；导航按钮及右上方操作区不标记为窗口拖动区域。Esc、失焦、pointercancel 和卸载取消拖动；松手产生的 click 不触发面板切换。交互测试会禁用 HTML 拖放事件，确认指针拖动独立工作。

顶栏通过 `useBalancedTitlebar` 观察操作区、导航偏移和原生控件留白，搜索相对整个应用居中；空间不足时先收紧输入区，避免覆盖操作。导航保存宽度与临时拖动宽度分开，按住收起后可反向恢复，窗口预算不会覆盖已保存的宽度。

## 4. 端到端分层

共享界面代码按职责划分为 `src/ui/actions`、`fields`、`menus`、`feedback`、`layout`、`editor`、`history`、`icons` 和 `hooks`，测试及样式与所属包放在一起。不保留根目录兼容组件，架构检查拒绝界面根目录源码。终端和混合资源工作区共用平面分屏渲染器、窗格表面、分隔线及落点选择器。现有领域标签存储继续作为权威来源，聚合工作区只保存引用与排布。左侧横条打开单独编排但沿用现有启动页设计的开始页，焦点资源操作放在标签栏工具条，不另加一行。

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

`src/platform/` 是唯一的基础设施接入层：`platform/api/*` 按领域封装 `invoke` 调用与跨进程契约类型，视图/领域层不直接 invoke。本地路径语义收敛在 `platform/path.ts`（分隔符、盘符根、上级目录）；所有跨 IPC 边界的文件路径在 `platform/api/fs`（以及 workspace/search）双向归一化——入参先规范成前端统一的 `/` 形式再 invoke，后端返回的原生路径先规范再进业务状态。业务层直接使用规范路径，不自行处理分隔符（终端 cwd 的 OSC 7 归一化仍由终端管线负责）。

## 5. 同步派发与三场景状态机：PTY 输出到屏幕

Rust PTY 输出的每个 chunk 不再先写主 xterm 再等 parser 异步回调，而是先在 **Rust 端同步扫描**，按字节顺序产生事件后经 Tauri IPC 一次性交付，前端 SessionController 同步消费。

### 5.1 Rust StreamScanner（`src-tauri/src/terminal/scan.rs`）

- 输入：`push(chunk)` 返回有序 `ScanEvent` 流，顺序与字节顺序一致；经 `pty.rs` 汇入 Tauri event `pty-output`。
- 事件形状（serde tag=kind, camelCase）：`{kind:'data', text}` / `{kind:'osc', code, payload, raw}` / `{kind:'altEnter'|'altExit', raw}`；前端镜像类型在 `src/features/terminal/services/pipeline/events.ts`（`DispatchEvent`）。
- OSC 解析：识别 `133;A` / `133;B` / `133;C` / `133;D;ec` / `133;E;b64` / `133;G;b64`、`7;path`、`0/2;title`；OSC 从 data 段剥离，但保留 `raw` 用于 classic / altScreen 场景下透传给主 xterm（保 OSC 8 超链接、OSC 52 剪贴板等）。`0/2;title` 另被 SessionController 消费为「前台程序标题」：命令执行中或全屏（altScreen）时展示在标签与标题栏，命令结束或退出全屏即清除，且不覆盖手动命名。
- alt-screen 观测：检测 `\x1b[?1049/1047/47[hl]`，只发事件，序列本身保留在 data 段。
- 跨 chunk 边界：不完整 ESC / OSC 序列存入 `pending`，与下一 chunk 拼接后再扫。
- 输入是 StreamDecoder 解码后的 UTF-8 字符串；扫描对象全是 ASCII 单字节控制字符，按字节索引安全。

### 5.2 SessionController（`src/features/terminal/services/pipeline/sessionController.ts`）

每 tab 一个实例（分屏时每 pane 一个），同步消费 `DispatchEvent`：

- **三场景状态机**
  - `classic`：默认，未收到 `133;A` 时主 xterm 全屏工作。
  - `blockList`：收到首个 `133;A` 后进入，主 xterm 隐藏，渲染 React block 列表。
  - `altScreen`：数据段检测到 alt-screen 进入序列后叠加在以上两场景之上，主 xterm 接管。

- **Block 生命周期**
  - `133;A` → 创建新 block（status=`pending`），上一 block 无 `D` 则标记 `interrupted`。
  - `133;E;<b64>` → 记录命令文本。
  - `133;G;<b64>` → 记录 git 分支。
  - 块输入栏提交命令或收到 `133;C` → block 转 `executing`，创建唯一离屏 xterm（`outputTerm`）；输入栏提交后不等待远端 preexec 标记，迟到的 `133;C` 不重复启动。
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

`altScreen` 叠加在 `classic` 或 `blockList` 之上；退出 alt-screen 后由 SessionController 恢复前一个场景。全屏应用（vi/htop 等）退出/被杀后 **alt buffer 最终画面不再回填块历史**，块只保留 teardown 后的 shell 噪音。输入框可见性由 `inputVisibility.ts` 消费当前 scene 与是否有长运行命令决定（见 §9）。

## 7. Block 生命周期状态机

`TermBlock` 状态定义见 `src/features/terminal/services/pipeline/termBlock.ts`：

```
pending ──(输入栏提交 / 133;C)──▶ executing ──(133;D)──▶ done
   │                      │
   └──── 无 D 直接 A ────┘           interrupted（由下一个 133;A 触发）
```

**Shell hook 驱动**（OSC 133 / Final Term shell integration）：

| 序列 | 语义 | 触发操作 |
|------|------|---------|
| `133;A` | precmd | 创建新 pending block；上一 block 无 `D` 则标记 `interrupted` |
| `133;B` | prompt 结束 | 行编辑器已可接收输入；标记该 pane 的 Shell 启动就绪（文件打开等延后命令据此下发），本身不建块、不写入主 xterm |
| `133;E;<b64>` | 命令文本 | 记录 `command` |
| `133;G;<b64>` | git 分支 | 记录 `gitBranch` |
| `133;C` | preexec | status→executing，创建单离屏 `outputTerm`；`earlyBuf` 按 typeahead 启发式丢弃或写回 |
| `133;D;<code>` | command_finished | 提取最终 outputHtml/outputText，dispose `outputTerm`，status→done |

**完成推进**：
1. `finishBlock(exitCode)`：从 `outputTerm` buffer 提取快照，释放 xterm。
2. 更新 `useBlockStore`（status、exitCode、outputHtml/outputText/outputRaw、linesTruncated）。
3. 下一个 `133;A` 创建新 pending block。

命令文本有两条来源：InputEditor 提交时按 pane 暂存；shell 的 `133;E` 是补充来源，可在 `133;C` 之后到达并更正正在执行块的命令名。controller 暂时未注册时，InputEditor 暂存仍保留并由下一次 preexec 消费；没有命令文本时保持空值，禁止沿用前一块命令。创建 PTY 子进程时会移除继承的 `VTE_VERSION`，避免 GNOME VTE 的 Bash hook 与 Vrykell 同时发送 `133;C`。

## 8. 滚动：普通 DOM + follow-bottom

`blockList` 场景下删除 `ScrollStateMachine`，改为普通 DOM 滚动 + `useFollowBottom`（`src/features/terminal/hooks/useFollowBottom.ts`）：

- 列表距底部 < 2 行时，新输出自动滚动到底部。
- 用户上滚后解除跟随；手动回到底部时恢复跟随。
- 滚动容器观察整段输出内容与自身尺寸；运行中 xterm 改变高度时，贴底视图继续贴底。阅读历史时记录视口附近的文字位置，面板开合或终端宽度变化导致折行后按文字锚点恢复视图。
- `altScreen` / `classic` 场景的滚动由主 xterm 自身处理。

运行中块通过 `SessionController` 持有块内 xterm，`RunningTerm` 把它挂到可见宿主。controller、待提交命令和宽度同步回调使用同一个跨热更新注册表，避免 dev 模式更新模块后 PTY 仍写入旧 controller、页面却无法取得活终端。诊断日志记录 `running-terminal-mounted`、`running-terminal-mount-missing` 和首次可见输出行数。

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

**（B）Block DOM**（`TerminalBlockList`）：`blockList` 场景下 React 渲染整个 block 列表。已完成块显示 `outputHtml` 快照；运行中块挂载 controller 持有的活 xterm，直接呈现 PTY 输出；pending 块不显示。列表使用普通 DOM 滚动，整段输出变化由 `ResizeObserver` 驱动贴底。

活终端使用 xterm 测得的字符高度，避免强行压缩行高时裁掉首行顶部笔画；完成块的 HTML 快照使用同一份实测行高（`floor(自然行高 × 行距)`，由终端层发布到 `--terminal-row-height`），历史输出因此与画布的网格逐行对齐——按字号公式估算会让整行着色的内容逐行重叠。

终端宽度随窗口、侧栏及分屏布局更新，调用 PTY 和活 xterm 的 resize，不使用横向滚动容器替代尺寸同步。完成块提取快照时仅按 xterm buffer 的 `isWrapped` 合并软换行，保留显式换行、空行、间距和颜色；历史输出随当前容器宽度重新换行。认证与屏幕快照仍保留物理网格行。终端历史使用纵向主题滚动条，提前预留滑块区域，避免溢出时列宽变化。

画面刷新与 GPU 资源有独立约定（`services/terminalRepaint.ts`）：普通重绘（切回标签、pane 重新可见、块终端挂载）只从缓冲区 `refresh`，**不清空字形图集**——字体/主题/DPR 相同的终端共用一个图集，清空必须是应用级动作：清空一次并刷新全部活终端（pane 主终端 + 运行中块终端），页面从后台恢复（`visibilitychange`）走同一条路径并按事件合并为一次。丢弃渲染器（手动重绘、切换渲染器偏好、终端销毁）时显式交还 WebGL 上下文，避免触碰浏览器存活上下文上限后随机终端花屏。细节与上游修复见 `docs/zh/pitfalls.md` §4.9/§4.10。

`TerminalBlockList` 按状态分组：

| 分组 | 条件 | 渲染 |
|------|------|------|
| `completed` | `done` / `interrupted` | `BlockItem`（上下文行 + 命令 + outputHtml、hover 工具条） |
| `running` | `executing` | `RunningItem`（脉冲点、实时输出、耗时、终止按钮） |
| `pending` | `pending` | `PendingItem`（只显示上下文行） |

## 11. 输出提取与颜色

`terminalSnapshot.ts` 是「从 xterm buffer 提取带颜色 HTML + 纯文本」的核心：

- `extractSnapshotFromBuffer(buf, cols)`：逐 cell 读前景/背景色，生成 `<span style="...">`，**相邻同样式 cell 合并**，去尾部空行，`<br>` 连接行。支持 bold/italic/underline/strikethrough/dim/inverse。
- `createOffscreenTerm`：隐藏 xterm（离屏）作为提取载体。
- `captureTerminalOutput(rawAnsi, cols)`：把原始 ANSI 回放到离屏 xterm 再提取——正确处理 anser/正则无法处理的光标移动、清屏、`\r` 覆盖。
- 颜色：`blockTypes.ts` 的 256 色 `PALETTE`（ANSI 16 + 6×6×6 cube + 24 灰阶），`indexToCss` 映射到 CSS 色值；默认色走 `var(--fg/--bg/--cursor)`。

## 12. 状态管理

zustand，按域拆分（`src/features/*/stores/`）：

| store | 关键状态 |
|-------|---------|
| `workspace` | tabs、activeId、激活/关闭、每 tab cwd |
| `terminal` | sessions（tabId→PTY id）、dims、`scenes`（tabId→classic/blockList/altScreen）、altScreenActive、keyboardTarget、pendingInput；`termInstances`（模块级 Map，不进 state） |
| `blocks` | `byTab: tabId → TermBlock[]`，setBlocks/updateBlock/clearBlocks/dropTab |
| `chat` | 每 tab AI 消息、send、setDefaultStream |
| `history` | 命令历史 |
| `ui` / `dock` / `workspaceDirs` / `searchHistory` / `searchHighlight` | UI 面板、搜索等 |

`TermBlock`（`src/features/terminal/services/pipeline/termBlock.ts`）是 UI 层的块投影，字段：id/command/cwd/gitBranch/status/exitCode/startedAt/endedAt/wasLongRunning/outputHtml/outputText/outputRaw/linesTruncated/snapshotPending/agent。

## 13. 后端（Rust 层）

`src-tauri/src/`：

| 目录/文件 | 职责 |
|------|------|
| `terminal/pty.rs` | `portable-pty` 会话生命周期，命令注册 `pty_spawn/write/resize/close`，页面重载或应用退出时由 `pty_close_all` 与 `on_page_load` 钩子统一收敛会话；事件 `pty-output`/`pty-exit`（含 StreamDecoder + scan.rs 接线；GUI 启动 TERM/COLORTERM 为空时补 `xterm-256color` + truecolor） |
| `terminal/scan.rs` | Rust StreamScanner（字节流同步扫描，见 §5.1） |
| `terminal/shell_integration.rs` | zsh（ZDOTDIR）/ bash（--rcfile）/ PowerShell 注入 OSC 133/7 的 shell integration 脚本 |
| `terminal/shells.rs` | shell 类型探测与 list_shells |
| `db/` | rusqlite 持久化：历史、会话、块（含 `output_html` 颜色快照）、分组、工作区、下载、SSH 连接（`HistoryDb` 分层；`user_version<2` 旧库直接重置） |
| `commands/` | Tauri command 转发层（search/session/group/workspace/download） |
| `files/` | 文件系统操作（fs、`fs_disks` 磁盘列表、file_open） |
| `remote/ssh.rs` | SSH/SFTP（connection CRUD、主机指纹 TOFU、SFTP 下载上传） |
| `agent/` | AI 流式（ai.rs）、Skills、记忆、MCP、web 抓取 |
| `theme.rs` | 主题配置持久化 |
| `lib.rs` / `main.rs` | Tauri 命令注册、AppState 组装、启动/退出归档 |

前端通过 `src/platform/pty.ts` 的 `invoke`/`listen` 与后端交互。

## 14. 完整数据流时间线

以执行 `ls -la` 为例：

```
T0   用户在 InputEditor 输入 "ls -la" 回车
       → 暂存命令名 → ptyWrite(sessionId, "ls -la\n")
       → Rust pty.rs 写入 PTY → shell 执行

T1   shell_integration 发出 OSC 133;E（命令文本）→ 133;C（preexec）
       → 如先收到外部 133;C，controller 先消费 InputEditor 暂存；后到的 133;E 只更新当前块
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

开启「自动保存日志」后，记录按 UTC 小时写入日志目录的 `diagnostics-<YYYYMMDDTHH>.jsonl`。排查命令挂起时，按时间关联 `command-submit`、`command-start`、`pty-io`、`terminal-io`、`terminal-scene-focus`、`terminal-input`、`terminal-input-write-complete` 和 `command-done`；日志只保留长度、状态和错误类型，不记录命令或终端原文。终端数据通路读数按秒聚合：Rust 侧 `pty-io` 汇总读取与输出冲刷（块数、字节、最大单块、最大间隔），前端 `terminal-io` 汇总收包、控制器入口与路由去向；整段静默按 1 s、2 s、4 s… 翻倍记 `read-idle`，所以「没有输出」本身也是可查的。`session-controller-register/dispose` 与 `command-pending-deferred` 用于定位热更新或生命周期竞态。

## 15. 关键文件索引

### 终端核心

| 文件 | 内容 |
|------|------|
| `src/App.tsx` | 顶层布局（Dock + SidePanel + TerminalView + 壁纸背景层） |
| `src/features/terminal/components/TerminalView.tsx` | scene 驱动 UI：loading / classic / blockList / altScreen（含分屏） |
| `src/features/terminal/hooks/useTerminalSession.ts` | 事件接线 + controller 生命周期 + 主 xterm 生命周期 |
| `src/features/terminal/hooks/useFollowBottom.ts` | block 列表贴底跟随 hook |
| `src/features/terminal/services/pipeline/events.ts` | `DispatchEvent` 类型（Rust `ScanEvent` 的镜像） |
| `src/features/terminal/services/pipeline/sessionController.ts` | block 生命周期 + 三场景状态机（classic/blockList/altScreen） |
| `src/features/terminal/services/pipeline/termBlock.ts` | UI 可见的 TermBlock 类型 |
| `src/features/terminal/model/terminalSnapshot.ts` | 离屏 xterm + buffer→HTML/纯文本提取 |
| `src/features/terminal/model/blockTypes.ts` | 256 色调色板 + `indexToCss` |
| `src/features/terminal/inputVisibility.ts` | 输入框可见性状态机 |
| `src/features/terminal/components/TerminalBlockList.tsx` | block 列表 + BlockItem/RunningItem/PendingItem |
| `src/features/terminal/components/TerminalPanel.tsx` | 主 xterm 面板（classic / altScreen 全屏） |
| `src/features/terminal/components/InputEditor.tsx` | 底部命令输入栏和询问 AI 入口 |
| `src/features/terminal/components/BlockOutput.tsx` | 块输出渲染（HTML/文本/高亮） |
| `src/features/terminal/hooks/useTerminalFocus.ts` | 终端聚焦路由 |
| `src/features/terminal/stores/terminal.ts` | 会话/尺寸/键盘路由 store + `termInstances` |
| `src/features/terminal/stores/blocks.ts` | 块 store |
| `src/platform/pty.ts` | Tauri IPC 封装 |
| `src/features/terminal/services/terminalWriteQueue.ts` | 终端输入写入队列：16K 码元分块、同会话串行、中断/关闭时丢弃未送出的余块 |
| `src/features/workspace/services/sessionManager.ts` | 会话/块持久化编排 |
| `src/utils/sanitizeHtml.ts` | outputHtml 落库/渲染双向净化（span 白名单 style + br，防注入） |
| `src/features/workspace/model/windowLayout.ts` | 分屏布局模型（TerminalSpec / pane 分裂） |
| `src-tauri/src/terminal/pty.rs` | portable-pty 会话生命周期 + 扫描接线 |
| `src-tauri/src/terminal/scan.rs` | **Rust StreamScanner**（PTY 字节流同步扫描器） |
| `src-tauri/src/terminal/shell_integration.rs` | OSC 133/7 shell integration 注入 |

### Agent / AI 与面板

| 文件 | 内容 |
|------|------|
| `src/features/agent/services/agentStream.ts` | chat store 的 AI SDK 流式实现（streamText + 工具） |
| `src/features/agent/model/messageParts.ts` | 消息部件模型（ToolRun 状态等） |
| `src/features/agent/tools/` | 工具集（runCommand/terminal/files/skill/webSearch/webFetch/memory） |
| `src/features/agent/stores/permissions.ts` | 权限模式（标准/严格/放行） |
| `src/features/agent/model/context.ts` | 上下文策略（off/window/compact + 摘要压缩） |
| `src/features/agent/services/skills.ts` / `src/features/agent/services/mcp.ts` | Skills / MCP 工具装配 |
| `src/features/chat/components/PanelChat.tsx` | 全局 AI 对话面板（dock 侧栏） |
| `src/features/chat/components/AiBlock.tsx` / `ToolRunCard.tsx` | 对话问答块 / 工具状态卡片 |
| `src/features/settings/` | 设置页（AI 行为/模型/MCP/Skills/快捷键/终端打开模式/外观：主题、块外观、字体与显示、主题文件） |
| `src-tauri/src/agent/` | AI 流/配置/记忆/Skills/MCP/web 抓取后端 |
| `src-tauri/src/remote/ssh.rs` | SSH/SFTP（主机指纹 TOFU、密码认证） |

### 文件面板（本地 / SSH 唯一实现）

本地文件面板与 SSH 文件面板**不是两套实现**：浏览与操作状态机只有一份，差异收敛到
「执行目标」这一状态变量。

| 文件 | 内容 |
|------|------|
| `src/features/files/model/fileOps.ts` | `FileOps` 接口 + `FileOpsTarget`（`{kind:'local'}` / `{kind:'ssh', connectionId}`）+ `fileOpsFor(target)` 唯一的实现选择点；`resolveTargetDir` 统一「右键/拖放落点」语义（文件夹=自身，文件=同级，空白=当前目录） |
| `src/features/files/services/localFileOps.ts` | 本地实现：`@platform/api/fs` + `@platform/path` |
| `src/features/ssh/services/fileOps.ts` | 远程实现：SSH 命令 + POSIX 路径工具 |
| `src/features/files/model/filePanelConfig.ts` | 面板配置：菜单条目 key 列表（行/多选/空白/更多）、拖放语义（拖出是否先下载、拖入是移动还是上传）、打开语义、测试标识 —— 「因状态而异」的部分只在这里 |
| `src/features/files/hooks/useFileBrowser.ts` | 共用的浏览与操作状态机：目录加载、树形懒加载、选中、访问轨迹回退/前进（每个目录一条记录）、剪贴板、回退历史（≤20 步）、新建/重命名/删除 |
| `src/features/files/components/FilePanel.tsx` | 共用视图：顶栏面包屑（可编辑）、文件树、右键/空白/更多菜单、确认弹窗、拖放接线 |
| `src/features/files/components/PanelFiles.tsx` / `src/features/ssh/components/RemoteFiles.tsx` | 薄封装：仅提供各自专有的菜单回调、图标、错误视图与下载管理入口 |
| `src/features/files/services/localPath.ts` | 本地面板目录的会话内记忆：面板重挂载（SSH 视图切换 / 下载管理往返 / 移到另一侧）时恢复浏览目录，不落盘；远程面板的等价物是 `@features/ssh/utils/remotePath.ts` |

约定：

- 文件操作一律经 `FileOps` 走后端命令；视图层不得直接 `invoke` 文件命令，也不得自行处理路径分隔符。
- 新增「只对某类目标有意义」的入口时，先加菜单 key 与配置项，由配置决定是否显示，避免出现点了就报「当前目标不支持」的条目。
- 重名避让由后端保证（`unique_path` / `unique_remote_path`，序号插在扩展名前），返回真实目标路径，回退历史按真实路径记录。
- 本地与远程的差异若属于「能力」而非「外观」，应表达为配置项（如 `drag.externalDropMode`），不要在组件里写 `if (isSsh)`。

### 路径语义分层（本地 / 远端 / 平台层）

路径的「绝对或相对、怎么拼、上级是谁」是平台相关的判断，一律收口到平台层，业务模块不自行判断：

| 路径种类 | 前端 | Rust |
|---|---|---|
| 本地路径 | `@platform/path`（分隔符、盘符根 `C:/`、上级目录、路径段） | `std::path`（`files/fs.rs`） |
| 远端（POSIX）路径 | `@platform/posixPath`（`isPosixAbsolute` / `joinPosix` / `parentPosix` / `fileNamePosix` / `normalizePosix`） | `src-tauri/src/platform/path.rs`（`is_absolute` / `join` / `parent` / `file_name` / `normalize` / `numbered_name` / `name_from_listing` / `is_within`） |
| IPC 边界 | `@platform/api/fs` 双向归一化本地路径 | 远端路径原样收发（已是 POSIX） |

规则：

- 远端路径**禁止**使用 `std::path`：Windows 宿主上 `Path::is_absolute("/home/user")` 为 `false`、`PathBuf::join` 会插反斜杠、`Path::new("/a/b").parent()` 的语义也与远端不一致。SFTP 调用时用 `Path::new(&posix_string)` 只是把字符串交给 libssh2，判断与拼接必须先用平台层助手完成。
- `ssh2` 的便捷 `Sftp::readdir` 会用宿主分隔符拼路径（Windows 上是 `\`）：取文件名必须走 `platform::path::name_from_listing(listed, dir)`，再由 `join` 生成 POSIX 路径。
- 前端同理：远端绝对/相对判断与拼接走 `@platform/posixPath`；`features/ssh/utils/remotePath.ts` 只做转发与 store/pane 相关工具。
- 在 Windows 上开发远端功能时，单测要覆盖「拼接结果不含 `\`」「`/home/user` 判定为绝对路径」，否则这类 bug 只会在真机操作时暴露。

### 主题

| 文件 | 内容 |
|------|------|
| `src/config/theme/tokens.ts` | 主题 CSS 变量（亮/暗） |
| `src/features/settings/model/terminalTheme.ts` | 终端主题 Store（壁纸 data URL + 应用不透明度 + 导入导出） |
| `src-tauri/src/theme.rs` | 主题配置持久化（JSON 文件） |

---


## 16. 分屏与窗口布局

每个终端标签可左右/上下拆成多个独立 PTY pane；**每个 pane 拥有独立的 SessionController 与 blocks store 键**，共享底部输入栏（输入路由到当前聚焦 pane，`useTerminalStore.focusedPaneId`）。

- 布局模型在 `src/features/workspace/model/windowLayout.ts`（`TerminalSpec` / `layoutLeaves` / `firstLeaf`）：标签的 layout 是一棵**分裂树**（N/S/E/W 边），叶子即 pane。
- `TerminalView.tsx` 按叶子渲染：每个叶子挂一个 `TerminalPanel` + scene 驱动视图，统一由 `useTerminalSession` 管理 PTY/xterm/controller。
- 分屏启动流程：NewTabModal（TopDock `+`）选择类型 → `beginSplit`（进入落点选择，在原 pane 上哪侧分裂）→ 创建新 pane。
- 连续 pane 尺寸用绝对定位 + 百分比，拖拽经 ResizeHandle 调 `windowLayout` 更新树。

### 终端区域的真实对齐（不是「居中」）

终端 pane 里各层的内边距**故意不对称**，改布局前先读这一节，否则很容易把整宽元素推偏：

| 层 | 内边距 | 说明 |
|---|---|---|
| `.terminal-pane`（`TerminalView` 的 pane 根） | 0 | 左/右都是 0：状态行、认证输入条等**整宽元素与 pane 的左右边界严格对齐**（左右留白相等，均为 0） |
| 终端屏幕容器（xterm 宿主 `[data-testid="ssh-terminal-screen"]`、快照 `pre`） | 左 8px、右 0 | 左侧 8px 是给终端文字/提示符的视觉留白；**右侧不留**，好让原生滚动条贴住 pane 右边缘 |
| 顶部状态行 / 认证输入条 | 对称 | 状态行 `4px 8px`；认证输入条 `padding: 12`，因此其内容左右各留 12px |

因此：

- 终端**内容**（文字、光标、滚动条）相对 pane 是**偏左留白、右侧贴边**的：文字比 pane 左边缘多缩进 8px，而 pane 右边缘不给滚动条留白。这不是「居中」，也不是错误，是有意取舍（滚动条贴边优先）。
- 需要左右对称的整宽元素（认证输入条、输入栏、面板边框）**必须挂在 pane 根层**，不要挂进带 8px 左边距的那层容器；反之，终端屏幕内容要保留那 8px。
- `e2e/ssh-auth.spec.ts` 的「认证输入条在终端区内左右对称」用例把这条约定固化了下来：一旦有人把左边距加回 pane 根层，用例会失败。

## 17. Agent / AI 对话（代码代理）

Dock 中的 `PanelChat` 管理独立 AI 对话。终端 `InputEditor` 提交命令，也可将终端快照暂存到 AI 输入区。旧版内联 AI 历史继续显示在其来源终端。

### 流式管线（`src/features/agent/`）

```
chat store send → agentStream（AI SDK streamText）
  ├─ createChatModel（provider 封装：Anthropic/Gemini/OpenAI 兼容/OpenCode）
  ├─ buildSystemPrompt + buildSkillsContext + 有限本地记忆检索
  ├─ buildTools（terminal/runCommand/files/*/skill/memory/webSearch/webFetch/webCrawl）
  ├─ buildMcpTool（每 MCP server 一个工具，Rust 侧 mcp.rs 启停连接）
  ├─ 文本 delta → onChunk（store 50ms 合批）；工具事件 → ToolRun（状态卡片）
  └─ stepCountIs(maxSteps) 循环，run_command 使用请求开始时固定的目标 pane
```

- **工具授权**（前端 `permissions.ts` + 后端 `src-tauri/src/agent/permissions.rs`）：请求由后端裁决。等级表存 `~/.vrykell/permissions.json`，危险命令 / 凭据路径 / 持久化写入的判断都实现在 Rust，命中时用系统原生对话框确认（网页内容无法代替用户点它）；放行后签发与「命令 + 参数摘要」绑定的一次性租约，受门控的后端命令（`read_file_text`/`write_file_text`/`edit_file_text`/`fs_search`）必须出示租约，漏掉授权的调用会失败关闭。前端只保留等级镜像（渲染设置页与决定注册哪些工具）、审批卡与「本会话允许」的会话授权。共享界面的特权命令也通过统一分发注册表消费租约；界面租约绑定原生 webview 和完整参数，主渲染进程仍属于信任边界。
- **权限模式**（`permissions.ts`）：标准（按设置页逐工具判定）/ 严格（逐次问）/ 放行（危险命令仍逐次问）；Shield 状态栏 chip 循环切换。
- **上下文策略**（`context.ts`）：off（全量）/ window（token 预算）/ compact（预算 + 自动摘要压缩），估算用 `estimateTokens`。
- **设置分层**（`agentSettings.ts`）：global 默认 + per-model overrides（`resolve(modelId)` 合并），localStorage 持久化；provider/模型等连接配置仍在 Rust `config.json`，而 API Key 与 SSH 密码一起放进平台密钥存储（`secret.rs`：Windows DPAPI 加密 / macOS 钥匙串 / 其它平台 0600 文件），`config.json` 不再包含 key，旧明文自动迁移。
- **服务商目录**（`src/config/providers.json` + `providers.ts`）：家族标识、显示名、默认端点与会话路由头都来自数据；预设模型在 `modelPresets.json`，真实模型列表由端点 `/models` 同步；`ai.rs` 的默认端点镜像由单测对照目录校验。
- **终端标签标题**（`agent/title.ts`）：终端命令活动足够时可调用 LLM 生成标签标题（App 启动 `initAutoTitle()`）；独立对话的标题在 AI 面板管理。
- **后端**：`src-tauri/src/agent/`（`ai.rs` SSE 流式、`skills.rs`、`memory.rs`、`mcp.rs`、`web.rs` 抓取）。

## 18. 主题系统

主题分两层：

| 层 | 内容 |
|---|---|
| 设计 tokens（`src/config/theme/tokens.ts`） | 亮/暗两套 CSS 变量（`--canvas/--text-primary/--border/...`），`applyTheme` 首帧同步写入防 FOUC |
| 外观主题（`src/features/settings/model/terminalTheme.ts` + Rust `theme.rs`） | 壁纸（data URL，背景层固定铺满 zIndex 0）+ 应用不透明度（有壁纸才生效；挂载在 body 的浮层经根变量继承同一数值）+ 主题导入/导出 JSON |

- 配置持久化在 Rust 侧（`theme_config` 命令，JSON 文件），启动先 `applyCachedWallpaper()` 再异步 `load()`。
- 终端配色（ANSI 调色板）在 `src/features/terminal/model/blockTypes.ts`，独立于设计 token。

## 19. 独立 AI 对话与终端关联

`chat` 领域持有独立对话 ID、标题、消息、执行环境和草稿。终端标签切换、关闭及设置导航不改变当前对话。AI 对话历史使用与会话历史并列的单例工作区页签，提供搜索、打开、新建和删除；打开记录时在 Dock 侧栏显示所选对话。输入区默认仅讨论；执行环境是显式选择的终端，引用快照不会自动授予终端操作权限。每次请求固定目标窗格和当时的环境信息，工具执行及回答中的代码运行都不重新读取鼠标焦点。SSH 环境不注册本地文件工具。

SQLite 的 `ai_conversations` 与 `ai_messages` 通过对话 ID 关联，独立于终端 `sessions` 的生命周期。兼容旧库时，一次性将 `chat_messages` 复制到 `legacy:<session-id>` 对话；迁移标记阻止删除后的旧对话重新出现。旧终端历史继续保留，打开 AI 面板不隐藏历史或 AI 执行的命令。

消息保存当时的命令、目录、退出码与输出快照，以及本轮执行环境。助手消息保存文本、工具结果、停止与失败状态；思考流仍只在内存中。未发送草稿和阅读位置在应用运行期间按对话保留。保存失败通过 ErrorBox 显示并可重试。独立会话可以并发生成，完整工具结果持久保存并作为配对模型消息重放。

AiBlock 沿用终端命令块的透明底色、内边距、分隔线和更多操作菜单，以整块蓝色左侧导轨标识问答。ToolRunCard 以紧凑行展示工具状态、审批和输出；在 AI 面板中每行不再带分隔细线，展开后的思考与工具输出改用与 markdown 代码块一致的外框（描边、圆角、平底色），工具输出框悬停或聚焦时在右上角出现复制按钮，终端内联 AI 块则保持平铺分隔行。SafeMarkdown 将明确执行目标传递到代码块，纯讨论隐藏终端运行入口。终端 InputEditor 只提交命令，询问 AI 将最近输出或命令块快照带入对话输入区供检查后发送。
