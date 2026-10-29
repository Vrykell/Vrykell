<div align="center">

<img src="public/app-icon.svg" width="80" height="80" alt="Vrykell" />

# Vrykell

### 终端与 AI，并肩工作。

一个带命令补全、文件浏览、编辑器和 Git 工具的桌面终端。支持本地 Shell 和 SSH，也能在旁边打开 AI 对话或 Agent。

[下载](https://github.com/Vrykell/Vrykell/releases) · [使用场景](#使用场景) · [命令补全](#命令补全) · [Git](#git) · [参与贡献](CONTRIBUTING.md) · [English](README.md)

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache-2.0" /></a>
  <a href="https://github.com/Vrykell/Vrykell/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-checks-64748b?style=flat-square" alt="CI checks" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-3b82f6?style=flat-square" alt="Windows, macOS, Linux" />
</p>

</div>

<a href="docs/images/hero-workspace-zh.png"><img src="docs/images/hero-workspace-zh.png" width="1600" alt="代码、构建终端与 Agent 工作区" /></a>

## 使用场景

每个标签最多放四个窗格，可以混排终端、文件、AI 对话和外部 Agent。拖动窗格调整位置，按项目给标签分组、命名和设置颜色。切换标签时，终端和对话继续运行。

### 左边改代码，右边看构建

打开源文件，在旁边保留构建或测试终端。改完代码就运行命令，对照结果检查。需要时再加一个 Agent 窗格，读取相关文件和命令输出。

编辑器支持语法高亮、查找替换、编码选择、Markdown 预览和 Git 差异。命令块保留工作目录、分支、耗时和退出状态；构建失败后，可以把对应命令块附到对话中。

<a href="docs/images/scenario-build-zh.png"><img src="docs/images/scenario-build-zh.png" width="1600" alt="并排编辑代码与运行构建" /></a>

### 左边 SSH，右边 AI

连接服务器，检查服务状态或部署日志。在旁边打开 AI 对话，附上需要分析的输出。交给 Agent 执行前先选好目标终端，工具调用和审批请求会显示在对话中。

主机管理覆盖密码与密钥认证、主机密钥确认和端口转发。直接连接支持 SFTP 浏览、上传、下载和远程编辑。交互终端支持跳板机；经跳板机的文件浏览与资源监控仍有限制。

<a href="docs/images/scenario-remote-zh.png"><img src="docs/images/scenario-remote-zh.png" width="1600" alt="远程服务检查与 AI 部署讨论" /></a>

### 在终端旁边运行 Agent

可以使用内置 AI 对话，也可以通过 ACP 接入外部 Agent。执行终端保持可见，文件和差异随时打开检查。对话可以放在窗格或侧栏中。

内置对话支持附件、工具权限、技能、MCP 和本地记忆。外部 Agent 通过 ACP 提供自己的模型和工具，具体能力取决于所配置的服务或 Agent。

### 其他布局

| 你正在做什么 | 可以怎样安排 |
| --- | --- |
| 调试接口 | 一个终端启动服务，另一个终端发请求，旁边打开处理函数或日志。 |
| 排查构建失败 | 保留失败命令块，让 AI 分析对应输出，再打开文件核对修复。 |
| 维护多个项目 | 按项目组织标签分组，用颜色区分；暂时不用的组可以收起。 |
| 检查远程变更 | SSH 终端旁边放远程文件或 AI 对话，核对目标后再执行操作。 |
| 审查 Agent 的工作 | 对照工具记录、文件内容与 Git 差异，确认变更后再继续。 |
| 重复工作流程 | 从命令历史搜索、收藏、分组或重新运行命令。 |

## 终端、文件与连接

终端、项目文件、已保存主机和 AI 对话都有独立工作区。可以单独使用，也可以把它们的标签组合到分屏中。

### 终端

经典模式保留连续终端输出，块模式将每条命令和输出放在一起。全屏程序使用交互终端画面。本地和 SSH 会话各有标签、目录和命令历史。

历史命令可以搜索、收藏、分组和重新运行。命令块会记录工作目录、分支、耗时和退出状态，方便回看结果。

#### 命令补全

- 输入时显示历史命令建议。本地匹配和文件路径补全不需要模型密钥；可选的 AI 补全会在没有本地建议时调用你配置的模型。
- Tab 补全结合内置建议、所支持的 Shell 补全和文件路径。路径补全跟随当前本地或 SSH 目录，支持引号和带空格的路径。
- 用 `Tab`、`Shift+Tab` 切换候选，按 `Esc` 恢复原始输入；接受建议的快捷键可以自定义。

<a href="docs/images/single-terminal-zh.png"><img src="docs/images/single-terminal-zh.png" width="1600" alt="终端会话和命令块" /></a>

### 文件与编辑器

浏览本地目录或 SFTP 远程文件，支持新建文件和目录、重命名、复制、移动、删除及多选操作。上传下载有独立传输列表，文件可以用内置编辑器或指定的外部程序打开。

编辑器支持语法高亮、查找替换、Markdown 预览、字符编码和 Vim 按键，多个文件以标签组织。只读状态、未保存修改和保存冲突会在覆盖前提示。

<a href="docs/images/single-editor-zh.png"><img src="docs/images/single-editor-zh.png" width="1600" alt="项目文件编辑工作区" /></a>

### Git

源码管理面板跟随当前终端或文件，也支持已保存的 SSH 连接。使用前需要在本机或远程主机安装 Git。

- 按冲突、已暂存、未暂存和未跟踪分组查看文件，支持列表和树状视图。可以打开差异、暂存、取消暂存，以及确认后丢弃修改。
- 检查暂存内容，填写提交信息并提交；也可以让 AI 起草提交信息，再自行检查。
- 支持 fetch、pull、push，创建、切换、重命名和删除分支，合并、变基和标签操作。可用操作取决于仓库当前状态。
- 浏览关联工作树，切换面板查看的仓库。

一次常见的检查流程是：**查看差异 → 暂存需要的文件 → 核对提交信息 → 提交 → 推送**。其他 Git 操作也可以直接在终端运行。

### SSH 主机

用列表或卡片管理连接，按名称、分组和标签找到目标。保存主机配置后，可以连接终端、浏览远程文件、管理传输任务或设置端口转发；直接连接还支持按需查看资源状态。

<a href="docs/images/single-hosts-zh.png"><img src="docs/images/single-hosts-zh.png" width="1600" alt="主机卡片与连接管理" /></a>

### AI 对话

纯对话可以直接提问，也可以附上文本、文件或图片；图片需要所选模型支持图像输入。需要执行任务时，选择明确的终端环境，查看工具调用和权限确认。内置对话与外部 Agent 可以按任务分别保留。

<a href="docs/images/single-ai-zh.png"><img src="docs/images/single-ai-zh.png" width="1600" alt="独立的 AI 对话工作区" /></a>

## 主题与字体

内置十套深浅配色，页面、编辑器和终端一起切换。深浅选择分别保存，也可以跟随系统。页面、编辑器、终端和对话可独立设置字体与字号，内置字体无需另行安装。

<a href="docs/images/theme-settings-zh.png"><img src="docs/images/theme-settings-zh.png" width="1600" alt="主题设置与配色预览" /></a>

<a href="docs/images/theme-light-zh.png"><img src="docs/images/theme-light-zh.png" width="1600" alt="浅色配色下的代码、终端与 Agent 工作台" /></a>

<a href="docs/images/theme-nord-zh.png"><img src="docs/images/theme-nord-zh.png" width="1600" alt="冷色配色与分组分屏工作台" /></a>

也可以选择本地壁纸，调整应用不透明度。

## 能力一览

| 领域 | 已有能力 |
| --- | --- |
| 终端 | 本地 Shell、SSH、命令块、经典终端视图、TUI 与备用屏幕、中文输入、复制与搜索。 |
| 补全 | 历史命令建议、Shell 与路径补全、候选切换、自定义接受快捷键、可选 AI 补全。 |
| 工作区 | 混合资源标签、最多四窗格、拖放与排序、命名分组、组颜色、收起分组、聚焦与调整分屏。 |
| AI 与 Agent | 多模型配置、自带密钥、流式对话、命令输出引用、工具权限、ACP、技能、MCP、本地记忆。 |
| 文件与编辑器 | 本地与 SFTP 浏览、多选、文件操作、上传下载、编辑器标签、字符编码、Vim 按键、Markdown 预览。 |
| Git | 差异、暂存、提交、可选 AI 提交信息、fetch/pull/push、分支、合并与变基、标签、关联工作树浏览。 |
| 远程连接 | 主机配置、密码与密钥认证、主机密钥校验、端口转发、直接连接下的资源监控。 |
| 历史与检索 | 命令历史、会话历史、收藏与分组、搜索筛选、工作区布局恢复。 |
| 显示与输入 | 十套内置深浅配色，支持跟随系统；应用/终端/编辑器字体设置、内置字体、快捷键、中文与英文界面。 |

截图来自应用界面，使用示例项目与模拟会话数据；点击可查看原始分辨率。

## 开始使用

在 [Releases](https://github.com/Vrykell/Vrykell/releases) 下载 Windows、macOS 和 Linux 安装包，当前发布版本为 **0.1.0 Beta 1**。这是早期预览版，日常使用前可先查看[当前边界](#当前边界)。也可以从源码运行或自行构建，见[构建说明](docs/zh/ci.md)。

准备 Node.js **22.12+**、Rust 稳定工具链，以及对应平台的[桌面构建依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/Vrykell/Vrykell.git
cd Vrykell
npm ci
npm run tauri dev
```

只开发前端时使用 `npm run dev`，默认端口为 `1420`。需要安装包时运行 `npm run tauri -- build`。

<details>
<summary>平台准备</summary>

- **Windows**：需要 C++ 构建工具、系统 WebView2 运行时，以及原生上下文菜单构建所需的桌面 SDK。
- **macOS**：需要命令行开发工具、Perl 和 Make。SSH 相关原生库由依赖工具链从源码构建，无需单独安装系统加密库。
- **Linux**：安装桌面 WebView、图形界面及应用指示器等系统开发依赖，具体见上方构建依赖链接。

</details>

### 连接模型或 Agent

在设置中添加模型服务的地址、密钥和模型，再选择当前配置。内置对话支持原生 Messages 接口、原生生成接口和 OpenAI 兼容接口，也可连接提供兼容接口的本地模型服务。请求直接发送至你配置的服务，应用不提供模型中转。

外部 Agent 在 ACP 设置中配置启动命令与工作目录。检查工具权限，再开始会话。使用远程目标时，请同时核对执行终端和工作目录，确认实际执行环境。

### 当前边界

- 会话和组合布局可以进入历史；未保存的编辑器草稿、文件浏览状态不能作为可靠的跨重启保存方式。
- 模型服务、外部 Agent 和远程主机需要自行配置；费用与能力取决于所选服务。
- 跳板机目前主要用于交互终端，文件浏览与监控尚未覆盖同等连接路径。
- 分发签名与公证尚未配置，详见[持续集成说明](docs/zh/ci.md)。

## 参与贡献

欢迎提交问题、文档、翻译、测试和代码。报告问题时请附上复现步骤和平台信息；较大的功能改动请先开 Issue，讨论预期行为。

**贡献 PR 以 `dev` 为目标分支。** `main` 用于维护者集成和版本构建。分支命名、开发环境、检查要求和提交流程见[贡献指南](CONTRIBUTING.md)。

```bash
npx tsc --noEmit
npm run test
npm run check:architecture
```

交互改动还需对应端到端测试，后端改动需运行原生测试。提交信息使用英文和约定前缀；仓库提供提交、PR 和 Issue 模板。

## 交流社区

欢迎加入交流群，分享想法、交流问题并关注项目进展。群号：**1130135497**。

<a href="docs/images/community-group.jpg"><img src="docs/images/community-group.jpg" width="260" alt="交流群二维码" /></a>

## 深入了解

[功能与回归清单](docs/zh/feature-spec.md) · [架构](docs/zh/architecture.md) · [工作区组合](docs/zh/workspace-compositions.md) · [开发规则](docs/zh/development-rules.md) · [安全模型](docs/zh/security-model.md) · [CI 与安装包](docs/zh/ci.md) · [已知陷阱](docs/zh/pitfalls.md)

## 许可

原创代码与文档采用 [Apache License 2.0](LICENSE)，另有声明的文件除外。Copyright 2026 Vrykell contributors。

第三方软件、字体和图标保留各自的许可与署名，详见 [NOTICE](NOTICE)、[第三方声明](THIRD_PARTY_NOTICES.md) 和[许可说明](docs/zh/licensing.md)。提交用于纳入本项目的贡献，除非明确另有说明，按项目许可提供。
