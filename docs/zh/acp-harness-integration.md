# 接入外部 harness（Agent Client Protocol）

> 状态：**设计（未实现）**。协议依据：Agent Client Protocol **v1**（agentclientprotocol.com），2026-10 按官方规范核对过方法名、能力字段与消息形状。
> 读者：实现这个功能的人，以及需要了解边界与取舍的评审。

## 1. 目标

Vrykell 作为 **ACP 客户端（host）**，把外部 agent harness（Claude Code、Codex、OpenCode、Gemini CLI 等任何实现了 ACP 的进程）接进工作区：

1. **一个 harness 会话 = 一个工作区标签页**：对话流、工具卡、审批卡、停止按钮全部复用现有组件，不新造第二套聊天界面；
2. **审批与授权走我们的策略**：形态级会话授权、「审批等待超时」、危险命令的系统原生确认都继续适用，安全决定不交给 harness；
3. **用量页把 harness 记为新的 `source`**（数据口径见 §6，这里有个必须接受的取舍）。

## 2. 非目标（第一版）

- 不做 ACP **服务端**：不把 Vrykell 自己的 agent 暴露给别的编辑器；
- 不做 `elicitation/*`（表单/URL 交互）与 `compaction_*`（上下文压缩可视化）：在 `initialize` 里**不声明**这些能力，harness 会退回普通消息（规范明确要求它们遵守能力协商）；
- 不做 MCP 透传：`session/new` 的 `mcpServers` 先传空数组；
- 不做进程池调度：先做到「一个 harness 定义一个进程，进程内多会话」。

## 3. 协议要点（v1，已核对）

传输：子进程 stdio，**每行一条 JSON-RPC 2.0 消息**（与现有 `agent/mcp.rs` 同构）；参数 camelCase，判别字段 snake_case；协议里的路径必须是绝对路径。

客户端 → agent（我们要实现的）：

| 方法 | 用途 |
| --- | --- |
| `initialize` | 版本（`protocolVersion: 1`）+ 能力协商 + 实现信息 |
| `session/new` | `{cwd, mcpServers: []}` → `{sessionId}` |
| `session/prompt` | `{sessionId, prompt: ContentBlock[]}` → `{stopReason}`：`end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled` |
| `session/cancel`（通知） | 打断当前轮次，无需响应 |
| `session/load` · `session/resume` · `session/close` | 恢复/关闭会话（需 agent 声明 `loadSession` / `sessionCapabilities.*`） |
| `session/set_mode` | 切换 agent 的运行模式（第一版只读展示） |

agent → 客户端（我们要处理的）：

| 方法 | 用途 |
| --- | --- |
| `session/update`（通知） | `user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `plan` / `available_commands_update` / `current_mode_update` / `session_info_update` / `usage_update` / `notice` |
| `session/request_permission` | `{sessionId, toolCall, options[]}`；选项带 `kind`：`allow_once` / `allow_always` / `reject_once` / `reject_always`；我们回答 `{outcome:{outcome:'selected', optionId}}` 或 `{outcome:{outcome:'cancelled'}}` |
| `fs/read_text_file` · `fs/write_text_file` | 仅当我们声明了 `fs` 能力时才会被调用 |

`tool_call` 的形状（决定我们怎么复用工具卡）：`toolCallId`、`title`、可选 `name`、`kind`（`read`/`edit`/`delete`/`move`/`search`/`execute`/`think`/`fetch`/`switch_mode`/`other`）、`status`（`pending`/`in_progress`/`completed`/`failed`）、`content[]`（`content` / `diff{path,oldText,newText}` / `terminal{terminalId}`）、`locations[]`、`rawInput`、`rawOutput`。

我们声明的客户端能力（建议值）：

```json
{
  "protocolVersion": 1,
  "clientCapabilities": {
    "fs": { "readTextFile": true, "writeTextFile": true },
    "terminal": false,
    "session": { "notices": {} }
  },
  "clientInfo": { "name": "vrykell", "title": "Vrykell", "version": "<包版本>" }
}
```

- `fs` 读**与写都声明**：这样 harness 的文件读写**经过我们**（可审、可拦、可记，见 §5）。不声明并不能阻止它自己写文件，只是把这件事挪出我们的视野。
- `terminal: false`：第一版不替 harness 起终端（它用自己的方式执行命令）；代价见 §8，P4 再声明，把命令执行拉进我们的危险规则与 PTY。
- `session.notices`：便宜且有用（MCP 掉线之类）；`session.compaction` 不声明。

## 4. 架构

```
用户输入（工作区 harness 标签）
  → Tauri 命令面（acp_*）
    → Rust `agent/acp.rs`：子进程 + ndjson JSON-RPC（请求关联 / 通知分发 / 取消）
      ↑ session/update、session/request_permission
      ↓ initialize / session/new / session/prompt / session/cancel
        harness 子进程
  ← Tauri 事件 → 前端 `useAcpSession` store
    → 映射到现有 ChatMessage / ToolRun（复用 AiBlock、ToolRunCard、审批卡）
