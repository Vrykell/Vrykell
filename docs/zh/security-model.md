# 安全模型

> 读者：**在 Vrykell 上加任何新功能前先读这一页**，尤其是接入第三方代码（MCP 服务器、技能、外部 harness）和新增 IPC 命令的时候。
> 配套文档：`security-review.md`（历次审查与未决项）、`acp-harness-integration.md`（外部 harness 接入设计）、`architecture.md`（分层）。
> 最近更新 2026-10-14。

## 1. 威胁模型：谁能影响什么

| 输入来源 | 信任级别 | 它能碰到什么 |
| --- | --- | --- |
| 用户本人（键盘、面板、设置） | 权威 | 一切（终端就是任意代码执行，这是产品） |
| **模型输出**（本机 agent） | **不可信内容** | 渲染路径（Markdown）、工具参数（受审批与租约约束） |
| **抓取的网页 / 搜索摘要 / 技能文本 / MCP 工具结果** | **不可信内容** | 同上；也是**提示注入**的入口（内容里可以写"请把 X 发到 Y"） |
| **远程 SSH 主机** | **不可信内容** | 终端输出、远端文件名；会话记录会落库并再次渲染 |
| **第三方 harness（ACP，规划中）** | **用户添加的可执行程序** | 它自己的进程权限（拦不住）；经我们声明的能力发起的操作（可拦） |
| **被完全攻陷的渲染进程** | 最坏情况 | 一切 UI 能做的事——**包括往 PTY 里敲命令**（见 §3） |

一句话：我们保护的是「**不可信内容不得变成渲染层或执行层的指令**」，以及「**危险操作必须经过不可伪造的确认**」。我们不假装能保护「渲染进程本身」和「用户自己装的程序」。

## 2. 七条防线（现状 + 证据 + 验证方式）

| 防线 | 现状 | 证据 | 怎么验证 |
| --- | --- | --- | --- |
| 渲染进程不进 Node | ✅ Tauri 天然无 Node；渲染进程没有直接文件系统权限，一切经 IPC | `src-tauri/tauri.conf.json` | 结构使然 |
| 显式 IPC + 能力清单 | ✅ 只用 `core:default` + dialog/drag/clipboard/opener + 窗口控制；自有命令 171 个 | `src-tauri/capabilities/default.json` | 改能力清单需同步文档 |
| 命令级授权（租约） | ✅ 4 个受门控命令（`read_file_text`/`write_file_text`/`edit_file_text`/`fs_search`）必须出示**与命令+参数摘要绑定的一次性租约**，否则失败关闭 | `src-tauri/src/agent/permissions.rs` | `cargo test --lib` 的租约用例 |
| 危险操作不可代答确认 | ✅ 危险命令/凭据路径/持久化写入命中即弹**系统原生对话框**；窗口不在前台直接拒绝；审批卡有超时 | 同上 + `agent/permissions.rs` | cargo 单测 + e2e `approval-timeout` |
| 授权粒度 | ✅ 等级表（允许/询问/禁止）+ **形态级会话授权**（`npm run` 只放开这一类）+ 危险规则在授予之前判定 | 同上 | cargo 形态派生用例 + e2e `approval-shape` |
| 路径授权（任意读收口） | ✅ 会把文件内容交给页面的命令（附件导入）只接受**系统级用户动作**产生的路径：Rust 侧授权登记表（`files/grants.rs`，持久化在 `~/.vrykell/approved-paths.json`）；选择器改由我们的 `pick_path` 打开（只有 Rust 亲自打开才知道选择来自用户），窗口拖放由 `WindowEvent::DragDrop` 登记；应用自有目录（附件、技能）无需手势；无人调用的 `read_image_data_url` 已删除 | `files/grants.rs`、`lib.rs` | cargo 单测（授权文件/目录/自有目录/未授权拒绝） |
| 内容渲染消毒 | ✅ Markdown 不启用 raw HTML、裸 URL 不 linkify、远程图片降级为文本、链接不导航应用窗口（外链交系统浏览器）；终端/命令块与 SSH 画面快照全部过 `sanitizeOutputHtml`（白名单只有 `<span>`+安全 style+`<br>`，且把"本地 DB 被篡改"写进威胁模型） | `Markdown.tsx`、`sanitizeHtml.ts`、`TerminalPanel.tsx` | vitest（Markdown 链接、快照消毒）+ e2e `chat-links` |
| CSP 与资源范围 | ✅ 生产 CSP：`default-src 'self'`、`script-src 'self'`（Tauri 自注入脚本走 hash）、`style-src 'self' 'unsafe-inline'`（React 内联样式需要）、`object-src 'none'`、`form-action 'none'`、`frame-ancestors 'none'`、img 只允许 self/data/asset、connect 只允许 ipc；dev 例外（HMR 的 ws 与内联脚本）只在 `devCsp` | `src-tauri/tauri.conf.json` | `npm run build` 后确认 `dist/index.html` 无内联脚本；改动 CSP 需重启应用 |
| 密钥与凭据 | ✅ API key / SSH 密码加密落盘（DPAPI/钥匙串/0600），**模型请求走 Rust 代理，key 从不进渲染进程**；附件读取锁死在附件目录 | `secret.rs`、`files/fs.rs` | 实机检查 `secrets.json`；`config.json` 无 key |

