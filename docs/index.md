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
| Phase 1 — 核心终端 | [phase-1-tauri-core.md](phases/phase-1-tauri-core.md) | ✅ 完成（含自研 DOM 终端重写与后续修复） |
| Phase 2 — 富内容渲染 | [phase-2-rich-content.md](phases/phase-2-rich-content.md) | 🚧 核心检测+渲染完成 |
| Phase 3 — AI 集成 | — | ⏳ 计划中 |
| Phase 4 — 远程功能 | — | ⏳ 计划中 |
| Phase 5 — 打包发布 | — | ⏳ 计划中 |

### 架构与重构
| 文档 | 说明 | 状态 |
|------|------|------|
| [架构文档](architecture.md) | 总体架构、模块职责、数据流、IPC 契约、扩展路线图 | ✅ 已发布 |
| [项目结构重构方案](refactor/structure-proposal.md) | 零代码改动的目录/模块重构计划与迁移路径 | ✅ 已发布 |

### 专题设计文档（superpowers）
| 文档 | 说明 | 状态 |
|------|------|------|
| [tab-close-and-terminal-theme 设计](superpowers/specs/2026-07-24-tab-close-and-terminal-theme-design.md) | 关闭标签确认对话框 + 强制终止子进程 + 纯黑终端主题 | ✅ 已实现 |
| [tab-close-and-terminal-theme 实施计划](superpowers/plans/2026-07-24-tab-close-and-terminal-theme.md) | 上述设计的任务拆解 | ✅ 已执行 |

---

## 快速开始

```bash
npm install           # 前端依赖
npm run dev           # 开发模式（cargo tauri dev：Rust 编译 + Vite HMR + 窗口）
npm run build         # 生产构建
npm test              # Vitest 单元/组件测试
npm run test:rust     # Rust 后端测试
npm run test:e2e      # Playwright E2E
```

## 项目结构

```
ai-terminal/
├── src-tauri/            # Rust 后端 (portable-pty + Tauri IPC)
│   └── src/              # pty.rs, session.rs, commands.rs, settings.rs,
│                         # terminal_parser.rs (ANSI → 结构化 TerminalEvent)
├── src/
│   ├── api/              # Tauri invoke/listen 桥接
│   ├── renderer/         # React 前端
│   │   ├── terminal/     # 自研 DOM 终端: buffer.ts / useDomTerminal.ts / TerminalView.tsx
│   │   ├── components/   # terminal, output, ai, layout, common(ConfirmDialog)
│   │   ├── hooks/        # useRichContent
│   │   ├── i18n/         # 中英文案 (en/zh)
│   │   ├── services/     # content-detector
│   │   └── stores/       # Zustand store
│   ├── shared/           # 类型, 富内容协议, TerminalEvent 类型
│   └── test/             # fake-tauri 测试桩
├── e2e/                  # Playwright E2E 测试
└── docs/                 # 文档
```

## 架构要点

- **后端 (Rust)**: `portable-pty` 管理 PTY 进程；`terminal_parser.rs` 将 ANSI 字节流解析为**结构化终端事件**（`TerminalEvent`，serde 序列化为 `{t, p}`），经 `pty:output` 事件批量推送；关闭会话时强制 `child.kill()` 终止前台程序
- **前端 (React)**: 自研 DOM 终端 — `TerminalBuffer` 单元格网格 + auto-wrap/CJK 宽字符处理；`useDomTerminal` 键盘与 IME 输入；`DomTerminalView` 虚拟滚动渲染；KaTeX/Shiki/marked 富内容渲染
- **IPC**: Tauri invoke（8 个命令：create/write/resize/close/list_pty + load/save_settings + exit_app）+ event 推送
- **状态管理**: Zustand store (sessions, richOutputs, settings, aiMessages)
- **内容检测**: 双层策略 — OSC 转义序列显式标记 + 正则自动检测
- **主题**: 纯黑背景 `#000000` + 亮白前景 `#f0f0f0`，CSS 变量驱动（`--terminal-bg` 等）
- **i18n**: 中/英文案（`src/renderer/i18n/`），含关闭标签/退出确认对话框文案
