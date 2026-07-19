---
name: module-resolution-deep-dive
description: Electron 模块解析机制深度分析 — 完整调用链、CJS/ESM 差异、包装器设计演进
metadata:
  type: reference
  updated: 2026-07-20
---

# Electron 模块解析深度分析

记录本项目从 Electron 28 到 32 的模块解析踩坑全历程。

---

## 1. 项目模块系统架构

### 编译层次

```
源码 (TypeScript)                  编译产物 (JavaScript)
─────────────────                  ──────────────────────
src/main/*.ts          ──tsc──►   dist/main/main/*.js    [CJS, "use strict"]
src/preload/*.ts       ──tsc──►   dist/main/preload/*.js  [CJS]
src/shared/*.ts        ──tsc──►   dist/main/shared/*.js   [CJS]
src/renderer/*.tsx     ──vite──►  dist/renderer/assets/*  [ESM bundle]
```

### 入口链

```
Electron 二进制启动
  → 读取 package.json "main": "main-wrapper.mjs"
  → 以 ESM 加载 main-wrapper.mjs (.mjs 强制 ESM)
    → createRequire(import.meta.url) 创建 CJS require 函数
    → require('electron') 获取 Electron API
    → globalThis.__ELECTRON_API__ = electron  // 缓存全局
    → require('./dist/main/main/index.js')     // 加载编译后的 CJS 应用
      → require('./electron-prelude')          // 修补模块加载（当前为 no-op）
      → require('electron')  // ← 问题发生点
      → electron_1.app.isPackaged  // ← TypeError
```

---

## 2. `main-wrapper.mjs` 设计演进

### v1 (原始设计 — 不可用)

```javascript
import pkg from 'electron';
globalThis.__ELECTRON_API__ = pkg;
import('./dist/main/main/index.js');
```

**失败原因**: ESM `import` 解析 `electron` 时，ESM 加载器通过 CJS 互操作获取 `module.exports`。
npm 包的 `module.exports = getElectronPath()` 返回路径字符串，`pkg` = `"/path/to/Electron"`.

### v2 (createRequire — 也不可用)

```javascript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const electron = require('electron');
```

**失败原因**: `createRequire` 创建的是标准 CJS `require` 函数，解析流程与 v1 相同，
仍找到 npm 包的 `index.js`。

### v3 (_linkedBinding — 部分成功但 API 不全)

```javascript
const electron = process._linkedBinding('electron_common_features');
```

**失败原因**: 返回对象不含 `app`/`BrowserWindow` 等核心 API，只有功能标志。

### v4 (当前版本 — 改为 ESM import 测试中)

当前版本使用 ESM `import` + `createRequire` 双重策略，配合 `electron-prelude.ts`
在 `Module._load` 层拦截。实际仍不可用，因为拦截层无法获取真实 API。

---

## 3. `electron-prelude.ts` 设计演进

### 文件职责

在 Electron 内置模块被 npm 包拦截时，修补模块加载机制，确保 `require('electron')` 返回真实 API。

### v1: `Module._resolveFilename` 路径过滤

```typescript
// 原设计：过滤 parent.paths 中含 '/electron' 的条目
parent.paths = origPaths.filter(
  (p) => !p.includes('/electron') && !p.endsWith('/electron')
);
```

**为什么失败**: `parent.paths` 包含的是 `node_modules` **目录**路径（如
`/Users/wuzhe/ai-terminal/node_modules`），不是具体的模块路径（如
`node_modules/electron/index.js`）。目录路径中不含 `/electron` 字面量，
所以过滤器实际什么都没过滤。npm 包仍然被找到。

### v2: 清空 parent.paths

```typescript
parent.paths = [];  // 强制只搜索内置模块
```

**为什么失败**: Electron 没有将 `electron` 注册为 Node.js 标准内置模块
（不在 `Module.builtinModules` 中）。清空路径后 `_resolveFilename` 直接返回
`MODULE_NOT_FOUND`。Electron 的模块拦截发生在 `Module._load` 层，不在 `_resolveFilename`。

### v3: `Module._load` 拦截（当前测试中）

```typescript
Module._load = function (request, parent, isMain) {
  if ((request === 'electron' || request.startsWith('electron/')) &&
      globalThis.__ELECTRON_API__) {
    return globalThis.__ELECTRON_API__;
  }
  return originalLoad.call(Module, request, parent, isMain);
};
```

**问题**: 需要 `globalThis.__ELECTRON_API__` 已设置，但设置它的唯一途径就是…
`require('electron')`。循环依赖。

### v4 (Electron 32+): No-op

```typescript
// No patching needed for Electron 32+
// Electron's Module._load natively intercepts require('electron')
```

**实际情况**: Electron 32 的 `Module._load` 也**没有**拦截 `electron`。
这个假设是错误的。回退到 v3 方案尝试。

---

## 4. `package.json` `"type"` 字段影响

### `"type": "module"` (原始设置)

- `.js` 文件 → 视为 ESM
- 编译产物是 CJS（`require`/`module.exports`）→ 加载时报错
- ESM `import` 可正常解析 npm `electron` 包（但仍返回路径字符串）

### `"type": "commonjs"` (修改后)

