# Phase 1: 核心终端 — 完成报告

**日期**: 2026-07-20
**状态**: ⚠️ 源代码完成并编译通过，Electron `require('electron')` 返回路径字符串 Bug 阻塞运行
**已测试版本**: Electron 28.3.3, 30.0.0, 32.3.3 — **全部受影响**
**版本**: v0.1.0

---

## 目标

构建一个可用的 Electron 桌面终端应用，支持本地 PTY Shell 和多标签页管理。

---

## 完整文件清单

### 项目配置（6 个文件）

| 文件 | 用途 |
|------|------|
| `package.json` | 项目元信息、依赖声明（22 个包）、构建脚本 |
| `tsconfig.base.json` | 共享 TypeScript 编译选项（ES2022, strict） |
| `tsconfig.main.json` | 主进程/Preload 编译配置（CommonJS, Node） |
| `tsconfig.json` | 渲染进程编译配置（JSX, DOM, Vite） |
| `vite.config.ts` | Vite 构建配置（root: `src/renderer`, React 插件） |
| `electron-builder.yml` | Electron 打包配置（macOS .dmg / Windows .exe / Linux .AppImage） |

### Shared 共享层（4 个文件）

| 文件 | 导出内容 |
|------|---------|
| `src/shared/types.ts` | `SessionInfo`, `SessionType`, `SessionOptions`, `SSHConnectOptions`, `SavedSSHConnection`, `RichContentType`, `DetectedBlock`, `RichOutputItem`, `Message`, `AppSettings`, `DEFAULT_SETTINGS` |
| `src/shared/ipc-channels.ts` | 15 个 IPC 通道名常量（`pty:output`, `pty:create`, `pty:write` 等） |
| `src/shared/backend-interface.ts` | `ISessionBackend` 接口（6 个方法 + 3 个事件回调）—— 抽象 PTY/IPC 层，支持未来 Tauri 迁移 |
| `src/shared/protocol.ts` | OSC 协议：`buildStartMarker()`, `END_MARKER`, `wrapWithMarkers()`, `parseMarker()` |

### Main 主进程（7 个文件）

| 文件 | 功能 |
|------|------|
| `src/main/index.ts` | Electron 入口：BrowserWindow 创建（1200×800）、macOS hiddenInset 标题栏、原生菜单栏（File/Edit/View/Terminal/Help）、窗口管理、应用生命周期 |
| `src/main/pty-manager.ts` | PTY 管理器：node-pty spawn shell、I/O 转发（EventEmitter）、进程退出检测、OSC 标题变更检测、resize、最大 20 并发会话 |
| `src/main/ipc-handlers.ts` | IPC 处理器：注册所有 PTY（create/write/resize/close）、SSH（connect）、AI（chat/abort）、Settings（load/save）的 IPC 处理器 |
| `src/main/session-store.ts` | 会话存储：内存 Map<string, SessionInfo>（Phase 4 将添加磁盘持久化到 `~/.ai-terminal/sessions.json`） |
| `src/main/ai-bridge.ts` | AI 桥接（Phase 3 占位）：Claude API 流式响应框架（EventEmitter），`configure()` / `chat()` / `abort()` |
| `src/main/ssh-client.ts` | SSH 客户端（Phase 4 占位）：ssh2 连接框架（EventEmitter），`connect()` |
| `src/main/electron-prelude.ts` | Electron API 预加载补丁：尝试修补 `Module._resolveFilename` 以解决 `require('electron')` 返回路径字符串的问题 |

### Preload 脚本（1 个文件）

| 文件 | 功能 |
|------|------|
| `src/preload/index.ts` | `contextBridge.exposeInMainWorld('electronAPI', {...})` — 8 个方法（createPTY, writeToPTY, resizePTY, closePTY, connectSSH, sendAIChat, abortAI, loadSettings, saveSettings）+ 8 个事件监听器（onPTYOutput, onPTYExit, onPTYTitleChange, onSessionCreated, onSessionClosed, onSSHStatus, onAIResponse, onMenuAction），每个返回 cleanup 函数 |

### Renderer 渲染进程（10 个文件）

