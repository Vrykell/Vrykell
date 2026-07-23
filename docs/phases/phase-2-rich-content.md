# Phase 2: Rich Content Rendering — Progress Report

**日期**: 2026-07-20（2026-07-24 更新）
**状态**: 🚧 核心检测与渲染完成，in-terminal decorations 待开发

> **更新说明（2026-07-24）**: 终端引擎已从 xterm.js 替换为自研 DOM 终端
> （`src/renderer/terminal/`），下文"待开发"中的 xterm.js Decorations 方案相应过时，
> 内联渲染将基于自研 `TerminalBuffer` / `DomTerminalView` 实现，思路（decoration 叠加、LRU 上限）不变。

---

## 已完成

### 1. 内容检测器 (`src/renderer/services/content-detector.ts`)
- 双层检测策略：显式 OSC AI 标记 → 自动正则扫描
- 支持检测类型：LaTeX（display/inline）、代码块（fenced）、Markdown 表格、URL
- OSC 标记解析：识别 `ESC ] AI;TYPE;PARAM ESC \ content ESC ] AI;END ESC \`
- 去重机制：按内容哈希避免重复检测
- 公开 API：`detectRichContent(text)` → `{ blocks, cleanedText }`；`detectFirstBlock(text)` → 快速模式

### 2. 渲染器组件
| 组件 | 文件 | 依赖 | 功能 |
|------|------|------|------|
| LatexRenderer | `components/output/LatexRenderer.tsx` | KaTeX | display/inline 数学公式渲染，错误回退到源码 |
| MarkdownRenderer | `components/output/MarkdownRenderer.tsx` | marked | 完整 Markdown 解析（标题、列表、代码、表格、链接） |
| CodeBlock | `components/output/CodeBlock.tsx` | Shiki | 语法高亮（30+ 语言），Copy 按钮，加载状态 |

### 3. RichOutput 面板 (`components/output/RichOutput.tsx`)
- 从占位符升级为完整实现
- 按内容类型路由到对应渲染器
- 类型标签、时间戳、Clear 按钮
- 响应式布局（由 Zustand outputPanelHeight 控制高度）

### 4. 检测 Hook (`hooks/useRichContent.ts`)
- 监听 `pty:output` 事件，按 session 缓冲输出
- 300ms 防抖检测，50KB 缓冲区上限自动裁剪
- 检测结果推送到 Zustand `richOutputs` store
- 去重：500 条 seen set，LRU 淘汰

### 5. CSS/主题设置
- KaTeX CSS（`katex/dist/katex.min.css`）在 `main.tsx` 导入
- Shiki 主题：`dark-plus`
- `global.css` 新增：Markdown 样式（h1-h3, code, table, blockquote）、KaTeX 布局、代码块滚动

---

## 待开发（Phase 2 剩余）

### xterm.js In-Terminal Decorations（RichContentAddon）
- 自定义 xterm.js 插件实现 `ITerminalAddon` 接口
- 拦截 OSC 序列（registerOscHandler）
- 在终端视口内注册 decoration 叠加渲染内容
- decoration LRU 管理（max 200，超出淘汰）
- 终端滚动时 decoration 回收/重建逻辑

### Web Worker 内容检测
- `src/renderer/workers/content-worker.ts`
- KaTeX/Shiki 渲染移至 Worker 线程
- postMessage 返回 HTML 字符串
- 主线程空闲时处理后台任务

### 图片支持
- iTerm2 内联图片协议（OSC 1337）解析器
- Base64 图片解码与渲染

---

## 构建验证

```
npx tsc -p tsconfig.main.json  → ✅ 通过
npx vite build                 → ✅ built in 2.20s
```

## 已知问题

- Shiki 打包体积较大（~1MB），lazy loading 可优化
- 仅在 RichOutput 面板渲染，未在终端内 (xterm.js decorations) 叠加
- 图片类型尚未实现渲染
