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
- 写入持会话锁且无超时，PTY 缓冲满时整个会话的所有操作（包括 kill）被卡死。→ 输出合批 + 非阻塞写入（Phase 8）。

### 3.6 GUI 启动缺 TERM/COLORTERM → TUI 应用挂起（`4c4f15a`）
- **现象**：从 Finder/Dock 启动时 `TERM` 为空，zsh 退化为 dumb，依赖终端能力检测的全屏 TUI（truecolor 应用）挂起/黑屏。终端里启动则正常——**只有 GUI 冷启动路径能复现**。
- **修复**：`pty_spawn` 时两者为空则补 `xterm-256color` + truecolor，用户显式设置优先。

### 3.7 GUI 启动缺用户 bin 目录 → PATH 与终端不一致（Phase 14，`pty.rs` `merge_user_bin_paths`）
- GUI 进程不经过登录 shell，`/usr/local/bin`、Homebrew 目录不在 PATH。修复为合并注入且不丢继承 PATH、去重。

---

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
- 写盘后目录 0700、文件 0600。SSH 密码更彻底：移入系统钥匙串（`secret.rs`），库内只留脱敏标记，旧库明文自动迁移。

---

## 九、安全

> 完整清单见 `docs/security-review.md`，此处只记「差点没想到」的坑。

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
- 大量 key 无引用、多数 UI 文案硬编码中文；缺 key 时直接显示 key 字符串（`dock.ssh`）。半吊子 i18n 比没有更糟——要么补齐要么删掉，本项目最终选择「UI 一律中文」写入开发规则第 3 条。

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

---

## 附：方法论层面的教训（从上述坑中提炼）

1. **静默失败是最贵的失败**：吞 ALTER 错误、吞 SQL 失败、吞 read 错误、丢弃未知序列、超时静默丢命令、INSERT OR IGNORE——本项目至少 6 类「静默」各自造成过一次难查的线上症状。失败要么修好，要么响。
2. **两端记账必须同源**：字符宽度表（string-width）、PTY 维度标签（随批次流动）、serde 命名（显式 rename_all）、拖拽索引空间（统一后投影）。凡是「两侧各自维护同一事实」的地方都出过 bug。
3. **先建复现基础设施再修 bug**：raw PTY 捕获/回放、setter trap 抓浏览器滚动、eventLog 区分环境伪影与自身 bug——三个最难的 bug（§2.2、§5.1、§13.2）都靠它定案。
4. **症状治理会被 revert，根因修复不会**：resize debounce（加了又撤）、nearBottom 两轮误诊 vs textarea 真凶，是最好的对照案例。
5. **可再生的数据删库重建，不可再生的数据版本化迁移**：§8.3 与 §8.2 是同一问题的两个答案，取决于数据价值。
6. **应用级行为挂应用级生命周期**：调度器寄生在设置页（§11.7）这类「组件卸载即功能失效」的 bug，靠 code review 清单防范。
7. **安全校验必须绑定实际执行的那一次**：DNS 校验绑定实际连接的 IP（pinning）、HTML 净化在渲染与恢复两侧、known_hosts 读改写在锁内。校验与使用之间隔着任何「重新解析/重新读取」都是绕过窗口。
