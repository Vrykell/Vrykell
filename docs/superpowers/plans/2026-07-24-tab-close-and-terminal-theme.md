# Tab Close Confirmation & Classic Pure-Black Terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix tab-close so foreground programs are force-killed with a confirmation dialog, and restyle the terminal with pure black background + bright white text.

**Architecture:** Three independent changes: (1) Rust backend explicitly kills child process on close, (2) React frontend adds a ConfirmDialog gate before closing any tab, (3) CSS variables + hardcoded color constants updated for classic terminal look.

**Tech Stack:** Tauri 2 (Rust), React 18 + TypeScript, Zustand, CSS custom properties

## Global Constraints

- Must not change `dev` branch — all work on `fix/tab-close-and-terminal-theme`
- Backend kill is best-effort (ignore error if process already exited)
- Reuse existing `ConfirmDialog` component — no new UI components
- CSS variables follow existing `--` naming convention in `:root`
- ANSI 16-color palette (red/green/yellow/blue/magenta/cyan) must remain visually unchanged
- Cursor inversion logic must be preserved (FG↔BG swap on cursor cell)

---

### Task 1: Backend — Force-kill child process on session close

**Files:**
- Modify: `src-tauri/src/pty.rs:293-303`

**Interfaces:**
- Produces: `PtyManager::close_session` now force-kills child before dropping, causing read-loop to get EOF and trigger cleanup

- [ ] **Step 1: Add child.kill() before drop in close_session**

Replace lines 293-303 in `src-tauri/src/pty.rs`:

```rust
    /// Close a session — kill the child process.
    pub fn close_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.remove(id) {
            // Explicitly kill the child process so foreground programs
            // (vim, top, htop, etc.) are terminated immediately.  The
            // read-loop thread will get EOF on the reader and run its
            // cleanup path (emit pty:exit, remove from session store).
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
            }
            // Dropping session closes the writer and master PTY sides;
            // the read-loop thread holds the reader clone and will get EOF.
            drop(session);
            Ok(())
        } else {
            Err(format!("Session {} not found", id))
        }
    }
```

- [ ] **Step 2: Build Rust backend to verify it compiles**

Run: `cd src-tauri && cargo check 2>&1`
Expected: exits 0, no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "fix(pty): force-kill child process when closing session"
```

---

### Task 2: Frontend — Add i18n strings for close-tab dialog

**Files:**
- Modify: `src/renderer/i18n/types.ts:2-22`
- Modify: `src/renderer/i18n/en.ts:4-14`
- Modify: `src/renderer/i18n/zh.ts:4-14`

**Interfaces:**
- Produces: `LocaleDict.closeTab` with `title`, `message`, `confirm`, `cancel` keys

- [ ] **Step 1: Add closeTab to LocaleDict type**

In `src/renderer/i18n/types.ts`, add `closeTab` block after `exit` (line 13):

```ts
export interface LocaleDict {
  tab: {
    new: string;
    close: string;
  };
  exit: {
    title: string;
    message: string;
    confirm: string;
    cancel: string;
  };
  closeTab: {
    title: string;
    message: string;
    confirm: string;
    cancel: string;
  };
  status: {
    sessions: string;
    local: string;
  };
  action: {
    newSession: string;
    toggleAI: string;
    toggleOutput: string;
  };
}
```

- [ ] **Step 2: Add English strings**

In `src/renderer/i18n/en.ts`, add `closeTab` block after `exit` (line 14):

```ts
const en: LocaleDict = {
  tab: {
    new: 'New Terminal (Ctrl+T)',
    close: 'Close',
  },
  exit: {
    title: 'Close AI Terminal',
    message:
      'This is the last session. Closing it will exit the application.\nAre you sure?',
    confirm: 'Close App',
    cancel: 'Keep Session',
  },
  closeTab: {
    title: 'Close Terminal',
    message:
      'A program is running in this terminal. Closing it will terminate the process.\nAre you sure?',
    confirm: 'Force Close',
    cancel: 'Cancel',
  },
  status: {
    sessions: '{count} session',
    local: 'Local',
  },
  action: {
    newSession: 'New Terminal',
    toggleAI: 'Toggle AI Panel',
    toggleOutput: 'Toggle Rich Output',
  },
};
```

- [ ] **Step 3: Add Chinese strings**

In `src/renderer/i18n/zh.ts`, add `closeTab` block after `exit` (line 13):

```ts
const zh: LocaleDict = {
  tab: {
    new: '新建终端 (Ctrl+T)',
    close: '关闭',
  },
  exit: {
    title: '关闭 AI Terminal',
    message: '当前是最后一个会话，关闭将退出应用程序。\n确定要退出吗？',
    confirm: '退出程序',
    cancel: '保留会话',
  },
  closeTab: {
    title: '关闭终端',
    message: '该终端中有正在运行的程序，关闭将强制终止。\n确定要关闭吗？',
    confirm: '强制关闭',
    cancel: '取消',
  },
  status: {
    sessions: '{count} 个会话',
    local: '本地',
  },
  action: {
    newSession: '新建终端',
    toggleAI: '切换 AI 面板',
    toggleOutput: '切换富文本输出',
  },
};
```

- [ ] **Step 4: Build to verify TypeScript compiles**

Run: `cd /Users/wuzhe/ai-terminal && npx tsc --noEmit 2>&1 | head -20`
Expected: exit 0, no errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/i18n/types.ts src/renderer/i18n/en.ts src/renderer/i18n/zh.ts
git commit -m "feat(i18n): add closeTab confirmation dialog strings"
```

