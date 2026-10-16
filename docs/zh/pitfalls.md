# Vrykell 踩坑记录

> 依据 git 历史（140+ commits，2026-07 → 2026-09）与代码内注释整理。
> 每条尽量给出：**现象 → 根因 → 结论/修复**，并标注来源 commit，便于考古与回归。
> 分类导航：[战略级](#一战略级大坑) · [终端模拟](#二终端模拟--vt-解析) · [PTY/resize](#三pty--resize--尺寸) · [字符宽度](#四字符宽度--渲染) · [滚动/视口](#五滚动--视口) · [跨平台](#六跨平台) · [Tauri/Rust](#七tauri--ipc--rust-后端) · [持久化](#八sqlite--持久化) · [安全](#九安全) · [React/状态](#十react--zustand-前端状态) · [AI/流式](#十一ai--llm--流式) · [富内容](#十二富内容--latexmarkdown) · [测试](#十三测试) · [进程管理](#十四进程管理) · [UI/交互](#十五ui--交互)

---

## 一、战略级大坑

### 1.1 Electron `require('electron')` Bug —— 整个技术栈作废（`05c9d07` → `260bf48`）
- **现象**：v0.1.0 源码完成，但 Electron 28~32 下 `require('electron')` 返回路径字符串而非 API 对象，应用无法启动，全平台无解（Electron issue #49034）。
- **教训**：在核心链路上押注一个已知且无解的上游 Bug 是致命的。前后尝试了后安装补丁、ESM→CJS 桥接（`main-wrapper.mjs`）、模块解析补丁均失败。
- **结论**：整体迁移 Tauri 2（Rust 后端 + 系统 WebView），前端 ~85% 复用。迁移后删除了全部 Electron 残留、调试脚本与 `sdk/` 占位目录（`5256b25`、`87804b2`）。

### 1.2 自研终端模拟器 —— 两轮重写后放弃（Phase 2 → `9557cc0`/`78be803`/`6459ab1` → v2 回归 xterm.js）
- **过程**：先用 `TerminalBuffer + react-virtuoso` 替换 xterm.js，再自写完整 CSI 解析器，又把 buffer 重写为 VT screen model（screen + scrollback）、实现 DEC 1047/1048/1049 alt screen。每一轮都修掉一批 artifact，又冒出新一批（详见 §2、§4 的大量条目——其中多数坑正是自研期间踩出来的）。
- **结论**：写入开发规则第 12 条「**禁止自研终端模拟器**」，v2 委托 xterm.js，且约束「xterm.js 不可见」（只做 PTY 会话管理与 VT 解析，UI 是 Block 列表）。该路线归档至 `archive/v1-dom-terminal`。
- **教训**：终端模拟器是「与无数 TUI 的行数记账模型对账」的工程，宽字符、pendingWrap、alt screen、reflow、resize 语义每一项都能独立造出幽灵 bug；三轮补丁只能收窄、不能根除（`6459ab1` 原话）。

### 1.3 构建产物入库 —— 一次清理 3.1GB（`161d8f1`）
- **现象**：`dist/` 与 `target/` 被提交进仓库，共 3.1GB。
- **结论**：`.gitignore` 补 `target/`、`gen/`、`test-results/`；`package-lock.json` 反向修正为**必须**入库（曾被误忽略，`87804b2`）。

---

## 二、终端模拟 / VT 解析

> 本节多数为 v1 自研期踩坑，v2 换 xterm.js 后作为「为什么不自研」的注脚保留。

### 2.1 单一 lines 数组 + 绝对光标 = 与 TUI 记账永久脱同步（`6459ab1`）
- **现象**：TUI（Claude Code 等）出现残留字符、错位、幽灵光标，三轮补丁只能缓解。
- **根因**：buffer 是「一条永远增长的 lines 数组 + 绝对光标」。CUP 寻址到了 scrollback 而不是 screen；CUD clamp 到 9999 而非 rows-1；没有底边滚动。任何用绝对定位/滚动擦除的 TUI，其行数记账必然与我们脱同步——这是结构性根因。
- **修复**：重写为 VT screen model：screen 恒为 rows 行、光标 screen-relative、LF 在底行把顶行滚入 scrollback（alt screen 则丢弃）、ED 0/2/3 按 xterm 语义分层。

### 2.2 未知转义序列被「误译」为合法序列（`d4335f3`）
- **现象**：TUI 画面散落字符、多光标、下划线莫名出现。
- **根因**：解析器把三类不认识的序列翻译成了**别的合法序列**：
  - `ESC ( B`（字符集指定）只跳过 designator 字节，最终的 `B` 泄进文本流；
  - `CSI > 4 m`（xterm modifyOtherKeys）被当成 SGR(4)，后续全文下划线；
  - `CSI < u` / `CSI > u`（kitty keyboard protocol）被当成 RestoreCursor，光标瞬移到陈旧位置——这就是 Claude 帧被打散、「多光标」的真凶。
- **修复**：带 `> < =` 参数前缀的 CSI 整体忽略；charset 指定跳两个字节；`ESC 7/8` 正确映射 Save/RestoreCursor；ITU 冒号子参数（`SGR 38:5:220`）按分号处理。**并用真实捕获的 Claude Code 启动帧（100×30）做端到端回放测试断言零垃圾。**
- **教训**：解析器「尽力猜」不如「明确忽略」；误译比丢弃危害大得多。

### 2.3 ED（清屏）截断 lines 数组导致丢行（`1a403c7`）
- **根因**：ED 实现直接截断数组而不是只清空 cells。同 commit 还发现 `React.memo` 阻止重渲染——cells 被原地 mutate、引用不变，memo 判定「无更新」。
- **教训**：对可变数据结构用 `React.memo`/浅比较是隐性炸弹。

### 2.4 光标移动序列缺省参数不是 1（`1091ad8`）
- `CSI A`（无参数）语义是「上移 1 行」，实现里默认成了 0，spinner 重绘错位。

### 2.5 alt screen 激活时主 scrollback 仍被拼接显示（`f11a121`）
- **现象**：进入全屏 TUI 后，shell 历史仍显示在 TUI 上方，「不像全屏」。
- **根因**：`buffer.lines` 永远返回 scrollback + screen。
- **修复**：altActive 时只暴露 alt screen，退出恢复（xterm 语义）。

### 2.6 resize 只 clamp 光标、不 reflow → 历史输出永远保持旧折行（`2f52a0c`）
- 需要在 `TerminalLine.wrapped` 上跟踪软换行链，宽度变化时 iTerm2 式 reflow：链合并重切、不劈宽字符、硬换行保留、光标跟随逻辑位置。
- **后续反转**：v1 后期又改为 **no-rewrap resize（xterm 语义）**（`529ca65`）——Ink 式 TUI 的「向上重绘 N 行」记账依赖行数恒定，reflow 会破坏它；过长行改为渲染期裁剪（`b732817`）。两种语义各有适用对象，最终选边 xterm/Windows Terminal 行为。

### 2.7 宽字符双换行 + wrapped 标志中毒（`123f515`）
- **现象**：反复拖窗后 TUI 画面重复/错位。
- **根因**（三个叠加）：
  1. 宽字符（CJK/emoji）跟在 pendingWrap 满行后时 `putChar` 触发了两次 `lf()`——一次在宽字符边缘分支、一次在 pendingWrap 块，幽灵空行把后续所有行下移；
  2. 宽字符边缘分支把新行标记 `wrapped=true`，即使源行很短（被维度不匹配的 CUP/CHA clamp 过来），毒化 reflow 合并两条无关行（"Welcome back! back!"）；
  3. `resize()` 对「满但有 padding」的行丢 pendingWrap（恢复检查会 trim 尾部空白——但对 TUI 那些是写过的内容）。
- **教训**：pendingWrap 必须先于一切分支处理；「尾部空白」对 shell 是可丢的、对 TUI 是内容。

### 2.8 全屏 TUI 画面污染命令块历史（`d9ae0e1`）
- **现象**：vi/htop 退出后，块历史里留着一整屏冻结画面。
- **修复**：移除「alt buffer 最终画面回填块」的逻辑，块只保留 teardown 后的 shell 输出。

### 2.9 DSR 查询被静默丢弃 → PowerShell 提示符永不出现（`b2ab619`）
- **现象**：PSReadLine 启动即发 `CSI 6 n`（报告光标位置）并**阻塞等待**终端回 `CSI row;col R`；解析器不认识 `CSI n` 直接丢弃 → 提示符不渲染、输入无回显，看起来像「PowerShell 挂了」。
- **修复**：新增 `TerminalEvent::Dsr`，前端回复光标位置（dsr 6）/ terminal-ok（dsr 5）。
- **教训**：「静默丢弃未知序列」对查询类序列（DSR/DA）是死锁；同 commit 还修了「read 错误静默 break 循环」与「空 `$SHELL` 当有效值」。

### 2.10 alt 序列与其它 DEC 私有模式合写 → 全屏画面再次污染块历史
- **现象**：某些 TUI 用同一条 CSI 同时开启备用屏幕和其它模式（如 `\x1b[?1049;2004h`），强制结束后块历史里仍出现整屏 TUI 画面。
- **根因**：扫描器只按整串精确匹配 `\x1b[?1049h` 一类，合写的序列不匹配 → 原样进入运行中块的 xterm，块自己切到备用缓冲区；命令结束时提取的快照正是当前活动的备屏。
- **修复**：扫描器改为逐个参数识别（终止字节 `h`/`l` 且参数含 1049/1047/47 即判定），整串原始序列仍写主 xterm，保证 bracketed paste 等其余模式的语义不丢。Rust 扫描器、前端测试镜像与 e2e mock 三处保持一致。

### 2.11 手动全屏遮罩与真 alt 屏争用可见面 → 全屏 TUI 黑屏（`useTerminalSession.ts` `onSceneChanged`）
- **现象**：在运行中的块上先点「进入全屏交互」，程序随后进入 alternate buffer（cmdc/vim 等）时整屏变黑；「重绘终端」点了也没反应（它重绘的是被遮住的主 xterm 与收不到输出的块终端）。
- **根因**：真 alt buffer 的字节只写主 xterm（`routeData` → `sinks.writeMain`），而手动全屏恰好把主 xterm 隐藏（`showXterm = scene==='altScreen' && !altScreenActive`）改用块终端显示。旧代码只在场景切换时「不设置」手动全屏标志，**不会清除已经生效的那一个**，于是遮罩一直盖着真正的 TUI。
- **修复**：控制器报告真 `altScreen` 时，若该窗格正处在手动全屏，立即让出可见面（`setAltScreenActive(false)`，诊断标记 `manual-fullscreen-cancelled`）。回归见 `running-term.spec.ts`「手动全屏中进入真 alt 屏」与 `useTerminalSession.test.tsx` 对应用例。

### 2.12 图片粘贴走 `term.paste()` → 被 bracketed paste 包成一串文本（`terminalClipboard.ts`）
- **现象**：剪贴板里有图片时，终端里按 Ctrl+V 前台 CLI（Claude Code / cmdc 等）收不到原生粘贴键，图片粘不进去；日志 `terminal-clipboard-paste` 显示 `image:true, chars:0` —— 识别是好的，坏在传输这一段。
- **根因**：`term.paste()` 的语义是「写入**粘贴文本**」：前台程序开了 bracketed paste（DECSET 2004，真实 CLI 基本都会开）时 xterm 会把内容包成 `\x1b[200~…\x1b[201~`。而图片路径送的是**按键** `\x16`（Ctrl+V），被包起来后程序只会当成粘贴进来的文本字符。
- **修复**：图片路径绕开终端、直接 `ptyWrite(sessionId, '\x16')`；文本仍走 `term.paste()`，保住 bracketed paste 与换行归一化。回归：`terminal-paste-focus.spec.ts` 现在先在 TUI 里开 `\x1b[?2004h`，断言 PTY 收到的就是裸 `\x16`（改回 `paste()` 会变成 `\x1b[200~\x16\x1b[201~` 而失败）；`terminalClipboard.test.ts` 补了「终端实例已注册时也必须裸写」的用例 —— 旧用例只覆盖「没有终端实例」的兜底分支，所以一直绿。

### 2.13 整段粘贴一次 `pty_write` → 中断排在整段后面（`terminalWriteQueue.ts`）
- **现象**：粘一大段文本后终端像卡住：按 Ctrl+C 没反应，要等整段送完才轮到中断键；前台进程不读 stdin 时要等到会话结束。
- **根因**：`term.paste()` 一次 `onData`、一次 `ptyWrite`。Rust 侧 `write_all` 在消费者读完这一整段之前不返回，且一直握着 writer 锁，同一会话后续写入（含 `\x03`）只能排它后面；IPC 载荷与 blocking 线程也跟整段一起涨。
- **修复**：终端输入统一走 `terminalWriteQueue`（16K 码元分块、按码点切分、同会话串行）：慢消费者只压住当前块，`\x03` 先丢弃未送出的余块再插队；多行 / 超 64K 粘贴先经 `PasteConfirmHost` 确认。回归：`terminalWriteQueue.test.ts`、`terminalClipboard.test.ts`、`PasteConfirmHost.test.tsx`、`terminal-paste-large.spec.ts`。
- **教训**：「一次动作一次写入」在小数据上没问题，一旦数据量由用户决定就会拖垮取消语义 —— 可中断性要求写入本身可分。

### 2.14 每个输出块各写一条终端日志 → 整屏 TUI 把日志写到分钟级 MB（`io_window.rs`、`sessionController.ts`、`useTerminalSession.ts`）
- **现象**：整屏 CLI 一跑起来日志就按分钟膨胀：实测一段 4.5 分钟的会话写出 87,919 条 / 23.9 MB，繁忙秒约 420 条、峰值 876 条/秒，每个输出块 5–7 条记录（`read-chunk`、`output`、`pty-output`、`controller-events`、`route-data`）；诊断写盘队列积压到 1.5 s（p95，中位 36 ms），另一段 13 分钟的会话写到 84 MB。粘贴 3.8 MB 时「输入到下一帧」间隔出现 6.3 s / 12.3 s / 10.2 s —— 卡顿感有一部分就是日志自己造出来的，也把真正有用的记录挤出内存环。
- **根因**：同一个输出块在流水线上被数了五次，而块的频率由前台程序决定（整屏应用每帧一块）—— 于是日志量正比于帧率，谁跑 TUI 谁就把日志写爆。
- **修复**：两端都改成按秒窗口聚合。Rust 端用 `pty-io`（`reads/read_bytes/chars/max_read/outputs/events/data_bytes/osc/alt/held/max_gap_ms`）替代 `read-chunk` + `output` + `input-response-batch`；前端用 `terminal-io` 一条记录汇总 rx（IPC 收包）/ ctl（控制器入口）/ 路由去向（main / block / early 的块数与字符数、`maxChars`、命令回显过滤）。停顿不再靠「没有记录」推断：整段静默按 1 s、2 s、4 s… 翻倍记 `read-idle`。回归：`io_window.rs` 单测、`terminalIoLog.test.ts`。
- **教训**：日志粒度要跟着「事件频率由谁决定」走；把用户能决定大小的数据逐块记，等于把日志体积也交给用户。

### 2.15 身份包的 `Application` 指向应用自身 → 右键资源管理器时正在运行的应用被系统终止（`AppxManifest.xml`、`shell_host.cpp`、`manage.ps1`）
- **现象**：应用正在使用（终端里在跑 TUI、日志正常滚动）时，用户在**资源管理器里右键一个文件夹**（甚至还没点菜单项），整个应用窗口**直接消失**，进程干净退出：Windows 事件日志没有崩溃记录、应用自己的诊断日志也停在死亡那一刻。`Microsoft-Windows-AppModel-Runtime/Admin` 里能对上：右键瞬间创建了一次 AppX 激活（Id 210/211），一秒后该激活被终止（Id 217），运行中的应用就死在 Id 217 那一刻。实测复现：从 PowerShell 触发该包的 COM 服务器激活（`[Activator]::CreateInstance(GetTypeFromCLSID('{8D41BA19-…}'))`），**所有** `vrykell.exe` 进程（含其它 worktree 的 debug 实例）同时消失。
- **根因**：身份清单为了挂 `windows.fileExplorerContextMenus` 必须有 `<Application>`，而当时声明的 `Executable="vrykell.exe"` **就是应用自己的可执行文件**。于是 Windows 把**任何**名为 `vrykell.exe` 的进程都当成该包的应用（`FinishPackageActivation` 事件连 worktree 里不同路径的 debug 实例都记）；而 shell 扩展的 COM 激活结束时，AppModel 会终止这个包的应用进程 —— 右键（加载扩展、随后释放）就足以杀掉正在使用的应用。又因为多个实例共用同一个 WebView2 用户数据目录（浏览器进程共享），被杀的实例还会把其它实例一起带走。
- **修复**：给身份包一个**专用宿主** `windows-context-menu\VrykellShellHost.exe`（`shell_host.cpp`，只转发启动、不承载业务），清单的 `<Application Executable>` 指向它，应用自己的 exe 不再进入包身份。三处防回归：`prepare-context-menu.mjs` 在打包前断言清单声明的是宿主（否则构建失败）、`manage.ps1` 把「声明了别的可执行文件」判为 `available=false`（拒绝启用）、`scripts/test-context-menu.ps1` 断言启用后 `available/stale` 状态正确。同时 `manage.ps1` 现在会在启用时清理旧的内容寻址 DLL，并通过 `stale` 报告「注册指向旧包/旧可执行文件」，设置页提示重新启用（应用更新后必须重新注册，否则仍加载旧扩展）。
- **教训**：稀疏身份包（sparse MSIX）的 `<Application Executable>` 不是「声明一下」——它把该镜像名的**所有**进程都纳入包身份与应用生命周期管理。凡是给桌面应用加 shell 集成，都要用专用宿主承载身份，绝不能让应用自身出现在身份清单里；另外「同一应用多实例」在 WebView2 下是共享浏览器进程，任何一次进程级终止都会连坐所有实例。

---

## 三、PTY / resize / 尺寸

### 3.1 resize debounce 的加与撤 —— 症状治理 vs 根因（`83913b6` → `9f7e8ae` revert → `9966540`）
- **第一版**：ResizeObserver 每像素变化都发 resizePTY，SIGWINCH 洪泛，文本按旧列宽折行 → 加 200ms debounce。
- **反转**：debounce 被 revert。真根因是**在途输出与 buffer 维度错位**：窗口拖动时，已在 IPC 路上的输出按旧宽度生成，却被应用到已 resize 的新 buffer，折行与写入方意图不符，幻影行使 TUI 帧记账永久脱同步。
- **最终修复**：Rust 给每个 `pty:output` 批次**打上生成时的 cols/rows 标签**（每会话维度原子更新，仅在 PTY resize 成功后写入）；前端应用事件前先把 buffer resize 到批次标签值，且不再在 onResize 里直接 resize buffer。
- **教训**：「输出属于哪个维度」必须随数据流动，而不是靠两端各自猜时序。

### 3.2 初始 PTY 维度用 80×24 默认值 → 首帧就散（`cb346f7`）
- **根因**：实际终端区因 380px AI 侧栏只有 ~60 列可见，Claude 按 80 列渲染 → 每行都折行 → 字符散落。
- **修复**：按 `(windowWidth - 390) / 8.4` 估算 cols，ResizeObserver 挂载后精调。
- **后续坑中坑**：估算无条件减 390px，但侧栏初始是折叠的 → 首帧又窄了 ~40 列（`69061f4` 顺带修复）；再后来 blockList 场景卡片比主表面窄 ~50px，满宽输出在卡片右缘被裁（`useTerminalSession.ts` 场景感知宽度注释）。

### 3.3 resize 后 CUP/CHA 不 clamp 目标列（`f0f7eac`、`d94903d`）
- **现象**：120 → 60 列后，TUI 用 `CUP 10;80` 定位，`putChar` 用空格把行垫到 80 列 → 字符散乱。
- **两轮修复**：先 clamp `cx`，后发现 CUP/CHA 的目标列**同样**要 clamp，且要在结构化事件与 `write()` CSI 表**两条路径**都修。
- **教训**：同一个语义在多条代码路径上实现时，修 bug 必须搜齐所有路径。

### 3.4 折叠面板宿主宽度读成 0 → PTY 挤成 2 列（`useTerminalSession.ts` 注释；Phase 8「全屏 TUI 宽度塌缩为 2 列」）
- **根因**：场景镜像状态（onSceneChanged 同步）滞后于 store——手动全屏只写 `store.scene` 不回调，本地镜像停在 blockList，走了卡片宽分支，而宿主 `display:none` 时 `clientWidth≈0`。
- **修复**：以 store 场景为准；宿主宽 ≤0 时退回主 xterm 全宽，等 ResizeObserver 落位后再校正。
- **相关**：分屏 pane 空白同理，PTY 用 0×0 启动 → 兜底 80×24（Phase 10）。

### 3.5 pty_write 持锁阻塞写 → 缓冲区满时「结束」按钮也卡死（`code-audit.md` 高优）
- **现象**：写入持会话锁且无超时，PTY 缓冲满时整个会话的所有操作（包括 kill）被卡死；这些 command 又是同步的（跑在主线程）→ 整个 UI 冻结，只能强杀应用。
- **根因**：会话锁同时被「可能无限阻塞的写」与「resize / close / kill」争用，且后三者同步跑在主线程。
- **修复**：writer 从会话锁里拆出来（独立 `Arc<Mutex<..>>`），阻塞写不再占用会话锁；`pty_resize` / `pty_close` / `pty_kill_foreground` 改 `async` + `spawn_blocking`，阻塞调用不再跑在主线程。
- **验证**：日志里 233 次写入全部 ≤1ms，而 `pty_resize` 最慢 542ms、`pty_close` 667ms —— 卡的正是这些调用本身。回归测试 `session_lock_stays_free_while_a_write_is_stuck`（真实 PTY + 从不读 stdin 的子进程 + 8 MiB 写）：写卡住时会话锁 800ns 可取得；把写改回「持会话锁」后同一条测试 3s 超时失败。
- **附带**：首击「结束」发 Ctrl+C 本质是往 stdin 写输入，写通道被卡住的写占用时送不进去 → 给写锁 1s 上限，超时返回可操作错误（升级窗口内再点一次即强杀）。

### 3.6 GUI 启动缺 TERM/COLORTERM → TUI 应用挂起（`4c4f15a`）
- **现象**：从 Finder/Dock 启动时 `TERM` 为空，zsh 退化为 dumb，依赖终端能力检测的全屏 TUI（truecolor 应用）挂起/黑屏。终端里启动则正常——**只有 GUI 冷启动路径能复现**。
- **修复**：`pty_spawn` 时两者为空则补 `xterm-256color` + truecolor，用户显式设置优先。

### 3.7 GUI 启动缺用户 bin 目录 → PATH 与终端不一致（Phase 14，`pty.rs` `merge_user_bin_paths`）
- GUI 进程不经过登录 shell，`/usr/local/bin`、Homebrew 目录不在 PATH。修复为合并注入且不丢继承 PATH、去重。

---

### 3.8 画布缩放产生空白帧

尺寸测量前清空渲染器会多产生一帧空白，画布本身改变尺寸也会先清空像素、随后才异步重绘。统一通过缩放适配器处理，在该帧呈现前完成重绘。同步绘制依赖内部渲染能力，版本相关访问集中在适配器中并做能力判断。不要延迟输入或增加长时间 resize 防抖。首个 PTY 尺寸立即发送，相同尺寸去重，IPC 忙时只保留最新待发送尺寸。`terminal-resize-frame` 记录画布几何位置，`terminal-input-render-complete` 记录输入至下一次绘制耗时，用于区分布局位移、输出延迟与绘制延迟。


## 四、字符宽度 / 渲染

### 4.1 手写 charWidth 表与 TUI 的 string-width 记账不一致 → 光标劈成两半（`69061f4`、`3eb3b7e`）
- **现象一**：零宽修饰符（VS16 U+FE0F、ZWJ、组合记号）被算 1 列写进 cell → 渲染出 `?` 垃圾。
- **现象二**：emoji presentation 字符（✨ ⏸）算 1 列而 TUI 算 2 列 → 整行右移、幻影折行，TUI 的 erase-lines 重绘永远擦不掉旧帧（96 列欢迎框残影在 140 列重绘后仍在）。
- **现象三**：手工挑的 BMP emoji 段漏掉 `▶ ◀ ⚠ © ® ™`（Ink/string-width 算 2 列），每漏一个该行少算 1 列 → TUI 垫到恰好 cols 的行在我们这是 cols+1 → 折行 → 插入幻影行把光标「劈成两半」。
- **最终修复**：**不再手写**——用 string-width@7 对每个 emoji 码点实测生成权威表，测试锁死两侧（2 列：▶◀⚠©®™；1 列：❯●⧉←·✘✦）；`©®` 在 CJK cutoff 之下、必须在 `< 0x1100` 早返回**之前**检查。另加 dev 模式 wrap forensics：alt screen 内任何自动换行（TUI 帧本不该折行）console.warn 行尾码点。
- **教训**：与外部程序共享「列数」这一记账单位时，宽度表必须来自同一权威实现，手工挑必漏。

### 4.2 xterm cellWidth 与浏览器字体渲染差 ~4% → 块结束瞬间折行（`c39e74e`）
- **现象**：运行中的块一切正常，命令**结束的瞬间**快照折行。
- **根因**：活终端画布按 xterm cellWidth（≈8.16px）排布，完成块 HTML 快照按浏览器字体渲染（≈8.43px）。同列数下快照比卡片宽。
- **修复**：blockList 场景改用 DOM 实测字符宽（探针 span 100 个 'W' 取均值，缓存）定列数；手动全屏（纯 canvas）仍用 cellWidth。

### 4.3 xterm 尺寸无公开 API，只能读私有 `_core._renderService.dimensions`（`lib/termMetrics.ts`）
- 曾有三处各自内联这段私有访问，升级 xterm 需同步多处 → 收敛为 `getCellMetrics()` 单点，取不到时回退默认值（7.8/14）。**升级 xterm 时需回归验证此私有路径。**

### 4.4 DOM renderer 的半块字符横缝（`useTerminalSession.ts` WebglAddon 注释；`3d6b4fb`）
- **根因**：DOM renderer 按字体 baseline 排 CSS 行盒，`▀▄` 半块字符上下行之间必然留缝（TUI 图标/对话框出现横裂缝）。
- **修复**：WebGL renderer 按 cell 精确对齐；WKWebView 无 WebGL 时 try/catch 回退 DOM renderer（缝隙在无 GPU 环境**无法根治**，只能接受）。

### 4.5 块输出快照的内容嗅探误判（`TerminalBlockList.test.tsx` 回归注释）
- 旧逻辑用 `includes('<span')` 嗅探 HTML，对无样式多行输出（`file1<br>file2`）误判为纯文本 → 渲染出可见的 `&lt;br&gt;` 乱码。嗅探特征必须覆盖生成器的全部结构（br 也算）。

### 4.6 超长行不裁剪 → box-drawing 行折行打散整个网格（`b732817`）
- no-rewrap resize 后保留行可能超出可见列数；box-drawing 渲染路径没设 `whiteSpace`，过长行折到第二个视觉行，整个网格 desync。所有渲染路径 `end = min(contentEnd, cols)` + `overflow:hidden` + 固定高度。

### 4.7 完成块快照的行高按字号公式估算 → 反白/块画逐行重叠（`terminalFont.ts` `measureTerminalDomCellHeight`）
- **现象**：TUI CLI（如 Command Code）的启动 logo 用**反白空格**铺出整行底色，在**已完成块的历史**里退化成一条条互相重叠的横条；同一个程序在别的终端里正常。
- **根因**：同一张网格有两个尺寸来源。实时画布用 xterm 实测的单元格高度（`getCellMetrics().height`，14px 字号下 **20px**）；完成块的 `outputHtml` 快照用 CSS 变量 `--terminal-row-height`，取值是字号公式 `ceil(fontSize * 16/14 * lineHeight)`（同设置下 **16px**）。差 4px：每行 20px 高的底色落进 16px 的行距，下一行的底色盖住上一行字形的下沿，整块画面被切成条带。纯文本看不出问题——只有整行着色的内容会暴露它。
- **修复**：`--terminal-row-height` 改为**按解析后的字体实测**：`floor(自然行高 × lineHeight)`——与 xterm 的推导一致（8 个字号 × 3 个行距的实测矩阵全部吻合），由终端层在字体加载完成和字体设置变化时发布；字号公式只作无测量 DOM（单测）时的兜底。`config/typography.ts` 不再猜这个值。
- **残留风险（未修）**：东亚「歧义宽度」字符（`█▀▄─│` 等 U+2580–259F）在浏览器里按**整宽**字形渲染（实测 14px = 2 格），而 xterm 按 1 格记账（`getCell().getWidth() === 1`）。若某个 TUI 用块字符作画，快照的该行会横向溢出并换行；本例的 CLI 用反白空格作画，未触发。修它需要在快照里强制单元格步进（或换字体栈），代价与影响面都比这次的行高大得多，留作独立改动。
- **教训**：行高不是「字号 × 一个系数」。终端是一张网格，尺寸必须来自与画布同一次的实测；凡是「画布与 DOM 要还原同一张网格」的地方，都不能各自用公式推。

---

## 五、滚动 / 视口

### 5.1 「打字跳视口」顽疾 —— 真凶是隐藏 textarea 在滚动容器里（`cf40d69`，历经 `05004f4`/`5fdee90` 两轮误诊）
- **现象**：输入字符时视口瞬移，长期无法根治。
- **误诊一**（`05004f4`，未进 dev）：以为是 nearBottom 覆盖逻辑。
- **误诊二**（`5fdee90`）：nearBottom 子句把距底 5 行内的渲染 slice 吸附到 maxScroll（任何重渲染都瞬移视口）——修了它，又给 onScroll 加 150ms 输入守卫回滚下滚。仍非根因。
- **真根因**：IME/键盘隐藏 textarea 放在**虚拟滚动容器内部**，用 `bottom:(lines-1-cy)*LH` 锚定。绝对定位子元素的 `bottom` 相对 scroller 的 **padding box（≈首屏）**解析而非内容 → 长 scrollback 时 textarea 悬在光标 intended 位置上方几百像素处，Chromium 每次按键的 scroll-caret-into-view 把视口传送过去。**没有任何 JS 写 scrollTop**（用 setter trap 在真实 Chromium 复现确认）。
- **修复**：textarea 移到非滚动 wrapper，用视口相对坐标（`top = cy*LH - scrollTop`）；IME 候选窗仍跟随光标。配 Playwright 回归（滚上去打字，scrollTop 不许动）。
- **教训**：「浏览器自己滚的」也是滚动源；输入元素永远不要放进滚动容器。

### 5.2 容器变高时 scrollTop 与渲染 slice 脱钩（`1be4bdb`）
- **根因**：窗口变高 → maxScroll 变小，但元素实际 scrollTop 保持旧大值，渲染却按新 maxScroll 算 slice → 底部显示陈旧内容。ResizeObserver 需在 pinned 时重钉 scrollTop。

### 5.3 follow-bottom latch 被「迟到 scroll 事件」误杀（`useFollowBottom.ts`）
- snap 后读回浏览器 clamp 过的实际 scrollTop 存 ref；内容增长时浏览器发出的迟到 scroll 事件若直接与阈值比较会误判「用户已上滚」。真实浏览器 `scrollTop=scrollHeight` 会被 clamp 到 `scrollHeight-clientHeight`，测试必须模拟这一行为。

- 内容增长和浏览器滚动锚定可能先于尺寸回调改变位置；布局触发的滚动事件应保留跟随状态，并容忍程序滚动的小数偏差。重新挂载时单独保存跟随状态，不能根据旧位置推断，因为隐藏期间输出可能增长；观察整个输出包装层。历史提交后通过 layout effect、尺寸回调在绘制前贴底，延后到下一动画帧会露出一帧跳动。换行输出不能使用估算固有高度，否则进入视口时会改变整棵历史树的高度。

### 5.4 运行块「挂载前输出」后首次上滚跳到回溯顶部（滚动模型与 buffer 脱同步，`TerminalBlockList.tsx` RunningTerm）
- **现象**：命令开始 2 秒内（运行块挂载前）输出超过一屏，之后第一次在活终端上滚会直接跳到回溯最顶；视口不再在底部，新输出不再跟随，需手动滚回底部。
- **根因**：块内活终端「先写入、后 open」（headless 写入）。无头期间渲染尺寸为 0，输出滚屏时写给滚动模型的位置是 `视口行号 × 行高(0) = 0`，模型停在顶部而 buffer 已在底部；open/尺寸变化只更新模型范围、不写位置，首次滚轮以模型位置 0 为基准计算 → 钳到 0 → 视口被拉到最顶。挂载后发生任何真实滚动（哪怕一行输出滚屏）都会自愈，纯等待不会。
- **修复**：首次挂载后一帧，若视口在底部则 `scrollToTop()` + `scrollToBottom()` 强制两次真实滚动把正确位置写回模型；单独 `scrollToBottom()` 在底部算出 0 行差是 no-op。调度放在 `term.element` 判断之外，StrictMode 双挂载下第二次挂载仍会调度。
- **回归**：`running-term.spec.ts`「运行块挂载前到达的输出不破坏首次滚轮回溯」。

---

## 六、跨平台

### 6.1 PowerShell 5.1 无 BOM 时按 ANSI 读 .ps1 → 注入脚本必须纯 ASCII（`shell_integration.rs:61`）
- shell integration 脚本含任何非 ASCII 字符（包括中文注释）在 Windows PowerShell 5.1 下乱码执行失败。**脚本必须纯 ASCII**。

### 6.2 前端发 `\n`，PowerShell/cmd 收不到回车（`pty.rs:445`）
- 命令发送必须归一化 `\n` → CR，否则 PSReadLine/cmd 无响应。

### 6.3 BSD ps 没有 `--ppid`（`3bc60eb`）
- 检测前台进程改用 `ps -axo pid=,ppid=` 自行建树。GNU 习惯参数在 macOS 不存在。

### 6.4 Windows 杀 shell 留孤儿前台应用（`pty.rs` 多处）
- 只 TerminateProcess 根 shell，vim/构建等前台应用继续活着。必须用 Toolhelp 快照收集**整棵进程树**连带终结；kill 后必须 `wait` 回收，否则僵尸进程。

### 6.5 macOS 12 WKWebView 不支持正则后瞻（开发规则第 13 条；`24aff5a` remarkGfmSafe）
- `(?<=…)`/`(?<!…)` 构造即抛 `SyntaxError: invalid group specifier name`。受害最深的是 remark-gfm 的 autolink-literal（邮箱/URL 识别用 lookbehind），**任何含裸链接的 AI 回复都击穿渲染**。
- **修复**：`remarkGfmSafe` 按原装配方重组 GFM 四功能，唯独剔除 autolink-literal——代价是裸 URL 不成链接，换全平台一致。
- **同类**：WKWebView 的 xterm helper 元素需要专门 CSS 兼容（`9d42419`）；无 WebGL 时 xterm 回退 DOM renderer（§4.4）。

### 6.6 Windows 默认 shell 探测每次 spawn 都很慢（`pty.rs:302`、`shells.rs:105`）
- pwsh 探测可达数百毫秒且 `list_shells` 曾在主线程同步跑多个 `Command::output()` → UI 冻结。修复：进程内缓存 + async/spawn_blocking 移出主线程。

---

## 七、Tauri / IPC / Rust 后端

### 7.1 大事件批次超 Tauri IPC 消息上限被截断（`7e34192`）
- **现象**：Claude TUI 一帧 500+ 事件，JSON 序列化超限 → 前端收到截断的损坏事件。
- **修复**：每次 emit 最多 128 事件分批。
- **教训**：IPC 消息大小有隐性上限，高频批量数据必须分批 + 合批两头控制（输出侧同样做了按字节阈值 flush，`pty.rs:421`）。

### 7.2 Tauri 2 配置键名是 `windowEffects` 不是 `effects`（`7e84e63`）
- 写错不报错直到 schema 校验；`cargo tauri dev` 才能发现。

### 7.3 serde snake_case 与前端 camelCase 不匹配 → 历史分组「不可见」（Phase 9）
- 字段静默序列化成另一种命名，前端读到 undefined，功能整体失效但无任何报错。AI 模型配置同样要求 camelCase 对齐（`ai.rs:27` 专门注释）。
- **教训**：Rust↔TS 边界每个 struct 都要显式 `#[serde(rename_all)]`，并靠共享类型/测试锁死。

### 7.4 UTF-8 多字节字符跨边界被切断
- **PTY 输出侧**：流式解码跨 read 边界产生 U+FFFD 乱码（Phase 7 修复）；非法字节需「丢 n 字节补 U+FFFD 继续循环」（`pty.rs:37`）。
- **AI SSE 侧**：按 chunk 独立 `from_utf8_lossy` 导致乱码 → 字节缓冲按 `\n` 切完整行再解码（`ai.rs:454`）。
- **搜索侧**：内容匹配上下文切片未对齐 UTF-8 边界，**中文文件搜索直接 panic** → `floor/ceil_char_boundary`（`search.rs:172`）。
- **Rust scan 侧**：flush 文本事件的 end 必须是字符边界（`scan.rs:43`）。
- **教训**：任何「字节流切片」都必须过 UTF-8 边界检查这一关，四处独立踩过同一个坑。

### 7.5 同步 command 阻塞主线程/async runtime
- `fs_list` LIKE 全表扫描、`which_cmd_sync` spawn 登录 shell（zshrc 重时 50-500ms）都曾在主线程/runtime worker 上同步跑 → UI 卡顿。修复：async + spawn_blocking（`fs.rs:251`、`file_open.rs:157`、`shells.rs:105`）。

### 7.6 MCP 子进程 stderr 不排空 → 管道写满卡死子进程（`mcp.rs:260`）
- 后台线程持续排空 stderr（日志丢弃，v1 取舍）。同类：`shell_integration.rs:300` 测试中阻塞读也要放后台线程，否则测试卡死。

### 7.7 环境变量是进程级状态，测试并行互相污染（`web.rs:1106`）
- 改代理环境变量的测试必须串行化。

### 7.8 Tauri 内部环境检测 —— 拖拽功能在浏览器里静默失效（`7860ee3`）
- e2e/浏览器环境没有 `__TAURI_INTERNALS__`，拖拽等依赖 Tauri API 的路径需先 `is_in_tauri_env` 检查。

### 7.9 GUI 启动的 shell 没有 locale → vi 等全屏程序中文乱码（`pty.rs:merge_locale_env`）
- **现象**：GUI 启动（Finder/Dock，无 `LANG`/`LC_*`）时，`vi` 打开 UTF-8 文件，中文显示成 `~H`、`~@`、`~C` 之类；`cat`/`ls` 却正常。
- **根因**：区域感知的程序按 `LC_CTYPE`（缺省 C）选择编码。vim 于是按 latin1 读取文件，把每个 UTF-8 汉字的 C1 高位字节画成 `~X`；只透传字节的程序不查 locale，所以看起来没问题。Terminal.app/iTerm 会自己设置 locale，所以同一个命令在别的终端正常。
- **修复**：`spawn_pty` 里 `merge_locale_env` 与 `merge_term_env` 并列——环境里没有任何 UTF-8 请求时补 `LC_CTYPE`（macOS 用 `en_US.UTF-8`，其它 Unix 用 `C.UTF-8`），`LANG` 为空时一并补；已有 UTF-8 时不动，保持用户语言。
- **教训**：GUI 启动缺的不止 PATH/TERM，还有 locale；凡是「本地正常、GUI 异常」的文本问题，先看 `LANG`/`LC_CTYPE`。

---

## 八、SQLite / 持久化

### 8.1 迁移顺序错误 → 启动 panic `no such column: group_id`（Phase 9）
- 索引建在 ALTER 之前。先 ALTER 后建索引。

### 8.2 迁移靠「吞 ALTER TABLE 错误」碰运气（`code-audit.md` → `security-review.md`）
- 无法区分「列已存在」与真失败。→ `PRAGMA user_version` 版本化 + `ensure_column` 逐列检查。

### 8.3 逐列迁移仍不够：旧库缺列 → 历史块静默消失（`c64a24d`）
- v1 库缺 `output_html` 列，`record_block`/`get_session_blocks` SQL 失败，但失败被吞 → 块不落库、重载会话后块消失，**用户只看到「历史没了」**。
- **结论**：本地缓存型数据库不做考古式迁移——`user_version < 2` 整库删除从零建表。数据可再生时，「删库重建」比「迁移矩阵」便宜且可靠得多。

### 8.4 `INSERT OR IGNORE` 静默丢真信息（`code-audit.md`、`db/session.rs:10`）
- 先落库的兜底行（占位）让后续真 title/cwd/created_at 全部被 IGNORE 掉。→ `ON CONFLICT DO UPDATE`。同类：record_block 前兜底 INSERT OR IGNORE 保外键，块才不会被静默丢弃（`session.rs:176`）。

### 8.5 `HistoryDb::open().expect()` → 启动即 panic（`code-audit.md`）
- 库文件损坏/权限问题时应用直接起不来。→ 降级为内存库：历史不可用，应用继续跑。
- **教训**：非核心子系统（历史/缓存）故障绝不允许击穿启动。

### 8.6 落库 HTML 快照的注入面（`593edad`、`cdc146c`）
- `outputHtml` 落库后经 `dangerouslySetInnerHTML` 渲染，DB 文件被篡改即可注入。→ `sanitizeOutputHtml` 白名单（span 的受限 style + br），**恢复（sessionManager）与渲染（BlockOutput）两侧都净化**——单侧净化等于没净化。

### 8.7 退出时归档 active 会话 → 「上次打开的标签」全丢（`d61b5a1`、`lib.rs:30/191`）
- active 的语义应是「上次打开未关闭」，启动由前端恢复；退出自动归档把它变成了「每次重启都从零开始」。移除退出归档。

### 8.8 恢复会话丢元数据（`code-audit.md`）
- `restore()` 只写 `{id,title,kind,cwd}`，shellType/ssh 元数据丢失 → SSH/指定 shell 标签恢复后 spawn 成默认 shell。`RestoreMeta` 补齐；旧持久化没有 paneId 的块「仅面板可见，不进块流」（`sessionManager.ts:178`）。

### 8.9 API key 明文落 config.json 且权限全开（`security-review.md`）
- 已修：API Key 与 SSH 密码统一进平台密钥存储（`secret.rs`）——Windows 用 DPAPI 加密后写 `secrets.json`（只有当前用户能解），macOS 进钥匙串，其它平台回退 0600 文件（无系统密钥环，属已知限制）。`config.json` 用 `skip_serializing` 不再包含 key；不做明文迁移——运行时只接受能解密的密文，未封存（旧明文）或损坏的值一律按缺失处理、不作密钥使用，重新输入一次即会加密覆盖；文件权限仍收紧为目录 0700 / 文件 0600 作为纵深防御。旧版本构建读不到迁移后的 key（会显示「未配置」），需要重新填入。

---

## 九、安全

> 完整清单见 `docs/zh/security-review.md`，此处只记「差点没想到」的坑。

### 9.1 DNS 重绑定绕过 SSRF 校验（`6c94150`）
- 「解析 → 校验 IP → 再发起请求（重新解析）」的窗口里，攻击者交替应答即可让第二次解析返回内网 IP。
- **修复**：`PinnedResolver` 解析一次 → 校验 → 缓存（TTL 60s），连接复用已验证结果。
- **教训**：SSRF 校验必须与**实际连接用的 IP** 绑定，「校验的」和「连接的」是两次解析就等于没校验。

### 9.2 IPv4-mapped IPv6（`::ffff:127.0.0.1`）绕过内网拦截（`web.rs:316/1071`）
- `is_private_ip` 必须对 mapped 地址按 IPv4 语义递归判断。

### 9.3 代理三坑（`web.rs:256-259`）
1. reqwest **默认不读环境变量代理** → 代理用户全部直连（`env_system_proxy` 手工构建）；
2. NO_PROXY 含 IP/CIDR 条目时若跳过校验，无法排除「域名绕过代理直连内网」→ 保守保留校验；
3. 只有远端解析型代理（http/socks5h）才可以跳过本地 DNS 校验；socks4/socks5 本地解析必须始终校验。

### 9.4 zip bomb：用 zip 头声明的体积做上限（`skills.rs:403`）
- 声明值可虚报。必须按**实际写出字节**流式计数，超限中止。同类：所有 HTTP 响应体一律 `read_body_capped` 流式截断（web 10MB / SKILL.md 1MB / 安装文件 2MB），全量 `text()/bytes()` 是内存 DoS 面。

### 9.5 重定向逃逸「硬编码可信主机」承诺（`web.rs:424`）
- 技能市场第一跳硬编码 GitHub，但重定向可以去任何地方 → `is_github_host` 白名单对第一跳**和每一跳重定向**都生效。

### 9.6 known_hosts 并发读改写互相覆盖（`ssh.rs:75`）
- 多个 SSH 连接同时 TOFU 写 known_hosts，后写覆盖前写且 `write_file` 整文件覆盖会破坏其它主机记录 → 进程级 Mutex 串行「完整读入-改-写」。

### 9.7 SSH 主机名参数注入（`c7700b8`、`pty.rs:131`）
- 主机名以 `-` 开头可注入 `-oProxyCommand=…` 获得任意命令执行 → 拒绝 `-` 开头/含空白。
- **同类思维**：远端注入脚本必须是二进制内静态常量（不落盘、不拼接远端数据）、base64 传递、`umask 077 + mktemp`；`exec "${SHELL:-sh}" -i` 加引号防词分裂——恶意 `$SHELL` 只会连接失败，绝不执行。

### 9.8 空用户名默认 root（`ssh.rs:52`）
- 「方便」的默认值在凭据操作上是事故放大器。直接报错。

### 9.9 `fs_rename` 的 new_name 可含 `/`、`..`（`fs.rs:187`）
- 重命名接口天然是路径遍历入口，必须校验单一 path component。SFTP 递归下载同病：远端条目名未校验可逃逸下载目录（拒绝 `.`/`..`/含分隔符）。

### 9.10 WebView 无 CSP + asset scope `$HOME/**` 全开（`c7700b8`）
- 修复：CSP（script 仅 self/inline、connect 仅 ipc、无远程 img、禁 object/frame）；asset scope 收窄 `$APPDATA/**`；壁纸按用户选择动态 `allow_file` 授权。
- **残留取舍**：script-src 含 `'unsafe-inline'`（dev 模式 Vite HMR 需要）；markdown 远程图片一律降级为链接文本（外带/追踪面）。

### 9.11 LIKE 通配符未转义（`code-audit.md`）
- 用户输入 `%`/`_` 直接拼进 LIKE 模式。同文件还有一处差点 SQL 注入：`filter_session_status` 拼 SQL → 参数化（`session.rs:222`）。

### 9.12 Agent 文件工具可被提示注入驱动读密钥（`sensitivePathReason`）
- LLM 被注入后「合法地」调用 read_file 读 `~/.ssh/id_rsa` 再外发。→ 敏感路径启发式（.ssh/.aws/.env/config.json）**无视权限模式强制逐次询问**。
- **教训**：代理权限系统的信任边界要防「被操纵的合法调用」，不止防非法调用。

### 9.13 信号白名单与防误杀（`pty.rs:523/528`）
- 前端可传任意信号乱杀进程 → 白名单；前台进程组 == shell 自身（没应用在跑）时拒绝发信号，防误杀 shell。

---

## 十、React / zustand 前端状态

### 10.1 StrictMode 双执行
- **reducer 内触发 toast** → 双提示（`store/blocks.ts:69`）。副作用必须放 `set` 外。
- **xterm 重复挂载**（StrictMode/切标签返回）→ `term.open(el)` 前先查 `term.element`，已挂载只搬 el（`TerminalBlockList.tsx:513`）。

### 10.2 zustand selector 返回新对象 → useSyncExternalStore 无限循环（`AiStatusBar.tsx:41`）
- `resolve()` 每次返回新对象，放进 selector 每帧都判「变了」→ 无限重渲染。selector 必须返回稳定引用/原始值。

### 10.3 模块级变量当状态 → 非响应式（`code-audit.md` 两处）
- 搜索筛选源启用集合、AI 模型名都是模块级缓存，切换后 UI 不更新直到重新输入。→ 一律进 zustand store。

### 10.4 模块级 store 状态在关 tab 后累积（`2114f6c`、`workspace.ts:299/426`）
- 关 tab 只关了标签，per-terminal 的 blocks/chat/cwd/PTY 记录残留 → 长期使用慢性增长。dropTab 必须清理**所有** per-tab/per-terminal 派生状态；流式请求的 AbortController 也要在 dropTab 时中止防泄漏（`store/chat.ts:63`）。

### 10.5 流式中关标签 → 幽灵空条目（`code-audit.md`）
- `appendChunk`/`finally` 都要判 tab 是否还存在，否则给已关闭 tab 复活条目。

### 10.6 快速拖动面板不跟手 —— 闭包陈旧吞增量（`store/dock.ts:235`）
- 拖拽回调用「外部传入的绝对宽度」时，快速拖动下渲染闭包陈旧，增量丢失（面板不动、终端 flex 反而在变）。→ store 内「当前值 + delta」累加。
- **同类拖拽竞态**（`2114f6c`）：ResizeHandle 重复 mousedown 要先解绑旧 listener（`ResizeHandle.tsx:40`）；折叠阈值要迟滞，避免回撤一两像素就弹出面板抖动（`SidePanel.tsx:53`）。

### 10.7 拖拽折叠立即卸载组件 → 反悔拖回状态全丢（`dc25a44`）
- 折叠改为标记 + 隐藏（内容实例保留），**松手才定局去留**；落盘按已关闭保存。文件面板拖回后停留在原目录而不是像 reload。

### 10.8 Tab 拖拽重排的两个索引空间混用（`ebb0de9`）
1. drop handler 把 sessions 数组索引和「sessions+settings 合并数组」索引混着用，settings 标签不在末尾时交换静默错位；
2. 目标检测循环先命中**被拖 tab 自己的 rect**——follow-transform 让它跟着鼠标走，每个位置都匹配源索引，最左 tab 右拖永远是 no-op。
- **教训**：拖拽逻辑要显式统一到一个索引空间再投影回去；命中检测必须跳过源元素。测试要用「rect 跟随鼠标」的 transform-aware mock 才抓得住第 2 个 bug。

### 10.9 条件 hook / early return 前必须调用全部 hook（`FilterPopover.tsx:15`）
- open false→true 切换直接崩。经典 React 规则，但有专门回归测试守着。

### 10.10 IPC 返回值与外部可变集合共享引用（`useSessionHistory.ts:89`）
- 删除后原数组原地变化，React 浅比较判「没变」跳过更新。IPC/mock 返回值要拷贝。

### 10.11 ErrorBoundary 不复位 → 一次中间态错误永久降级（`SafeMarkdown.tsx:33`）
- 流式渲染中一次瞬时解析错误让整条消息永远显示降级文本。内容更新时必须复位 error 状态。

### 10.12 焦点管理的兜底轮询（`useTerminalFocus.ts`）
- 输入栏若是 `display:none`/卸载，焦点丢失**不一定触发 focusout** → 低频轮询兜底；焦点不到位 IME 无法起组合、按键无处去。
- 同类：卡片内 xterm 不消费 wheel（customWheelHandler return false），否则滚轮落在运行中卡片上整页滚不动（`TerminalBlockList.tsx:560`）。

### 10.13 监听器/计时器泄漏批量清理（`2114f6c`）
- 多处 addEventListener/setTimeout 无对应清理；Toast 自动消失路径也要清计时器表，否则手动关闭/悬停暂停后残留（`Toast.tsx:36`）。PTY 输出监听器应**全局注册一次** + ref 跟踪 sessionId，而不是每会话注册（`a1d0a13`，v1 时期同款教训）。

---

## 十一、AI / LLM / 流式

### 11.1 AI SDK v7：system 提示词塞进 messages 直接抛 InvalidPromptError（`agentStream.ts:109`）
- 默认 `allowSystemInMessages=false`，system 必须走 `instructions` 选项。升级 SDK 大版本先查这类默认值变化。

### 11.2 每 token 一次 setState → O(n²) 卡顿（`store/chat.ts:124`）
- 流式回复每个 chunk 触发整条消息 Markdown + KaTeX 全量重解析。→ 合批 ~50ms flush。
- 同类：`SafeMarkdown.tsx:41` 明确注释这是长对话主要卡顿源。

### 11.3 挂起的工具审批 Promise 卡死 agent 步进（`store/chat.ts:314`）
- tab 关闭/流中止时，挂起等待用户审批的 Promise 无人 resolve → 工具 execute 悬挂。→ 一律按拒绝放行。

### 11.4 run_command 快照提取太快 → 模型拿到空输出（`runCommand.ts:146`）
- 命令 done 后立刻提取终端快照，输出可能还没落屏 → 给一个宽限 timer 再收口，否则模型误判「目录为空」。

### 11.5 assistant 消息的 parts 重建契约（`messageParts.ts:10`）
- 「别处不要给 assistant 消息写 `parts: []`」——历史重建依赖 content 重建首 text part，违反约定会静默丢工具节点。

### 11.6 前端直连 LLM → API key 暴露在 WebView（`9be3245`）
- 流式请求经 Rust 代理（`llmFetch`），key 不出 Rust。同 commit 加了流式错误处理与日志。

### 11.7 定时任务调度写在设置页组件里（`1215255`）
- **只有设置页打开时调度才生效**。应用级行为必须挂在应用级生命周期（App.tsx），不能寄生在任何页面组件。同 commit 清了一批未处理 Promise 拒绝与静默失败。

### 11.8 上下文压缩的幂等提示（`context.ts:103/138`)
- 摘要合并更新时提示词必须写明「不要重复啰嗦」；已折叠部分未变时只折叠新增溢出消息，避免反复重摘。

### 11.9 代理 fetch 只取消 Rust 请求、不结束本地流 → 终止后界面卡在「生成中」（`llmFetch.ts` `abort`）
- **现象**：点「停止生成」后模型请求确实断了（Rust `AbortHandle` 取消 reqwest，日志里能看到 `llm_abort`），但界面一直停在生成中、发送键回不来。
- **根因**：被 abort 时 Rust 静默返回、不再推 `done`/`error`，而 `llmFetch` 的本地 `ReadableStream` 从不关闭也不报错；AI SDK 的包装流只在「一次 read 落地之后」才检查 `abortSignal.aborted`，读取器于是永久挂起，`fullStream` 的收尾逻辑（`finally` 里清 `sendingTab`、落终态）永远不执行。
- **修复**：abort 监听里同时 `controller.error(new DOMException(…, 'AbortError'))`，让本地流立即结算；`llmFetch.test.ts`「流中中止」锁死该行为。e2e 侧 `tauri-mock` 的 `llm_abort` 必须同样「停发且不发终态事件」，否则测不出这类挂起。

### 11.10 全局发送态被当成「本对话在生成」，以及「先标记后发送」丢任务（`sendingTab`）
- 存储层一次只跑一轮对话（`sendingTab` 单槽），于是有两个踩过的坑：
  1. `AiBlock` 用 `sendingTab !== null` 判断「本回答在生成」——后台定时任务一触发，所有回答的重新生成/编辑/删除全部变灰，看起来像当前对话卡住；
  2. `scheduleRunner` 先 `markScheduleRun` 再 `sendToChat`——发送态被占时 `sendToChat` 静默跳过，任务却被记成「已运行」，整轮（最长一小时）凭空消失。
- **约定**：判断「本对话在生成」一律用 `sendingTab === <对话 id>`（`PanelChat` 早就如此，`AiBlock` 现在按所属对话判断）；后台任务在确认能真正开始前不得写运行时间，忙时留给下一次 tick 重试（`isChatTurnActive()`）。

---

## 十二、富内容 / LaTeX/Markdown

### 12.1 shell 回显被误判为内联数学（`20afcdc`）
- **现象**：PowerShell 回显 `$c=$w; $n++`、`try{...}` 渲染成红色 KaTeX 报错。
- **修复三守卫**（一律偏向纯文本——「其它终端显示什么我们就显示什么」优先于渲染数学）：pandoc 式定界符校验（开 `$` 后非空格、闭 `$` 前非空格，杀 `$5 and $10`）；内容以运算符/标点/引号开头结尾不算公式；花括号不配对是代码碎片。
- **有意放弃** pandoc 的「闭 `$` 后跟数字」规则：原地重绘会在公式后留一个陈旧 cell（`$x^2$` 覆盖 `line 6` → `$x^2$6`），该规则会把真公式杀掉。

### 12.2 CJK 守卫误杀 `\text{}` 中文注释（`07a1a18`）
- 「$$ 体内含 CJK 即拒绝」的守卫杀掉了合法公式（麦克斯韦方程组的 `\text{ (高斯定律) }`），且因慢速输出时机呈现为「偶尔不渲染」。→ 收紧为「CJK 体 **且** 无任何 LaTeX 命令」才拒绝。双向回归测试。

### 12.3 长度阈值太紧漏掉长公式（`4f8203e`）
- 内联数学接受长度 60 → 500 字符（`\nabla\times\mathbf{E}=...`）；单大写字母接受（`$ surface`），多字符全大写 shell 变量仍拒绝。

### 12.4 软换行把公式劈开（`529ca65`）
- rich-scan 必须按**逻辑行**扫描：软换行的物理行用 `''` 连接（绝不能 `'\n'`），否则跨行折行的 `$...$` 到 KaTeX 时中间被注入换行 → 红色原文。

### 12.5 KaTeX 不认识 TeX 间距参数（`530de24`、`f0ba794`）
- `\\[4pt]` 渲染成红字面量；终端 markdown 渲染器还会把 `\\` 折叠成 `\`，`\[8pt]` 同样漏进来。→ 预处理剥掉可选间距参数；display 模式顶层 `\\` 包进 `gathered` 环境。

### 12.6 扫描边界只看最后 3 行 → 提示符上方的短答案不渲染（`713be32`）
- 改为光标行以上全部扫描。

### 12.7 marked → react-markdown 重写以关闭 XSS 面（`7d1efdc`）
- 不启用 rehype-raw，原始 HTML 一律转义。这是「前端未发现高危 XSS」结论的前提，**引入任何 raw HTML 渲染前先读这条**。

---

## 十三、测试

### 13.1 本仓库 vitest 4 陷阱：beforeEach + mockRejectedValue 误报 unhandled（`files.test.ts:8` 头注释，多个测试文件引用）
- **现象**：测试文件里存在 `beforeEach`（清 mock）时，`mockRejectedValue` 的 rejection 被误报为 unhandled rejection；探针可复现，去掉 beforeEach 即正常。
- **约定**：agent 系测试一律**不用 beforeEach 清 mock**，各用例自设 mock 实现、用不同参数断言。
- **同类**：`beforeEach(() => mock.mockClear())` 箭头函数**必须带花括号**——`() => mock.mockClear()` 会把 mockClear 的返回值当返回语义（`agentStream.test.ts:65`）。

### 13.2 ConPTY 环境伪影：node stub 测不了 resize（`1658043`）
- Windows e2e 用 node 做 TUI stub 不可行：ConPTY 下 node **收不到 resize 事件**，且全宽输出突发撞上 ConPTY deferred-wrap 怪癖——两者都是环境伪影（用 eventLog 验证发生在我们代码之下）。
- **替代**：PowerShell 轮询 stub（`[Console]::WindowWidth` + `\e[4A` 重绘）模拟 Ink 的行数记账。

### 13.3 e2e mock 必须复刻 @tauri-apps/api v2 内部契约（`e2e/tauri-mock.ts` 头注释）
- `invoke → __TAURI_INTERNALS__.invoke(cmd, args)`；`listen → transformCallback 注册 window[_${id}] 再 invoke('plugin:event|listen')`。mock 走真实库代码路径而不是打桩库本身，API 升级时契约变化会被 e2e 抓住。
- mock PTY 输出默认 emit 完整 OSC 133 序列（新管线由 shell integration 驱动场景切换），并留 `integration:false` 开关测经典回退。
- Anthropic mock 的 init script **必须在 goto 前注册**（多个 spec 头注释）。

### 13.4 e2e 断言的选择器/时序细节
- `block-width.spec.ts:37`：取「最内层」匹配 div——外层容器同样 `includes('<br>')` 会误中。
- `blocks.spec.ts:77`：键盘断言必须放在横幅按钮点击**之前**——点击会把焦点从 xterm 抢走。
- WebGL 下 canvas 渲染，读文本必须断言 buffer 而不是 DOM（`blocks.spec.ts:71`）。
- `pane-move.spec.ts:6`：拖拽用例的核心断言是「运行中块的 PTY 必须存活」——回归「拖拽终端/标签时运行中内容立刻退出」。

### 13.5 用真实捕获数据做回归 fixture（`d4335f3`、`156660b`）
- 终端 bug 的可靠复现来自**真实 TUI 输出捕获**（Claude Code 启动帧 100×30 回放、真实 resize 集成测试），手写序列永远漏掉实际组合。仓库有专门的捕获/回放脚本（`68cfca7`：raw PTY byte dumping、probe/record/replay 脚本）。
- 教训：**先建捕获-回放基础设施，再修终端 bug**。

### 13.6 测试与实现共享「权威来源」
- emoji 宽度表用 string-width@7 实测生成并双向锁定（§4.1）；tokens.test.ts 在每次主题改动时同步期望值（`40c862a`、`ee356b1`）——主题试验期靠测试期望值强制显式确认每次色值变更。

### 13.7 codemod 批量改导入的盲区（`fb36bab`、`e1ae0a4`)
- 658 处相对导入转 `@/` 别名的 sed codemod **匹配不到副作用导入**（`import '@/...'` 无 from 子句），漏了 3 处。批量替换后必须全局搜残余模式，不能只信 tsc（副作用导入不报类型错）。

---

## 十四、进程管理

### 14.1 关会话不 force-kill → 子进程残留（`29f5d41`）
### 14.2 KillState 条目从不清理 → 长时间使用无限增长（`code-audit.md`、`pty.rs:496/517`）
- `pty_close`/`reap_session` 必须同步删除「结束升级」状态。
### 14.3 pty_spawn 部分失败泄漏子进程（`code-audit.md` 高优）
### 14.4 reap_session 的 emit 失败路径阻塞 wait（`code-audit.md`）
### 14.5 杀进程树的顺序（`pty.rs:611`）
- 先收集后代再杀，避免父进程先死导致子进程被重新挂到别的父进程下而漏杀。
### 14.6 输出 pending 缓冲在会话关闭时卡住最后一段（`pty.rs:353`）
- 合批窗口内未 flush 的输出（如 cmd/PowerShell 提示符）要强制 flush，否则「最后一行永远不出现」。

---

## 十五、UI / 交互

### 15.1 关最后一个 tab 弹两个对话框（`f865d06`、`0b30c1e`）
- force-close 确认 + 会话归零后的退出确认串行弹出；取消退出还曾错误地新建会话。→ 最后 tab 直接走退出对话框，取消保留活会话。settings tab 作为最后 tab 时关闭要**延迟到退出确认后**。
- 相关取舍：只有前台进程在跑才确认关闭（idle shell 直接关，`3bc60eb`）。

### 15.2 默认主题带色相倾向被否（`ee356b1`，此前 `40c862a` 刚做的青绿主题）
- 多轮主题实验（Phase 5 一整天：ink & violet / graphite & amber / frosted-glass…）后收敛的结论：**默认中性**，彩色方案降级为可选预设（theme.json 覆盖机制）。功能性语义色（success/error/warning）除外。
- 教训：审美探索要留「回退到中性默认」的机制化出口，而不是在默认值上反复横跳。

### 15.3 搜索竞态：请求 ID 丢弃过期结果（`search/engine.ts:51/91`）
- 输入联想类异步搜索必须带请求 ID，响应回来时 ID 已变则丢弃。

### 15.4 fileTree 防环（`fileTree.ts:47`）
- 自引用 symlink、或后端对任意路径返回相同列表时，递归展开栈溢出。目录路径已在祖先链上则照常渲染该行但不再递归。

### 15.5 路径规范化必须收口在平台层（`da7ee25`；混合分隔符 `C:/Users/foo\.android`）
- `normPath('/')` → `''`，`fs_list('')` 失败 → `cd /` 后文件面板显示空目录。路径规范化必须保留文件系统根。
- Windows 盘符根必须保留根斜杠 `C:/`：`C:` 是「该驱动器当前目录」，`fs_list('C:')` 不一定是根。
- 后端条目路径带原生反斜杠，而从终端 cwd（已规范化）进入子目录时会拼出 `C:/Users/foo\.android` 这类混合路径。修复：路径语义收敛到 `@platform/path`，`@platform/api/fs`（以及 workspace/search）在 IPC 边界双向归一化；业务层不得再对 `entry.path` 手写 `normPath`。

### 15.6 waitForSession 8s 超时静默丢弃命令（`code-audit.md`）
- 「同步到终端」等跨面板操作在 PTY 未就绪时静默失败，用户以为按钮坏了。超时要有用户可见反馈。

### 15.7 空状态按钮无反馈 / 同步操作弹多余通知
- 「输出发给 AI」「清除对话」空状态静默无反馈 → toast（`code-audit.md`）；反过来，目录同步这种确定性操作**不该**弹成功通知（`d7c569c`）。反馈的原则：不确定结果才提示。

### 15.8 i18n 名存实亡（`code-audit.md`）
- 大量 key 无引用、多数 UI 文案硬编码中文；缺 key 时直接显示 key 字符串（`dock.ssh`）。半吊子 i18n 比没有更糟——要么补齐要么删掉。本项目一度选择「UI 一律中文」写入开发规则第 3 条，后又改为「代码内用英文 key + `src/i18n` 补中文条目」；教训不变：i18n 要么彻底执行，要么不要引入。

### 15.9 动画时长下限（开发规则第 19 条；`2114f6c` 修动画时长）
- 折叠/展开、hover 过渡 ≥ 100ms；曾出现过快动画与硬编码颜色（应走 CSS 变量）一并清理。

### 15.10 文件面板拖拽不走 HTML5 拖放；删除用应用内暂存换取可回退
- 桌面窗口保留原生文件拖入，HTML5 drag 事件在 Windows 会被拦截 → 行拖拽用指针事件实现（与导航按钮拖拽一致：6px 阈值、Esc 取消、指针抬起后抑制一次 click）。
- 拖出窗口（放到桌面/资源管理器）用 `tauri-plugin-drag`（`drag:default` 权限）而非 HTML5：`dragDropEnabled` 开启时 Windows 上没有可用的 HTML5 拖放，两者只能选其一，而原生文件拖入需要真实路径。
- 删除若直接 `trash::delete` 就无法程序化还原（回收站没有跨平台恢复 API）：改为先移动到 `~/.vrykell/undo` 暂存，回退时移回原位，被挤出历史栈或应用启动时再把暂存项送入系统回收站——保留回退窗口的同时保留「删除 = 进回收站」的最终语义。
- 跨盘移动的「复制 + 删源」退化路径在删源失败时必须回滚目标副本，否则用户看到的是「移动失败却留下一个复制」。
- 通用右键菜单补了 Esc 关闭（捕获阶段处理并阻止冒泡，避免同时触发全局 Esc 的键盘目标切换）。

### 15.11 面板合并后仍需提防「按变体写死的选择器」
- 本地与 SSH 面板合并为一套 `FilePanel` 后，拖拽 hook 里仍写着 `[data-testid="file-row-expander"]`：本地面板的展开箭头恰好叫这个名字，SSH 面板叫 `remote-row-expander`，于是点远程箭头会被 `setPointerCapture` 吞掉 click，展开完全失效（单测不渲染 DOM，只有真机/ e2e 能发现）。
- 结论：共用组件之间不要用测试标识当行为钩子，改用与变体无关的语义标记（`data-file-row`、`data-row-expander`、`data-drop-dir`）；测试标识只服务于 e2e。
- 同理，空白处右键最初用 `closest('[data-testid^="remote-file-"]')` 判断是否命中行，而树容器本身叫 `remote-file-tree` 也匹配该前缀 → 空白处菜单永远打不开。前缀匹配在共享命名空间里是陷阱。

### 15.12 重名避让必须是「后端返回真实路径」，否则回退历史会错
- 粘贴 / 拖拽 / 重命名遇到同名项若报错，用户只能自己改名；改为自动加序号（`notes (1).txt`，序号在扩展名前，与资源管理器一致）后，**必须把真实目标路径回传给前端**：`fs_rename` / `ssh_rename` / `fs_move` / `fs_copy` / `ssh_move` / 新建命令都返回最终路径。
- 前端只用返回的路径记录回退对与选中项；若前端按「目标目录 + 原名」自己拼，一旦发生避让，回退就会去动一个不存在的路径（这正是引入避让时最容易埋的新 bug）。
- 远程复制还要注意 `cp -R src dest/` 会按源文件名落盘：避让后必须显式给出完整目标路径（`cp -R src dest/src (1).txt`），否则避让白算。

### 15.13 pane 容器的不对称内边距把整宽元素推右（认证输入条「不居中」）
- 现象：SSH 认证输入条左边留白明显比右边大（用户直接指出「容器位置错了或者层级错了」），换了窗口尺寸、开不开右侧面板都能看到。
- 原因：`TerminalView` 把 `padding: '8px 0 0 8px'`（左 8、右 0，右侧 0 是为了让原生滚动条贴住 pane 右边缘）加在**包住整个终端面板**的容器上，于是认证输入条这类整宽元素也被一起推右 8px。
- 修法：把这 8px 从「面板容器层」下移到「终端屏幕内容层」（xterm 宿主与快照 `pre`），整宽元素留在 pane 根层 → 左右严格对称（实测左右留白 0/0），并补 e2e 断言（左右差值 ≤ 1px）固化。
- 教训：内边距加在哪一层等价于「谁被当作整宽元素」。给容器加**单侧**内边距会连带推动它下面所有子元素；跨层复用组件（面板级容器 vs 内容级留白）时最容易踩。

### 15.14 Windows 宿主上用 `std::path` 处理远端 POSIX 路径（粘贴报「必须是绝对路径」）
- 现象：SSH 面板里复制文件后粘贴，报「目标目录必须是绝对路径」；远端重命名 / 移动 / 新建 / 上传在同名避让时也可能生成带反斜杠的路径。
- 原因：远端路径的「绝对/相对、拼接、取父目录、取文件名」用了 `std::path`：
  - `Path::is_absolute("/home/user")` 在 Windows 上返回 **false**（`/home/user` 被当作相对路径）；
  - `PathBuf::join` 在 Windows 上用 `\`，得到 `/home/user\docs`；
  - `ssh2` 的便捷 `Sftp::readdir(dir)` 也按宿主分隔符拼接返回路径。
- 修法：新增平台层 `src-tauri/src/platform/path.rs`（POSIX 语义：`is_absolute` / `join` / `parent` / `file_name` / `normalize` / `numbered_name` / `name_from_listing` / `is_within`），远端路径的全部判断与拼接改走它；SFTP 调用只把已拼好的字符串交给 `Path::new(&s)`；列表项文件名用 `name_from_listing` 从宿主拼接过路径里剥离。前端同步把 POSIX 助手抽到 `@platform/posixPath`。
- 教训：**平台相关的判断必须由平台层承担**。宿主平台（Windows）与目标平台（Linux 主机）可以完全不同，业务层一旦「顺手用本地语义」处理远端路径，就会写出只在这台机器上坏的代码。单测要固定「不含反斜杠」「`/home` 是绝对路径」这类不变量。

### 15.16 拖出窗口看起来像复制：`DROPEFFECT_MOVE` 的收尾没做
- 现象：把文件从面板拖到桌面/资源管理器，落点出现一份文件，面板里原文件还在——用户看到的语义是「复制」，而应用声明的是「拖拽 = 移动」。
- 原因：Windows 拖放的 MOVE 约定是「目标把文件搬过去（同盘时由目标 rename 源文件）」，跨盘或目标只做复制时源必须由**拖拽源自己删除**；只把 `mode: 'move'` 传给系统而不做收尾，就会留下源文件。
- 修法：`tauri-plugin-drag` 的 `startDrag` 回调返回 `Dropped` 即视为移动完成，源头同步清理（本地 → 应用内暂存删除，远端 → 远端暂存删除），并进回退历史；同盘场景系统已移走源文件，暂存失败按「已不存在」安静跳过。远端拖出仍是「先下载到本地再交给系统」，但拖放成功后远端源文件会被移除，语义上仍是移动。
- 教训：跨进程/跨系统的「移动」是两段式协议（目标搬运 + 源清理），只做一半就退化成复制。

### 15.15 回退栈不能保留「永远退不掉」的一步
- 现象：用户在别的终端里把待回退的文件移走/删除后点回退，回退失败，但「更多 → 回退移动（共 N 步）」里的 N 一直不减，菜单项永远挂着。
- 原因：早期实现把回退失败的项留在栈顶「便于重试」，但目标已不存在属于永久失败，重试永远不会成功。
- 修法：`runUndo` 每次调用都消耗栈顶一步（失败也移除），部分失败时提示「N 项已不存在（已跳过）」，全部失败提示原因并说明该步已从历史移除；`files-op` 日志带 done/error 计数便于排查。
- 教训：可重试的语义只适用于**瞬时失败**；「文件已不在原位」这类永久失败必须让状态收敛，否则计数与菜单会一直骗人。

---

## 终端渲染器与 CJK 宽度（排查顺序）

- 渲染器只有一处可选：`src/features/terminal/model/xtermRenderer.ts`，默认 WebGL，GPU 上下文丢失时降级 DOM。用户在「设置 → 主题 → 终端渲染器」切换（`typography` store 的 `terminalRenderer`），切换会立即应用到已打开的终端（DOM 卸载 addon、WebGL 重新加载），新建终端读取同一份偏好。
- **框线/表格错位先查字体，不要先怀疑渲染器**：根因通常是 CJK 回退字体的字宽不是 2 个拉丁单元 —— 字体栈必须能命中一个等宽 CJK 字体（Sarasa Mono SC / Noto Sans Mono CJK SC），否则 `│ 名称 │` 这类表格的右边框逐行错开。无头 e2e 环境通常没有这些字体，**不能据此判断渲染器好坏**。
- WebGL 渲染器在无 GPU 的环境（无头浏览器 / SwiftShader）截不到画面：`.xterm-rows` 为空、截图全黑（选区被画进 canvas 纹理，不是 DOM）。比较渲染器必须在真机跑。
- 已量到的几何事实：WebGL 画布按设备像素对齐（CSS 宽 × dpr 恰为整数），所以「画布取整」这条推断不成立；怀疑边缘亮线前，先量 `screen` / `region` / `canvas` 三者的 rect 再下结论。
- **字符格取整（Windows Terminal 的做法）**：等宽字体的 advance 常是小数（14px 字号下约 8.4px），`cols × cellWidth` 就落在非整数上，画布右边缘会剩一条亚像素列 —— 拖动窗口时「有时有、有时没有」正是这个取整。做法是给 xterm 设置 `letterSpacing = round(实测格宽) − 实测格宽`（每格最多半个像素），格宽锁到整数、网格落在设备像素上；`useTerminalSession` 与 `createBlockTerm` 都在创建时设置、并在字号变化时重算（`terminalFont.ts` 的 `snapLetterSpacing` 有单测）。
- **win32-input-mode 的按键捕获会顺手吞掉复制/粘贴**：`attachWin32KeyCapture` 在**捕获阶段**就 `preventDefault + stopPropagation`，会话一旦请求该模式，Ctrl+C 会被编码成按键记录发进 PTY，复制直接失效 —— 而 e2e 默认不开这个模式，所以「本机不触发、用户机上必现」。判定必须拿到终端本身：Ctrl+V 永远放行；Ctrl+C 只在**有选区**时放行（无选区仍要编码，否则会话丢了中断键）。回归覆盖见 `terminal-clipboard.spec.ts` 的「win32-input-mode 下 Ctrl+C 仍然复制」。
- **终端「选区旁边一条细线」= 终端自带的滚动条**：`.xterm-viewport` 比 `.xterm-screen` 宽 8px（那 8px 是原生滚动条滑道），全局 `::-webkit-scrollbar-thumb` 的 `2px 透明边框 + padding-box` 让它只剩中间约 4px 的浅色细条，紧贴选区时就像渲染瑕疵。运行块早就用 `display: none` 关掉了自己的滚动条，pane 现在也关（滚轮/触控板/键盘滚动不受影响）。切换渲染器（WebGL/DOM）**不会**改变这个现象，别把它当成渲染器问题。

---

### 原生编辑器输入与历史 SSH 引用

Escape 路由使用聚焦的 pane ID，因为场景状态按 pane 而非标签保存。只在块列表消费切回输入栏的 Escape，经典和备用屏幕编辑器直接接收。部分原生文本提交遗漏 keypress 且带 composed 标记，应先观察 xterm onData，仅补发未处理的 insertText，组合输入仍由原生路径管理。诊断只记录事件类型、长度和处理状态，不记录输入内容。真实 POSIX 编辑器测试需覆盖普通模式、插入模式和 Escape 后保存文件。

SSH 历史 pane 可能引用已删除的连接。挂载连接终端前验证引用，保留地址快照，提供替换连接或重新认证。JSON 空白和嵌套布局不能影响 SSH 历史识别与主机搜索；经典连接会话不显示没有意义的命令块数量。

---

## 附：方法论层面的教训（从上述坑中提炼）

1. **静默失败是最贵的失败**：吞 ALTER 错误、吞 SQL 失败、吞 read 错误、丢弃未知序列、超时静默丢命令、INSERT OR IGNORE——本项目至少 6 类「静默」各自造成过一次难查的线上症状。失败要么修好，要么响。
2. **两端记账必须同源**：字符宽度表（string-width）、PTY 维度标签（随批次流动）、serde 命名（显式 rename_all）、拖拽索引空间（统一后投影）。凡是「两侧各自维护同一事实」的地方都出过 bug。
3. **先建复现基础设施再修 bug**：raw PTY 捕获/回放、setter trap 抓浏览器滚动、eventLog 区分环境伪影与自身 bug——三个最难的 bug（§2.2、§5.1、§13.2）都靠它定案。
4. **症状治理会被 revert，根因修复不会**：resize debounce（加了又撤）、nearBottom 两轮误诊 vs textarea 真凶，是最好的对照案例。
5. **可再生的数据删库重建，不可再生的数据版本化迁移**：§8.3 与 §8.2 是同一问题的两个答案，取决于数据价值。
6. **应用级行为挂应用级生命周期**：调度器寄生在设置页（§11.7）这类「组件卸载即功能失效」的 bug，靠 code review 清单防范。
7. **安全校验必须绑定实际执行的那一次**：DNS 校验绑定实际连接的 IP（pinning）、HTML 净化在渲染与恢复两侧、known_hosts 读改写在锁内。校验与使用之间隔着任何「重新解析/重新读取」都是绕过窗口。
