# AI Terminal — 面向 AI 时代的桌面终端模拟器

## 项目背景

传统终端只能渲染纯文本——无法显示 LaTeX 数学公式、语法高亮的代码块、或 AI 工具（Claude Code、
ChatGPT CLI 等）日益输出的富文本 Markdown。本项目构建一个新一代**桌面终端模拟器**，通过智能
内容检测与渲染弥合这一差距。

**目标用户**：日常使用 AI 编程工具的开发者、处理数学密集型输出的研究人员。

**核心需求**：
- 纯桌面应用（macOS / Windows / Linux）
- 本地终端 + 远程 SSH 连接
- LaTeX / Markdown / 代码高亮 / 图片 渲染
- 内嵌 AI 对话面板 + 命令建议 + AI SDK 深度集成

## 总体架构

纯 Electron 桌面应用。主进程管理 PTY/SSH（系统 I/O），渲染进程运行 UI。
核心原则：**后端抽象为接口**，Electron 是当前实现，未来可切换为 Tauri。
无浏览器模式，无 WebSocket 服务器，仅使用 Electron IPC 通信。

```
┌──────────────────────────────────────────────────────────┐
│                      Electron 桌面应用                     │
│                                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │  渲染进程 (React 18 + TypeScript + Vite)            │   │
│  │                                                    │   │
│  │  ┌──────────┐ ┌───────────┐ ┌─────────────────┐   │   │
│  │  │终端面板  │ │AI 对话    │ │富文本输出面板   │   │   │
│  │  │(xterm.js │ │面板       │ │(Markdown/LaTeX) │   │   │
│  │  │ +WebGL)  │ │           │ │                 │   │   │
│  │  └──────────┘ └───────────┘ └─────────────────┘   │   │
│  │                                                    │   │
│  │  内容检测 & 渲染管线 (Web Worker 异步执行)           │   │
│  │  LaTeX → KaTeX  |  代码 → Shiki  |  MD → marked    │   │
│  └────────────────────────────────────────────────────┘   │
│                         │                                  │
│                   Electron IPC                              │
│               (二进制通道, 零序列化)                         │
│                         │                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │  主进程 (Node.js)                                   │   │
│  │                                                    │   │
│  │  ┌───────────┐ ┌───────────┐ ┌────────────────┐   │   │
│  │  │PTY 管理器 │ │SSH 客户端 │ │AI SDK 桥接     │   │   │
│  │  │(node-pty) │ │(ssh2)     │ │                │   │   │
│  │  └───────────┘ └───────────┘ └────────────────┘   │   │
│  │                                                    │   │
│  │  会话管理：标签页 · 持久化 · 远程连接               │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

## 项目结构

```
ai-terminal/
├── package.json
├── tsconfig.json
├── electron-builder.yml            # Electron 打包配置
├── vite.config.ts                  # Vite 渲染进程打包
│
├── src/
│   ├── main/                       # Electron 主进程
│   │   ├── index.ts                # 应用入口，窗口管理
│   │   ├── pty-manager.ts          # PTY 生命周期管理（node-pty）
│   │   ├── ssh-client.ts           # 远程 SSH 连接（ssh2）
│   │   ├── session-store.ts        # 会话持久化
│   │   ├── ai-bridge.ts            # AI SDK IPC 桥接
│   │   └── ipc-handlers.ts         # IPC 处理器注册
│   │
│   ├── preload/                    # Preload 脚本
│   │   └── index.ts                # contextBridge 暴露 API
│   │
│   ├── renderer/                   # 渲染进程
│   │   ├── index.html
│   │   ├── main.tsx                # React 入口
│   │   ├── App.tsx                 # 根布局组件
│   │   │
│   │   ├── components/
│   │   │   ├── terminal/
│   │   │   │   ├── TerminalView.tsx      # xterm.js 封装
│   │   │   │   ├── TerminalTabs.tsx      # 标签栏
│   │   │   │   └── SearchBar.tsx         # 终端搜索
│   │   │   │
│   │   │   ├── output/
│   │   │   │   ├── RichOutput.tsx        # 富文本输出面板
│   │   │   │   ├── MarkdownRenderer.tsx  # Markdown 渲染
│   │   │   │   ├── LatexRenderer.tsx     # LaTeX 渲染（KaTeX）
│   │   │   │   └── CodeBlock.tsx         # 语法高亮代码块
│   │   │   │
│   │   │   ├── ai/
│   │   │   │   ├── AIChatPanel.tsx       # AI 对话面板
│   │   │   │   ├── CommandSuggest.tsx    # AI 命令建议
│   │   │   │   └── ContextBar.tsx        # AI 上下文显示
│   │   │   │
│   │   │   └── layout/
│   │   │       ├── Sidebar.tsx
│   │   │       └── StatusBar.tsx
│   │   │
│   │   ├── hooks/
│   │   │   ├── useTerminal.ts       # xterm.js 生命周期
│   │   │   ├── useSession.ts        # 会话状态管理
│   │   │   └── useAI.ts             # AI 集成 Hook
│   │   │
│   │   ├── services/
│   │   │   ├── content-detector.ts  # 内容检测 worker
│   │   │   ├── rendering-pipeline.ts # 渲染管线（主线程侧）
│   │   │   └── ai-client.ts         # Claude API 客户端
│   │   │
│   │   ├── workers/
│   │   │   └── content-worker.ts    # Web Worker：检测+渲染
│   │   │
│   │   └── styles/
│   │       ├── global.css
│   │       └── themes/
│   │           ├── dark.css
│   │           └── light.css
│   │
│   └── shared/                     # 主进程与渲染进程共享
│       ├── ipc-channels.ts         # IPC 通道定义
│       ├── protocol.ts             # 富内容协议（OSC 序列）
│       ├── types.ts                # 共享类型定义
│       └── backend-interface.ts    # ISessionBackend 抽象接口
│
├── sdk/                            # AI 工具集成 SDK
│   ├── index.ts
│   ├── terminal-protocol.ts
│   └── examples/
│       └── claude-code-usage.ts
│
└── resources/                      # 构建资源
    ├── icon.png
    └── icon.icns
