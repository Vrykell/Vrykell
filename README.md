# AI Terminal (v2)

chat-first 终端。终端是主表面，每个命令渲染为一个**命令块（Block）**；AI 对话（Anthropic BYOK 直连）以内联面板显示在终端上方。

> v1 自研 DOM 终端已废弃并归档（`archive/v1-dom-terminal` 分支）。当前开发在 `v2-chat-first` 分支。

## 技术栈

- **桌面壳**：Tauri 2（Rust 后端）
- **前端**：React 19 + TypeScript + Vite
- **终端**：`@xterm/xterm`（主终端 + 每块离屏 xterm，不做自研终端模拟器）
- **状态**：zustand
- **AI**：`@anthropic-ai/sdk`（BYOK）+ react-markdown + KaTeX
- **测试**：vitest（单测）、Playwright（e2e）

## 快速开始

> **构建依赖**：SSH 远程文件浏览（SFTP）用 `ssh2` crate，需要系统 `libssh2` + `openssl`。
> macOS 用 Homebrew 安装：
> ```bash
> brew install libssh2 openssl
> ```
> （`ssh2` 的 `libssh2-sys` 不支持从源码 vendored libssh2，因此这是硬依赖；若要完全免系统依赖，可改用纯 Rust 的 `russh`。）

```bash
npm install
npm run dev        # 前端 dev server
npm run tauri dev  # 启动完整 Tauri 应用
```

## 常用命令

```bash
npm run build      # tsc + vite build
npm run test       # vitest run（单测）
npm run test:e2e   # playwright test（e2e，需 @playwright/test@1.48.2）
cargo test         # Rust 后端测试（src-tauri）
```

## 文档

| 文档 | 内容 |
|------|------|
| [docs/architecture.md](docs/architecture.md) | **当前 v2 实现架构**（同步单趟派发、三场景状态机、Block 生命周期、渲染管线） |
| [docs/development-rules.md](docs/development-rules.md) | 开发规则与硬约束 |
| [docs/feature-spec.md](docs/feature-spec.md) | 功能规格与测试清单 |
| [NOTICE](NOTICE) | 第三方依赖许可说明 |

## 架构速览

PTY 输出 → **StreamDispatcher 同步扫描** → SessionController 三场景状态机（OSC 133 驱动）→ 每 executing block 一个离屏 xterm；完成后提取 outputHtml 快照 → scene 驱动 UI，block 列表普通 DOM 滚动 + follow-bottom。详见 [architecture.md](docs/architecture.md)。
