# AI Terminal — 完整实现计划

## 项目背景

传统终端只能渲染纯文本——无法显示 LaTeX 数学公式、语法高亮的代码块、或 AI 工具日益输出
的富文本 Markdown。本项目构建一个新一代**桌面终端模拟器**，通过智能内容检测与渲染弥合
这一差距。

**目标用户**: 日常使用 AI 编程工具的开发者、处理数学密集型输出的研究人员。

**核心需求**:
- 纯桌面应用（macOS / Windows / Linux）
- 本地终端 + 远程 SSH 连接
- LaTeX / Markdown / 代码高亮 / 图片渲染
- 内嵌 AI 对话面板 + 命令建议 + AI SDK 深度集成

**框架选型**: 最初基于 Electron，因 `require('electron')` 在 Electron 28~43 全版本返回
路径字符串而非 API 对象的持续未修复 Bug (GitHub #49034)，迁移到 **Tauri v2**。

---

## 总体架构

Tauri v2 桌面应用。Rust 后端管理 PTY/SSH（系统 I/O），React 前端运行在系统 WebView 中。
核心原则：**后端抽象为接口**，前端框架无关，支持未来迁移。

```
┌──────────────────────────────────────────────────────────┐
│                     Tauri 桌面应用                         │
│                                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │  前端 (React 18 + TypeScript + Vite)               │   │
│  │                                                    │   │
│  │  ┌──────────┐ ┌───────────┐ ┌─────────────────┐   │   │
│  │  │终端面板  │ │AI 对话    │ │富文本输出面板   │   │   │
│  │  │(xterm.js │ │面板       │ │(Markdown/LaTeX) │   │   │
│  │  │ +DOM渲染)│ │           │ │                 │   │   │
│  │  └──────────┘ └───────────┘ └─────────────────┘   │   │
│  │                                                    │   │
│  │  内容检测 & 渲染管线 (Web Worker 异步执行)           │   │
│  │  LaTeX → KaTeX  |  代码 → Shiki  |  MD → marked    │   │
│  └────────────────────────────────────────────────────┘   │
│                         │                                  │
│                    Tauri IPC                               │
│               (invoke + event 推送)                        │
│                         │                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │  Rust 后端                                          │   │
│  │                                                    │   │
│  │  ┌───────────┐ ┌───────────┐ ┌────────────────┐   │   │
│  │  │PTY 管理器 │ │SSH 客户端 │ │AI 桥接         │   │   │
│  │  │(portable  │ │(russh)    │ │(reqwest)       │   │   │
│  │  │ -pty)     │ │           │ │                │   │   │
│  │  └───────────┘ └───────────┘ └────────────────┘   │   │
│  │                                                    │   │
│  │  会话管理：标签页 · 持久化 · 远程连接               │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 项目结构

```
ai-terminal/
├── src-tauri/                    # Rust 后端
│   ├── Cargo.toml                # Rust 依赖声明
│   ├── tauri.conf.json           # 窗口、安全、打包配置
│   ├── capabilities/             # 权限声明 (deny-by-default)
│   ├── icons/                    # 应用图标
│   └── src/
│       ├── main.rs               # Tauri 入口
│       ├── lib.rs                # 命令注册 + Builder 配置
│       ├── pty.rs                # PTY 管理器 (portable-pty)
│       ├── session.rs            # 会话状态管理
│       ├── commands.rs           # Tauri IPC 命令
│       ├── ssh.rs                # SSH 客户端 (russh, Phase 4)
│       └── ai.rs                 # AI 桥接 (reqwest, Phase 3)
│
├── src/                          # 前端
│   ├── api/                      # Tauri 桥接层
│   │   └── index.ts              # invoke + listen 封装
│   ├── renderer/                 # React 前端
│   │   ├── index.html
│   │   ├── main.tsx              # React 入口
│   │   ├── App.tsx               # 根布局组件
│   │   ├── components/
│   │   │   ├── terminal/
│   │   │   │   ├── TerminalView.tsx      # xterm.js 封装
│   │   │   │   └── TerminalTabs.tsx      # 标签栏
│   │   │   ├── output/
│   │   │   │   ├── RichOutput.tsx        # 富文本输出面板
│   │   │   │   ├── LatexRenderer.tsx     # KaTeX 渲染
│   │   │   │   ├── MarkdownRenderer.tsx  # marked 渲染
│   │   │   │   └── CodeBlock.tsx         # Shiki 高亮
│   │   │   ├── ai/
│   │   │   │   └── AIChatPanel.tsx       # AI 对话面板
│   │   │   └── layout/
│   │   │       └── StatusBar.tsx
│   │   ├── hooks/
│   │   │   ├── useTerminal.ts       # xterm.js 生命周期
│   │   │   └── useRichContent.ts    # 富内容检测 hook
│   │   ├── services/
│   │   │   └── content-detector.ts  # 内容检测 (正则扫描)
│   │   ├── stores/
│   │   │   └── terminal-store.ts    # Zustand 全局状态
│   │   └── styles/
│   │       └── global.css
│   └── shared/                     # 前后端共享
│       ├── types.ts                # 类型定义 + 默认设置
│       ├── ipc-channels.ts         # 事件/命令名常量
│       ├── protocol.ts             # OSC 富内容协议
│       └── backend-interface.ts    # ISessionBackend 抽象接口
│
├── docs/                          # 文档
├── package.json                   # 前端依赖
├── vite.config.ts                 # Vite 构建配置
└── tsconfig.json                  # TypeScript 配置
```

---

## 关键技术决策

### 1. 桌面框架：Tauri v2

| 维度 | Tauri v2 | Electron (已弃用) |
|------|----------|-------------------|
| 安装包大小 | **~10MB** | ~150MB |
| 空闲内存 | **~50MB** | ~150MB |
| 冷启动 | **<1s** | ~2-3s |
| PTY 支持 | **portable-pty**（WezTerm 同款，生产级） | node-pty |
| SSH 支持 | **russh**（纯 Rust, async） | ssh2 |
| AI SDK | reqwest → Claude API（Rust）或前端 fetch | @anthropic-ai/sdk |
| 终端 I/O | Tauri invoke + event emit | MessagePort 二进制 |
| 前端 | 系统 WebView（Safari/Edge/WebKitGTK） | Chromium |
| 富内容渲染 | **完全相同**（KaTeX/Shiki/marked 均在浏览器运行） | 相同 |

### 2. 终端引擎：xterm.js v5

- **选型理由**: VS Code 同款引擎，插件生态成熟
- **渲染**: DOM 渲染器（Tauri macOS 使用 WKWebView/Safari，WebGL addon 有兼容问题）。
  Windows (WebView2) 和 Linux (WebKitGTK) 可选 WebGL addon
- **插件**: Fit, Search, Unicode11
- **性能**: 可视区域懒渲染 decoration；最多 200 个 decoration，LRU 淘汰；
  快速输出 debounce 50ms；回滚缓冲区 ~1 万行
- **npm 包**: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-unicode11`

### 3. Rust 后端架构

**PTY 管理器** (`pty.rs`):
- Crate: `portable-pty` 0.9（WezTerm 同款，月下载 80 万）
- `PtyManager` 结构体：spawn shell、stdin 写入、stdout 读取（后台 std::thread）、resize
- `take_writer()` / `try_clone_reader()` 分离读写句柄
- 每个会话一个后台线程循环读取 stdout，通过 `app_handle.emit()` 推送前端
- OSC 标题变更检测（OSC 0/2 序列）
- 最大 20 并发会话

**会话存储** (`session.rs`):
- `SessionStore`: HashMap 管理活跃会话
- `SessionInfo` 结构体 #[serde] 对齐前端类型
- Phase 4 添加 `~/.ai-terminal/sessions.json` 磁盘持久化

**IPC 命令** (`commands.rs`):
- `create_pty` / `write_pty` / `resize_pty` / `close_pty` / `list_pty`
- 全部通过 `#[tauri::command]` 注册
- PTY 输出事件：`app_handle.emit("pty:output", payload)` / `pty:exit` / `pty:title-change`

### 4. 富内容协议

两层策略：**显式标记**供 AI 工具，**自动检测**保向后兼容。

**第一层：AI 标记（OSC 转义序列）**

OSC code 6969，格式：
```
ESC ] AI ; TYPE ; PARAMS ESC \ content ESC ] AI ; END ESC \
```

示例：
```
\x1b]AI;LATEX;inline\x1b\\
E = mc^2
\x1b]AI;END\x1b\\

\x1b]AI;CODE;python\x1b\\
def hello():
    print("world")
\x1b]AI;END\x1b\\
```

**第二层：自动检测**

对无标记的输出进行正则扫描：
- LaTeX：`$...$`、`$$...$$`、`\(...\)`、`\[...\]`
- 代码块：` ```lang ... ``` `
- 表格：`| ... |` 模式
- URL：RFC 3986 → 可点击链接

### 5. 内容检测管线

```
主线程                             Web Worker
───────                           ──────────
终端输出 (Tauri event)            内容检测（正则扫描）
    │                                  │
    ▼                                  ▼
写入 xterm.js                      KaTeX 渲染（LRU 缓存）
    │                                  │
    ▼                                  ▼
useRichContent hook 缓冲           Shiki 语法高亮
    │                                  │
    ▼                                  ▼
debounce 300ms                     marked Markdown 解析
    │                                  │
    ▼                                  ▼
detectRichContent() ──────────►   返回 DetectedBlock[]
    │
    ▼
推送到 Zustand richOutputs store
    │
    ▼
RichOutput 面板渲染
```

关键：检测在 useRichContent hook 中执行，buffer 上限 50KB，去重上限 500 条。

---

## IPC 协议详表

### 前端 → 后端（Tauri commands）

| 命令 | 参数 | 返回 | 触发时机 |
|------|------|------|---------|
| `create_pty` | shell?, cwd?, cols?, rows? | SessionInfo | 新建标签 / 自动创建 |
| `write_pty` | sessionId, data: string | () | 用户按键（高频） |
| `resize_pty` | sessionId, cols, rows | () | 窗口/容器大小变更 |
| `close_pty` | sessionId | () | 关闭标签 |
| `list_pty` | — | SessionInfo[] | 获取会话列表 |

### 后端 → 前端（Tauri events）

| 事件 | Payload | 触发时机 |
|------|---------|---------|
| `pty:output` | `{sessionId, data: string}` | Shell stdout/stderr（高频） |
| `pty:exit` | `{sessionId, exitCode: number}` | Shell 进程退出 |
| `pty:title-change` | `{sessionId, title: string}` | OSC 0/2 标题变更 |
| `session:created` | `{session: SessionInfo}` | 新会话创建 |
| `session:closed` | `{sessionId}` | 会话关闭 |

### 前端桥接层 (`src/api/index.ts`)

```typescript
// Commands (invoke)
createPTY(opts)        → invoke('create_pty', opts)
writeToPTY(id, data)   → invoke('write_pty', {sessionId: id, data})
resizePTY(id, c, r)    → invoke('resize_pty', {sessionId: id, cols: c, rows: r})
closePTY(id)           → invoke('close_pty', {sessionId: id})

// Events (listen)
onPTYOutput(cb)        → listen('pty:output', cb)       → Promise<UnlistenFn>
onPTYExit(cb)          → listen('pty:exit', cb)
onPTYTitleChange(cb)   → listen('pty:title-change', cb)
onSessionCreated(cb)   → listen('session:created', cb)
onSessionClosed(cb)    → listen('session:closed', cb)
```

---

## 核心数据流

### 按键输入流程（以用户输入 `ls` 为例）

```
用户按下 'l'
  → xterm.js 捕获 keydown → term.onData('l')
  → useTerminal hook: writeToPTY(sessionId, 'l')
  → Tauri invoke('write_pty', {sessionId, data: 'l'})
  → Rust commands::write_pty → pty_manager.write_to_session()
  → PTY writer.write_all(b'l') → kernel → shell stdin
  → Shell 处理 → 回显 'l' → PTY stdout
  → 后台读线程：reader.read() → emit("pty:output", payload)
  → 前端 listen("pty:output"): term.write(data)
  → xterm.js DOM 渲染器绘制
  → 同时: useRichContent hook 缓冲，debounce 300ms 后检测富内容
```

### 会话创建流程

```
App 挂载 / Cmd+T
  → createPTY({})
  → Tauri invoke('create_pty', opts)
  → Rust: pty_manager.create_session()
    → portable_pty: openpty() → spawn shell
    → take_writer() 存为 stdin 写入句柄
    → try_clone_reader() 启后台读线程
    → session_store.add(session)
  → 返回 SessionInfo
  → 前端: store.addSession(session)
  → TerminalView 挂载 → useTerminal hook 绑定 I/O
```

---

## 状态管理设计（Zustand）

```typescript
interface TerminalStore {
  // 会话
  sessions: SessionInfo[];
  activeSessionId: string | null;

  // 富输出 (keyed by sessionId)
  richOutputs: Record<string, RichOutputItem[]>;

  // 设置
  settings: AppSettings;

  // AI
  aiMessages: Message[];
  aiStreaming: boolean;

  // UI
  sidebarOpen: boolean;
  outputPanelHeight: number;

  // Actions
  addSession, removeSession, setActive, updateSessionTitle,
  appendOutput, clearOutputs,
  addAIMessage, appendToLastMessage, setAIStreaming, clearAIMessages,
  updateSettings, toggleSidebar, setOutputPanelHeight
}
```

## 设置 Schema

```typescript
interface AppSettings {
  terminal: {
    fontSize: number;           // 默认 14
    fontFamily: string;        // 默认 'JetBrains Mono, Menlo, monospace'
    cursorStyle: 'block' | 'underline' | 'bar';
    cursorBlink: boolean;
    scrollback: number;        // 默认 10000
  };
  appearance: {
    theme: 'dark' | 'light' | 'high-contrast';
    opacity: number;
  };
  richContent: {
    enableLatex: boolean;      // 默认 true
    enableMarkdown: boolean;
    enableCodeHighlight: boolean;
    enableAutoDetect: boolean;
    maxDecorations: number;    // 默认 200
  };
  ai: {
    apiKey: string;
    model: string;             // 默认 'claude-sonnet-5-20251001'
    maxContextLines: number;   // 默认 200
  };
  ssh: {
    savedConnections: SavedSSHConnection[];
    defaultUsername: string;
  };
}
```

---

## 错误处理策略

| 错误场景 | 处理方式 |
|---------|---------|
| PTY 进程崩溃 | 终端显示红色提示 `[Process exited with code: N]`，保留输出，用户可按 Enter 重建 |
| SSH 连接失败 | 显示错误对话框，列出原因（认证失败/网络超时/主机不可达） |
| WebView 兼容问题 | macOS 使用 DOM 渲染器兜底；Windows/Linux 可选 WebGL |
| KaTeX 渲染失败 | 富输出面板显示原始 LaTeX 源码（灰色），不阻塞终端 |
| Shiki 不支持某语言 | 回退纯文本显示，代码块保留但无高亮 |
| AI API 调用失败 | 对话面板显示错误信息，允许重试 |
| IPC 消息丢失 | Tauri event 系统自带重试；前端 debounce 缓冲兜底 |
| 文件描述符耗尽 | 限制最大 20 个并发会话 |

---

## 测试策略

| 层级 | 工具 | 覆盖内容 |
|------|------|---------|
| 单元测试 (Rust) | cargo test | PTY spawn/kill, Session CRUD, OSC 检测 |
| 单元测试 (TS) | Vitest | content-detector 正则匹配, protocol 序列化 |
| 组件测试 | @testing-library/react | TerminalTabs, AIChatPanel, RichOutput |
| E2E | Playwright + Tauri | 启动应用 → Shell → 命令 → 验证输出 |
| 安全 | cargo audit + npm audit | 依赖漏洞检查 |

---

## 性能目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 输入延迟 | <16ms (60fps) | 按键到屏幕回显 |
| 富渲染延迟 | <50ms | 检测到 DOM 注入完成 |
| 空闲内存 | <50MB | 单标签页无输出 |
| 活跃内存 | <200MB | 10 个标签页 |
| 冷启动 | <1s | 应用启动到可交互 |
| 安装包 | <10MB (macOS .dmg) | 压缩后 |

---

## 实现阶段

### Phase 1 — 核心终端 ✅ Rust 编译通过

**目标**: 可启动的 Tauri 桌面应用，本地 PTY + 多标签页。

**已完成**:
- [x] Tauri v2 项目初始化 (`src-tauri/`, Cargo.toml, tauri.conf.json)
- [x] Rust 后端: PTY 管理器 (portable-pty), Session 管理, IPC 命令
- [x] 前端桥接: `src/api/index.ts` (invoke + listen)
- [x] 前端适配: App.tsx, useTerminal.ts, TerminalTabs.tsx, useRichContent.ts
- [x] 删除所有 Electron 代码
- [x] cargo check ✅ 0 errors 0 warnings

**待完成**:
- [ ] `cargo tauri dev` 运行时验证
- [ ] macOS 窗口拖拽区域配置 (titleBarStyle: Overlay)
- [ ] 原生菜单（File/Edit/View/Terminal/Help）
- [ ] 窗口关闭生命周期（清理 PTY 进程）

**里程碑**: `cargo tauri dev` → 窗口打开 → shell 可用 → 输入命令有回显

### Phase 2 — 富内容渲染

**目标**: LaTeX / Markdown / 代码高亮检测与渲染。

- [x] 内容检测器 (`content-detector.ts`): 双层检测 + 去重
- [x] 渲染器: LatexRenderer (KaTeX), MarkdownRenderer (marked), CodeBlock (Shiki)
- [x] RichOutput 面板: 类型路由, 时间戳, Clear 按钮
- [x] useRichContent hook: 缓冲 + debounce + 去重
- [ ] In-terminal decorations (xterm.js addon)
- [ ] Web Worker 异步检测（大输出场景）

### Phase 3 — AI 集成

**目标**: Claude API 对话面板 + 命令建议。

- [ ] AIChatPanel: fetch + SSE 流式调用 Anthropic API
- [ ] API Key 存储: Tauri Store 插件 (加密)
- [ ] 流式 Markdown/LaTeX 实时渲染
- [ ] CommandSuggest: 终端上下文 AI 建议
- [ ] 备选: Rust 后端代理 (reqwest → 流式转发)

### Phase 4 — SSH + 会话持久化

**目标**: SSH 远程连接 + 会话磁盘持久化 + 分屏。

- [ ] Rust SSH 客户端 (`ssh.rs`): russh crate
- [ ] SSH 连接设置 UI
- [ ] 会话持久化: `~/.ai-terminal/sessions.json`
- [ ] 分屏: React flexbox 组件

### Phase 5 — 打包发布

**目标**: 三平台安装包 + 自动更新。

- [ ] `cargo tauri build` 配置
- [ ] macOS 代码签名 + 公证
- [ ] Tauri Updater 插件
- [ ] 用户文档 + 快捷键列表

---

## AI SDK 设计 (Phase 3)

AI 工具通过 OSC 转义序列控制终端渲染：

```typescript
import { TerminalSDK } from '@ai-terminal/sdk';

const term = new TerminalSDK();
await term.render({ type: 'latex', content: 'E = mc^2', display: 'inline' });
await term.render({ type: 'markdown', content: '# 结果\n通过 **95%**' });
await term.render({ type: 'code', language: 'python', content: 'def f(): ...' });
```

传输：SDK 将内容序列化为 OSC 转义序列写入 stdout，终端自动拦截并渲染。零网络依赖。

---

## 依赖清单

### 前端 (package.json)

| 包 | 版本 | 用途 |
|---|---|---|
| react | ^18.3.0 | UI 框架 |
| react-dom | ^18.3.0 | React DOM 渲染 |
| @xterm/xterm | ^5.5.0 | 终端引擎 |
| @xterm/addon-fit | ^0.10.0 | 自适应容器 |
| @xterm/addon-search | ^0.15.0 | 终端内搜索 |
| @xterm/addon-unicode11 | ^0.8.0 | Unicode 11 |
| @xterm/addon-webgl | ^0.18.0 | WebGL 渲染（可选） |
| katex | ^0.16.0 | LaTeX 渲染 |
| shiki | ^1.29.0 | 语法高亮 |
| marked | ^12.0.0 | Markdown 解析 |
| zustand | ^5.0.0 | 状态管理 |
| @tauri-apps/api | ^2.0.0 | Tauri invoke/listen |
| @tauri-apps/plugin-shell | ^2.0.0 | Shell 插件 |
| @tauri-apps/plugin-store | ^2.0.0 | 加密存储（Phase 3） |

### Rust (Cargo.toml)

| Crate | 版本 | 用途 |
|---|---|---|
| tauri | 2 | 桌面框架 |
| tauri-build | 2 | 构建宏 |
| tauri-plugin-shell | 2 | Shell 插件 |
| portable-pty | 0.9 | PTY 管理 |
| tokio | 1 | Async runtime |
| serde | 1 | 序列化 |
| serde_json | 1 | JSON 读写 |
| russh | — | SSH（Phase 4） |
| reqwest | — | HTTP 客户端（Phase 3/4） |

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| macOS WKWebView 不支持 xterm.js WebGL | DOM 渲染器兜底，所有平台可靠 |
| portable-pty Windows ConPTY 支持 | macOS/Linux 优先，Windows 后续适配 |
| Tauri IPC 高频 I/O 性能 | Rust 侧批量推送 + 前端 debounce |
| russh SSH 生态不如 ssh2 | Phase 4 可选 Node.js sidecar |
| macOS 代码签名成本 ($99/年) | Phase 5 手动分发，App Store 可选 |

---

## 验证方案

1. **Phase 1**: `cargo tauri dev` → `ls`, `cd`, `vim`, `htop` 均正常
2. **Phase 2**: `echo '$$E=mc^2$$'` → 终端内渲染为 LaTeX 公式
3. **Phase 3**: AI 面板提问 → 流式回复含 LaTeX/代码块富渲染
4. **Phase 4**: SSH 连接远程服务器 → 终端正常使用；分屏两个会话
5. **Phase 5**: `cargo tauri build` → 三平台安装包；安装运行正常
