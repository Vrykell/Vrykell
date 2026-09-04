# Vrykell 开发规则

> 最后更新: 2026-09-02

## 一、代码规范

1. **注释与命名** — 使用通用术语描述功能，避免在注释或变量名中出现任何第三方产品/品牌名。
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

24. `src/terminal/` — 终端相关组件（Block 列表、输入栏、终端面板、输出渲染、pipeline/）。
25. `src/stores/` — zustand 状态管理（workspace、terminal、blocks、chat、history、ui、dock、input）。
26. `src/components/` — 通用 UI 组件（TabBar、Sidebar、CommandPalette、NewTabModal、Toast、ContextRing）。
27. `src/chat/` — AI 对话渲染（AiBlock、ModelPill、ToolRunCard、Markdown、PanelChat）。
28. `src/agent/` — AI 代理逻辑（agentStream、工具、权限、Skills、MCP、上下文、记忆、调度、智能标题）。
29. `src/settings/` — 设置页（行为/模型/MCP/Skills/快捷键/终端打开模式/主题）。
30. `src/lib/` — Tauri IPC 与纯基础设施（pty、fs、ai、sessionManager、windowLayout、sshApi、errorHandler）。
31. `src/ssh/` `src/files/` `src/search/` `src/theme/` — SSH 领域 / 本地文件领域 / 全局搜索 / 主题（tokens + terminalTheme）。
32. `e2e/` — Playwright e2e 测试，tauri-mock.ts 提供 Tauri + Anthropic mock。