```

## 关键技术决策

### 1. 终端引擎：xterm.js v5.5+
- **选型理由**：VS Code 同款引擎。Canvas/WebGL 渲染，插件生态成熟。
- **插件**：`@xterm/addon-webgl`（主力，比 Canvas 快 ~30%）、`@xterm/addon-canvas`（降级）、
  `@xterm/addon-fit`、`@xterm/addon-unicode11`、`@xterm/addon-search`、`@xterm/addon-clipboard`
- **性能策略**：WebGL 渲染 + 可视区域懒渲染 decoration；最多 200 个 decoration，LRU 淘汰；
  快速输出 debounce 50ms；回滚缓冲区 ~1 万行，超出存二级数组。

### 2. 桌面框架选择：Electron vs Tauri

#### 核心对比

| 维度 | Electron 28+ | Tauri v2 |
|------|-------------|----------|
| 安装包大小 | ~150MB 压缩 | **~10MB 压缩** |
| 空闲内存 | ~150MB | **~50MB** |
| 冷启动 | ~2-3s | **<1s** |
| 电池续航 | 一般（Chromium 持续合成） | **好**（原生渲染） |
| PTY 支持 | **node-pty**（极成熟） | portable-pty（可用，社区小） |
| SSH 支持 | **ssh2**（极成熟） | russh/ssh2-rs（可用） |
| AI SDK | **@anthropic-ai/sdk 原生** | 需前端调用或自建 HTTP |
| 终端 I/O IPC | **MessagePort 二进制**（零开销） | Tauri events（JSON 序列化） |
| 前端（xterm.js+React） | Chromium | 系统 WebView，**完全一样** |
| 富内容渲染（KaTeX/Shiki） | **相同** | **相同** |
| OSC 序列检测 | **相同** | **相同** |

#### 结论：Electron 是当前更好的选择

理由：
1. **node-pty 是核心依赖**——它是整个应用的基础。Electron 上它零配置运行；
   Tauri 上需要用 Rust `portable-pty` 重写，这个 crate 对 Windows ConPTY 的支持不如 node-pty 成熟
2. **AI SDK 集成简单**——`@anthropic-ai/sdk` 在主进程直接运行，API key 安全存储；
   Tauri 需要额外方案
3. **IPC 性能更好**——MessagePort 二进制通道用于终端 I/O，零序列化；
   Tauri 的 IPC 走 JSON 序列化，高频按键场景有额外开销
4. **富内容渲染与框架无关**——OSC 检测和 KaTeX/Shiki 都在 xterm.js 层，
   无论 Electron 还是 Tauri 前端完全相同

Tauri 的优势（轻量、快速、省电）是真实的，但**对于终端模拟器这个品类，
PTY 的可靠性和 AI SDK 的集成便利性比节省 100MB 内存更重要**。

#### 可迁移架构

代码分层隔离框架依赖。PTY/IPC 层抽象为接口 `ISessionBackend`：

```typescript
// src/shared/backend-interface.ts
interface ISessionBackend {
  createSession(opts: SessionOptions): Promise<Session>;
  closeSession(id: string): Promise<void>;
  write(id: string, data: Uint8Array): void;
  onOutput(cb: (id: string, data: Uint8Array) => void): void;
  onExit(cb: (id: string, code: number) => void): void;
}
```

Electron 实现用 `node-pty + MessagePort`，未来如果需要极致轻量，可以写一个 Tauri 实现
用 `portable-pty + Tauri invoke`。前端代码完全不用改。

- **渲染进程**：React 18 + TypeScript + Vite。选 React 而非 Lit 因为：AI 流式对话面板、
  设置页、拖拽标签、分屏——需要成熟的状态管理和组件生态。
- **IPC 设计**：
  - 高频终端 I/O：Electron `MessagePort` 二进制通道，零序列化
  - 控制消息：结构化 JSON IPC（通过 `contextBridge` 暴露的类型安全 API）

### 3. 富内容协议

两层策略：**显式标记**供 AI 工具，**自动检测**保向后兼容。

**第一层：AI 标记（OSC 转义序列）**
与 iTerm2 内联图片/kitty 图形协议同机制，AI 工具输出 OSC 序列声明富内容：

```
\x1b]AI;LATEX;inline\x1b\\
E = mc^2
\x1b]AI;END\x1b\\

