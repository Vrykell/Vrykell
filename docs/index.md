# AI Terminal — 项目文档

面向 AI 时代的桌面终端模拟器。支持 LaTeX/Markdown/代码高亮渲染，内嵌 AI 对话面板。

**技术栈**: Electron 28 + React 18 + TypeScript + xterm.js 5 + KaTeX + Shiki + marked + Zustand

**平台**: macOS / Windows / Linux

---

## 文档索引

### 总体规划
- [完整实现计划](plan.md) — 5 阶段实现计划，架构设计，技术决策

### 各阶段报告
| 阶段 | 文件 | 状态 |
|------|------|------|
| Phase 1 — 核心终端 | [phase-1-core-terminal.md](phases/phase-1-core-terminal.md) | ⚠️ 代码完成，Electron require 阻塞级 Bug（影响 28~32） |
| Phase 2 — 富内容渲染 | [phase-2-rich-content.md](phases/phase-2-rich-content.md) | 🚧 核心检测+渲染完成，in-terminal decorations 待开发 |
| Phase 3 — AI 集成 | — | ⏳ 计划中 |
| Phase 4 — 远程功能 | — | ⏳ 计划中 |
| Phase 5 — 打包发布 | — | ⏳ 计划中 |

### 参考资料
- [代码审查报告 2026-07-20](reference/code-review-2026-07-20.md) — 全面代码审查，含 Bug 清单和重构建议
- [Electron require 问题详解](reference/electron-require-issue.md) — 根因、版本对比、调试记录
- [模块解析深度分析](reference/module-resolution-deep-dive.md) — 入口链、包装器演进、文件职责、代码规范
- [项目记忆](reference/project-memory.md)
- [会话上下文](reference/session-context.md)

---

## 快速开始

```bash
cd ~/ai-terminal
npm install
npm run dev:main     # 编译主进程
npm run dev:renderer # 启动 Vite dev server
npm start            # 启动 Electron
```

## 项目结构

```
ai-terminal/
├── src/
│   ├── main/         # Electron 主进程（PTY, IPC, 窗口管理）
│   ├── preload/      # contextBridge 安全 API
│   ├── renderer/     # React UI（xterm.js 终端, 组件, store）
│   ├── shared/       # 共享类型, IPC 通道, 协议定义
│   └── sdk/          # AI 工具集成 SDK（Phase 3）
├── docs/             # 本文档目录
└── dist/             # 编译输出
```
