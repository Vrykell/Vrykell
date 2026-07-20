---
name: code-review-2026-07-20
description: 项目全面代码审查结果 — Phase 1 源码审查，含 Bug 清单、重构建议、优化方向
metadata:
  type: reference
  updated: 2026-07-20
---

# Code Review — AI Terminal v0.1.0

**审查日期**: 2026-07-20
**审查范围**: 全部 22 个源文件（src/main, src/preload, src/renderer, src/shared）+ 配置文件
**方法**: 9 角度并行审查（5 correctness + 3 cleanup + 1 altitude），多 agent 独立验证
**审查标准**: 最大 effort — 宁可误报，不能漏报

---

## 一、严重 Bug（必须修复）

### 🔴 Bug 1 (CRITICAL): `Uint8Array.toString()` 将所有键盘输入变成乱码

**文件**: `src/main/pty-manager.ts:76`
**影响**: 终端完全不可用 — 任何按键输入都无法被 Shell 识别

```typescript
// 当前代码（错误）
writeToSession(id: string, data: Uint8Array): void {
  const session = this.sessions.get(id);
  if (!session) return;
  session.process.write(data.toString());  // ← BUG
}
```

**根因**: `Uint8Array.prototype.toString()` 继承自 `Array.prototype.toString()`，用逗号连接各字节的十进制值。用户输入 `ls` → TextEncoder 编码为 `Uint8Array([108, 115])` → `data.toString()` 输出 `"108,115"` → Shell 收到乱码命令。

**验证**:
```javascript
new Uint8Array([104,101,108,108,111]).toString()  // → "104,101,108,108,111"
new TextDecoder().decode(new Uint8Array([104,101,108,108,111]))  // → "hello"
```

**修复**:
```typescript
session.process.write(Buffer.from(data).toString('utf-8'));
// 或
session.process.write(new TextDecoder().decode(data));
```

---

### 🟠 Bug 2 (HIGH): 关闭会话后渲染进程不清理，产生僵尸标签

**文件**: `src/renderer/App.tsx`
**影响**: 关闭的终端标签仍显示在 UI 中，点击后指向已销毁的 PTY

**根因**: `App.tsx` 订阅了 `onSessionCreated` 但没有订阅 `onSessionClosed` 或 `onPTYExit`。关闭会话时主进程发送了关闭事件，但渲染进程不响应。

```typescript
// App.tsx 当前代码 — 只有 session created，没有 session closed
useEffect(() => {
  const disposer = window.electronAPI?.onSessionCreated((session) => {
    addSession(session);  // ← 只有 add，没有 remove
  });
  return () => disposer?.();
}, [addSession]);
// 缺少对应的 onSessionClosed 监听器
```

**修复**: 添加对 `onSessionClosed` 的监听：
```typescript
useEffect(() => {
  const disposer = window.electronAPI?.onSessionClosed(({ sessionId }) => {
    useTerminalStore.getState().removeSession(sessionId);
  });
  return () => disposer?.();
}, []);
```

---

### 🟠 Bug 3 (HIGH): 4 个 `createPTY()`/`closePTY()` 调用点缺少错误处理

**文件**: `src/renderer/App.tsx:77, 90, 101, 106`
**影响**: PTY 创建失败时（如 Shell 不存在）产生 unhandled promise rejection

```typescript
// App.tsx line 77 — 无 .catch()
window.electronAPI?.createPTY({});

// line 90 — 无 .catch()  
window.electronAPI?.createPTY({});

// line 101 — 无 .catch()
window.electronAPI?.createPTY({});

// line 106 — 无 .catch()
window.electronAPI?.closePTY(activeSessionId);
```

**修复**: 每个调用点添加 `.catch()`：
```typescript
window.electronAPI?.createPTY({}).catch(err => console.error('Failed to create PTY:', err));
```

---

## 二、中等 Bug（建议修复）

### 🟡 Bug 4: AI 流式响应的 `streamingMessageId` 跨对话泄漏

**文件**: `src/renderer/App.tsx:34-68`
**影响**: 快速连续发送两条 AI 消息时，第二条的 chunk 被追加到第一条

**根因**: `streamingMessageId` 是 useEffect 闭包中的变量，只在 `data.done` 或 `data.error` 时重置。如果在流式响应未完成时发起新的对话，新流的第一个 chunk 会被错误附加到上一次的消息中。

### 🟡 Bug 5: AI chat `ipcMain.handle` 中的 Promise 被丢弃

**文件**: `src/main/ipc-handlers.ts:71-73`
**影响**: AI 调用失败时产生 unhandled promise rejection

```typescript
ipcMain.handle(IPC_AI_CHAT, async (_event, messages: Message[]) => {
  aiBridge.chat(messages);  // ← 未 return/await，Promise 被孤立
});
```

**修复**: `return aiBridge.chat(messages);`

### 🟡 Bug 6: `updateSettings` 浅合并破坏嵌套配置对象