\x1b]AI;MARKDOWN\x1b\\
# 运行结果
测试**通过**，置信度 95%。
\x1b]AI;END\x1b\\

\x1b]AI;CODE;python\x1b\\
def hello():
    print("world")
\x1b]AI;END\x1b\\
```

**第二层：自动检测（Web Worker 执行）**
对无标记的输出：
- LaTeX：`$...$`、`$$...$$`、`\(...\)`、`\[...\]`
- 代码块：` ```lang ... ``` `
- 表格：`| ... |` 模式
- URL：RFC 3986 → 可点击链接

**渲染策略：xterm.js Decorations API**
自定义 xterm.js 插件拦截终端流 → 提取富内容块 → `registerDecoration()` 创建叠加 DOM →
`onRender(HTMLElement)` 注入 KaTeX/Shiki 输出。

**已知限制**：多行 decoration 的 marker 滚出视口时会被完全隐藏（无法部分可见）。缓解方案：
终端下方富输出面板保留持久副本。

### 4. 内容检测管线（Web Worker 架构）

```
主线程                             Web Worker
───────                           ──────────
终端输出                          内容检测（正则扫描）
    │                                  │
    ▼                                  ▼
写入 xterm.js                      KaTeX 渲染（LRU 缓存）
    │                                  │
    ▼                                  ▼
OSC 序列拦截                       Shiki 语法高亮
    │                                  │
    ▼                                  ▼
发送到 Worker ──────────────►    返回 HTML 字符串
                                       │
    ◄────────────────────────────  postMessage 回主线程
    │
    ▼
注入 decoration.element.innerHTML
```

关键：检测和渲染全在 Worker 中异步完成，主线程只负责 DOM 注入。KaTeX 缓存 500 条，Shiki
主题构建时预编译。

## 完整依赖清单

### 生产依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| electron | ^28.0.0 | 桌面框架 |
| react | ^18.3.0 | UI 框架 |
| react-dom | ^18.3.0 | React DOM 渲染 |
| @xterm/xterm | ^5.5.0 | 终端引擎 |
| @xterm/addon-webgl | ^0.18.0 | WebGL 渲染器 |
| @xterm/addon-canvas | ^0.7.0 | Canvas 降级渲染器 |
| @xterm/addon-fit | ^0.10.0 | 自适应容器大小 |
| @xterm/addon-search | ^0.15.0 | 终端内搜索 |
| @xterm/addon-clipboard | ^0.1.0 | 剪贴板增强 |
| @xterm/addon-unicode11 | ^0.8.0 | Unicode 11 支持 |
| @xterm/addon-web-links | ^0.11.0 | URL 自动检测 |
| node-pty | ^1.0.0 | 本地 PTY |
| ssh2 | ^1.16.0 | SSH 客户端 |
| katex | ^0.16.0 | LaTeX 渲染 |
| shiki | ^1.0.0 | 语法高亮 |
| marked | ^12.0.0 | Markdown 解析 |
| @anthropic-ai/sdk | ^0.30.0 | Claude API |
| tailwindcss | ^3.4.0 | 原子化 CSS |
| zustand | ^5.0.0 | 轻量状态管理 |
| electron-log | ^5.0.0 | 日志 |
| electron-updater | ^6.0.0 | 自动更新 |

### 开发依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| typescript | ^5.4.0 | 类型检查 |
| vite | ^5.4.0 | 构建 |
| @vitejs/plugin-react | ^4.3.0 | Vite React 插件 |
| electron-builder | ^24.0.0 | 打包 |
| vitest | ^2.0.0 | 单元测试 |
| @testing-library/react | ^16.0.0 | React 组件测试 |
| playwright | ^1.46.0 | E2E 测试 |
| eslint | ^8.57.0 | 代码规范 |
| prettier | ^3.3.0 | 格式化 |

## 核心数据流

### 按键输入流程（以用户输入 `ls` 为例）
```
用户按下 'l'
  → xterm.js 捕获 keydown → term.onData('l')
  → TerminalView 调用 window.electronAPI.writeToPTY(sessionId, 'l')
  → preload 桥接到主进程
  → ipc-handlers 收到消息 → ptyManager.write(id, Buffer.from('l'))
  → node-pty 写入 Shell stdin
  → Shell 处理 → 回显 'l' + 等待更多输入
  → node-pty stdout → ptyManager 通过 MessagePort 推送 ArrayBuffer
  → preload 转发到渲染进程
  → TerminalView 调用 term.write(new Uint8Array(data))
  → xterm.js WebGL 渲染器绘制到 Canvas
  → 同时，输出数据复制一份发送到 Web Worker（内容检测）
