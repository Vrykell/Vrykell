# AI Terminal — 项目文档

面向 AI 时代的桌面终端模拟器。支持 LaTeX/Markdown/代码高亮渲染，内嵌 AI 对话面板。

**技术栈**: Tauri v2 + Rust + React 18 + TypeScript + xterm.js 5 + KaTeX + Shiki + Zustand

**平台**: macOS / Windows / Linux

---

## 文档索引

### 总体规划
- [迁移计划](~/.claude/plans/plan-md-swift-brook.md) — Electron → Tauri 迁移方案，5 阶段实现

### 各阶段报告
| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 — 核心终端 | 本地 PTY + 标签页 | 🚧 Tauri 迁移完成，待运行时验证 |
| Phase 2 — 富内容渲染 | LaTeX/Markdown/代码高亮 | 🚧 核心检测+渲染完成 |
| Phase 3 — AI 集成 | Claude API 对话面板 | ⏳ 计划中 |
| Phase 4 — 远程功能 | SSH + 会话持久化 + 分屏 | ⏳ 计划中 |
| Phase 5 — 打包发布 | 三平台安装包 + 自动更新 | ⏳ 计划中 |

---

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（启动 Rust 后端 + Vite dev server + 窗口）
cargo tauri dev

# 生产构建
cargo tauri build
```

## 项目结构

```
ai-terminal/
├── src-tauri/                # Rust 后端
│   ├── src/
│   │   ├── main.rs           # Tauri 入口
│   │   ├── lib.rs            # 命令注册 + Builder 配置
│   │   ├── pty.rs            # PTY 管理器 (portable-pty)
│   │   ├── session.rs        # 会话状态管理
│   │   └── commands.rs       # Tauri IPC 命令
│   ├── Cargo.toml
│   └── tauri.conf.json       # Tauri 窗口/安全/打包配置
│
├── src/
│   ├── api/                  # Tauri 桥接层
│   │   └── index.ts          # invoke/listen 封装
│   ├── renderer/             # React 前端
│   │   ├── components/       # terminal/ output/ ai/ layout/
│   │   ├── hooks/            # useTerminal, useRichContent
│   │   ├── services/         # content-detector
│   │   └── stores/           # Zustand store
│   └── shared/               # 共享类型 + IPC 通道 + 协议
│
├── docs/                     # 文档
├── package.json
├── tsconfig.json
└── vite.config.ts
```
