# Design: Tab Close Confirmation & Classic Pure-Black Terminal Theme

**Date**: 2026-07-24
**Branch**: `fix/tab-close-and-terminal-theme`
**Status**: Approved

---

## Overview

Two independent changes in one branch:
1. **Tab close with running process**: Backend force-kill + frontend confirmation dialog
2. **Classic pure-black terminal**: Replace hardcoded `#1e1e1e`/`#d4d4d4` with `#000000`/`#f0f0f0` via CSS variables

---

## Section 1: Backend — Force Kill Child Process

### Problem

`PtyManager::close_session` removes the `ManagedSession` from the HashMap and drops it. However, the read-loop thread still holds `child_arc` (an `Arc<Mutex<Box<dyn Child>>>`) and `reader` (a PTY master reader clone). When `ManagedSession` is dropped, the `writer` side of the PTY master closes, but the `reader` side remains open in the read-loop thread, which is blocked on `reader.read()`. The child process does NOT receive SIGHUP because the PTY master is not fully closed, so foreground programs continue running. The tab appears "stuck" — it won't close until the program exits on its own.

### Design

In `close_session`, explicitly kill the child process BEFORE dropping the session:

```rust
// pty.rs — PtyManager::close_session
pub fn close_session(&self, id: &str) -> Result<(), String> {
    let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.remove(id) {
        // Explicitly kill the child process so foreground programs
        // are force-terminated. The read-loop thread will then get
        // EOF and run its cleanup path (emit pty:exit, remove from store).
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill(); // SIGKILL on Unix
        }
        drop(session); // cleanup reader/writer/master
        Ok(())
    } else {
        Err(format!("Session {} not found", id))
    }
}
```

- `child.kill()` is best-effort: if the process already exited, we ignore the error and still drop the session.
- After kill, the read-loop thread receives EOF on `reader.read()` (returns `Ok(0)`), triggering the existing cleanup: emit `pty:exit`, remove from session store.

### Files Changed

| File | Change |
|---|---|
| `src-tauri/src/pty.rs` | Add `child.kill()` call in `close_session` before `drop(session)` |

---

## Section 2: Frontend — Close Tab Confirmation Dialog

### Problem

When the user clicks the close button on a tab (or presses `Ctrl+W`), `closePTY(id)` is invoked immediately with no warning. There is no indication that a foreground program might be running, and no opportunity to cancel.

### Design

Intercept the close action with a `ConfirmDialog`, reusing the existing [`ConfirmDialog`](src/renderer/components/common/ConfirmDialog.tsx) component that is already used for the exit-app dialog.

**TerminalTabs.tsx** changes:

```tsx
// New state: which tab is pending close confirmation
const [closingId, setClosingId] = useState<string | null>(null);

// handleClose now opens the dialog instead of closing directly
const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setClosingId(id);
};

// confirmClose performs the actual close
const confirmClose = async () => {
    if (!closingId) return;
    try { await closePTY(closingId); } catch (err) { ... }
    setClosingId(null);
};
```

Render `ConfirmDialog` when `closingId !== null`:
- Title: "Close Terminal"
- Message: "A program is running in this terminal. Closing it will terminate the process.\nAre you sure?"
- Confirm: "Force Close" (danger button, red)
- Cancel: "Cancel"

**App.tsx** changes:

The `Ctrl+W` handler (line 94) needs the same confirmation. Extract the close-with-confirm flow so both the tab bar and the keyboard shortcut use it. The simplest approach: store `closingId` at the App level (or in the zustand store) so `Ctrl+W` sets it and `TerminalTabs` reads it.

Alternative (simpler): Keep `closingId` state in `App.tsx` and pass `onCloseTab(id)` down to `TerminalTabs`. The `ConfirmDialog` renders in `App.tsx` alongside the existing exit dialog.

### i18n Strings

Add to `en.ts`:
```ts
closeTab: {
    title: 'Close Terminal',
    message: 'A program is running in this terminal. Closing it will terminate the process.\nAre you sure?',
    confirm: 'Force Close',
    cancel: 'Cancel',
},
```

Add corresponding Chinese strings in `zh.ts`.

### Files Changed

| File | Change |
|---|---|
| `src/renderer/App.tsx` | Add `closingId` state, pass `onCloseTab` to `TerminalTabs`, render close-confirm `ConfirmDialog`, wire `Ctrl+W` |
| `src/renderer/components/terminal/TerminalTabs.tsx` | Accept `onCloseTab` prop, call it instead of `closePTY` directly |
| `src/renderer/i18n/en.ts` | Add `closeTab` strings |
| `src/renderer/i18n/zh.ts` | Add `closeTab` strings |
| `src/renderer/i18n/types.ts` | Add `closeTab` to `LocaleDict` type |