---

### Task 3: Frontend — Wire close-tab confirmation into TerminalTabs and App

**Files:**
- Modify: `src/renderer/components/terminal/TerminalTabs.tsx` (entire file, 56 lines)
- Modify: `src/renderer/App.tsx:89-101` (Ctrl+W handler), `App.tsx:122-131` (ConfirmDialog)

**Interfaces:**
- Consumes: `LocaleDict.closeTab` from Task 2, `ConfirmDialog` component, `closePTY` from API
- Produces: `TerminalTabs` accepts `onCloseTab: (id: string) => void` prop instead of calling `closePTY` directly; App manages closingId state and renders ConfirmDialog

- [ ] **Step 1: Simplify TerminalTabs — accept onCloseTab prop**

Replace `src/renderer/components/terminal/TerminalTabs.tsx` entirely:

```tsx
import React from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { createPTY } from '../../../api';

interface Props {
  onCloseTab: (id: string) => void;
}

export const TerminalTabs: React.FC<Props> = ({ onCloseTab }) => {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const setActive = useTerminalStore((s) => s.setActive);
  const addSession = useTerminalStore((s) => s.addSession);

  const handleNewSession = async () => {
    try {
      const session = await createPTY({});
      addSession(session);
      setActive(session.id);
    } catch (err) { console.error('Failed to create session:', err); }
  };

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onCloseTab(id);
  };

  return (
    <div className="tab-bar" data-testid="terminal-tabs">
      <div className="tab-bar-tabs">
        {sessions.map((session) => (
          <div
            key={session.id}
            data-testid={`session-tab-${session.id}`}
            className={`tab-item${activeId === session.id ? ' active' : ''}`}
            onClick={() => setActive(session.id)}
            title={session.title}
          >
            <span className="tab-icon">
              {session.type === 'ssh' ? '🔗' : '⬡'}
            </span>
            <span className="tab-title">{session.title}</span>
            <button
              data-testid={`close-btn-${session.id}`}
              className="tab-close"
              onClick={(e) => handleClose(e, session.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tab-bar-actions">
        <button data-testid="new-tab-btn" className="tab-btn" onClick={handleNewSession} title="New Terminal (Ctrl+T)">
          +
        </button>
      </div>
    </div>
  );
};
```

