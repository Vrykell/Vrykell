# AI Terminal

面向 AI 时代的桌面终端模拟器 — 支持 LaTeX/Markdown/代码高亮渲染，内嵌 AI 对话面板。

**技术栈**: Tauri v2 + Rust + React 18 + TypeScript + xterm.js 5 + KaTeX + Shiki + Zustand

**平台**: macOS / Windows / Linux

## 开发状态

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 1 — 核心终端 | 🚧 Tauri 迁移完成 | 本地 PTY、标签页、Rust 后端编译通过 ✅ |
| Phase 2 — 富内容渲染 | 🚧 开发中 | LaTeX/Markdown/代码高亮检测与渲染 |
| Phase 3 — AI 集成 | ⏳ 待开始 | Claude API 对话面板、命令建议 |
| Phase 4 — 远程功能 | ⏳ 待开始 | SSH 连接、会话持久化、分屏 |
| Phase 5 — 打包发布 | ⏳ 待开始 | 三平台安装包、自动更新 |

## 快速开始

```bash
# 安装前端依赖
npm install

# 开发模式（Rust 编译 + Vite HMR + 窗口）
cargo tauri dev

# 生产构建
cargo tauri build
```

## 项目结构

```
src-tauri/         # Rust 后端 (portable-pty + tokio)
  └── src/
      ├── pty.rs        # PTY 管理器
      ├── session.rs    # 会话存储
      └── commands.rs   # Tauri IPC 命令

src/
├── api/           # Tauri invoke/listen 桥接
├── renderer/      # React 前端 (xterm.js, KaTeX, Shiki)
│   ├── components/ # terminal/ output/ ai/ layout/
│   ├── hooks/      # useTerminal, useRichContent
│   ├── services/   # content-detector
│   └── stores/     # Zustand store
└── shared/        # 类型定义, IPC 通道, 富内容协议
```

## 文档

- [文档首页](docs/index.md)
- [Phase 1 (Tauri)](docs/phases/phase-1-tauri-core.md)
- [迁移计划](~/.claude/plans/plan-md-swift-brook.md)
