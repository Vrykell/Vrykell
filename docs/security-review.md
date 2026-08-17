# 安全性审查

> 针对 AI Terminal v2 的一次安全审查。范围：后端 Rust（Tauri 命令、PTY、SSH/SFTP、SQLite、AI HTTP 客户端）、前端 React（IPC 调用、Markdown/HTML 渲染、密钥与配置处理）。
> 威胁模型：本机桌面应用，无远程服务端；主要风险面是「恶意远端（SSH/SFTP/AI 服务）」「恶意文件名/路径」「密钥明文落盘」与「命令注入」。

---

## 已修复的安全问题

| 问题 | 严重度 | 修复 |
|---|---|---|
| `fs_rename` 的 `new_name` 可含 `/`/`..`，可把文件移出父目录 | 高 | 校验为单一 path component |
| SFTP 目录下载 `download_dir_recursive` 未校验远端条目名，`..`/含分隔符可路径遍历逃逸下载目录 | 高 | 拒绝 `.`/`..`/含 `/` `\` 的名称 |
| SSH 用户名为空时默认 `root` 登录 | 高 | 改为报错「用户名不能为空」 |
| `which_cmd_sync` 命令探测注入 | 高 | 保留白名单（字母数字 + `-._+`），并改用 `/bin/sh` |
| AI API key 明文写入 `~/.ai-terminal/config.json` 且未收紧权限 | 中 | 写盘后目录 0700、文件 0600 |
| `ai_stream` 无超时（网络挂起会无限等待） | 中 | 加 `connect_timeout(15s)` + 总 `timeout(180s)` |
| SSE 多字节字符跨 chunk 截断乱码（非安全，属健壮性） | 低 | 字节缓冲按 `\n` 切完整行再解码 |
| 迁移顺序错误导致启动 panic（`no such column: group_id`） | 高（可用性） | 索引创建移到 ALTER 之后 |

前端未发现高危 XSS：AI 输出经 `react-markdown`（未启用 `rehype-raw`）渲染，原始 HTML 会被转义；`BlockOutput` 的 `dangerouslySetInnerHTML` 仅用于渲染**本应用自己从 xterm buffer 生成的** HTML 快照，非外部输入。

---

## 仍未解决（需单独评估，风险/改动较大）

| 问题 | 严重度 | 说明与建议 |
|---|---|---|
| SSH 首次连接 TOFU 无用户确认 | 高 | `ssh.rs::verify_host_key` 首次连接即信任并写入 `~/.ssh/known_hosts`，等于放行首次 MITM。建议：首次连接展示主机指纹要求用户确认后再写入。 |
| SSH 密码明文存 SQLite（`ssh_connections.password`） | 高 | 建议迁移到 macOS Keychain / Windows DPAPI，SQLite 只存引用。 |
| `HistoryDb::open().expect()` 启动 panic | 中 | DB 打开失败会直接崩溃；建议 `run()` 里降级为「历史功能不可用」或至少给出可读错误后退出。 |
| known_hosts 并发写无锁 | 中 | 多个 SSH 连接同时建立时可能互相覆盖 known_hosts；建议进程级/文件级锁 + 仅在确有变更时写回。 |
| `sessions`/`groups` 迁移用「吞 ALTER 错误」方式碰运气 | 中 | 已能工作，但建议改为 `PRAGMA user_version` 版本化迁移，区分「列已存在」与「真实迁移失败」。 |

---

## 结论

本应用为本地桌面工具，攻击面有限；主要残留风险集中在 **SSH 信任与凭据存储**（TOFU 确认、密码明文）。其余（命令探测注入、路径遍历、文件权限、超时）已在本次审查中加固。建议优先处理 TOFU 确认与 Keychain 存储这两项，其余按需推进。
