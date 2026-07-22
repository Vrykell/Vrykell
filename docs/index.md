# AI Terminal — 项目文档

面向 AI 时代的桌面终端模拟器。支持 LaTeX/Markdown/代码高亮渲染，内嵌 AI 对话面板。

**技术栈**: Tauri v2 (Rust + portable-pty) + React 18 + TypeScript + 自研 DOM 终端 + KaTeX + Shiki + Zustand

**平台**: macOS / Windows / Linux

---

## 文档索引

### 总体规划
- [完整实现计划](plan.md) — 架构设计、技术决策、数据流、IPC 协议、5 阶段计划

### 各阶段报告
| 阶段 | 文件 | 状态 |
|------|------|------|
| Phase 1 — 核心终端 | [phase-1-tauri-core.md](phases/phase-1-tauri-core.md) | 🚧 Rust 编译通过，待运行时验证 |
| Phase 2 — 富内容渲染 | [phase-2-rich-content.md](phases/phase-2-rich-content.md) | 🚧 核心检测+渲染完成 |
| Phase 3 — AI 集成 | — | ⏳ 计划中 |
| Phase 4 — 远程功能 | — | ⏳ 计划中 |
| Phase 5 — 打包发布 | — | ⏳ 计划中 |

---

## 快速开始

```bash
npm install           # 前端依赖
cargo tauri dev       # 开发模式（Rust 编译 + Vite HMR + 窗口）
cargo tauri build     # 生产构建
```

## 项目结构

```
ai-terminal/
├── src-tauri/            # Rust 后端 (portable-pty + Tauri IPC)
│   └── src/              # pty.rs, session.rs, commands.rs
├── src/
│   ├── api/              # Tauri invoke/listen 桥接
│   ├── renderer/         # React 前端 (xterm.js, KaTeX, Shiki)
│   │   ├── components/   # terminal, output, ai, layout
│   │   ├── hooks/        # useTerminal, useRichContent
│   │   ├── services/     # content-detector
│   │   └── stores/       # Zustand store
│   └── shared/           # 类型, IPC 通道, 协议, 接口
└── docs/                 # 文档
```

## 架构要点

- **后端 (Rust)**: `portable-pty` 管理 PTY 进程，`#[tauri::command]` 暴露 IPC
- **前端 (React)**: xterm.js DOM 渲染器，KaTeX/Shiki/marked 富内容渲染
- **IPC**: Tauri invoke (请求-响应) + event emit/listen (服务端推送)
- **状态管理**: Zustand store (sessions, richOutputs, settings, aiMessages)
- **内容检测**: 双层策略 — OSC 转义序列显式标记 + 正则自动检测