| 文件 | 功能 |
|------|------|
| `src/renderer/index.html` | HTML 入口，CSP 安全策略 |
| `src/renderer/main.tsx` | React 入口：`createRoot` 挂载 `<App />`（StrictMode） |
| `src/renderer/App.tsx` | 根组件：布局（标签栏 + 终端 + 富输出 + AI 面板 + 状态栏）、IPC 事件监听、键盘快捷键（Cmd+T/W/J）、自动创建首会话 |
| `src/renderer/components/terminal/TerminalView.tsx` | xterm.js 封装组件：容器 ref 传递、useTerminal hook |
| `src/renderer/components/terminal/TerminalTabs.tsx` | 标签栏：会话列表、添加/切换/关闭、SSH/Local 图标区分 |
| `src/renderer/components/output/RichOutput.tsx` | 富输出面板（Phase 2 占位）：显示 detected blocks 列表，类型标签 |
| `src/renderer/components/ai/AIChatPanel.tsx` | AI 对话面板（Phase 3 占位）：侧边栏切换、占位 UI |
| `src/renderer/components/layout/StatusBar.tsx` | 状态栏：版本号、会话类型、终端尺寸（cols×rows）、会话计数 |
| `src/renderer/stores/terminal-store.ts` | Zustand store：sessions, richOutputs, settings, aiMessages, aiStreaming, sidebarOpen, outputPanelHeight + 所有 actions |
| `src/renderer/hooks/useTerminal.ts` | xterm.js 生命周期 Hook：WebGL/Fit/Search/Unicode11 插件、PTY I/O 绑定（onData → writeToPTY, pty:output → term.write）、resize 同步、ResizeObserver、WebGL 降级到 DOM 渲染器 |
| `src/renderer/styles/global.css` | 全局样式：box-sizing, 滚动条（8px, #424242）, xterm-viewport 滚动条覆盖, macOS 拖拽区域 |
| `src/renderer/global.d.ts` | `Window.electronAPI` 类型声明 |

---

## 完整 IPC 协议

### 主进程 → 渲染进程（8 个通道）

| 通道 | 负载类型 | 触发时机 |
|------|---------|---------|
| `pty:output` | `{sessionId: string, data: ArrayBuffer}` | Shell 有 stdout/stderr 输出（高频，~60fps） |
| `pty:exit` | `{sessionId: string, exitCode: number}` | Shell 进程退出 |
| `pty:title-change` | `{sessionId: string, title: string}` | OSC 0/2 标题变更 |
| `session:created` | `SessionInfo` | 新会话创建成功 |
| `session:closed` | `{sessionId: string}` | 会话已关闭 |
| `ssh:status` | `{sessionId: string, status: 'connecting'\|'connected'\|'error', error?: string}` | SSH 连接状态变更 |
| `ai:response` | `{sessionId: string, chunk: string}` | AI 流式回复 |
| `app:menu-action` | `{action: string}` | 原生菜单点击 |

### 渲染进程 → 主进程（9 个通道）

| 通道 | 负载类型 | 触发时机 |
|------|---------|---------|
| `pty:create` | `{shell?: string, cwd?: string, cols: number, rows: number}` | 创建新 Shell 会话 |
| `pty:write` | `{sessionId: string, data: Uint8Array}` | 用户输入（高频按键） |
| `pty:resize` | `{sessionId: string, cols: number, rows: number}` | 窗口/容器大小变更 |
| `pty:close` | `{sessionId: string}` | 关闭会话 |
| `ssh:connect` | `{host, port, username, privateKey?, agent?}` | 发起 SSH 连接 |
| `ai:chat` | `{messages: Message[], model?: string}` | 发起 AI 对话 |
| `ai:abort` | `{}` | 取消当前 AI 请求 |
| `settings:save` | `Partial<AppSettings>` | 保存设置 |
| `settings:load` | `—` | 加载设置 |

---

## 核心数据流

### 按键输入（以 `l` 为例）

```
用户按下 'l'
  → xterm.js: term.onData('l')
  → TerminalView: window.electronAPI.writeToPTY(sessionId, 'l')
  → Preload: ipcRenderer.send('pty:write', sessionId, buf)
  → Main: ptyManager.writeToSession(id, data)
  → node-pty: ptyProcess.write('l')
  → Shell: 回显 'l'
  → node-pty: onData → emit('output', id, Buffer)
  → Main: mainWindow.webContents.send('pty:output', {sessionId, data})
  → Preload: ipcRenderer.on handler
  → TerminalView: term.write(new Uint8Array(data))
  → xterm.js: WebGL 渲染器绘制到 Canvas
```

### 会话创建

```
App 挂载 / Cmd+T
  → window.electronAPI.createPTY({})
  → Preload: ipcRenderer.invoke('pty:create', opts)
  → Main: ptyManager.createSession(opts)
    → node-pty.spawn(shell, [], {name: 'xterm-256color', cols, rows, cwd, env})
    → 注册 onData / onExit 回调
  → Main: sessionStore.add(session)
  → Main: mainWindow.webContents.send('session:created', session)
  → Renderer: store.addSession(session)
  → TerminalView 挂载，useTerminal hook 绑定 onData/onPTYOutput
```

---

## 已安装依赖清单

### 生产依赖（13 个）

