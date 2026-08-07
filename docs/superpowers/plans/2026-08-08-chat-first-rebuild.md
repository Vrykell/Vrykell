# Chat-First AI Terminal 推倒重建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零重建 AI Terminal：chat 页面为主体（AI 流式输出 + Markdown/LaTeX 渲染 + 命令块一键下发），xterm.js 提供稳定的内嵌终端面板，Rust/Tauri 2 只做 PTY 后端。

**Architecture:** 两个表面各司其职——chat 表面渲染受控的 AI 文本流（react-markdown + KaTeX，零启发式扫描），终端表面是纯文本哑终端（xterm.js，能跑 vim/Claude Code 即可）。Rust 后端仅负责 PTY 会话生命周期（spawn/write/resize/close + 输出事件流）。Block 结构化（OSC 133）、文件管理、自动补全不在本计划内，各自是后续独立计划。

**Tech Stack:** Tauri 2（Rust + portable-pty）、React + TypeScript + Vite、@xterm/xterm + @xterm/addon-fit、react-markdown + remark-gfm + remark-math + rehype-katex、zustand、@anthropic-ai/sdk（BYOK，浏览器直连）、vitest + @testing-library/react。

## Global Constraints

- **禁止自研终端模拟器/VT 解析器**——终端一律 xterm.js，不写自研的 buffer/rewrite/scan 层。
- **禁止从终端输出文本反推富内容**——富渲染只发生在 chat 表面（受控输入）。
- 开发机是 macOS 12（Darwin 21）WKWebView：**禁止正则后瞻 `(?<!...)` / `(?<=...)`**（Safari < 16.4 解析即崩）。vitest 在 Node 里测不出，任何新正则字面量必须人工核查。
- UI 文案用中文。
- AI 模型 ID 可配置，默认 `claude-sonnet-5`。
- API Key 存 localStorage（v0 明文，README 注明风险，后续换 keyring）。
- 包管理器用 npm；测试用 vitest。
- 每个 Task 完成后 `npm run build`（前端）和 `cargo check`（后端）必须干净。

---

### Task 1: 归档旧代码 + 全新脚手架

**Files:**
- Create: 整个新工程骨架（由 create-tauri-app 生成）
- Modify: `.gitignore`（生成物自带）
- Delete: 工作区全部旧文件（git 历史保留）

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 Tauri 2 + React + TS 空工程；`npm run dev`（Vite）与 `npm run tauri dev`（桌面窗口）可用

- [ ] **Step 1: 归档当前工作区（含未提交的 resize/rich-scan 修复）**

```bash
cd /Users/wuzhe/ai-terminal
git checkout -b archive/v1-dom-terminal
git add -A
git commit -m "archive: v1 自研 DOM 终端 + rich-scan（推倒重建前的最终状态）"
```

- [ ] **Step 2: 从 main 切出重建分支并清空工作区**

```bash
git checkout main
git checkout -b v2-chat-first
git rm -rf .
git clean -fdx   # 删除未跟踪文件；node_modules 也会删，无妨
```

- [ ] **Step 3: 生成新骨架**

```bash
cd /tmp
npm create tauri-app@latest ai-terminal-v2 -- --template react-ts --manager npm --yes
cd /Users/wuzhe/ai-terminal
cp -R /tmp/ai-terminal-v2/. .   # 模板不带 .git，不会覆盖现有历史
```

若 `--yes` 参数不被当前 create-tauri-app 版本支持，则交互运行并依次选择：项目名 `ai-terminal-v2` → npm → TypeScript → React。

- [ ] **Step 4: 恢复本计划文档到工作区**

```bash
git checkout archive/v1-dom-terminal -- docs/superpowers/plans/2026-08-08-chat-first-rebuild.md
```

- [ ] **Step 5: 安装依赖并验证双端可跑**

```bash
npm install
npm run tauri dev
```

Expected: 桌面窗口打开，显示 Vite+React 模板页；`Ctrl+C` 退出。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: v2 脚手架（Tauri 2 + React + TS，create-tauri-app 模板）"
```

---

### Task 2: Rust PTY 后端

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs`（注册 state + commands）
- Modify: `src-tauri/Cargo.toml`（加 `portable-pty`、`uuid`）
- Test: `src-tauri/src/pty.rs` 内 `#[cfg(test)]` 模块（roundtrip 测试）