Key changes from original:
- Added `Props` interface with `onCloseTab: (id: string) => void`
- Removed `closePTY` import
- `handleClose` now calls `onCloseTab(id)` instead of `closePTY(id)` directly

- [ ] **Step 2: Update App.tsx — add closingId state, pass onCloseTab, wire Ctrl+W**

In `src/renderer/App.tsx`, make these three edits:

**Edit A — Add import for i18n closeTab strings (line 10):**

```tsx
import { t } from './i18n';
```
Already present, no change needed — `t()` function already works with new keys.

**Edit B — Add `closingId` state and `closePTY` import (already imported on line 13):**

After line 30 (`const [showExitDialog, setShowExitDialog] = useState(false);`), add:

```tsx
const [closingId, setClosingId] = useState<string | null>(null);
```

**Edit C — Update Ctrl+W handler (replace lines 92-94):**

Replace:
```tsx
case 'w': e.preventDefault(); if (activeSessionId) closePTY(activeSessionId).catch(() => {}); break;
```
With:
```tsx
case 'w': e.preventDefault(); if (activeSessionId) setClosingId(activeSessionId); break;
```

**Edit D — Update `<TerminalTabs />` usage to pass onCloseTab prop (line 106):**

Replace:
```tsx
<TerminalTabs />
```
With:
```tsx
<TerminalTabs onCloseTab={(id) => setClosingId(id)} />
```

**Edit E — Add close-tab ConfirmDialog after the exit ConfirmDialog (after line 131):**

Add right before the closing `</>` fragment:

```tsx
<ConfirmDialog
  open={closingId !== null}
  title={t('closeTab.title')}
  message={t('closeTab.message')}
  confirmLabel={t('closeTab.confirm')}
  cancelLabel={t('closeTab.cancel')}
  danger
  onConfirm={() => {
    if (closingId) {
      closePTY(closingId).catch(() => {});
      setClosingId(null);
    }
  }}
  onCancel={() => setClosingId(null)}
/>
```

- [ ] **Step 3: Build to verify TypeScript compiles**

Run: `cd /Users/wuzhe/ai-terminal && npx tsc --noEmit 2>&1 | head -20`
Expected: exit 0, no errors

- [ ] **Step 4: Run existing tests to ensure no regressions**