```

### 富内容渲染流程（以 Claude Code 输出 Markdown 为例）
```
Claude Code 输出 "\x1b]AI;MARKDOWN\x1b\\n# 结果\\n通过 **95%**\\n\x1b]AI;END\x1b\\n"
  → node-pty stdout → MessagePort → 渲染进程
  → RichContentAddon 拦截 OSC 序列：
    1. 检测到 OSC AI;MARKDOWN → 开始收集内容
    2. 收集到 OSC AI;END → 提取完整 Markdown
    3. 从终端输出中移除 OSC 序列（用户不可见）
    4. 在当前位置注册 terminal.registerMarker()
    5. 内容发送到 Web Worker
  → Web Worker：marked 解析 → 返回 HTML 字符串
  → 主线程：terminal.registerDecoration({marker, ...})
  → decoration.onRender(el => el.innerHTML = html)
  → 同时推送到 RichOutput 面板组件（zustand store 更新）
```

### SSH 连接流程
```
用户在 CommandSuggest 中输入 `ssh user@host`
  → sshClient.connect({host, port, username, privateKey/agent})
  → ssh2 建立 TCP 连接 + 密钥交换 + 认证
  → sshClient 创建 Shell 会话
  → 注册到 sessionStore
  → 通知渲染进程新会话就绪
  → 渲染进程创建新标签页 + xterm.js 实例
  → SSH 流 ↔ PTY I/O 相同模式
```

## IPC 协议详表

### 主进程 → 渲染进程

| 通道 | 负载类型 | 触发时机 |
|------|---------|---------|
| `pty:output` | `{sessionId: string, data: ArrayBuffer}` | Shell 有 stdout/stderr 输出 |
| `pty:exit` | `{sessionId: string, exitCode: number}` | Shell 进程退出 |
| `pty:title-change` | `{sessionId: string, title: string}` | OSC 0/2 标题变更 |
| `session:created` | `SessionInfo` | 新会话创建成功 |
| `session:closed` | `{sessionId: string}` | 会话已关闭 |
| `ssh:status` | `{sessionId: string, status: 'connecting'\|'connected'\|'error', error?: string}` | SSH 连接状态变更 |
| `ai:response` | `{sessionId: string, chunk: string}` | AI 流式回复 |
| `app:menu-action` | `{action: string}` | 原生菜单点击 |

### 渲染进程 → 主进程

| 通道 | 负载类型 | 触发时机 |
|------|---------|---------|
| `pty:create` | `{shell?: string, cwd?: string, cols: number, rows: number}` | 创建新 Shell 会话 |
| `pty:write` | `{sessionId: string, data: Uint8Array}` | 用户输入（高频） |
| `pty:resize` | `{sessionId: string, cols: number, rows: number}` | 窗口/容器大小变更 |
| `pty:close` | `{sessionId: string}` | 关闭会话 |
| `ssh:connect` | `{host, port, username, privateKey?, agent?}` | 发起 SSH 连接 |
| `ai:chat` | `{messages: Message[], model?: string}` | 发起 AI 对话 |
| `ai:abort` | `{}` | 取消当前 AI 请求 |
| `settings:save` | `Partial<AppSettings>` | 保存设置 |

### MessagePort 二进制通道（高频 I/O 专用）

不经过 JSON 序列化，直接传输 ArrayBuffer：
```
pty:write  →  [4字节 sessionId长度][N字节 UTF-8 sessionId][剩余: 原始终端输入字节]
pty:output ←  [4字节 sessionId长度][N字节 UTF-8 sessionId][剩余: 原始终端输出字节]
```

## 状态管理设计（Zustand）

```typescript
// src/renderer/stores/terminal-store.ts
interface TerminalStore {
  // 会话
  sessions: Map<string, SessionInfo>;
  activeSessionId: string | null;
  // 富输出
  richOutputs: Map<string, RichOutputItem[]>;  // sessionId → outputs
  // 终端设置
  fontSize: number;
  fontFamily: string;
  theme: 'dark' | 'light';
  // AI
  aiMessages: Message[];
  aiStreaming: boolean;
  // UI 状态
  sidebarOpen: boolean;
  outputPanelHeight: number;
  // Actions
  addSession: (session: SessionInfo) => void;
  removeSession: (id: string) => void;
  setActive: (id: string) => void;
  appendOutput: (sessionId: string, output: RichOutputItem) => void;
  addAIMessage: (msg: Message) => void;
  setAIStreaming: (v: boolean) => void;
}
```

## 自定义 xterm.js 插件设计（RichContentAddon）

```
src/renderer/services/rich-content-addon.ts
```

实现 `ITerminalAddon` 接口：

```typescript
class RichContentAddon implements ITerminalAddon {
  private _terminal: Terminal | null = null;
  private _worker: Worker;
  private _pendingBlocks: Map<string, string> = new Map(); // 收集中的富内容块
  private _decorations: IDecoration[] = [];  // LRU 管理
  private _maxDecorations = 200;

