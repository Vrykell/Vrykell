# 贡献指南

[English](CONTRIBUTING.en.md)

欢迎参与 Vrykell。问题复现、使用场景、文档、翻译、测试和代码都很有价值。不要求第一次贡献就熟悉整个项目；先选择一个边界清楚的小问题即可。交流可以使用中文或英文，提交信息和代码中的注释使用英文。

## 先确认要解决的问题

提交前搜索现有 Issue 和 PR。报告问题时填写版本、操作系统、复现步骤、预期和实际行为。功能建议请说明实际工作场景；较大的改动先讨论方案，避免在范围尚未明确时投入大量实现。

截图、日志和配置中请移除密钥、密码、令牌、私有主机信息及无关个人内容。诊断日志虽以元数据为主，分享前也应自行检查。

## 分支与目标分支

| 分支 | 用途 |
| --- | --- |
| `dev` | 日常集成分支，外部贡献 PR 的目标分支。 |
| `main` | 默认分支，维护者从 `dev` 集成并构建版本。普通功能和修复不直接提交到这里。 |
| `<type>/<short-description>` | 从最新 `dev` 创建的贡献分支。使用小写英文和连字符。 |

分支类型与示例：`feat/remote-file-search`、`fix/terminal-resize`、`docs/setup-guide`、`test/session-restore`、`refactor/shared-menu`。自动化工具创建的分支可以使用 `codex/<short-description>`。

Fork 仓库后，以自己的 Fork 为 `origin`，以本仓库为 `upstream`：

```bash
git clone https://github.com/YOUR_USERNAME/Vrykell.git
cd Vrykell
git remote add upstream https://github.com/Vrykell/Vrykell.git
git fetch upstream
git switch -c feat/short-description upstream/dev
npm ci
git config --local commit.template .gitmessage
```

提交前同步上游。如果分支已由多人协作，合并上游 `dev`；需要重写自己分支的历史时先协调，不改写共享分支或上游历史。

```bash
git fetch upstream
git merge upstream/dev
git push -u origin feat/short-description
```

随后创建 **你的分支 → `Vrykell/Vrykell:dev`** 的 PR。由于默认分支是 `main`，请主动检查创建页面的 base branch。维护者将已审查的变更从 `dev` 提升到 `main`，不要为普通贡献另开直达 `main` 的 PR。

## 环境与项目约定

需要 Node.js 22.12+、Rust 稳定工具链和对应平台的桌面构建依赖，见 [README](README.md#开始使用)。`npm run tauri dev` 启动桌面应用，`npm run dev` 只启动前端。

开始改动前阅读 [AGENTS.md](AGENTS.md)、[开发规则](docs/zh/development-rules.md)和[项目约定](.agents/skills/vrykell-conventions/SKILL.md)。涉及 IPC、文件访问、渲染或外部集成时，还需阅读[安全模型](docs/zh/security-model.md)。

- 先复用最近的现有界面和共享组件，保持交互、间距、菜单、错误反馈和图标风格一致。
- 保持类型检查无错误，遵守模块边界，不绕过统一的 IPC 和资源所有者。
- 用户可见文案在代码中写英文，并补齐中文词条。文档有中英文版本时同步更新。
- 保持既有终端解析器和渲染架构；不新增独立的终端解析器，不使用正则后行断言。
- 不提交密钥、私有配置、构建产物或机器上的绝对路径。依赖变更同步锁文件和第三方声明，不引入未经说明的外部代码或素材。
- 一个 PR 聚焦一个问题；功能增加对应测试，修复增加能复现问题的回归用例。

## 验证要求

每次提交前至少运行：

```bash
npx tsc --noEmit
npm run test
npm run check:architecture
```

| 改动 | 还需验证 |
| --- | --- |
| 交互、终端、编辑器或工作区 | 对应的 `npm run test:e2e -- <spec>`，在宽窄布局检查实际界面。 |
| 后端或原生集成 | `cargo test --manifest-path src-tauri/Cargo.toml`，并覆盖对应平台路径。 |
| 依赖、字体、图标或原生目标 | `npm run licenses:generate`、`npm run licenses:check` 和生产构建，提交更新后的声明。 |
| 文档或展示图 | 检查链接、语言同步、实际渲染和原始图片清晰度；不把模拟数据当作实测结果。 |

浏览器测试每个分片使用一个工作进程。没有运行的检查要在 PR 中说明原因，不填写“已通过”。普通检查不需要构建安装包；只有验证打包行为时才运行打包命令。[CI 说明](docs/zh/ci.md)列出了自动执行的检查与 `main` 安装包矩阵。

### 更新展示图

在一个终端运行 `npm run dev -- --port 1432 --host 127.0.0.1`，在另一个终端运行 `node --experimental-strip-types scripts/capture-readme.mjs`。首次使用前运行 `npx playwright install chromium` 安装截图浏览器。脚本使用真实前端与示例数据生成中英文场景图，不连接实际模型或服务器。

保留 2 倍像素密度生成的 3200×1800 PNG 和 16:9 比例，等待字体与编辑器加载完成。不要放大旧截图或拉伸图片；README 中保留原图链接，更新后检查桌面和窄屏渲染。

## 提交信息

使用英文、祈使句和以下前缀，保持提交小而聚焦：

```text
feat: add directory filters to command history
fix: preserve the cursor after resizing a pane
docs: explain the contributor setup
test: cover reconnect cancellation
refactor: share the file action menu
```

运行 `git config --local commit.template .gitmessage` 后，直接执行 `git commit` 即可使用仓库模板。配置只影响当前克隆；模板中的 `#` 注释不会进入提交信息。正文按需要说明问题、变更和验证，不必为简单改动填满所有部分。

## PR 与审查

填写 PR 模板，说明问题、最终行为、关联 Issue 和实际验证结果；交互改动附截图或短录屏。标题使用与提交相同的英文前缀。草稿 PR 也欢迎，用它尽早讨论范围。

回应审查时更新实现、测试与文档，保持 PR 描述反映最终结果。不要混入无关格式化、生成文件或大规模重命名。维护者会确认范围与检查结果后合并到 `dev`；是否提升到 `main` 由维护者决定。

## 许可

除非明确另有说明，提交用于纳入项目的贡献按 [Apache-2.0](LICENSE) 提供。保留第三方版权、许可与署名；新增依赖和素材时说明来源及分发要求，见[许可说明](docs/zh/licensing.md)。尊重其他贡献者，围绕问题和证据交流。