**Interfaces:**
- Produces（Tauri commands，JS 侧用 camelCase 传参）:
  - `pty_spawn(cols: u16, rows: u16, cwd: Option<String>) -> Result<String, String>` 返回 session id
  - `pty_write(id: String, data: String) -> Result<(), String>`
  - `pty_resize(id: String, cols: u16, rows: u16) -> Result<(), String>`
  - `pty_close(id: String) -> Result<(), String>`
- Produces（Tauri events）:
  - `pty-output` payload `{ id: string, data: string }`
  - `pty-exit` payload `{ id: string }`

- [ ] **Step 1: 加依赖**

`src-tauri/Cargo.toml` 的 `[dependencies]` 追加：

```toml
portable-pty = "0.8"
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 2: 写失败的 roundtrip 测试**

`src-tauri/src/pty.rs`（先只有测试模块，驱动出 `spawn_shell` 辅助函数）：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn pty_roundtrip_echoes_input() {
        let mut session = spawn_shell(80, 24, None).expect("spawn");
        session.writer.write_all(b"echo v2-pty-ok\n").unwrap();
        session.writer.flush().unwrap();
        let mut out = String::new();
        let mut buf = [0u8; 4096];
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !out.contains("v2-pty-ok") && std::time::Instant::now() < deadline {
            match session.reader.read(&mut buf) {
                Ok(n) if n > 0 => out.push_str(&String::from_utf8_lossy(&buf[..n])),
                _ => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
        assert!(out.contains("v2-pty-ok"), "no echo, got: {out:?}");
    }
}
```

- [ ] **Step 3: 实现 pty.rs**

```rust
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<HashMap<String, PtySession>>);

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: String,
}

#[cfg(test)]
struct TestSession {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn Child + Send + Sync>,
}

#[cfg(test)]
fn spawn_shell(cols: u16, rows: u16, cwd: Option<String>) -> Result<TestSession, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new_default_prog();
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    Ok(TestSession { reader, writer, _child: child })
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new_default_prog();
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    state.0.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        PtySession { master: pair.master, writer, child },
    );

    let tid = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = app.emit("pty-exit", PtyExit { id: tid.clone() });
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    if app.emit("pty-output", PtyOutput { id: tid.clone(), data }).is_err() {
                        break; // 窗口已关闭
                    }
                }
                Err(_) => break,
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("session not found")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("session not found")?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}
```

- [ ] **Step 4: 注册到 lib.rs**

`src-tauri/src/lib.rs` 的 `run()` 中（保留模板自带的 plugin/setup 调用，只加 `mod`、`manage` 和 handler）：

```rust
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: 验证**

```bash
cd src-tauri
cargo test pty_roundtrip_echoes_input -- --nocapture
cargo check
```

Expected: 测试 PASS（输出里能看到 `v2-pty-ok`）；check 干净。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/
git commit -m "feat(pty): PTY 会话后端（spawn/write/resize/close + 输出事件流）"
```

---

### Task 3: 前端 PTY IPC 封装

**Files:**
- Create: `src/lib/pty.ts`
- Test: `src/lib/pty.test.ts`
- Create: `src/test/setup.ts`（vitest setup）

**Interfaces:**
- Consumes: Task 2 的 4 个 command 和 2 个 event
- Produces:
  - `ptySpawn(cols: number, rows: number, cwd?: string): Promise<string>`
  - `ptyWrite(id: string, data: string): Promise<void>`
  - `ptyResize(id: string, cols: number, rows: number): Promise<void>`
  - `ptyClose(id: string): Promise<void>`
  - `onPtyOutput(cb: (id: string, data: string) => void): Promise<UnlistenFn>`
  - `onPtyExit(cb: (id: string) => void): Promise<UnlistenFn>`

- [ ] **Step 1: 写失败测试**

注意：所有 `vi.mock` factory 里引用的 mock 函数必须用 `vi.hoisted` 定义——vitest 会把 `vi.mock` 提升到文件顶部，直接引用顶层 `const` 会在收集期报 "cannot reference top-level variable"。