```

- **协议与进程在 Rust**：与「后端判定」的既有精神一致（MCP 客户端也在 Rust），前端永远不碰 stdio。
- **前端只做映射**：`tool_call.kind` 决定图标（`execute` → 终端、`edit`/`delete` → 铅笔、`read` → 文件、`search` → 搜索、`other` → 扳手）；`kind: 'think'` 走思考折叠；`diff` 内容第一版按文本展示。
- **会话身份**：`(harnessId, sessionId)` 唯一。工作区标签 kind = `harness`；标题取 `session_info_update`，其次首条用户消息（与现有智能标题一致的退化顺序）。
- **进程生命周期**：首次打开该 harness 的会话时 spawn（`kill_on_drop` + 现有 `terminate_tree` 清理子进程树）；进程退出 → 会话标记断开；agent 声明 `loadSession` 时提供「重新连接并回放」。

## 5. 权限与审批（核心）

`session/request_permission` 的**决定权在我们**（规范明确允许客户端按用户设置自动允许/拒绝）。映射：

| agent 给的选项 `kind` | 我们展示/执行 |
| --- | --- |
| `allow_once` | 「允许一次」→ 回该 `optionId` |
| `allow_always` | 「本会话允许「<形态>」」→ 用 `toolCall.rawInput` 推出命令形态（复用 `agent/permissions.rs` 的 `command_shape`），**只按形态授权**；推不出形态时退回「本会话允许该工具」；两者都推不出时只回 `allow_once` |
| `reject_once` | 「拒绝」 |
| `reject_always` | 第一版按「拒绝」处理，并在会话内记住这次拒绝（我们不给 harness 无法撤销的长期规则） |

- **危险命令仍走系统原生确认**：把 `toolCall.rawInput` 里的命令文本喂给现有 `danger_reason` / `sensitive_path_reason`，命中即弹原生对话框（与本地 agent 完全一致），与 harness 给了什么选项无关。
- **`fs/write_text_file` 不等同于已授权**：它按本地 `write_file` 工具同一条路径处理——等级表 + 危险/凭据判定 + 审批卡，通过后才落盘；`fs/read_text_file` 限制在会话根目录集合（`cwd` 及 `additionalDirectories`）内。
- **取消**：发出 `session/cancel` 后，所有待批的 permission 请求必须回 `{outcome:'cancelled'}`（与 `denyAllPending` 的语义一致）；审批卡超时按 `reject_once` 回复并在会话里说明（沿用刚做完的 P1 行为）。
- 模式切换（`session/set_mode`）与 agent 广告的 modes 第一版只读展示。

## 6. 用量口径（必须接受的取舍）

ACP v1 只提供 **`usage_update`**：会话上下文 `used`/`size`（token）+ 可选 `cost{amount,currency}`。**没有**每轮的 input/output/cache token。

因此：harness 来源**不能**与本地 agent 同口径展示「总 tokens / 新增输入 / 缓存命中率」——那是服务商返回的每轮统计，ACP 不提供。

建议落地：harness 来源只展示**会话上下文占用**；`cost` 即使上报也**不显示**（用量页的既定口径是不显示金额，套餐与折扣会让金额看起来权威却未必准确），只把它留在数据模型里备将来可选开关。要注明「该来源只上报上下文用量」。`source` chip 已经就位，harness 名直接作为 `source`。若某个 harness 将来通过 `_meta` 给出更细的每轮 token 统计，再按需接入（`_meta.vrykell` 留给我们的扩展）。

## 7. 工作区与设置

- 新标签 kind `harness`；入口：新建标签菜单「连接 harness…」+ 全局搜索「harness」；图标取 harness 定义里的条目（默认 Bot）。
- 会话内：停止按钮 = `session/cancel`；`plan` 更新第一版放在工具卡上方的折叠行（复用思考折叠的样式）；`notice` 走 Toast。
- 设置页新增「外部 harness」分组（放在「子代理」之后）：名称 / 命令 / 参数（每行一个）/ 环境变量 / 工作目录策略 / 启用；持久化到 `~/.vrykell/harnesses.json`（与 `mcp.json` 同款：单文件、camelCase、可手改）。
- 每个 harness 提供「测试连接」：只跑 `initialize` 并显示协商结果（协议版本、能力）——这是第一版唯一会真正拉起进程的入口，用来验证配置。

## 8. 安全边界（必须说清）

我们能约束的：

- 经**我们声明的客户端能力**发起的操作（`fs/*`，将来的 `terminal/*`）：走我们的策略、审批与日志；
- 我们自己的进程管理：工作目录、环境变量、退出时清理子进程树；
- 我们拒绝的能力就真的不会被用（规范要求 harness 遵守 `initialize` 协商）。

我们**不能**约束的（第一版写进文档与设置页说明）：

- harness 用自己的进程权限直接读写文件、执行命令——它就是个本地进程，与我们终端里敲命令同级，所以「外部 harness」是**用户显式添加的可执行程序**，添加即授权；
- harness 内部的模型与工具决策：我们只看得到它愿意上报的 `session/update`。

结论：接入 harness 的安全模型是**「用户添加的可执行程序」＋「经我们的操作全部可见可拦」**，不是沙箱。

## 9. 实现前必须遵守的安全前置条件

照 `security-model.md` 的自查清单，接入 ACP 时以下几条是硬要求：

1. **能力声明最小化**：只声明我们能门控的。`fs.readTextFile`/`writeTextFile` 都声明，但每一次调用都必须走我们的策略（等级表 + 危险/凭据判定 + 审批卡），`fs/write_text_file` 等同本地 `write_file`，没有例外；`terminal` 第一版不声明；`elicitation` / `compaction` 不声明。
2. **权限请求必须落到我们的审批链**：`session/request_permission` → 复用本地审批卡（形态授权、超时、无人应答自动拒绝）；`toolCall.rawInput` 里的命令文本先过 `danger_reason` / `sensitive_path_reason`，命中即系统原生确认，**与 harness 给了什么选项无关**。
3. **新 IPC 命令一律走策略面**：为 ACP 新增的命令必须登记进受门控命令清单（租约或等价的策略校验），不做裸命令；`acp_*` 不得成为"任意路径读/写/执行"的新入口。
4. **渲染不得绕过消毒**：`session/update` 的文本走现有 Markdown 路径（无 raw HTML、链接走 `Link` 交系统浏览器）；`tool_call.content` 里的 diff 与文本一律按文本渲染，禁止 `innerHTML`（除非过 `sanitizeOutputHtml`）。
5. **开第二个 webview 时同批做三件事**：命令命名空间（agent 与 UI 分开）、按调用者鉴权（Tauri 注入的 webview 身份）、租约绑定 `webview_label`——这是补上 `security-model.md` §3.2 那个空维度的唯一时机。
6. **不加载远程内容**：CSP 现状不允许远程脚本/图片；harness 要展示网页就交系统浏览器，不在应用内嵌。
7. **harness 即"用户添加的可执行程序"**：设置页文案与首次连接确认必须写明"添加即授权"，并显示实际命令行。
8. **日志只记元数据**：ACP 请求/响应日志记录方法名、会话 id、通知类型；不记 prompt 全文与工具参数全文。

## 10. 分阶段

| 阶段 | 内容 | 验证方式 |
| --- | --- | --- |
| **P0 协议层** | `agent/acp.rs`：ndjson 编解码、请求关联、通知分发、取消、`initialize` / `session/new` / `session/prompt` / `session/cancel` / 权限应答；harness 配置读写 + `acp_handshake` 探测命令 | cargo 单测：用内存传输（`tokio::io::duplex`）驱动一个脚本化假 agent，覆盖握手、一轮 prompt、流式通知、权限请求与取消路径 |
| **P1 可见可用** | 工作区 harness 标签 + 设置页 harness 分组 + 事件 → ChatMessage/ToolRun 映射 + 停止 | vitest（映射与 store）+ e2e（假 agent：开标签、发一轮、看流式、点停止） |
| **P2 安全接入** | permission → 审批卡（形态授权 + 超时）+ `fs/*` 走策略 + 危险命令系统确认 | cargo（策略复用）+ vitest（权限映射）+ e2e（危险命令弹确认、无人应答自动拒绝） |
| **P3 体验** | `session/load` 恢复、模式只读展示、notice/plan、上下文用量条、用量页 `source` | 各层单测 + e2e |
| **P4 可选** | `terminal/*` 委托（命令经我们的 PTY，危险规则全覆盖）、MCP 透传、elicitation | 视需要 |

## 11. 待定决策

1. 第一版是否声明 `fs.writeTextFile`？（建议：声明，理由见 §3/§5）
2. 第一版是否声明 `terminal`？（建议：先不声明，代价是 harness 的命令我们看不到）
3. 用量口径是否接受「harness 来源只显示上下文占用/成本」？
4. harness 配置单开 `~/.vrykell/harnesses.json`，还是并进 `config.json`？
5. 入口（新建标签 + 全局搜索）与设置分组位置是否合适？
