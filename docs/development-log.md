# AI Terminal 产品开发日志

> 依据 git 历史（238 条提交，2026-07-20 → 2026-08-17）整理。
> 本项目是一个 **chat-first 终端**：终端是主表面，每个命令渲染为一个**命令块（Block）**，AI 对话（Anthropic BYOK 直连）以内联面板显示在终端上方。

---

## 里程碑总览

| 阶段 | 时间 | 主题 | 关键产物 |
|---|---|---|---|
| Phase 0 | 07-20 | Electron 核心终端 | v0.1.0 源码（受 require Bug 阻塞） |
| Phase 1 | 07-22 | Tauri v2 迁移 | Electron → Rust 后端 + 系统 WebView |
| Phase 2 | 07-22 ~ 07-24 | v1 自研 DOM 终端 | 自写 CSI 解析器 + DOM 渲染（后废弃） |
| Phase 3 | 07-23 ~ 07-25 | 终端稳定性与体验 | VT screen model、alt screen、resize 修复 |
| Phase 4 | 07-24 ~ 07-27 | 架构分层重构 | 分层后端 + 基于功能的前端 |
| Phase 5 | 08-01 ~ 08-07 | 主题探索 | 多轮 theme 实验 + settings tab |
| Phase 6 | 08-08 ~ 08-11 | v2 chat-first 重构 | Block 架构、OSC 133、命令面板、书签 |
| Phase 7 | 08-13 ~ 08-14 | 同步单趟派发重构 | StreamDispatcher + SessionController |
| Phase 8 | 08-15 | 性能/内存批量修复 | OSC/CSI、fileOpen、AI 流式下沉 Rust |
| Phase 9 | 08-15 ~ 08-16 | 企业功能与安全 | SSH、下载、会话历史、分组、代码审计 |
| Phase 10 | 08-16 ~ 08-17 | 分屏、全局搜索与收尾 | 分屏块列表模型、Cmd+F 搜索、单测补全 |

---

## Phase 0 — 起点：Electron 核心终端（2026-07-20）

项目以 Electron 起步，目标是 Phase 1 核心终端。

- `v0.1.0: Phase 1 核心终端 — 源码完成`，但 **Electron `require` Bug 阻塞运行**，应用无法启动。
- 随后围绕 Electron 主进程修复：更新 Electron 版本、添加后安装补丁、改进终端消息处理。
- 重构 Electron API 加载逻辑，移除过时的补丁脚本，优化主进程入口。
- 更新后端接口，使会话输入/输出接受字符串数据。

**小结**：Electron 的模块加载与 IPC 问题暴露出该技术栈在此场景下的脆弱性，为下一阶段迁移 Tauri 埋下伏笔。

---

## Phase 1 — Tauri v2 迁移（2026-07-22）

彻底放弃 Electron，转向更轻量的 Tauri 2。

- `Tauri v2 迁移: Electron → Rust 后端 + 系统 WebView 前端`。
- 删除所有 Electron 残留、无用依赖，重写文档。
- 清理根目录调试脚本与 `sdk/`，重写 README、修正 `.gitignore`。
- 重写 `docs/plan.md`（Tauri 完整计划）、更新 `docs/index.md`。
- 清理构建产物 `dist/` + `target/`（**共 3.1GB**）。
- 修复 tsconfig（添加 `src/api`）、`.gitignore`（添加 `gen/`）。

**小结**：确定了 Rust 后端 + 系统 WebView 前端的长期技术底座，项目目录焕然一新。

---

## Phase 2 — v1 自研 DOM 终端（2026-07-22 ~ 07-24）

进入 v1 阶段后，团队尝试用**自研终端模拟器**替代 xterm.js。

- `DOM 终端替换 xterm.js: TerminalBuffer + react-virtuoso`。
- `自写 CSI 解析器 + DOM 渲染，零外部依赖`。
- 实现 PTY 会话管理（spawn/write/resize/close + 输出事件流）。
- 支持 **CJK 字符宽度处理**与 **IME 组合输入**，补充 CJK 测试用例。
- 优化虚拟滚动与行渲染，为 `DomTerminalView` 补充单测。
- 重写缓冲区为 **VT screen model（screen + scrollback）**，实现 DEC 1047/1048/1049 **交替屏幕缓冲**。
- 建立权威 emoji 宽度表（实测自 string-width@7），对齐 wcwidth 语义。
- 修复 parser 不再把未知序列误译为合法序列。