`src/lib/pty.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput } from './pty';

describe('pty IPC wrapper', () => {
  beforeEach(() => { invokeMock.mockReset(); listenMock.mockReset(); });

  it('pty_spawn 传 camelCase 参数并返回 id', async () => {
    invokeMock.mockResolvedValue('sess-1');
    const id = await ptySpawn(80, 24, '/tmp');
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', { cols: 80, rows: 24, cwd: '/tmp' });
    expect(id).toBe('sess-1');
  });

  it('pty_spawn 缺省 cwd 传 null', async () => {
    invokeMock.mockResolvedValue('sess-2');
    await ptySpawn(120, 40);
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', { cols: 120, rows: 40, cwd: null });
  });

  it('pty_write/resize/close 映射到对应 command', async () => {
    invokeMock.mockResolvedValue(undefined);
    await ptyWrite('s', 'ls\n');
    await ptyResize('s', 100, 30);
    await ptyClose('s');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'pty_write', { id: 's', data: 'ls\n' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pty_resize', { id: 's', cols: 100, rows: 30 });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'pty_close', { id: 's' });
  });

  it('onPtyOutput 解包 payload', async () => {
    const cb = vi.fn();
    listenMock.mockResolvedValue(() => {});
    await onPtyOutput(cb);
    const handler = listenMock.mock.calls[0][1];
    handler({ payload: { id: 's', data: 'hello' } });
    expect(cb).toHaveBeenCalledWith('s', 'hello');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run src/lib/pty.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/lib/pty.ts`**

```ts
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function ptySpawn(cols: number, rows: number, cwd?: string): Promise<string> {
  return invoke('pty_spawn', { cols, rows, cwd: cwd ?? null });
}

export function ptyWrite(id: string, data: string): Promise<void> {
  return invoke('pty_write', { id, data });
}

export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke('pty_resize', { id, cols, rows });
}

export function ptyClose(id: string): Promise<void> {
  return invoke('pty_close', { id });
}

export function onPtyOutput(cb: (id: string, data: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string; data: string }>('pty-output', (e) => cb(e.payload.id, e.payload.data));
}

export function onPtyExit(cb: (id: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string }>('pty-exit', (e) => cb(e.payload.id));
}
```

- [ ] **Step 4: 配置 vitest**

`package.json` 加 devDeps：`vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event`，加 script `"test": "vitest run"`；`vite.config.ts` 加：

```ts
/// <reference types="vitest" />
export default defineConfig({
  // ...模板原有内容（plugins 等）保留
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts' },
});
```

`src/test/setup.ts`：

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run src/lib/pty.test.ts
```
Expected: 4 PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/ src/test/ package.json vite.config.ts
git commit -m "feat(api): PTY IPC 封装 + vitest 基础设施"
```

---

### Task 4: xterm.js 终端面板

**Files:**
- Create: `src/terminal/useXterm.ts`
- Create: `src/terminal/TerminalPanel.tsx`
- Test: `src/terminal/TerminalPanel.test.tsx`

**Interfaces:**
- Consumes: `ptySpawn/ptyWrite/ptyResize/ptyClose/onPtyOutput/onPtyExit`（Task 3）
- Produces: `<TerminalPanel onReady={(sessionId: string) => void} />`——session id 经 `onReady` 上报，由 Task 7 存入 terminal store

- [ ] **Step 1: 安装依赖**