  activate(terminal: Terminal): void {
    this._terminal = terminal;
    // 拦截 OSC 序列
    terminal.parser.registerOscHandler(6969, this._handleAIOsc.bind(this));
    // 监听写入以进行自动检测
    terminal.onWriteParsed(this._onWriteParsed.bind(this));
  }

  // 处理 AI OSC 序列
  private _handleAIOsc(data: string): boolean {
    // 解析 AI;LATEX;inline 或 AI;MARKDOWN 等
    // 如果是开始标记 → 开始收集
    // 如果是结束标记 → 提取完成，发送到 Worker
    return true; // 表示已处理，不显示原始序列
  }

  // 自动检测（无 OSC 标记的情况）
  private _onWriteParsed(): void {
    // 防抖 50ms
    // 获取可视区域行内容
    // 发送到 Worker 检测
  }

  // 接收 Worker 结果并创建 decoration
  private _applyRichContent(block: DetectedBlock): void {
    // 注册 marker
    // 注册 decoration
    // 超出上限则 LRU 淘汰
    // 同时写入 richOutputs store
  }

  dispose(): void {
    this._decorations.forEach(d => d.dispose());
    this._worker.terminate();
  }
}
```

## 设置/偏好 Schema

```typescript
interface AppSettings {
  // 终端
  terminal: {
    fontSize: number;           // 默认 14
    fontFamily: string;        // 默认 'JetBrains Mono, Menlo, monospace'
    cursorStyle: 'block' | 'underline' | 'bar';
    cursorBlink: boolean;
    scrollback: number;        // 默认 10000
    bellSound: boolean;
  };
  // 外观
  appearance: {
    theme: 'dark' | 'light' | 'high-contrast';
    opacity: number;           // 0.0 - 1.0，窗口透明度
    blur: boolean;             // 背景模糊（仅 macOS）
  };
  // 富内容
  richContent: {
    enableLatex: boolean;      // 默认 true
    enableMarkdown: boolean;   // 默认 true
    enableCodeHighlight: boolean; // 默认 true
    enableAutoDetect: boolean; // 自动检测（无 OSC 标记），默认 true
    maxDecorations: number;    // 默认 200
  };
  // AI
  ai: {
    apiKey: string;            // 加密存储于 keychain
    model: string;             // 默认 'claude-sonnet-5-20251001'
    maxContextLines: number;   // 发送给 AI 的终端上下文行数，默认 200
  };
  // SSH
  ssh: {
    savedConnections: SavedSSHConnection[];
    defaultUsername: string;
  };
}
```

## 错误处理策略

| 错误场景 | 处理方式 |
|---------|---------|
| PTY 进程崩溃 | 终端显示红色提示 `[进程已退出，code: N]`，保留输出内容，用户可按 Enter 重新启动 |
| SSH 连接失败 | 显示错误对话框，列出原因（认证失败/网络超时/主机不可达） |
| WebGL 不可用 | 自动降级到 Canvas 渲染器，状态栏显示 ⚠️ 图标 |
| KaTeX 渲染失败 | 在富输出面板显示原始 LaTeX 源码（灰色），不阻塞终端 |
| Shiki 不支持某语言 | 回退到纯文本显示，代码块仍保留但无高亮 |
| AI API 调用失败 | 在对话面板显示错误信息，允许重试 |
| IPC 消息丢失 | MessagePort 自带背压，主进程环形缓冲区兜底 |
| 磁盘空间不足（会话持久化） | 静默跳过持久化，日志记录警告 |
| 文件描述符耗尽（过多 PTY） | 限制最大 20 个并发会话，超出时提示用户 |

## 测试策略

| 层级 | 工具 | 覆盖内容 |
|------|------|---------|
| 单元测试 | Vitest | 共享类型序列化、OSC 协议解析器、content-detector 正则匹配、KaTeX/Marked 封装 |
| 组件测试 | @testing-library/react | TerminalTabs 交互、AIChatPanel 流式消息、RichOutput 渲染 |
| IPC 测试 | Vitest + Mock | pty-manager 会话生命周期、ssh-client 连接 mock |
| E2E | Playwright + Electron | 启动应用 → 创建 Shell → 输入命令 → 验证输出、LaTeX 渲染、SSH 连接 |
| 性能 | Electron DevTools | 内存快照对比、FPS 监控、CPU profile |
| 安全 | npm audit + 手写审计 | 依赖漏洞、IPC 隔离性 |

## 实现阶段（细化版）

### 第一阶段：核心终端（第 1-2 周）
**目标**：可用的 Electron 应用，本地 PTY + 标签管理

**具体任务**：
- [ ] `npm init` + 安装 Electron/Vite/React/TypeScript 依赖
- [ ] 配置 `vite.config.ts`（renderer 打包）、`tsconfig.json`（base + main + renderer 三个）
- [ ] 配置 `electron-builder.yml`（macOS .dmg / Windows .exe / Linux .AppImage）
- [ ] `src/main/index.ts`：创建 BrowserWindow、加载 Vite dev server / 打包文件
- [ ] `src/preload/index.ts`：`contextBridge.exposeInMainWorld('electronAPI', {...})`
- [ ] `src/shared/types.ts`：`SessionInfo`、`SessionType` 类型定义
- [ ] `src/shared/ipc-channels.ts`：所有 IPC 通道名常量
- [ ] `src/shared/backend-interface.ts`：`ISessionBackend` 接口
- [ ] `src/main/ipc-handlers.ts`：注册所有 `ipcMain.handle` 处理器
- [ ] `src/main/pty-manager.ts`：实现 `ISessionBackend`，node-pty spawn + MessagePort 转发
- [ ] `src/main/session-store.ts`：Map<string, Session> 内存存储
- [ ] `src/renderer/index.html` + `main.tsx` + `App.tsx`：React 挂载
- [ ] `src/renderer/components/terminal/TerminalView.tsx`：xterm.js 实例化，WebGL + Fit 插件，onData 绑定
- [ ] `src/renderer/components/terminal/TerminalTabs.tsx`：标签栏 UI
- [ ] `src/renderer/hooks/useTerminal.ts`：管理 xterm.js 生命周期
- [ ] `src/renderer/hooks/useSession.ts`：管理会话状态
- [ ] `src/renderer/stores/terminal-store.ts`：Zustand store
- [ ] `src/renderer/styles/themes/dark.css`：深色主题变量
- [ ] TAG v0.1.0：本地 Shell 可用，标签切换正常
- **里程碑**：`npm run dev` → Electron 窗口打开 → 显示 zsh/bash → 可输入命令

### 第二阶段：富内容渲染（第 2-3 周）
**目标**：LaTeX / 代码块 / Markdown 检测与渲染

**具体任务**：
- [ ] `src/shared/protocol.ts`：OSC 序列定义（AI;LATEX|MARKDOWN|CODE|IMAGE;params）
- [ ] `src/renderer/workers/content-worker.ts`：Web Worker 入口
- [ ] `src/renderer/services/content-detector.ts`：正则扫描（LaTeX/MD/代码块/URL）
- [ ] `src/renderer/services/rich-content-addon.ts`：自定义 xterm.js 插件（上文详述）
- [ ] `src/renderer/services/rendering-pipeline.ts`：Worker ↔ 主线程协调
- [ ] `src/renderer/components/output/RichOutput.tsx`：富输出面板容器
- [ ] `src/renderer/components/output/LatexRenderer.tsx`：KaTeX 封装（含错误边界）
- [ ] `src/renderer/components/output/MarkdownRenderer.tsx`：marked + React 渲染
- [ ] `src/renderer/components/output/CodeBlock.tsx`：Shiki 包装（含复制按钮）
- [ ] KaTeX CSS 导入 + Shiki 主题预编译脚本
- [ ] iTerm2 内联图片协议（OSC 1337）解析器
- [ ] 终端滚动时 decoration 回收/重建逻辑
- [ ] TAG v0.2.0：富内容渲染可用
- **里程碑**：`echo '$$E=mc^2$$'` → 终端内渲染为公式

### 第三阶段：AI 集成（第 3-4 周）
**目标**：内嵌 AI 对话面板、命令建议、SDK

**具体任务**：
- [ ] `src/main/ai-bridge.ts`：封装 @anthropic-ai/sdk，流式响应→ IPC 转发
- [ ] `src/renderer/services/ai-client.ts`：渲染进程 AI 客户端
- [ ] `src/renderer/components/ai/AIChatPanel.tsx`：对话 UI（消息列表 + 输入框）
- [ ] `src/renderer/components/ai/CommandSuggest.tsx`：内联命令建议（幽灵文本）
- [ ] `src/renderer/components/ai/ContextBar.tsx`：显示当前 AI 上下文行数
- [ ] `src/renderer/hooks/useAI.ts`：AI 状态管理 hook
- [ ] AI 流式回复中的 Markdown/LaTeX 实时渲染
- [ ] 设置页（API Key 配置、模型选择）
- [ ] `sdk/index.ts`：SDK 公开 API（`TerminalSDK` 类）
- [ ] `sdk/terminal-protocol.ts`：OSC 序列构建器
- [ ] `sdk/examples/claude-code-usage.ts`：Claude Code hook 集成示例
- [ ] TAG v0.3.0：AI 功能可用
- **里程碑**：打开 AI 面板 → 提问 → 回复以富渲染展示

### 第四阶段：远程与高级功能（第 4-5 周）
**目标**：SSH 连接、会话持久化、分屏

**具体任务**：
- [ ] `src/main/ssh-client.ts`：ssh2 封装，连接池管理
- [ ] SSH 连接设置 UI（主机、端口、密钥/密码、保存连接）
- [ ] `src/main/session-store.ts`：磁盘持久化（`~/.ai-terminal/sessions.json`）
- [ ] 应用启动时自动恢复上次会话
- [ ] 分屏组件（Golden Layout 或自建），无限嵌套分屏
- [ ] `src/renderer/components/terminal/SearchBar.tsx`：xterm search addon 封装
- [ ] 原生菜单栏（文件/编辑/查看/终端/帮助）+ 快捷键
- [ ] 系统托盘（可选）
- [ ] 全局快捷键（Ctrl+` 显示/隐藏窗口）
- [ ] TAG v0.4.0：完整终端功能
- **里程碑**：SSH 可用、会话持久化、分屏流畅