---

## Section 3: Classic Pure-Black Terminal Theme

### Problem

The terminal uses hardcoded colors throughout:
- Background: `#1e1e1e` (dark gray, not black)
- Foreground: `#d4d4d4` (light gray, not bright white)

The app shell background (`--bg-root: #0a0a0c`) is darker than the terminal, creating a disjointed look. No "terminal aesthetic" — it looks like a code editor pane, not a terminal emulator.

### Design

Introduce CSS custom properties for terminal colors, then reference them from TypeScript. This aligns with the existing CSS variable pattern (`--bg-root`, `--text-primary`, etc.).

**Color Palette:**

| Token | Old | New | Rationale |
|---|---|---|---|
| Terminal BG | `#1e1e1e` | `#000000` | Pure black — classic terminal |
| Terminal FG | `#d4d4d4` | `#f0f0f0` | Brighter white for readability |
| ANSI bright-black (90) | `#666666` | `#888888` | Better contrast on pure black |
| ANSI black (30) | `#000000` | `#000000` | Unchanged |
| ANSI white (37) | `#e5e5e5` | `#f0f0f0` | Match new default FG |
| ANSI bright-white (97) | `#ffffff` | `#ffffff` | Unchanged |
| Cursor | Inverted FG/BG | Inverted FG/BG | Logic unchanged, colors update automatically via variables |
| Selection | N/A | `rgba(255,255,255,0.2)` | Subtle white overlay on black |

**16-color ANSI palette** (red/green/yellow/blue/magenta/cyan and their bright variants): Keep the existing VSCode-derived colors. They already have excellent contrast.

**CSS variables** (added to `:root` in `global.css`):

```css
--terminal-bg: #000000;
--terminal-fg: #f0f0f0;
--terminal-cursor: #f0f0f0;
--terminal-selection: rgba(255, 255, 255, 0.2);
```

**buffer.ts** changes:
```ts
const DEF_FG = '#f0f0f0';  // was '#d4d4d4'
const DEF_BG = '#000000';  // was '#1e1e1e'
// ANSI palette updates:
// 37 -> '#f0f0f0' (was '#e5e5e5')
// 90 -> '#888888' (was '#666666')
```

**TerminalView.tsx** changes:
- Line 112: `backgroundColor: '#000000'` (was `'#1e1e1e'`)
- Line 246: `background: '#000000'` (was `'#1e1e1e'`)
- Lines 68-69: span defaults use `DEF_BG`/`DEF_FG` from buffer (already references constants)
- Lines 73-81: cursor uses inverted colors (logic unchanged, colors update via constants)

**CRT vignette effect** (optional enhancement):

Add a subtle inner shadow to the terminal container for depth:
```css
.terminal-container::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.4);
}
```

### Files Changed

| File | Change |
|---|---|
| `src/renderer/styles/global.css` | Add `--terminal-bg`, `--terminal-fg`, `--terminal-cursor`, `--terminal-selection` to `:root`; add CRT vignette to `.terminal-container` |
| `src/renderer/terminal/buffer.ts` | Update `DEF_BG`, `DEF_FG`, and `FG[37]`/`FG[90]` color constants |
| `src/renderer/terminal/TerminalView.tsx` | Replace hardcoded `'#1e1e1e'` with `'#000000'` |

---

## Testing Strategy

- **Backend kill**: Existing Rust tests in `session.rs` cover store operations. Manual verification: open `top`/`htop`/`vim` in a terminal tab, click close — tab should close immediately.
- **Frontend confirmation**: The `ConfirmDialog` is a pure presentational component already covered by existing render patterns. No new unit tests needed. Manual verification: confirm dialog appears on close, cancel keeps tab, confirm closes tab.
- **Theme**: Visual regression — open terminal, verify background is pure black, text is bright white. Verify ANSI colors still render correctly. Verify cursor is visible on pure black.
- **E2E**: Not applicable for these changes — they are behavioral and visual.

---

## Spec Self-Review

- [x] No placeholders, TBDs, or incomplete sections
- [x] All file paths and line numbers verified
- [x] Internal consistency: backend kill → read thread cleanup → frontend `removeSession` flow is coherent
- [x] Scope boundary: no drift into full theme system or session persistence
- [x] No ambiguous requirements — explicit colors, explicit behavior