Run: `cd /Users/wuzhe/ai-terminal && npx vitest run 2>&1 | tail -20`
Expected: all tests pass (none should break since we only changed close flow, and tests don't test tab close)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/terminal/TerminalTabs.tsx src/renderer/App.tsx
git commit -m "feat(ui): add close-tab confirmation dialog with force-kill warning"
```

---

### Task 4: Terminal Theme — Pure black background + bright white text

**Files:**
- Modify: `src/renderer/terminal/buffer.ts:8-11` (FG/BG color tables, DEF_FG, DEF_BG)
- Modify: `src/renderer/terminal/TerminalView.tsx:68-69,73-81,112,246` (hardcoded colors)
- Modify: `src/renderer/styles/global.css:6-50` (add terminal CSS variables), line 270-281 (add CRT vignette)

**Interfaces:**
- Consumes: None (standalone visual change)
- Produces: Terminal renders with `#000000` background, `#f0f0f0` foreground

- [ ] **Step 1: Update color constants in buffer.ts**

In `src/renderer/terminal/buffer.ts`, replace lines 8-11:

Replace:
```ts
const FG: Record<number,string>={30:'#000',31:'#cd3131',32:'#0dbc79',33:'#e5e510',34:'#2472c8',35:'#bc3fbc',36:'#11a8cd',37:'#e5e5e5',90:'#666',91:'#f14c4c',92:'#23d18b',93:'#f5f543',94:'#3b8eea',95:'#d670d6',96:'#29b8db',97:'#fff'};
const BG: Record<number,string>={40:'#000',41:'#cd3131',42:'#0dbc79',43:'#e5e510',44:'#2472c8',45:'#bc3fbc',46:'#11a8cd',47:'#e5e5e5'};
const DEF_FG = '#d4d4d4';
const DEF_BG = '#1e1e1e';
```

With:
```ts
const FG: Record<number,string>={30:'#000',31:'#cd3131',32:'#0dbc79',33:'#e5e510',34:'#2472c8',35:'#bc3fbc',36:'#11a8cd',37:'#f0f0f0',90:'#888',91:'#f14c4c',92:'#23d18b',93:'#f5f543',94:'#3b8eea',95:'#d670d6',96:'#29b8db',97:'#fff'};
const BG: Record<number,string>={40:'#000',41:'#cd3131',42:'#0dbc79',43:'#e5e510',44:'#2472c8',45:'#bc3fbc',46:'#11a8cd',47:'#f0f0f0'};
const DEF_FG = '#f0f0f0';
const DEF_BG = '#000000';
```

Changes:
- `FG[37]`: `#e5e5e5` → `#f0f0f0` (brighter white)
- `FG[90]`: `#666` → `#888` (bright-black more visible on pure black)
- `BG[47]`: `#e5e5e5` → `#f0f0f0` (match new white)
- `DEF_FG`: `#d4d4d4` → `#f0f0f0`
- `DEF_BG`: `#1e1e1e` → `#000000`

- [ ] **Step 2: Update hardcoded colors in TerminalView.tsx**

In `src/renderer/terminal/TerminalView.tsx`, make these replacements:

**Line 68-69** — span defaults (already reference `DEF_FG`/`DEF_BG` indirectly, but have fallbacks):

Replace:
```tsx
color: base.fg || '#d4d4d4',
backgroundColor: base.bg || '#1e1e1e',
```
With:
```tsx
color: base.fg || '#f0f0f0',
backgroundColor: base.bg || '#000000',
```

**Lines 73-81** — cursor colors (inverted FG/BG):

Replace:
```tsx
color: base.bg || '#1e1e1e',
backgroundColor: base.fg || '#d4d4d4',
```
With:
```tsx
color: base.bg || '#000000',
backgroundColor: base.fg || '#f0f0f0',
```

**Line 112** — line div background:

Replace:
```tsx
backgroundColor: '#1e1e1e',
```
With:
```tsx
backgroundColor: '#000000',
```

**Line 246** — container background:

Replace:
```tsx
background: '#1e1e1e',
```
With:
```tsx
background: '#000000',
```

- [ ] **Step 3: Add terminal CSS variables and CRT vignette to global.css**

**Edit A — Add terminal color variables to `:root` (after line 33, before `--red`):**

In `src/renderer/styles/global.css`, add after `--border-strong`:

```css
  /* Terminal */
  --terminal-bg: #000000;
  --terminal-fg: #f0f0f0;
  --terminal-cursor: #f0f0f0;
  --terminal-selection: rgba(255, 255, 255, 0.2);
```

**Edit B — Add CRT vignette effect (after line 281, the `.terminal-container .xterm` block):**

After the `.terminal-container .xterm` block (line 285), add:

```css
/* CRT vignette — subtle dark edge glow for classic terminal depth */
.terminal-container::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.4);
  z-index: 1;
}
```

- [ ] **Step 4: Build and run tests to verify**

Run: `cd /Users/wuzhe/ai-terminal && npx tsc --noEmit 2>&1 | head -20`
Expected: exit 0

Run: `cd /Users/wuzhe/ai-terminal && npx vitest run 2>&1 | tail -20`
Expected: all tests pass (color changes don't affect test assertions)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/terminal/buffer.ts src/renderer/terminal/TerminalView.tsx src/renderer/styles/global.css
git commit -m "feat(theme): switch terminal to classic pure-black background with bright white text"
```
