# 前端架构演进方向

## 决策

Vrykell 后续采用以业务 Feature 为中心的架构。以「功能优先」的方式组织代码，避免继续扩张 `app / entities / widgets / features / 旧业务目录` 的混合层。

当前结构：

```text
src/
├── app/             应用启动、全局 Provider、根布局
├── features/        业务域，每个域内聚组件、Hooks、Store、Service、Types、Utils
│   ├── workspace/
│   ├── terminal/
│   ├── chat/
│   ├── session-history/
│   ├── files/
│   ├── ssh/
│   ├── search/
│   ├── settings/
│   └── window/
├── ui/              无业务语义的通用 UI 组件
├── platform/        Tauri、PTY、文件系统等平台适配
├── core/            跨业务核心协议与基础服务
├── config/          应用配置与默认值
├── i18n/            国际化
├── utils/           纯函数和通用工具
├── mocks/           测试 Mock
└── test-utils/      测试基础设施
```

## 约束

- 一个业务域只有一个主目录，禁止同一领域同时在顶层目录和 `features` 中维护两套实现。
- Feature 内部允许按职责拆分，但外部只通过 Feature 公共入口访问。
- Store、Service、IPC 和组件不跨层互相穿透；Tauri 调用集中在 `platform` 或 Feature 的 `services`。
- `ui`、`utils`、`core` 不允许依赖具体业务 Feature。
- 模块只通过 Feature 公共入口访问领域能力，不保留旧目录兼容导出。
- 每个垂直切片必须通过 TypeScript、单元测试和相关 E2E 测试。

## 落地顺序

1. 建立 Feature 公共入口和架构门禁。
2. 将 terminal、chat、workspace 的组件、Hooks、Store、服务合并到各自 Feature。
3. 将 files、ssh、search、settings、session-history 合并到 Feature 内部。
4. 将 Tauri IPC、PTY、文件系统和窗口 API 收敛到 `platform`。
5. 清理兼容层，按 Feature 拆分懒加载边界，处理构建产物体积。

本阶段已按可运行的垂直切片完成目录、别名、入口、平台适配和架构门禁迁移。
