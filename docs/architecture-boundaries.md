# 前端架构边界

## 依赖方向

```text
页面 / 组件
    ↓
领域 Hook、Selector、Entity 门面
    ↓
Feature Model / Service
    ↓
Platform IPC / Tauri
```

视图层不得直接导入 `src/features/*/stores`。需要读取领域状态时，通过 `src/entities/*` 门面；需要组合状态、异步请求和副作用时，放入对应 Feature 的 `hooks/`。

当前已落地的公开入口包括：

- `src/entities/agent/index.ts`
- `src/entities/chat/index.ts`
- `src/entities/search/index.ts`
- `src/entities/session/index.ts`
- `src/entities/ssh/index.ts`
- `src/entities/terminal/index.ts`
- `src/features/workspace/hooks/useActiveWorkspace.ts`

## Hook 职责

Hook 负责 React 生命周期和交互编排，不负责渲染布局。组件负责展示和事件绑定，不直接处理跨领域 Store、IPC 或会话恢复流程。

每个新增 Hook 至少需要一个单元测试；涉及键盘、拖拽、弹窗、异步恢复等用户路径时，还需要 Playwright E2E 覆盖。

`npm run check:architecture` 会检查生产视图层是否穿透领域 Store。新增领域状态时，先补充 Entity 门面，再接入组件。