**小结**：这是一次富有教育意义的深度自研尝试，产出了扎实的 VT/ANSI 解析经验。但最终结论是「禁止自研终端模拟器」，该路线归档至 `archive/v1-dom-terminal` 分支，v2 重新委托给 xterm.js。

---

## Phase 3 — 终端稳定性与体验打磨（2026-07-23 ~ 07-25）

在 v1 终端之上补齐稳定性与桌面体验细节。

- 结构化终端事件处理、**拆分大事件批次避免 Tauri IPC 截断**。
- PTY resize：debounce 防止 SIGWINCH 洪泛、从窗口尺寸估算初始尺寸、resize 后 clamp 光标。
- 关闭标签确认对话框（含 force-kill 警告）、**强制 kill 子进程**、i18n 文案。
- 关闭最后一个标签时只弹一次退出对话框。
- 主题切到经典纯黑背景 + 亮白文字。
- 滚动修复：输入时 viewport 不跳、resize 时 reflow、alt screen 激活时隐藏主 scrollback。
- e2e 测试：终端使用、vim 交互、真实 Claude resize 集成测试。
- 布局：隐藏 textarea 移出滚动容器、修复 60 列散乱行。

**小结**：终端进入「可日常使用」状态，桌面交互细节（关闭确认、resize、滚动）基本收敛。

---

## Phase 4 — 架构分层重构（2026-07-24 ~ 07-27）

为后续大规模功能扩展整理代码结构。

- 重组项目为**分层后端 + 基于功能的前端**。
- 提取 app Shell，新增 feature entries 与路径别名。
- 转发特殊键与修饰键组合到 PTY。
- 清零所有既有 tsc 错误（类型层面）。
- 新增捕获 Claude Code 启动输出的脚本，修正 README 描述。

**小结**：确立分层与模块化骨架，为 v2 的大规模功能开发铺路。

---

## Phase 5 — 主题探索与 rich-theme（2026-08-01 ~ 08-07）

一段集中的视觉实验期，多轮主题迭代，最终收敛为可控的设置项。

- 修正 invoke 命令名为 snake_case 以匹配 Rust 命令。
- 终端引入 **flow layout + inline rich-content 渲染**（LaTeX 公式内联）。
- 多轮主题实验：`proof margin`、`ink & violet`、`modern chrome`、`graphite & amber`、`flat design`、`frosted-glass`（零渐变、毛玻璃）。
- 调色板收敛到经典终端色（黑/白/灰/蓝/绿）。
- **box-drawing 字符检测**用于网格对齐；窗口透明 + backdrop blur。
- 新增 **settings tab**（外观与富内容选项），标签拖拽，退出对话框逻辑修复。
- 添加 Tauri `macos-private-api` feature、修正 windowEffects 配置键。
- rich-rendering 开关（Cmd+Shift+L）。

**小结**：主题从「无方向的反复试色」收敛为「默认克制 + 可配置」，settings 体系初步建立。

---

## Phase 6 — v2 chat-first 重构（2026-08-08 ~ 08-11）

**本项目最重要的一次重构**：放弃 v1 自研终端，以「chat-first + Block 架构」重写产品。

### 脚手架与基础设施
- `v2 脚手架（Tauri 2 + React + TS，create-tauri-app 模板）`。
- Rust PTY 会话后端、PTY IPC 封装 + vitest 基础设施。
- overlay 窗口 + e2e 设施（Playwright + Tauri mock + Anthropic SSE mock），16 条用例。

### 核心功能（按提交顺序）
- xterm.js 终端面板接入 PTY 后端。
- 聊天面板 + Markdown/LaTeX/表格/代码块渲染。
- Anthropic BYOK 流式对话接入。
- 命令块一键下发终端 + chat/终端双表面布局。
- **布局重构：终端为主表面、Chat 为可折叠侧栏**，再进一步**移除 ChatPanel，AI 内联到终端**。