```bash
npm install @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 2: 写失败测试（mock xterm，验证接线而非 xterm 本身）**

`src/terminal/TerminalPanel.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const { writeMock, onDataHandlers, invokeMock } = vi.hoisted(() => ({
  writeMock: vi.fn(),
  onDataHandlers: [] as Array<(d: string) => void>,
  invokeMock: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24;
    loadAddon() {}
    open() {}
    write = writeMock;
    dispose() {}
    onData(h: (d: string) => void) { onDataHandlers.push(h); return { dispose() {} }; }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

invokeMock.mockResolvedValue('sess-x');
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// jsdom 无 ResizeObserver
globalThis.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
} as unknown as typeof ResizeObserver;

import TerminalPanel from './TerminalPanel';

describe('TerminalPanel', () => {
  beforeEach(() => { invokeMock.mockClear(); writeMock.mockClear(); onDataHandlers.length = 0; });

  it('挂载后 spawn PTY 并上报 session id', async () => {
    const onReady = vi.fn();
    render(<TerminalPanel onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith('sess-x'));
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', expect.objectContaining({ cols: 80, rows: 24 }));
  });

  it('xterm 输入转发到 pty_write', async () => {
    render(<TerminalPanel onReady={() => {}} />);
    await waitFor(() => expect(onDataHandlers.length).toBe(1));
    onDataHandlers[0]!('ls\n');
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 'sess-x', data: 'ls\n' });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run src/terminal/TerminalPanel.test.tsx
```
Expected: FAIL（组件不存在）

- [ ] **Step 4: 实现 `src/terminal/useXterm.ts`**

```ts
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput, onPtyExit } from '../lib/pty';
import type { UnlistenFn } from '@tauri-apps/api/event';

export function useXterm(onReady: (sessionId: string) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: 'Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    let sessionId: string | null = null;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    ptySpawn(term.cols, term.rows).then((id) => {
      if (disposed) { ptyClose(id); return; }
      sessionId = id;
      onReadyRef.current(id);
    });

    const dataSub = term.onData((data) => {
      if (sessionId) ptyWrite(sessionId, data).catch(() => {});
    });

    onPtyOutput((id, data) => {
      if (id === sessionId) term.write(data);
    }).then((u) => unlisteners.push(u));
    onPtyExit((id) => {
      if (id === sessionId) term.write('\r\n\x1b[31m[进程已退出]\x1b[0m\r\n');
    }).then((u) => unlisteners.push(u));

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (sessionId && term.cols > 0 && term.rows > 0) {
        ptyResize(sessionId, term.cols, term.rows).catch(() => {});
      }
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      unlisteners.forEach((u) => u());
      if (sessionId) ptyClose(sessionId).catch(() => {});
      term.dispose();
    };
  }, []);

  return containerRef;
}
```

- [ ] **Step 5: 实现 `src/terminal/TerminalPanel.tsx`**

```tsx
import '@xterm/xterm/css/xterm.css';
import { useXterm } from './useXterm';

export default function TerminalPanel({ onReady }: { onReady: (sessionId: string) => void }) {
  const ref = useXterm(onReady);
  return <div ref={ref} style={{ width: '100%', height: '100%', padding: 4, background: '#0e0f11' }} />;
}
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx vitest run src/terminal/
```
Expected: 2 PASS

- [ ] **Step 7: 真机验证**

临时把 `src/App.tsx` 改为渲染 `<TerminalPanel onReady={() => {}} />`，`npm run tauri dev`，输入 `ls` 回车；再跑 `vim` 进入全屏编辑后退出。

Expected: 目录列表正常输出；vim 全屏正常（验证 TUI 兼容）。

- [ ] **Step 8: Commit**

```bash
git add src/terminal/ package.json
git commit -m "feat(terminal): xterm.js 终端面板接入 PTY 后端"
```

---

### Task 5: Chat UI + Markdown/LaTeX 渲染

**Files:**
- Create: `src/stores/chat.ts`
- Create: `src/chat/Markdown.tsx`
- Create: `src/chat/MessageItem.tsx`
- Create: `src/chat/ChatView.tsx`
- Create: `src/chat/ChatInput.tsx`
- Test: `src/chat/Markdown.test.tsx`、`src/stores/chat.test.ts`

**Interfaces:**
- Consumes: 无（AI 流在 Task 6 接入）
- Produces:
  - `useChatStore`（zustand）：`messages: ChatMessage[]`、`sending: boolean`、`send(text: string, streamFn?: StreamFn): Promise<void>`、`appendChunk(id: string, chunk: string): void`
  - `ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; pending?: boolean }`
  - `StreamFn = (messages: Array<{ role: string; content: string }>, onChunk: (text: string) => void) => Promise<void>`
  - `setDefaultStream(fn: StreamFn): void`
  - `<ChatView />` 完整聊天面板

- [ ] **Step 1: 安装依赖**

```bash
npm install zustand react-markdown remark-gfm remark-math rehype-katex katex
```

- [ ] **Step 2: 写失败测试 — store**

`src/stores/chat.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat';

