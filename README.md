# AI Terminal

面向 AI 时代的桌面终端模拟器 — 支持 LaTeX 渲染、Markdown 渲染、代码语法高亮，内嵌 AI 对话面板。

**技术栈**: Electron 28 + React 18 + TypeScript + xterm.js 5 + KaTeX + Shiki

**平台**: macOS / Windows / Linux

## 开发状态

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 1 — 核心终端 | ✅ 完成 | 本地 PTY、标签页、IPC 通信 |
| Phase 2 — 富内容渲染 | 🚧 开发中 | LaTeX/Markdown/代码高亮检测与渲染 |
| Phase 3 — AI 集成 | ⏳ 待开始 | Claude API 对话面板、命令建议、SDK |
| Phase 4 — 远程功能 | ⏳ 待开始 | SSH 连接、会话持久化、分屏 |
| Phase 5 — 打包发布 | ⏳ 待开始 | 三平台安装包、自动更新、文档 |

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev:main       # 编译主进程
npm run dev:renderer   # 启动 Vite dev server
npm start              # 启动 Electron

# 生产构建
npm run build
npm run package
```

## 项目结构

```
src/
├── main/          # Electron 主进程（PTY、IPC、窗口管理）
├── preload/       # contextBridge 安全 API
├── renderer/      # React UI（xterm.js 终端、组件）
├── shared/        # 共享类型、协议定义
└── sdk/           # AI 工具集成 SDK
```

## 文档

完整文档在 [`docs/`](docs/) 目录中：

- [文档首页](docs/index.md) — 完整索引
- [完整实现计划](docs/plan.md) — 5 阶段架构设计
- [Phase 1 完成报告](docs/phases/phase-1-core-terminal.md) — 详细文件清单、IPC 协议、数据流
- [Electron 28 兼容性问题](docs/reference/electron-require-issue.md) — 已知问题与解决方案