### 第五阶段：打包与发布（第 5-6 周）
**目标**：生产级分发

**具体任务**：
- [ ] `electron-builder.yml` 最终配置（代码签名、公证、自动更新 feed URL）
- [ ] macOS 公证（notarization）+ Windows 代码签名
- [ ] electron-updater 集成（检查更新 → 下载 → 安装）
- [ ] 错误上报（Sentry 或自定义日志收集）
- [ ] 启动性能调优（快照 V8 context、延迟加载非关键模块）
- [ ] 内存调优（减少 decoration 泄漏、xterm dispose 验证）
- [ ] `README.md`：项目介绍、安装指南、开发指南
- [ ] `sdk/README.md`：SDK API 文档、集成示例
- [ ] 用户文档：功能介绍、快捷键列表、SSH 配置指南
- [ ] TAG v1.0.0：正式发布
- **里程碑**：三平台安装包可下载，文档完备

## AI SDK 设计

AI 工具通过 OSC 转义序列控制终端渲染。SDK 封装这些序列为简洁 API：

```typescript
import { TerminalSDK } from '@ai-terminal/sdk';

const term = new TerminalSDK();

// 渲染 LaTeX
await term.render({ type: 'latex', content: 'E = mc^2', display: 'inline' });

// 渲染 Markdown
await term.render({ type: 'markdown', content: '# 结果\n通过 **95%**' });

// 渲染语法高亮代码
await term.render({ type: 'code', language: 'python', content: 'def f(): ...' });

// 渲染图片
await term.render({ type: 'image', data: buffer, format: 'png' });
```