**文件**: `src/renderer/stores/terminal-store.ts:108-109`
**影响**: 调用 `updateSettings({ terminal: { fontSize: 16 } })` 会丢失所有其他 terminal 设置

```typescript
updateSettings: (partial) =>
  set((s) => ({ settings: { ...s.settings, ...partial } })),  // 浅合并
```

### 🟡 Bug 7: macOS 所有窗口关闭后重建时 PTY 输出丢失

**文件**: `src/main/index.ts:141, 147-151`
**影响**: macOS 上关闭所有窗口再重新打开后，终端输入/输出失效

**根因**: `window-all-closed` 事件调用 `ptyManager.destroy()` → `removeAllListeners()` 移除了 `registerIpcHandlers` 注册的 IPC 转发监听器。macOS 上 app 不退出，用户可通过 dock 重新打开窗口，但 IPC 监听器已丢失。

---

## 三、代码质量与重构建议

### 1. 预加载脚本 8 个几乎相同的监听器工厂

**文件**: `src/preload/index.ts:40-79`（~45 行）
**建议**: 提取通用 helper 函数，减少 ~35 行重复：

```typescript
const listen = <T>(channel: string, cb: (data: T) => void): (() => void) => {
  const handler = (_: any, data: T) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
```

### 2. 无效文件 `electron-prelude.ts`

**文件**: `src/main/electron-prelude.ts`（13 行全是注释）
**建议**: Electron 43 已解决 require 问题，此文件可安全删除。`main/index.ts:1` 的 import 一并移除。

### 3. 死变量 `disposersRef`

**文件**: `src/renderer/hooks/useTerminal.ts:18`
**建议**: 声明的 `disposersRef` 从未被写入或读取，应删除。

### 4. `TerminalView.tsx` 无用的 store 订阅导致多余渲染

**文件**: `src/renderer/components/terminal/TerminalView.tsx:15`
**建议**: `activeSessionId` 被选择但未被使用，每次切换标签页都会触发不必要的重渲染。

### 5. 会话状态的双重存储

**文件**: `pty-manager.ts:12` + `session-store.ts:8`
**问题**: 同一个逻辑会话存储在两个独立的 Map 中，所有生命周期操作必须同步更新两者。`sessionStore.remove()` 在正常关闭流程中被调用了两次（`ipc-handlers.ts:49` 和 `ipc-handlers.ts:98`）。

### 6. `ISessionBackend` 接口契约违规

**文件**: `src/main/pty-manager.ts:91-94`
**问题**: `PtyManager implements ISessionBackend` 但 `connectSSH()` 无条件抛出错误，违反 Liskov 替换原则。

### 7. 硬编码 IPC 通道字符串

**文件**: `src/main/index.ts:130`
**问题**: `sendMenuAction()` 使用裸字符串 `'app:menu-action'` 而非导入的常量 `IPC_APP_MENU_ACTION`。

### 8. 缺少 Phase 功能开关

**文件**: `AIChatPanel.tsx`, `RichOutput.tsx`, `ai-bridge.ts`
**问题**: 未完成的 Phase 2-4 占位组件始终可见，v0.1.0 用户会看到无功能的 AI 面板和富输出面板。建议添加 feature flag 机制。

### 9. 缺少依赖

**文件**: `package.json` vs `docs/plan.md`
**缺失**: `@xterm/addon-canvas`（WebGL 降级方案）、`@xterm/addon-clipboard`、`@xterm/addon-web-links`、`electron-builder`、`vitest`（零测试文件）等

### 10. 预加载 IPC 事件使用 `any` 类型

**文件**: `src/preload/index.ts:41-78`
**问题**: 9 处事件回调使用 `data: any` 绕过类型检查。IPC 边界是类型安全最关键的防线。

---

## 四、汇总

| 类别 | 数量 | 严重程度分布 |
|------|------|-------------|
| 严重 Bug | 3 | CRITICAL ×1, HIGH ×2 |
| 中等 Bug | 4 | MEDIUM ×4 |
| 代码质量/重构 | 10 | — |

### 优先修复顺序

1. **立即修复**: Bug 1 (`Uint8Array.toString()` → 终端输入乱码)
2. **尽快修复**: Bug 2 (僵尸标签), Bug 3 (缺少错误处理)
3. **Phase 2 前修复**: Bug 5 (AI Promise 丢弃), Bug 6 (浅合并)
4. **长期改进**: 提取重复代码, 删除死代码, 添加 feature flag

### 架构级评价

项目整体架构设计合理（分层清晰、ISessionBackend 接口抽象、OSC 协议设计完善），文档质量优秀。当前代码处于 Phase 1 MVP 阶段，主要问题集中在：
- **IPC 数据转换**（Bug 1 — 严重）
- **生命周期管理**（Bug 2, 3, 7 — 会话清理不完整）
- **Phase 2+ 占位代码**未做 feature flag 隔离
