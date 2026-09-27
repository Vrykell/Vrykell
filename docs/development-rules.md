# Vrykell 开发规则

> 最后更新: 2026-09-27

## 一、代码规范

1. **注释与命名** — 新增或修改的代码注释统一使用英文（包括 JSDoc、行内注释、CSS 和 Rust 注释）；注释与变量名使用通用术语描述功能，避免第三方产品或品牌名。
2. **独立实现** — 用自己的方式实现功能，不照抄任何第三方源码。
3. **中文 UI** — 所有用户可见的文案使用中文。
4. **TypeScript 严格** — 零 TS 错误，不使用 `any` 除非必要且标注 `// eslint-disable-next-line`。

## 二、测试要求

5. **每个功能必须有单测** — 新增功能需在 `__tests__/` 目录下编写 vitest 用例。
6. **交互功能必须有 e2e** — 涉及用户交互的功能需在 `e2e/` 目录下编写 Playwright 用例。
7. **实现后跑全量** — 每次提交前必须 `npx tsc --noEmit && npx vitest run && npx playwright test` 全绿。

## 三、实现流程

8. **先写测试** — 先写失败的单测/ e2e，再写实现代码，确认测试通过。
9. **小步提交** — 每完成一个功能独立提交，commit message 格式: `feat:` / `fix:` / `test:` / `refactor:` / `docs:`。
10. **更新 feature-spec** — 新增功能必须同步更新 `docs/feature-spec.md` 的测试清单。
11. **代码评审** — 每完成一个大功能，自查代码质量：死代码、未使用导入、类型安全、命名一致性。

## 四、技术约束

12. **禁止自研终端模拟器** — 终端 VT/ANSI 解析使用 xterm.js，不自行实现 parser。
13. **禁止正则后瞻** — macOS 12 WKWebView 不支持 `(?<=...)` 和 `(?<!...)`。
14. **xterm.js 不可见** — xterm.js 仅用于 PTY 会话管理和 VT 解析，不直接出现在用户可见的 UI 中。
15. **Block 架构** — 已完成命令块由 TerminalBlockList 渲染为真实 DOM 元素，仅活跃命令使用隐藏 xterm.js 处理。

## 五、输出质量标准

16. **无乱码** — 块输出必须经过 ANSI 清理（stripNonSGR + truncateAfterPromptStart），不含 OSC/CSI 裸露文字。
17. **自动滚动** — 新输出到达时自动滚到底部（用户不在底部时不强制滚动）。
18. **无空白块** — 无输出的命令块显示 "(无输出)"，不渲染空块。
19. **动画 > 0.1s** — 折叠/展开、hover 过渡时间 ≥ 100ms，不得快于 100ms。

## 六、架构原则

20. **终端为主表面** — 终端 Block 列表是主区域，输入栏在底部，无独立 Chat 侧栏。
21. **AI 内联** — AI 对话结果显示在终端上方 InlineAI 区域，通过输入栏 ⚡ 模式触发。
22. **Session 保活** — 多标签 PTY 会话通过隐藏 xterm.js (display:none) 保活，切换标签不重建。
23. **颜色系统** — 所有颜色通过 `theme.css` CSS 变量定义，不在组件中硬编码色值（除 ANSI 颜色相关）。

## 七、文件组织

24. `src/features/terminal/` — 终端领域（components、hooks、stores、model、services/pipeline）。
25. `src/features/*/stores/` — 领域 Zustand 状态；视图层通过 Feature 公共入口访问。
26. `src/ui/` — 无业务语义的通用 UI 组件。
27. `src/features/chat/` — AI 对话渲染（AiBlock、ModelPill、ToolRunCard、Markdown、PanelChat）。
28. `src/features/agent/` — AI 代理逻辑（agentStream、工具、权限、Skills、MCP、上下文、记忆、调度、智能标题）。
29. `src/features/settings/` — 设置页（行为/模型/MCP/Skills/快捷键/终端打开模式/主题）。
30. `src/platform/` 与 `src/utils/` — Tauri IPC、PTY、运行时适配与纯工具函数。业务服务归属对应 Feature。
31. `src/features/ssh/` `src/features/files/` `src/features/search/` `src/config/theme/` — SSH / 本地文件 / 全局搜索 / 设计 token。
32. `e2e/` — Playwright E2E 测试，`tauri-mock.ts` 提供 Tauri + Anthropic mock。

## 八、可观测性与日志

33. **修改功能时同步补充日志** — 对有状态流程，在入口、状态转换、外部调用结果和错误/超时分支记录结构化事件，确保问题可以按时间线排查。
34. **优先记录元数据** — 记录会话/块 ID、状态、耗时、字节数和错误类型；不要记录原始命令、终端输出、提示词、凭据或未经脱敏的用户路径。
35. **复用诊断接口** — 前端使用 `terminalDebug`，Rust 终端层使用 `terminal::debug::write`；新增事件名应稳定且能说明操作阶段，避免逐字符或高频输出日志。
36. **开发环境自动记录** — dev 模式启动时诊断日志默认开启；生产环境按需启用。涉及后台任务或新 IPC 流程时，应确认入口和失败分支都能留下可关联的日志。