**传输**：SDK 将内容序列化为 OSC 转义序列写入 stdout，终端自动拦截并渲染。零网络依赖。
Claude Code 集成：通过 hook 系统管道输出，自动检测并升级为富渲染。

## 性能分析与优化

### 性能目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 输入延迟 | <16ms（60fps） | 按键到屏幕回显 |
| 输出吞吐 | >10MB/s | `cat` 大文件场景 |
| 富渲染延迟 | <50ms | 检测到 DOM 注入完成 |
| 空闲内存 | <100MB | 单标签页无输出 |
| 活跃内存 | <300MB | 10 个标签页 |
| 冷启动 | <2s | 应用启动到可交互 |
| 安装包 | <150MB（macOS .dmg） | 压缩后 |

### 瓶颈与对策

#### 瓶颈 1：Electron 基线开销（~150MB / ~150MB 磁盘）

Electron 内嵌 Chromium，基线偏高，但换来的是 node-pty/ssh2/AI SDK 的完整 Node.js 生态。
对于开发工具类应用，这个开销在可接受范围内（VS Code、Figma、Slack 均同级别）。

**优化**：
- `contextIsolation: true`、`sandbox: true` 减少内存碎片
- `backgroundThrottling` 非活跃窗口降低资源消耗
- 多窗口共享渲染进程，减少重复加载

