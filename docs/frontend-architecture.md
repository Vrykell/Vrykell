# 前端架构约定

## 目标

前端采用“应用层 + 组件编排层 + 业务域 + 共享能力”的渐进式架构。第一阶段先建立稳定边界，不要求一次性迁移所有历史文件。

```text
src/
├─ app/       应用启动、Provider、应用壳和全局生命周期
├─ widgets/   跨域页面区块，例如工作区、应用级弹层
├─ features/  可复用的用户行为，例如搜索、会话操作、设置项
├─ entities/  业务实体及其状态，例如 session、terminal、agent
├─ shared/    无业务语义的 UI、工具、配置和基础设施
└─ <domain>/  现有业务目录，作为迁移期间的兼容层
```

## 依赖方向

依赖只能自上而下：

```text
app → widgets → features → entities → shared
```

现阶段 `agent`、`terminal`、`store`、`api` 等目录仍保留原位置。新代码应通过 `@app/*`、`@widgets/*`、`@features/*`、`@entities/*`、`@shared/*` 或 `@/*` 导入，禁止从组件反向依赖 `app`，也不要在 `main.tsx` 直接组装业务组件。

## 应用启动约定

- `main.tsx` 只做 preload、Provider 挂载和 React root 挂载。
- `app/bootstrap` 负责启动任务编排、错误隔离和清理，不渲染 UI。
- `app/App.tsx` 只连接应用生命周期、全局交互和 `AppShell`。
- 业务模块的初始化必须通过依赖注入或明确的启动函数接入，避免在模块 import 时产生副作用。
- 所有长期订阅、定时器和事件监听必须返回 cleanup，并由 bootstrap 或组件生命周期销毁。
- 实体状态必须通过实体公开入口访问；迁移期间可以由实体入口兼容旧 Store，但业务组件不得继续扩散底层 Store 依赖。

## 迁移策略

1. 先建立别名、入口和启动层，保证构建与现有测试稳定。
2. 按业务边界迁移 `store/api` 到 `entities`，迁移可复用行为到 `features`。
3. 将通用组件、错误处理、IPC 封装和格式化工具收敛到 `shared`。
4. 每次迁移都保留兼容导出，并同时补充单元测试；交互行为继续补充 Playwright 测试。

## 命名和测试

- 组件使用 PascalCase，hooks 使用 `useXxx`，纯业务函数使用动词开头。
- 一个文件只承担一个主要职责；超过一个职责时优先拆成编排层和纯逻辑层。
- 启动编排、状态转换、IPC 适配必须有单元测试；复杂交互必须有 e2e 测试。
- 用户可见文字继续遵守项目约定，统一使用中文；颜色使用主题 CSS 变量。
