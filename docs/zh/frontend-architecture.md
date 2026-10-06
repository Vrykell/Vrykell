# 前端架构约定

## 目标

前端采用以业务 Feature 为核心的目录结构。业务状态、组件、Hook、服务和类型按领域内聚，通用能力下沉到无业务语义的共享层。

```text
src/
├─ app/          应用启动、Provider、根布局、全局命令和开发入口
├─ features/     业务域，每个领域拥有自己的组件、状态、服务、模型和 Hook
├─ platform/     Tauri IPC、PTY、文件系统和运行时适配
├─ core/         跨业务协议与基础契约
├─ ui/           无业务语义的通用 UI
├─ config/       静态配置和设计 token
├─ utils/        纯函数与通用工具
├─ i18n/         国际化
├─ test-utils/   测试基础设施
└─ assets/       静态资源
```

当前业务域：

- `features/workspace`：标签、分屏、Dock 和会话工作区状态
- `features/terminal`：终端组件、输入栏、块状态和 Rust 扫描事件消费
- `features/chat`：AI 对话渲染和聊天状态
- `features/agent`：Agent 流、工具、权限、上下文、Skills、MCP 和调度
- `features/files`、`features/ssh`、`features/search`
- `features/settings`、`features/session-history`

## 依赖方向

```text
app → features → platform / core / ui / config / utils
```

- `app` 负责组合业务能力，不重新实现领域逻辑。
- `features/*` 只通过领域公开入口向其他模块暴露能力。
- `platform`、`core`、`ui`、`config`、`utils` 不得反向依赖 `app` 或 `features`。
- `ui` 不包含业务状态；交互行为放入对应 Feature 的 Hook。
- IPC 调用集中在 `platform` 或 Feature 的 `services`。

`npm run check:architecture` 负责检查旧目录、反向依赖和视图层直接访问 Store。

## 应用启动约定

- `main.tsx` 只负责 preload、Provider 挂载和 React root 挂载。
- `app/bootstrap` 负责任务编排、错误隔离和清理，不渲染 UI。
- `app/App.tsx` 连接应用生命周期、全局交互和 `AppShell`。
- 长期订阅、定时器和事件监听必须返回 cleanup。
- Feature 初始化必须通过明确的启动函数或依赖注入接入，不能在模块 import 时产生副作用。

## 命名和测试

- 组件使用 PascalCase，Hook 使用 `useXxx`，纯业务函数使用动词开头。
- 一个文件只承担一个主要职责。
- 状态转换、IPC 适配、纯业务逻辑必须有单元测试。
- 键盘、拖拽、弹窗、异步恢复等用户路径必须有 Playwright E2E。
- 用户可见文案走 i18n（代码内写英文，`src/i18n` 补中文条目），颜色使用主题 CSS 变量。
