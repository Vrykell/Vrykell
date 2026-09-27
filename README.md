# Vrykell

chat-first 终端。终端是主表面，每个命令渲染为一个**命令块（Block）**；AI 对话（Anthropic/Gemini/OpenAI 兼容 BYOK 直连）以内联 @Agent 块 + 全局 AI 面板（dock 侧栏）双形态展示，并支持**代码代理**（工具调用、权限模式、Skills、MCP、记忆、调度）。

> v1 自研 DOM 终端已废弃并归档（`archive/v1-dom-terminal` 分支）。当前开发在 `dev` 分支。

## 技术栈

- **桌面壳**：Tauri 2（Rust 后端）
- **前端**：React 19 + TypeScript + Vite
- **终端**：`@xterm/xterm`（主终端 + 每块离屏 xterm，不做自研终端模拟器）
- **状态**：zustand
- **AI**：AI SDK（`ai` + `@ai-sdk/*`，BYOK 多 provider）+ react-markdown + KaTeX
- **后端能力**：`portable-pty`（PTY）、`rusqlite`（持久化）、`ssh2`（SSH/SFTP）
- **测试**：vitest（单测）、Playwright（e2e）

## 快速开始

请先安装 Node.js、npm 和 Rust 工具链（含 Cargo），并准备好当前平台的 Tauri 2 系统构建依赖。

Fedora 安装系统开发依赖（包含本项目 SSH/SFTP 所需依赖）：

```bash
sudo dnf install gcc gcc-c++ make pkgconf-pkg-config \
  glib2-devel gtk3-devel webkit2gtk4.1-devel \
  openssl-devel libssh2-devel libappindicator-gtk3-devel \
  librsvg2-devel libxdo-devel curl wget file
```

其他发行版请参考 [Tauri 系统依赖说明](https://v2.tauri.app/start/prerequisites/#linux)。

> **构建依赖**：SSH 远程文件浏览（SFTP）用 `ssh2` crate，需要系统 `libssh2` + `openssl`。
> macOS 用 Homebrew 安装：
> ```bash
> brew install libssh2 openssl
> ```
> （`ssh2` 的 `libssh2-sys` 不支持从源码 vendored libssh2，因此这是硬依赖；若要完全免系统依赖，可改用纯 Rust 的 `russh`。）

```bash
npm install
npm run tauri dev  # 启动完整 Tauri 应用
```

`npm run tauri dev` 使用项目依赖 `@tauri-apps/cli`，并自动启动前端开发服务器，无需另外运行 `npm run dev`，也无需全局安装 Tauri CLI。仅开发前端时，可单独运行 `npm run dev`（端口 1420）。

## 常见问题

### Linux 编译提示找不到 `glib-2.0`

如果 `glib-sys` 构建失败，且 `pkg-config` 提示找不到 `glib-2.0.pc`，请先安装系统开发依赖。Fedora 使用上方的 `dnf install` 命令，然后检查：

```bash
pkg-config --modversion glib-2.0 gtk+-3.0 webkit2gtk-4.1
npm run tauri dev
```

安装到系统默认路径的开发包通常无需手动设置 `PKG_CONFIG_PATH`。`npm install` 不会安装这些系统依赖。

### `cargo tauri dev` 提示 `no such command: tauri`

这表示 Cargo 未安装 Tauri CLI。本项目已通过 npm 管理 CLI，请在项目根目录执行：

```bash
npm install
npm run tauri dev
```

不要使用 `cargo install tauri` 安装 CLI：`tauri` 是 Rust 库，不包含可执行程序，因此会提示 `there is nothing to install`。

## 构建与测试

```bash
npm run build      # tsc + vite build
npm run test       # vitest run（单测，覆盖率阈值 80/75/80/80）
npm run test:e2e   # playwright test（e2e，自动起 1421 端口 dev server）
cargo test --manifest-path src-tauri/Cargo.toml  # Rust 后端测试
# 提交前全量验证：
npx tsc --noEmit && npx vitest run && npx playwright test
```

## 文档

| 文档 | 内容 |
|------|------|
| [docs/architecture.md](docs/architecture.md) | **当前实现架构**（Rust 扫描、三场景状态机、Block 生命周期、分屏、Agent、主题） |
| [docs/development-rules.md](docs/development-rules.md) | 开发规则与硬约束 |
| [docs/feature-spec.md](docs/feature-spec.md) | 功能规格与测试清单 |
| [docs/development-log.md](docs/development-log.md) | 开发阶段日志 |
| [docs/code-audit.md](docs/code-audit.md) | 代码审计与修复记录 |
| [docs/security-review.md](docs/security-review.md) | 安全性审查 |
| [NOTICE](NOTICE) | 第三方依赖许可说明 |

## 架构速览

PTY 输出 → **Rust StreamScanner 同步扫描**（`src-tauri/src/terminal/scan.rs`）→ SessionController 三场景状态机（OSC 133 驱动）→ 每 executing block 一个离屏 xterm；完成后提取 outputHtml 快照 → scene 驱动 UI，block 列表普通 DOM 滚动 + follow-bottom。分屏时每个 pane 各有一个 SessionController。详见 [architecture.md](docs/architecture.md)。
