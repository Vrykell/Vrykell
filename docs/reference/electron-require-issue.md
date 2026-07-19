---
name: electron-require-issue
description: "Electron require('electron') 返回路径字符串而非 API 对象 — 完整根因分析、版本对比、调试记录"
metadata:
  type: reference
  updated: 2026-07-20
---

# Electron `require('electron')` 返回路径字符串问题

**症状**: 在 Electron 主进程中 `require('electron')` 返回二进制路径字符串
（如 `/path/to/Electron.app/Contents/MacOS/Electron`），而非 `{app, BrowserWindow, ...}` API 对象。

**影响范围**: 所有通过 npm 安装 `electron` 作为 devDependency 的项目，Electron 28 ~ 32（可能更多）。

---

## 根因分析

### 模块解析流程

```
require('electron')
  → Module._load('electron', parent, isMain)
    → Electron 的 c._load (node:electron/js2c/node_init) 被调用
    → c._load 没有拦截 'electron' 请求（BUG）
    → 回退到标准 Node.js 模块解析
    → Module._resolveFilename('electron', parent, false)
    → 在 parent.paths 中搜索 node_modules
    → 找到 node_modules/electron/index.js ← npm 包
    → 返回 getElectronPath() → 路径字符串
```

### npm `electron` 包的 index.js 变迁

| 版本 | index.js 行为 |
|------|-------------|
| **28.3.3** | 有运行时检测代码：`process._linkedBinding('electron_common_features')` +
  创建 fake parent（`paths: []`）尝试 resolve 内置模块 + fallback 到路径字符串 |
| **30.0.0+** | **移除所有检测代码**，直接 `module.exports = getElectronPath()` |
| **32.3.3** | 与 30 相同，纯路径返回 |

28 版本的检测代码也失败了，因为：
- `_linkedBinding('electron_common_features')` 返回的是**功能标志对象**（`isBuiltinSpellCheckerEnabled` 等），不含 `app`/`BrowserWindow`
- fake parent 方式 `Module._resolveFilename('electron', {paths: []}, false)` → `MODULE_NOT_FOUND`

---

## 跨版本测试结果

测试方法：创建最小 Electron 应用 `const { app } = require('electron')`

| Electron 版本 | 嵌入 Node.js | index.js 检测逻辑 | require('electron') 结果 |
|--------------|-------------|------------------|------------------------|
| 28.3.3 | 18.18.2 | 有（失败） | ❌ 路径字符串 |
| 30.0.0 | 20.11.1 | 无 | ❌ 路径字符串 |
| 32.3.3 | 20.18.1 | 无 | ❌ 路径字符串 |

**结论：换版本不能解决问题。** 这是一个从 Electron 28 到 32 持续存在的系统性 Bug。

---

## 调试详情

### 1. 可用的 linked binding

```javascript
process._linkedBinding('electron_common_features')
// → { isBuiltinSpellCheckerEnabled, isPDFViewerEnabled, isFakeLocationProviderEnabled,
//     isPrintingEnabled, isComponentBuild, isExtensionsEnabled }
// ❌ 不含 app, BrowserWindow, ipcMain 等核心 API

process._linkedBinding('electron')        // → Error: No such binding
process._linkedBinding('electron_browser') // → Error: No such binding
process._linkedBinding('atom_common_features') // → Error: No such binding
```

### 2. 可用的 Electron 内置模块（js2c）

```javascript
require('module').builtinModules.filter(m => m.includes('electron'))
// → [
//   'electron/js2c/browser_init',    // ⚠️ require 会导致 SIGSEGV (exit 139)
//   'electron/js2c/isolated_bundle',
//   'electron/js2c/node_init',
//   'electron/js2c/renderer_init',
//   'electron/js2c/sandbox_bundle',
//   'electron/js2c/utility_init',
//   'electron/js2c/worker_init'
// ]
```

`require('electron/js2c/browser_init')` 会导致**段错误崩溃** (exit code 139)，
因为 browser_init 包含浏览器进程初始化代码，不应被二次加载。

### 3. 关键环境变量

```javascript
process.versions.electron  // → '28.3.3' (或 30.0.0 / 32.3.3)
process.type               // → undefined ← 关键！应该是 'browser'
```

`process.type` 为 `undefined` 说明 Electron 浏览器进程**尚未初始化**。
在正常流程中，`require('electron')` 触发延迟初始化，设置 `process.type = 'browser'` 并返回 API。

### 4. 各种尝试方案汇总

| 方案 | 结果 | 说明 |
|------|------|------|
| `require('electron')` | ❌ 路径字符串 | npm 包拦截 |
| `import pkg from 'electron'` (ESM) | ❌ 路径字符串 | ESM → CJS 互操作，仍走 npm 包 |
| `import('electron')` (dynamic) | ❌ 路径字符串 | 同上 |
| `createRequire` + `require('electron')` | ❌ 路径字符串 | createRequire 的 require 仍走 CJS 解析 |
| `Module._resolveFilename` 清空 parent.paths | ❌ MODULE_NOT_FOUND | Electron 不注册 electron 为内置 |
| `Module._load` 拦截 | ❌ 无源 API | 没有途径获取真实 electron API |
| `_linkedBinding('electron_common_features')` | ❌ 特性不全 | 无 app/BrowserWindow |
| `require('electron/js2c/browser_init')` | ❌ SIGSEGV | 二次初始化崩溃 |
| `require('electron/main')` | ❌ MODULE_NOT_FOUND | 无此模块 |
| 移除 node_modules/electron | ❌ MODULE_NOT_FOUND | CJS 和 ESM 都找不到 |
| Electron 30.0.0（换版本） | ❌ 同上 | npm 包 index.js 更简化 |
| Electron 32.3.3（换版本） | ❌ 同上 | 同上 |
| 最小化独立 Electron 应用 | ❌ 同样失败 | 非本项目的特有问题 |

---

## 已确认的解决方案

### 方案 A：升级到 Electron 43+（推荐）

Electron 43 的官方模板（electron-quick-start）确认 `require('electron')` 正常工作。
可能是 Electron 在该版本修复了内置模块拦截机制。

### 方案 B：使用 electron-forge

`electron-forge` 通过自定义的 CLI 启动流程和打包方式可能绕过了此问题。

### 方案 C：不使用 npm `electron` 包

如果通过其他方式（如直接下载 Electron 二进制文件，不经过 npm）获取 Electron，
则 `node_modules/electron` 不存在，不会发生拦截。

---

## 相关文件

- [electron-prelude.ts](/src/main/electron-prelude.ts) — 曾尝试修补模块加载（当前为 no-op）
- [main-wrapper.mjs](/main-wrapper.mjs) — ESM 包装入口，用 createRequire 加载 CJS 代码
- [package.json](/package.json) — `"type": "commonjs"` + `"main": "main-wrapper.mjs"`
- [dist/main/main/index.js](/dist/main/main/index.js) — 编译后的主进程入口

---

## 参考链接

- Electron Issue [#49034](https://github.com/electron/electron/issues/49034) — Windows 平台的同一问题报告
- 日期：2025-11-18 报告，影响 v31.7.7+ 和 v32.2.2+