| 包名 | 版本 | 用途 |
|------|------|------|
| react | 18.3.1 | UI 框架 |
| react-dom | 18.3.1 | React DOM 渲染 |
| @xterm/xterm | 5.5.0 | 终端引擎 |
| @xterm/addon-webgl | 0.18.0 | WebGL 渲染器（~30% 性能提升） |
| @xterm/addon-fit | 0.10.0 | 自适应容器大小 |
| @xterm/addon-search | 0.15.0 | 终端内搜索 |
| @xterm/addon-unicode11 | 0.8.0 | Unicode 11 支持 |
| node-pty | 1.1.0 | 本地伪终端 |
| ssh2 | 1.17.0 | SSH 客户端（Phase 4） |
| katex | 0.16.47 | LaTeX 渲染（Phase 2） |
| shiki | 1.29.2 | 语法高亮（Phase 2） |
| marked | 12.0.2 | Markdown 解析（Phase 2） |
| zustand | 5.0.14 | 状态管理 |

### Dev 依赖（2 个）

| 包名 | 版本 | 用途 |
|------|------|------|
| electron | 28.3.3 | 桌面框架 |
| typescript | 5.4.0 | 类型检查 |
| vite | 5.4.0 | 渲染进程构建 |
| @vitejs/plugin-react | 4.3.0 | Vite React 插件 |
| @types/react | 18.3.0 | React 类型 |
| @types/react-dom | 18.3.0 | ReactDOM 类型 |

---

## 编译输出结构

```
dist/
├── main/
│   ├── main/
│   │   ├── index.js            # Electron 入口
│   │   ├── electron-prelude.js  # require('electron') 补丁
│   │   ├── pty-manager.js       # node-pty 管理器
│   │   ├── ipc-handlers.js      # IPC 处理器
│   │   ├── session-store.js     # 会话存储
│   │   ├── ai-bridge.js         # AI 桥接
│   │   └── ssh-client.js        # SSH 客户端
│   ├── preload/
│   │   └── index.js             # contextBridge 脚本
│   └── shared/
│       ├── types.js
│       ├── ipc-channels.js
│       ├── backend-interface.js
│       └── protocol.js
└── renderer/                    # Vite 构建输出
    ├── index.html
    └── assets/
```

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + T` | 新建本地终端标签 |
| `Cmd/Ctrl + W` | 关闭当前标签 |
| `Cmd/Ctrl + J` | 切换 AI 侧边栏 |
| `Cmd/Ctrl + Shift + N` | 新建窗口 |

---

## 已知问题

### Electron `require('electron')` 返回路径字符串（阻塞级 Bug）

**影响范围**: Electron 28.3.3 ~ 32.3.3（macOS 验证），可能更多版本
**现象**: `const { app } = require('electron')` → `TypeError: Cannot read properties of undefined (reading 'isPackaged')`

**根因**: npm `electron` 包的 `index.js` 在任何版本中都优先于 Electron 内置模块被解析。
- Electron 28: index.js 有运行时检测但失败
- Electron 30+: index.js 简化，直接返回二进制路径（无检测逻辑）

**已测试方案** (全部失败):
1. ❌ `Module._resolveFilename` 清空 parent.paths → `MODULE_NOT_FOUND`
2. ❌ ESM `import` / `createRequire` → 仍走 npm 包
3. ❌ `process._linkedBinding` → 返回功能标志，无 `app`/`BrowserWindow`
4. ❌ `require('electron/js2c/browser_init')` → SIGSEGV 崩溃
5. ❌ 移除 npm 包的 index.js → CJS 和 ESM 均 `MODULE_NOT_FOUND`
6. ❌ 换版本 (30.0.0, 32.3.3) → 同样问题
7. ❌ 新建最小 Electron 应用 → **同样失败**（非本项目特有）

**推荐方案**: 升级到 Electron 43+，官方 quick-start 模板确认可用。
详细分析见 [Electron require 问题](../../docs/reference/electron-require-issue.md) 和
[模块解析深度分析](../../docs/reference/module-resolution-deep-dive.md)。

### 其他

- `node-pty` 需要针对 Electron 版本重新编译（`electron-rebuild`），当前未安装此工具
- 窗口透明/模糊效果仅 macOS 支持，需检测 `process.platform`

---

## 下一阶段

### 阻塞问题

Electron 无法启动验证 — 参见"已知问题"和 [Electron require 问题详解](../reference/electron-require-issue.md)。

### Phase 2 可并行开发

Phase 2（富内容渲染）大部分代码不依赖 Electron 运行时：
- Web Worker 内容检测（正则扫描 LaTeX/Markdown/代码块）
- KaTeX / Shiki / marked 渲染器组件
- 渲染管线（Worker ↔ 主线程协调）
- 可用 `vitest` 单元测试验证，无需启动应用