describe('chat store', () => {
  beforeEach(() => useChatStore.setState({ messages: [], sending: false }));

  it('send 追加用户消息并流式填充助手消息', async () => {
    const chunks = ['你好', '，世界', '！'];
    const fakeStream = async (_msgs: unknown, onChunk: (t: string) => void) => {
      for (const c of chunks) { onChunk(c); await Promise.resolve(); }
    };
    await useChatStore.getState().send('打个招呼', fakeStream);
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', content: '打个招呼' });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '你好，世界！', pending: false });
  });

  it('流式失败时助手消息带错误提示', async () => {
    const failStream = async () => { throw new Error('boom'); };
    await useChatStore.getState().send('hi', failStream);
    const msgs = useChatStore.getState().messages;
    expect(msgs[1]!.content).toContain('出错了');
    expect(msgs[1]!.pending).toBe(false);
  });
});
```

- [ ] **Step 3: 写失败测试 — Markdown 渲染**

`src/chat/Markdown.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Markdown from './Markdown';

describe('Markdown', () => {
  it('渲染 GFM 表格', () => {
    const { container } = render(<Markdown content={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('渲染 $$...$$ 为 KaTeX block', () => {
    const { container } = render(<Markdown content={'公式：\n\n$$E = mc^2$$'} />);
    expect(container.querySelector('.katex-display')).toBeInTheDocument();
  });

  it('渲染行内 $...$ 为 KaTeX inline', () => {
    const { container } = render(<Markdown content={'其中 $x^2$ 是平方'} />);
    expect(container.querySelector('.katex')).toBeInTheDocument();
  });

  it('渲染代码块', () => {
    const { container } = render(<Markdown content={'```python\nprint(1)\n```'} />);
    expect(container.querySelector('pre code')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

```bash
npx vitest run src/stores/chat.test.ts src/chat/Markdown.test.tsx
```
Expected: FAIL（模块不存在）

- [ ] **Step 5: 实现 `src/stores/chat.ts`**

```ts
import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
}

export type StreamFn = (
  messages: Array<{ role: string; content: string }>,
  onChunk: (text: string) => void,
) => Promise<void>;

let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  send: (text: string, streamFn?: StreamFn) => Promise<void>;
  appendChunk: (id: string, chunk: string) => void;
}

let defaultStream: StreamFn = async (_msgs, onChunk) => {
  onChunk('（尚未配置 AI 服务）');
};
export function setDefaultStream(fn: StreamFn) {
  defaultStream = fn;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sending: false,
  appendChunk: (id, chunk) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
    })),
  send: async (text, streamFn) => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return;
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: trimmed };
    const assistantMsg: ChatMessage = { id: nextId(), role: 'assistant', content: '', pending: true };
    set((s) => ({ messages: [...s.messages, userMsg, assistantMsg], sending: true }));
    const history = get()
      .messages.filter((m) => !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));
    try {
      await (streamFn ?? defaultStream)(history, (chunk) => get().appendChunk(assistantMsg.id, chunk));
    } catch (err) {
      get().appendChunk(assistantMsg.id, `\n\n> 出错了：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set((s) => ({
        sending: false,
        messages: s.messages.map((m) => (m.id === assistantMsg.id ? { ...m, pending: false } : m)),
      }));
    }
  },
}));
```

- [ ] **Step 6: 实现 `src/chat/Markdown.tsx`**

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
      {content}
    </ReactMarkdown>
  );
}
```

- [ ] **Step 7: 实现 `MessageItem.tsx` / `ChatView.tsx` / `ChatInput.tsx`**

`src/chat/MessageItem.tsx`：

```tsx
import Markdown from './Markdown';
import type { ChatMessage } from '../stores/chat';

export default function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div style={{
      alignSelf: isUser ? 'flex-end' : 'stretch',
      maxWidth: isUser ? '80%' : '100%',
      background: isUser ? '#1f6feb33' : 'transparent',
      borderRadius: 8, padding: '6px 10px',
    }}>
      {isUser ? message.content : <Markdown content={message.content} />}
      {message.pending && <span style={{ opacity: 0.5 }}>▍</span>}
    </div>
  );
}
```

`src/chat/ChatView.tsx`：

```tsx
import { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chat';
import MessageItem from './MessageItem';
import ChatInput from './ChatInput';

export default function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sending);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ opacity: 0.5, textAlign: 'center', marginTop: 40 }}>
            问点什么吧——支持 Markdown / LaTeX 渲染，shell 代码块可一键在终端运行。
          </div>
        )}
        {messages.map((m) => <MessageItem key={m.id} message={m} />)}
        <div ref={bottomRef} />
      </div>
      <ChatInput onSend={send} disabled={sending} />
    </div>
  );
}
```

`src/chat/ChatInput.tsx`：

```tsx
import { useState } from 'react';

export default function ChatInput({ onSend, disabled }: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };
  return (
    <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #ffffff14' }}>
      <textarea
        value={text}
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        rows={2}
        style={{ flex: 1, resize: 'none', background: '#ffffff0a', color: 'inherit', border: 'none', borderRadius: 6, padding: 8 }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button onClick={submit} disabled={disabled} style={{ padding: '0 16px' }}>发送</button>
    </div>
  );
}
```

- [ ] **Step 8: 跑测试确认通过**

```bash
npx vitest run src/stores/ src/chat/
```
Expected: 6 PASS（store 2 + markdown 4）

- [ ] **Step 9: Commit**

```bash
git add src/stores/ src/chat/ package.json
git commit -m "feat(chat): 聊天面板 + Markdown/LaTeX/表格/代码块渲染"
```

---

### Task 6: Anthropic BYOK 流式接入

**Files:**
- Create: `src/lib/ai.ts`
- Create: `src/chat/ApiKeyField.tsx`
- Modify: `src/App.tsx`（装配 ChatView + ApiKeyField）
- Test: `src/lib/ai.test.ts`

**Interfaces:**
- Consumes: `setDefaultStream`、`StreamFn`（Task 5）
- Produces: `anthropicStream: StreamFn`；`getApiKey()/setApiKey()/getModel()`（localStorage 封装）

- [ ] **Step 1: 安装依赖**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: 写失败测试**

`src/lib/ai.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: streamMock };
    constructor(public opts: unknown) {}
  },
}));

import { anthropicStream } from './ai';

describe('anthropicStream', () => {
  beforeEach(() => { localStorage.clear(); streamMock.mockReset(); });

  it('未配置 key 时抛出中文错误', async () => {
    await expect(anthropicStream([], () => {})).rejects.toThrow('API Key');
  });

  it('把 text_delta 事件逐块转发给 onChunk', async () => {
    localStorage.setItem('ai-terminal-api-key', 'sk-test');
    streamMock.mockReturnValue((async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '！' } };
      yield { type: 'message_stop' };
    })());
    const got: string[] = [];
    await anthropicStream([{ role: 'user', content: 'hi' }], (t) => got.push(t));
    expect(got).toEqual(['你好', '！']);
    expect(streamMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: 'hi' }],
    }));
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run src/lib/ai.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 `src/lib/ai.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { StreamFn } from '../stores/chat';

const KEY_STORAGE = 'ai-terminal-api-key';
const MODEL_STORAGE = 'ai-terminal-model';
const DEFAULT_MODEL = 'claude-sonnet-5';

export function getApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}
export function setApiKey(key: string) {
  localStorage.setItem(KEY_STORAGE, key.trim());
}
export function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL;
}

export const anthropicStream: StreamFn = async (messages, onChunk) => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('尚未配置 API Key，请先在顶部输入');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const stream = client.messages.stream({
    model: getModel(),
    max_tokens: 8192,
    messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onChunk(event.delta.text);
    }
  }
};
```

- [ ] **Step 5: 实现 `src/chat/ApiKeyField.tsx` + 装配 App**

`src/chat/ApiKeyField.tsx`：

```tsx
import { useState } from 'react';
import { getApiKey, setApiKey } from '../lib/ai';

export default function ApiKeyField() {
  const [key, setKey] = useState(getApiKey() ?? '');
  const [saved, setSaved] = useState(!!getApiKey());
  if (saved) return null;
  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#b45309aa' }}>
      <input
        type="password"
        value={key}
        placeholder="输入 Anthropic API Key（sk-ant-...），仅存在本机"
        style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit' }}
        onChange={(e) => setKey(e.target.value)}
      />
      <button onClick={() => { setApiKey(key); setSaved(true); }}>保存</button>
    </div>
  );
}
```

`src/App.tsx`（整个替换模板内容）：

```tsx
import { useEffect } from 'react';
import ChatView from './chat/ChatView';
import ApiKeyField from './chat/ApiKeyField';
import { setDefaultStream } from './stores/chat';
import { anthropicStream } from './lib/ai';