### Block 架构演进（一天内多轮迭代）
- 从「Block 容器化（独立背景矩形）」→「已完成块独立渲染，仅活跃命令用 xterm.js」→「BlockOverlay 分段」→「真正的 Block 列表架构」→「隐藏 xterm.js，只有 Block 列表 + InputEditor」。
- Block 持有原始 ANSI 输出，Overlay 渲染与 xterm.js 一致的彩色内容。
- 过滤 OSC/DCS/非 SGR 转义序列，修复 Block 输出乱码；基于 **OSC 133 A 精确截断提示符**。
- 运行中命令实时显示 + 自动滚到底部。

### 交互功能
- 全局快捷键（Cmd+T/W/数字/F/,）、终端搜索栏、链接识别。
- 命令面板 Cmd+P、字体缩放 Cmd+/-/0、撤销关闭标签 Cmd+Shift+T。
- Block 书签系统、Toast 通知、Tab 双击重命名 + 右键菜单、中键关闭、活跃指示器。
- copy-on-select、Block 菜单（书签/清除所有块）、块全部折叠/展开。
- **TUI 全屏模式**（alt screen 检测与切换，v1 遗留问题在此重做）。
- InlineAI 动画、终端空状态。

### 设计参考与文档
- 整理视觉与布局规范：theme 色值、布局常量、ShellIndicator、block 列表、输入区。
- 功能清单从 317 项扩充至 413 项（30 → 43 个分类）。
- 编写功能规格与测试清单（60+ 测试项，10 个分类）。

### 架构重写设计
- 终端架构重写设计文档：Handler 分层、Block 生命周期、滚动状态机、三路派发。
- 后端 shell 检测异步化、KillState 泄漏清理等 code review 修复。

**小结**：v2 产品形态（chat-first + Block）在这一阶段定型，大量交互功能落地，并建立起系统性的功能规格/功能清单文档。

---

## Phase 7 — 终端「同步单趟派发」重构（2026-08-13 ~ 08-14）

把 v2 早期「三路派发」的临时管线，重写为文档化的**同步单趟派发架构**（即当前架构）。

- 编写终端页面重构设计文档 + 实现计划（12 任务）。
- 修复 PTY 输出 UTF-8 流式解码（多字节字符跨 read 边界不再产生 U+FFFD 乱码）。
- shell integration 上报 git 分支（OSC 133;G）。
- **StreamDispatcher**：PTY 字节流同步扫描器（OSC 剥离 / alt 观测 / 跨 chunk 拼接）。
- **SessionController**：block 生命周期 + 三场景状态机（同步单趟派发）。
- store 切换到新 TermBlock 类型，新增 setBlocks/scenes。
- **useTerminalSession**：主 xterm + 同步管线接线，替代 useXterm（多轮 review 修复 listener leak、PTY race、resize/focus/cleanup）。
- TerminalView 三路派发改 **scene 驱动** + follow-bottom 替代滚动状态机。
- TerminalBlockList 视觉调整：上下文行、加粗命令、细分隔线，去左边框与 pill。
- 输出发 AI 改从 block store 取输出；InputEditor 加 forceHidden。
- 删除旧管线（BlockTracker/BlockListManager/blockOps/scrollState/useXterm）。
- e2e 适配新 block UI + classic 回退/altScreen 场景。

**小结**：当前 v2 架构（StreamDispatcher + SessionController 三场景状态机 + 每 block 单离屏 xterm）在此定型，性能与可维护性显著提升。

---

## Phase 8 — 性能/内存批量修复与下沉 Rust（2026-08-15）

一批系统性的性能与内存修复，将关键策略从渲染进程下沉到 Rust 后端。

