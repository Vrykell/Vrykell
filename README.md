# AI Terminal

面向 AI 时代的桌面终端模拟器 — 支持 LaTeX/Markdown/代码高亮渲染，内嵌 AI 对话面板。

**技术栈**: Tauri v2 + Rust (portable-pty) + React 18 + TypeScript + 自研 DOM 终端 + KaTeX + Shiki + Zustand

**平台**: macOS / Windows / Linux

## 开发状态

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 1 — 核心终端 | ✅ 完成 | 本地 PTY、多标签页、自研 DOM 终端（结构化事件流）、i18n、关闭确认对话框、纯黑主题 |
| Phase 2 — 富内容渲染 | 🚧 开发中 | LaTeX/Markdown/代码高亮检测与渲染（RichOutput 面板） |
| Phase 3 — AI 集成 | ⏳ 待开始 | Claude API 对话面板、命令建议 |
| Phase 4 — 远程功能 | ⏳ 待开始 | SSH 连接、会话持久化、分屏 |
| Phase 5 — 打包发布 | ⏳ 待开始 | 三平台安装包、自动更新 |

## 快速开始

```bash
# 安装前端依赖
npm install

# 开发模式（Rust 编译 + Vite HMR + 窗口）
npm run dev

# 生产构建
npm run build
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | Tauri 开发模式（Rust 编译 + Vite HMR + 窗口） |
| `npm run dev:renderer` | 仅启动 Vite 前端开发服务器 |
| `npm run build` | 生产构建（前端 + Tauri 安装包） |
| `npm run build:renderer` | 仅构建前端产物 |
| `npm test` | Vitest 单元/组件测试 |
| `npm run test:watch` | Vitest 监听模式 |
| `npm run test:rust` | Rust 后端测试 (cargo test) |
| `npm run test:e2e` | Playwright E2E 测试 |
| `npm run test:all` | 全部测试（TS + Rust + E2E） |

## 项目结构

```
src-tauri/             # Rust 后端 (portable-pty + tokio)
  └── src/
      ├── main.rs              # Tauri 入口
      ├── lib.rs               # 命令注册 + Builder 配置
      ├── pty.rs               # PTY 管理器（spawn/写入/读取/resize/强制终止）
      ├── session.rs           # 会话存储
      ├── commands.rs          # Tauri IPC 命令（8 个）
      ├── settings.rs          # 应用设置持久化（app_data_dir）
      └── terminal_parser.rs   # ANSI 解析器 → 结构化 TerminalEvent

src/
├── api/               # Tauri invoke/listen 桥接
├── renderer/          # React 前端
│   ├── terminal/      # 自研 DOM 终端（buffer.ts 缓冲, useDomTerminal.ts 输入/渲染,
│   │                  #   TerminalView.tsx 虚拟滚动视图）
│   ├── components/    # terminal/ output/ ai/ layout/ common(ConfirmDialog)
│   ├── hooks/         # useRichContent
│   ├── i18n/          # 中英文案 (en/zh)
│   ├── services/      # content-detector
│   ├── stores/        # Zustand store
│   └── styles/        # global.css（CSS 变量主题）
├── shared/            # 类型定义, 富内容协议, TerminalEvent 类型
└── test/              # fake-tauri 测试桩、测试 setup

e2e/                   # Playwright E2E（含真实 Claude 进程 resize 集成测试）
scripts/               # capture-resize.mjs 等调试脚本
docs/                  # 文档
```

## 架构要点

- **后端 (Rust)**: `portable-pty` 管理 PTY 进程；`terminal_parser.rs` 在 Rust 侧把 ANSI 字节流解析为**结构化终端事件**（`TerminalEvent`），通过 `app_handle.emit("pty:output", …)` 批量推送前端
- **前端 (React)**: 自研 DOM 终端 — `TerminalBuffer` 维护单元格网格，`useDomTerminal` 处理键盘/IME 输入，`DomTerminalView` 虚拟滚动渲染；KaTeX/Shiki/marked 富内容渲染
- **IPC**: Tauri invoke（8 个命令）+ event 推送（`pty:output` / `pty:exit` / `pty:title-change` / `session:*`）
- **状态管理**: Zustand store（sessions, richOutputs, settings, aiMessages）
- **内容检测**: 双层策略 — OSC 转义序列显式标记 + 正则自动检测

## 文档

- [文档首页](docs/index.md) — 完整文档索引
- [完整实现计划](docs/plan.md) — 架构设计、技术决策、IPC 协议、5 阶段计划
- [Phase 1 报告](docs/phases/phase-1-tauri-core.md) · [Phase 2 报告](docs/phases/phase-2-rich-content.md)
