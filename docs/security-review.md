# 安全性审查

> 针对 Vrykell 的历次安全审查汇总（最近更新 2026-08-26）。范围：后端 Rust（Tauri 命令、PTY、SSH/SFTP、SQLite、AI HTTP 客户端、web 抓取）、前端 React（IPC 调用、Markdown/HTML 渲染、密钥与配置处理）。
> 威胁模型：本机桌面应用，无远程服务端；主要风险面是「恶意远端（SSH/SFTP/AI/网页内容）」「恶意文件名/路径」「密钥明文落盘」「命令注入」「LLM 提示注入驱动的内网探测（SSRF）」。

---

## 已修复的安全问题

| 问题 | 严重度 | 修复 |
|---|---|---|
| `fs_rename` 的 `new_name` 可含 `/`/`..`，可把文件移出父目录 | 高 | 校验为单一 path component |
| SFTP 目录下载 `download_dir_recursive` 未校验远端条目名，`..`/含分隔符可路径遍历逃逸下载目录 | 高 | 拒绝 `.`/`..`/含 `/` `\` 的名称 |
| SSH 用户名为空时默认 `root` 登录 | 高 | 改为报错「用户名不能为空」 |
| `which_cmd_sync` 命令探测注入 | 高 | 保留白名单（字母数字 + `-._+`），并改用 `/bin/sh` |
| AI API key 明文写入 `~/.vrykell/config.json` 且未收紧权限 | 中 | 写盘后目录 0700、文件 0600 |
| `ai_stream` 无超时（网络挂起会无限等待） | 中 | 加 `connect_timeout(15s)` + 总 `timeout(180s)` |
| SSE 多字节字符跨 chunk 截断乱码（非安全，属健壮性） | 低 | 字节缓冲按 `\n` 切完整行再解码 |
| 迁移顺序错误导致启动 panic（`no such column: group_id`） | 高（可用性） | 索引创建移到 ALTER 之后 |
| **DNS 交替应答（重绑定）可绕过 SSRF 校验** | 高 | `PinnedResolver`：解析一次→校验→缓存（TTL 60s），连接复用已验证结果；攻击者无法在校验后注入内网 IP |
| **IPv4-mapped IPv6（`::ffff:127.0.0.1`）绕过内网拦截** | 高 | `is_private_ip` 对 mapped 地址按 IPv4 语义递归判断 |
| **代理误伤/绕过**：代理用户被本地 DNS 误拦；NO_PROXY 含 IP/CIDR 条目时校验被跳过；socks5 本地解析被跳过 | 中 | `proxy_does_remote_dns_for`：仅远端解析型代理（http/https/socks4a/socks5h）跳过 DNS 级校验；NO_PROXY 有 IP/CIDR 条目时保守保留校验；socks4/socks5 始终校验 |
| **代理不生效**：reqwest 默认不读环境变量代理 | 中 | `env_system_proxy` 构建 Proxy::custom（HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/NO_PROXY） |
| **响应体无上限读取（内存 DoS）**：web_fetch/crawl/search/registry/skills 全量 `text()/bytes()` | 中 | `read_body_capped` 流式截断（web 10MB、SKILL.md 1MB、安装文件 2MB） |
| **unchecked 抓取重定向无主机限制**（技能市场第一跳硬编码、重定向可逃逸） | 中 | `is_github_host` 白名单，第一跳与重定向都限制在 GitHub 域名 |
| **zip bomb：体积上限用 zip 头声明值（可虚报）** | 中 | 流式解压按实际写出字节计数，超限即中止 |
| **known_hosts 并发写互相覆盖** | 中 | `verify_host_key` 读-改-写包在进程级 Mutex 内串行 |
| 技能市场 GitHub URL 解析（`/tree/main`、`.git` 后缀误判） | 低 | 改用 `url` crate 标准解析，只取 owner/repo |

前端未发现高危 XSS：AI 输出经 `react-markdown`（未启用 `rehype-raw`）渲染，原始 HTML 会被转义；`BlockOutput` 的 `dangerouslySetInnerHTML` 仅用于渲染**本应用自己从 xterm buffer 生成的** HTML 快照（所有 cell 文本经 `escapeHtml`），非外部输入。

---

## 仍未解决（需单独评估，风险/改动较大）

| 问题 | 严重度 | 说明与建议 |
|---|---|---|
| SSH 首次连接 TOFU 无用户确认 | 高 | `ssh.rs::verify_host_key` 首次连接即信任并写入 `~/.ssh/known_hosts`，等于放行首次 MITM。建议：首次连接展示主机指纹要求用户确认后再写入。 |
| SSH 密码明文存 SQLite（`ssh_connections.password`） | 高 | 建议迁移到 macOS Keychain / Windows DPAPI，SQLite 只存引用。 |
| `HistoryDb::open().expect()` 启动 panic | 中 | DB 打开失败会直接崩溃；建议 `run()` 里降级为「历史功能不可用」或至少给出可读错误后退出。 |
| `sessions`/`groups` 迁移用「吞 ALTER 错误」方式碰运气 | 中 | 已能工作，但建议改为 `PRAGMA user_version` 版本化迁移，区分「列已存在」与「真实迁移失败」。 |
| 代理模式下主机名内网防护让渡给代理 | 低（既定设计） | 远端解析型代理接管域名解析，本地无法校验；前提是信任用户自己的代理。字面私网 IP 始终拦截。 |
| 直连模式 DNS 钉扎 TTL（60s）到期后重新解析 | 低（残余窗口） | 到期重解析会再次校验，交替应答只能造成"短暂不可用"而非穿透；如需零窗口可加长 TTL。 |

---

## 结论

本应用为本地桌面工具，攻击面有限；SSRF 面（web 工具 + 技能市场）已通过「DNS 钉扎 + 代理感知 + mapped IPv6 + 响应体上限 + 重定向白名单」系统性加固。主要残留风险集中在 **SSH 信任与凭据存储**（TOFU 确认、密码明文 Keychain 化）两项设计级改动，以及启动/迁移的健壮性。建议优先处理 TOFU 确认与 Keychain 存储。