- 安全/性能/内存批量修复（Merge fix/security-perf-batch1）。
- **OSC/CSI 扫描下沉 Rust**。
- **fileOpen 策略下沉 Rust** + get_search_context 使用活跃 tab 的 cwd。
- **AI 流式下沉 Rust**、内存泄漏修复、killForeground 升级下沉 Rust。
- 删除 v1 遗留死代码 `src/renderer`。
- 修复全屏 TUI 宽度塌缩为 2 列的问题。
- PTY 会话管理优化：输出合批 + 非阻塞写入。
- 添加清空命令历史功能（前后端数据一致性）；fs_list 异步化避免主线程阻塞；修复 BlockOutput 的 HTML 渲染逻辑增强安全性。
- 增强 session 处理与终端交互、滚动行为。

**小结**：将热路径逻辑下沉 Rust 后，渲染进程职责更纯粹，为后续功能扩展降低复杂度。

---

## Phase 9 — 企业功能与安全（2026-08-15 ~ 08-16）

补齐远程/文件/会话管理等「生产力」能力，并做了一轮严谨的代码审计与安全加固。

### 功能
- SSH 连接管理 + 会话历史视图。
- 下载管理 + 删除/重命名确认对话框。
- 设置管理重构 + AI 配置增强。
- 前端 domain 模块化（ssh/files/settings）。

### 标签分组与拖拽
- tab 分组 + 拖拽重排 + 会话历史分组。
- 后端 db 模块拆分 + 自定义鼠标拖拽 + 历史分组打磨。
- 多次修复：migration 顺序（先 ALTER 后建索引，避免启动 panic）、archive 竞态、group_id 持久化、group header 加 tab、serde snake_case 不匹配导致历史分组不可见、delete group 归档而非删除、历史分组排序。

### 安全与审计
- 新增 `docs/security-review.md`、`docs/code-audit.md`。
- **修复 SFTP 下载路径穿越**、拒绝空 SSH 用户、SSH 端口校验。
- 多轮审计修复：session upsert、chat ghost state、搜索过滤响应性、tab 撤销恢复时保留 shell/ssh 元数据、bookmark block 驱逐、workspace lastClosed 类型。
- 删除死代码 MessageItem.tsx，最终确定 code-audit 已修复清单。

**小结**：远程 SSH/SFTP、下载、会话历史分组等能力落地，同时完成了少见的「文档化 + 闭环」式代码审计，安全姿态明显提升。

---

## Phase 10 — 分屏、全局搜索与收尾（2026-08-16 ~ 08-17）

最后的冲刺阶段，补上分屏与全局搜索两个高频需求，并加强测试覆盖。

### 分屏
- MVP 分屏：每个终端标签可左右/上下拆成两个独立 PTY pane。
- 多轮修复：分屏后空白（主 pane 保持挂载不被卸载）、保留输入栏、PTY 就绪后重校尺寸、未分屏路径还原原始渲染、修复 sessionControllers key、顶部加分屏按钮。
- **重写为「分屏块列表」模型**：每个 pane 各自块列表 + 共享输入栏。
- PTY 兜底尺寸启动（0×0 → 80×24），避免分屏 pane 空白。

### 全局搜索与设置
- 全局搜索功能：Cmd+F 打开居中弹窗并聚焦。
- 修复点击筛选面板不崩溃，确保搜索框可交互。
- 设置新增快捷键说明页，展示当前支持的键盘快捷键。

### 测试补全
- 增强终端输入处理与 pane 管理。
- 增加 pane、terminal 和 workspace 存储的单元测试，增强输入状态管理和聚焦逻辑覆盖。

**小结**：分屏（每个 pane 独立块列表 + 共享输入栏）与全局搜索落地，测试覆盖补齐，本轮开发收尾。

---

## 现状与后续

- **当前架构**（详见 `docs/architecture.md`）：PTY 输出 → StreamDispatcher 同步扫描 → SessionController 三场景状态机（OSC 133 驱动）→ 每 executing block 一个离屏 xterm，完成后提取 outputHtml 快照 → scene 驱动 UI。
- **技术栈**：Tauri 2（Rust）+ React 19 + TypeScript + Vite；终端 `@xterm/xterm`；状态 zustand；AI `@anthropic-ai/sdk`（BYOK）+ react-markdown + KaTeX；测试 vitest + Playwright。
- **待办**：按功能清单持续补齐 backlog。
- **合规**：第三方依赖许可说明见 `NOTICE`。