export default function App() {
  useEffect(() => setDefaultStream(anthropicStream), []);
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0e0f11', color: '#e6e8eb' }}>
      <ApiKeyField />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatView />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx vitest run src/lib/
```
Expected: ai 2 PASS + pty 4 PASS

- [ ] **Step 7: 真机验证（需要真实 API Key）**

`npm run tauri dev`，顶部输入 key 保存，发"用 LaTeX 写麦克斯韦方程组"。

Expected: 流式输出，公式渲染为 KaTeX 排版（同时验收整个 chat 渲染链路）。

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai.ts src/lib/ai.test.ts src/chat/ApiKeyField.tsx src/App.tsx package.json
git commit -m "feat(ai): Anthropic BYOK 流式对话接入"
```

---

### Task 7: 命令块一键在终端运行 + 应用布局

**Files:**
- Create: `src/stores/terminal.ts`
- Create: `src/chat/CommandBlock.tsx`
- Modify: `src/chat/Markdown.tsx`（接入 CommandBlock）
- Modify: `src/App.tsx`（chat + 终端面板布局）
- Test: `src/chat/CommandBlock.test.tsx`、`src/stores/terminal.test.ts`

**Interfaces:**
- Consumes: `ptyWrite`（Task 3）、`<TerminalPanel onReady>`（Task 4）、`Markdown`（Task 5）
- Produces:
  - `useTerminalStore`：`sessionId: string | null`、`visible: boolean`、`setSession(id: string): void`、`toggle(): void`、`runInTerminal(command: string): void`
  - Markdown 的 shell 代码块（bash/sh/zsh/shell）渲染为带「▶ 在终端运行」按钮的块

- [ ] **Step 1: 写失败测试 — terminal store**

`src/stores/terminal.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useTerminalStore } from './terminal';

describe('terminal store', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useTerminalStore.setState({ sessionId: null, visible: true });
  });

  it('runInTerminal 把命令写入活动会话并补换行', () => {
    useTerminalStore.getState().setSession('s1');
    useTerminalStore.getState().runInTerminal('ls -la');
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'ls -la\n' });
  });

  it('无活动会话时自动展开终端面板且不写入', () => {
    useTerminalStore.setState({ visible: false });
    useTerminalStore.getState().runInTerminal('ls');
    expect(useTerminalStore.getState().visible).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 写失败测试 — CommandBlock**

`src/chat/CommandBlock.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import Markdown from './Markdown';
import { useTerminalStore } from '../stores/terminal';

describe('CommandBlock', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useTerminalStore.setState({ sessionId: 's1', visible: true });
  });

  it('bash 代码块带运行按钮，点击写入终端', () => {
    render(<Markdown content={'```bash\nls -la\n```'} />);
    fireEvent.click(screen.getByText('▶ 在终端运行'));
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'ls -la\n' });
  });

  it('python 代码块没有运行按钮', () => {
    render(<Markdown content={'```python\nprint(1)\n```'} />);
    expect(screen.queryByText('▶ 在终端运行')).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run src/stores/terminal.test.ts src/chat/CommandBlock.test.tsx
```
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 `src/stores/terminal.ts`**

```ts
import { create } from 'zustand';
import { ptyWrite } from '../lib/pty';

interface TerminalState {
  sessionId: string | null;
  visible: boolean;
  setSession: (id: string) => void;
  toggle: () => void;
  runInTerminal: (command: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessionId: null,
  visible: true,
  setSession: (id) => set({ sessionId: id }),
  toggle: () => set((s) => ({ visible: !s.visible })),
  runInTerminal: (command) => {
    const { sessionId } = get();
    if (!sessionId) {
      set({ visible: true }); // 终端尚未就绪：先展开面板让用户看到
      return;
    }
    ptyWrite(sessionId, command.endsWith('\n') ? command : command + '\n').catch(() => {});
  },
}));
```

- [ ] **Step 5: 实现 `src/chat/CommandBlock.tsx` 并接入 Markdown**

`src/chat/CommandBlock.tsx`：

```tsx
import { isValidElement, type ReactNode, type ReactElement } from 'react';
import { useTerminalStore } from '../stores/terminal';

const SHELL_LANGS = new Set(['bash', 'sh', 'zsh', 'shell']);

function extractCode(children: ReactNode): { lang: string; text: string } | null {
  // ReactMarkdown 的 pre 唯一子节点是 <code className="language-x">text</code>
  if (!isValidElement(children)) return null;
  const code = children as ReactElement<{ className?: string; children?: ReactNode }>;
  const lang = (code.props.className ?? '').replace('language-', '');
  const text = typeof code.props.children === 'string' ? code.props.children : '';
  return { lang, text };
}

export default function CommandBlock({ children }: { children?: ReactNode }) {
  const runInTerminal = useTerminalStore((s) => s.runInTerminal);
  const code = extractCode(children);
  const isShell = code ? SHELL_LANGS.has(code.lang) : false;
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{ background: '#ffffff0a', borderRadius: 6, padding: 10, overflowX: 'auto' }}>
        {children}
      </pre>
      {isShell && code && (
        <button
          style={{ position: 'absolute', top: 6, right: 6, fontSize: 12 }}
          onClick={() => runInTerminal(code.text.trim())}
        >
          ▶ 在终端运行
        </button>
      )}
    </div>
  );
}
```

`src/chat/Markdown.tsx` 改为：

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import CommandBlock from './CommandBlock';
import 'katex/dist/katex.min.css';

export default function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{ pre: (props) => <CommandBlock {...props} /> }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

- [ ] **Step 6: 实现应用布局 `src/App.tsx`（替换 Task 6 版本）**

```tsx
import { useEffect } from 'react';
import ChatView from './chat/ChatView';
import ApiKeyField from './chat/ApiKeyField';
import TerminalPanel from './terminal/TerminalPanel';
import { setDefaultStream } from './stores/chat';
import { useTerminalStore } from './stores/terminal';
import { anthropicStream } from './lib/ai';