- `.js` 文件 → 视为 CJS ← **编译产物正确加载**
- `.mjs` 文件 → 仍为 ESM ← **wrapper 正常**
- `createRequire` 创建的 require 可正确加载 CJS 编译产物

### 关键规则

- **`.mjs` 始终是 ESM，`.cjs` 始终是 CJS** — 与 `"type"` 无关
- **`createRequire`** 是 ESM 中安全加载 CJS 模块的唯一方式
- **动态 `import()`** 在 `"type": "commonjs"` 下加载 `.js` 可能触发 CJS/ESM 混淆

---

## 5. 编译产物加载问题记录

### 问题：CJS 编译产物被当作 ESM 加载

```
// package.json: "type": "module"
require('./dist/main/main/index.js')
// → Error: exports is not defined in ES module scope
```

**原因**: `"type": "module"` 让所有 `.js` 被当作 ESM，即使它们是 CJS 格式。

**修复**: 改为 `"type": "commonjs"`，依赖 `.mjs` 扩展名区分 ESM。

### 问题：`ipc-handlers.js` 中的 `require('electron')`

`dist/main/main/index.js` 不是唯一调用 `require('electron')` 的文件。
所有主进程模块（`ipc-handlers.js`, `pty-manager.js` 等）都间接依赖它。

**影响**: 修复不能只针对 `index.js`，必须全局解决 `require('electron')` 解析问题。

---

## 6. 调试用脚本

### `debug-electron.cjs`

用于在 Electron 环境中枚举可用 API 的独立脚本。位于项目根目录，使用方式：

```bash
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron debug-electron.cjs
```

测试内容：
- 枚举所有 `process._linkedBinding` 绑定
- 列出 `Module.builtinModules` 中的 electron 内置模块
- 尝试各种 `require('electron/...')` 内部路径
- 检查 `Module._cache` 状态

### `test-entry.cjs`

最小化 CJS 入口，用于隔离测试 `require('electron')` 行为。

---

## 7. 已知的 Electron Bug

### GitHub Issue #49034

- **标题**: `require('electron')` Returns Executable Path Instead of API Objects on Windows
- **URL**: https://github.com/electron/electron/issues/49034
- **报告日期**: 2025-11-18
- **影响版本**: v31.7.7, v32.2.2（可能更多）
- **平台**: Windows（本项目的 macOS 测试表明同样受影响）
- **状态**: 无已知修复版本

### 本项目补充发现

- **影响 Electron 28.3.3, 30.0.0, 32.3.3**（均在 macOS 验证）
- **npm `electron@30+` 移除了运行时检测代码**（`index.js` 从 68 行简化到 21 行）
- **连全新创建的最小 Electron 应用也受影响**（非本项目特有）

---

## 8. 代码规范与约定

### TypeScript 编译

- `tsconfig.base.json` — 共享基础配置（ES2022, strict mode）
- `tsconfig.main.json` — 主进程配置：`module: CommonJS`, `outDir: dist/main`
- `tsconfig.json` — 渲染进程：`jsx: react-jsx`, `module: ESNext`

### IPC 通道命名

- 格式：`<domain>:<action>` — 如 `pty:create`, `session:closed`
- 常量定义：`src/shared/ipc-channels.ts`
- 所有通道名集中管理，不允许硬编码字符串

### 文件职责

| 文件 | 单一职责 |
|------|---------|
| `src/main/index.ts` | 窗口创建、菜单、应用生命周期 — **不处理业务逻辑** |
| `src/main/pty-manager.ts` | PTY 进程生命周期（spawn/write/resize/kill） |
| `src/main/ipc-handlers.ts` | IPC 处理器注册，**纯路由** — 业务逻辑委托给各 manager |
| `src/main/session-store.ts` | 会话元数据 CRUD — 当前内存，Phase 4 加磁盘 |
| `src/main/ai-bridge.ts` | Claude API 封装 — Phase 3 实现 |
| `src/main/ssh-client.ts` | SSH2 封装 — Phase 4 实现 |
| `src/preload/index.ts` | contextBridge 暴露 API — **安全边界** |
| `src/shared/types.ts` | 所有跨进程类型定义 + 默认值 |
| `src/shared/ipc-channels.ts` | IPC 通道名常量 |
| `src/shared/protocol.ts` | OSC 转义序列构建器 |

### 安全模型

- `contextIsolation: true` — 渲染进程无法访问 Node.js
- `nodeIntegration: false` — 必须通过 preload bridge 通信
- `sandbox: false` — node-pty 的 IPC 需要此设置
- 主进程持有所有 API key 和私钥，不传递给渲染进程

---

## 9. 当前阻塞与下一步

### 阻塞问题

**Electron 无法启动** — `require('electron')` 在所有测试版本中返回路径字符串。
所有 Phase 1 代码编译通过但无法运行时验证。

### 推荐行动

1. **短期**: 尝试 Electron 43+ (最新版)，官方模板确认可用
2. **备选**: 使用 electron-forge 工具链
3. **终极方案**: 手动管理 Electron 二进制，不通过 npm `electron` 包

### Phase 2 可并行进行

Phase 2（富内容渲染）的代码大部分是纯 TypeScript + React 组件，
不依赖 Electron 运行时。可以在不启动应用的情况下开发和单元测试。
