# 前端架构边界

## 依赖方向

```text
页面 / 组件
    ↓
Feature Hook / 公共入口
    ↓
Feature Model / Store / Service
    ↓
Platform IPC / Core 协议
```

视图层不得直接导入 `src/features/*/stores`。需要读取领域状态时使用对应 Feature 的公开入口；需要组合状态、异步请求和副作用时，放入该 Feature 的 `hooks/`。

当前领域公开入口：

- `src/features/agent/index.ts`
- `src/features/chat/index.ts`
- `src/features/files/index.ts`
- `src/features/search/index.ts`
- `src/features/session-history/index.ts`
- `src/features/settings/index.ts`
- `src/features/ssh/index.ts`
- `src/features/terminal/index.ts`
- `src/features/workspace/index.ts`

## 分层职责

- `app/`：应用组合根、启动编排、根布局、全局命令和 Provider。
- `features/`：业务领域，内部按 `components / hooks / model / services / stores / utils` 分工。
- `platform/`：Tauri、PTY、文件系统、窗口和运行时适配。
- `core/`：跨业务协议和稳定契约。
- `ui/`：无业务语义的通用组件。
- `config/`、`utils/`、`i18n/`、`test-utils/`：静态配置、纯函数、国际化和测试基础设施。

## Hook 职责

Hook 负责 React 生命周期和交互编排，不负责渲染布局。组件负责展示和事件绑定，不直接处理跨领域 Store、IPC 或会话恢复流程。

每个新增 Hook 至少需要一个单元测试；涉及键盘、拖拽、弹窗、异步恢复等用户路径时，还需要 Playwright E2E 覆盖。

`npm run check:architecture` 会检查旧目录、低层反向依赖和视图层 Store 穿透。