## 3. 两条「做不到」，必须写清楚

1. **真隔离不可达**：UI 必须驱动 PTY（终端就是产品），渲染进程一旦失陷就等于用户的任意命令执行，任何 IPC 拆分/把 agent 移出 webview 都改变不了这一点。因此我们的目标是**缩小失陷后的收益**，不是挡住失陷本身。
2. **「调用者身份」这一维现在是空的**：`agent` 与 `UI` 都是同一个 webview 里的 JS，后端无法区分。技术上可行（Tauri 会把调用者 webview 注入命令签名，页面无法伪造），但**只有一个 webview 时做了等于没做**。等引入第二个 webview（例如 ACP harness 的会话 UI）时，同批做：命令命名空间 + 按调用者鉴权 + 租约绑定 `webview_label`。

## 4. 新功能自查清单（每个 PR 都要能回答）

1. **新 IPC 命令**：是否受租约/策略门控？加进受门控命令清单了吗？会不会成为"任意路径读/写/执行"的新入口？
2. **新渲染路径**：是不是又往 DOM 里塞 `innerHTML`？能不能走 Markdown/文本？必须塞 HTML 时过 `sanitizeOutputHtml` 吗？
3. **新内容来源**（第三方文本/文件/接口）：它算不可信内容吗？进渲染层前消毒了吗？会不会诱发一次外链点击？（链接一律走 `Link`，外链默认交系统浏览器）
4. **新能力或新资源**：CSP 需要放宽吗？`assetProtocol` scope 需要扩大吗？能力清单要加吗？——三问都要写进 PR 说明。
5. **新第三方代码**（进程、脚本、插件）：是否由用户显式添加？设置页是否写清"添加即授权"？
6. **新授权**：是否复用现有审批链（等级表 + 形态授权 + 超时 + 危险规则），还是自造了一套？自造的一律需要评审。
7. **日志**：新写日志是否泄漏命令文本/输出/密钥？（诊断日志只记元数据）
8. **测试**：这条防线有没有对应的单测/e2e？（见 §2 最后一列）

## 5. 已知缺口与成本（摘录，完整见 `security-review.md`）

| 缺口 | 成本 |
| --- | --- |
| `opener` 的 `open_path` scope 为 `**`（面板必须能打开任意用户文件，属既定设计，等同 PTY 级别） | — |
| 外部 harness 的启动（`acp_handshake`） | 属**既定类**：它只能启动用户在 `~/.vrykell/harnesses.json` 里**启用**的程序，探测**不跑任何工具**（权限请求一律拒绝），并且不扩大攻击面——同一个 webview 早已能通过 PTY 执行任意命令。P1 的设置页会在文案里写明"添加即授权" |
| 面板能力化文件系统（路径必须来自用户动作或 shell cwd） | 3–6 周，改产品语义，仍挡不住 PTY → 不做 |
| agent 移出 webview | 2–4 月 / sidecar 2–4 周，仍挡不住 PTY → 不做 |

## 6. 相关历史

- `8ddffb1`：授权判定搬进 Rust + 一次性租约
- `f3ca94f`：密钥/密码加密落盘
- `ab34159` / `5ee61b9`：危险规则（包装器穿透、Windows 路径与 shell 族）
- `e026f96` / `e506d69`：无人应答审批超时、原生确认边界
- `ee4c70e` / `0e83644`：形态级会话授权
- 生产 CSP 拆分、链接不导航、SSH 画面消毒：见 `security-review.md` 对应条目