export default function App() {
  const visible = useTerminalStore((s) => s.visible);
  const toggle = useTerminalStore((s) => s.toggle);
  const setSession = useTerminalStore((s) => s.setSession);
  useEffect(() => setDefaultStream(anthropicStream), []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0e0f11', color: '#e6e8eb' }}>
      <ApiKeyField />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatView />
      </div>
      <div style={{ borderTop: '1px solid #ffffff14' }}>
        <button onClick={toggle} style={{ fontSize: 12, opacity: 0.7, margin: '4px 8px' }}>
          {visible ? '▾ 收起终端' : '▸ 展开终端'}
        </button>
        {visible && (
          <div style={{ height: 260 }}>
            <TerminalPanel onReady={setSession} />
          </div>
        )}
      </div>
    </div>
  );
}
```

注意：`visible=false` 时 TerminalPanel 卸载会关闭 PTY 会话，再展开是新会话——v0 接受；会话保活（display:none）留待后续优化。

- [ ] **Step 7: 跑全部测试**

```bash
npx vitest run
```
Expected: 全绿（16 个测试）

- [ ] **Step 8: 真机验收**

`npm run tauri dev`：
1. 输入 API key，问"列出当前目录的命令是什么？"→ AI 回复 bash 代码块
2. 点「▶ 在终端运行」→ 底部终端执行并输出
3. 终端里直接 `vim test.txt` 能正常编辑退出

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: 命令块一键下发终端 + chat/终端双表面布局"
```

---

## 后续计划（各自独立成计划，不在本文档内）

- **P2 Blocks**：OSC 133（Semantic Prompts）shell 集成，命令历史结构化（cwd/退出码/时长）
- **P3 文件管理侧栏**：Tauri fs API，点击文件插入 chat 上下文
- **P4 自动补全**：xterm.js 输入拦截 + AI 建议
- **硬化**：API key 迁移 keyring、PTY 输出二进制对齐（from_utf8_lossy 可能截断多字节字符）、终端会话保活