**可迁移性保障**：PTY/IPC 层已通过 `ISessionBackend` 接口抽象，如果后续对内存有极致要求，
可编写 Tauri 实现（Rust `portable-pty` + Tauri IPC）替换，前端零改动。

#### 瓶颈 2：大量输出渲染（>10k 行）

xterm.js WebGL 渲染器在 1 万行内流畅，超出后性能下降。

**优化**：
- 回滚缓冲区 10k 行上限，超出转入二级数组缓冲区
- 可视区域 ±100 行才实际渲染，其余懒加载
- 快速输出时（如 `cat`）按 60fps 批量写入，不逐字节推送
- 内容检测放 Web Worker，不阻塞主线程

#### 瓶颈 3：多标签页

10 个活跃 PTY 同时输出时的资源分配。

**优化**：
- 非活跃标签页的 xterm.js 暂停渲染 + 暂停 stdin
- 主进程环形缓冲区暂存非活跃会话输出（1MB/session 上限），切回时回放
- `requestIdleCallback` 空闲时处理后台任务

### 性能验证

1. `time cat /dev/zero | head -c 100M` → 测量吞吐
2. 10 标签页同时 `yes` → 监控 FPS + 内存
3. 1000 行含 `$...$` 公式的输出 → 测量渲染延迟
4. 运行 Claude Code 完成编程任务 → 端到端体验

## 实现阶段

### 第一阶段：核心终端（第 1-2 周）
**目标**：可用的 Electron 应用，本地 PTY + 标签管理
- [ ] 项目脚手架（Electron + Vite + React + TypeScript）
- [ ] preload 脚本 + contextBridge API
- [ ] PTY 管理器（node-pty spawn shell + 二进制 IPC）
- [ ] xterm.js 渲染（WebGL + fit 插件）
- [ ] 终端标签栏
- [ ] 基础主题
- **里程碑**：打开应用即可使用本地 Shell

### 第二阶段：富内容渲染（第 2-3 周）
**目标**：LaTeX / 代码块 / Markdown 检测与渲染
- [ ] Web Worker 内容检测服务
- [ ] 富输出面板组件
- [ ] KaTeX 集成 + LRU 缓存
- [ ] Shiki 集成（构建时预编译主题）
- [ ] Markdown 渲染器（marked）
- [ ] OSC 转义序列解析器
- [ ] iTerm2 内联图片协议
- **里程碑**：终端自动检测并渲染富内容

### 第三阶段：AI 集成（第 3-4 周）
**目标**：内嵌 AI 对话面板、命令建议、SDK
- [ ] AI 对话面板（Claude API 流式对话 UI）
- [ ] 命令建议栏（基于终端上下文）
- [ ] AI SDK 包（`@ai-terminal/sdk`）
- [ ] Claude Code 集成示例
- **里程碑**：AI 功能可用，SDK 可被外部工具调用

### 第四阶段：远程与高级功能（第 4-5 周）
**目标**：SSH 连接、会话持久化、分屏
- [ ] SSH 客户端（ssh2 + 连接管理器）
- [ ] 会话持久化（磁盘存取）
- [ ] 分屏（水平/垂直）
- [ ] 终端内搜索
- **里程碑**：完整远程能力，日常可用的终端

### 第五阶段：打包与发布（第 5-6 周）
**目标**：生产级分发
- [ ] electron-builder 三平台打包
- [ ] 自动更新
- [ ] 性能调优
- [ ] 文档（用户指南 + SDK 文档）
- **里程碑**：可下载安装，文档完备

## 验证方案

1. **第一阶段**：启动应用 → `ls`、`cd`、`vim`、`htop` 均正常。
2. **第二阶段**：`echo '$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$'` → 终端内渲染为公式。
3. **第三阶段**：打开 AI 面板 → 提问 → 回复含 LaTeX/代码块的富渲染。
   Claude Code 在终端中运行 → 输出自动检测渲染。
4. **第四阶段**：SSH 连接远程服务器 → 终端正常使用。分屏打开两个会话。
5. **第五阶段**：`npm run package` → 产出 `.dmg`/`.exe`/`.AppImage`。安装运行正常。
