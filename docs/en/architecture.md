# Vrykell Architecture

> The actual architecture of the current v2 chat-first implementation (branch `dev`). The terminal surface abstracts terminal output into **command blocks (Block)**, organized around "synchronous Rust StreamScanner scanning + the SessionController three-scene state machine + one offscreen xterm per block".
>
> This document records the actual architecture of the current implementation. (Last updated: 2026-09-02; StatusBar, block color snapshot persistence + bidirectional HTML sanitization, and disk cards removed; see §16-§18 for split panes, Agent, and themes.)

---

## Table of Contents

1. [Overview and Product Form](#1-overview-and-product-form)
2. [Tech Stack](#2-tech-stack)
3. [Top-Level Layout](#3-top-level-layout)
4. [End-to-End Layering](#4-end-to-end-layering)
5. [Synchronous Dispatch and the Three-Scene State Machine: PTY Output to Screen](#5-synchronous-dispatch-and-the-three-scene-state-machine-pty-output-to-screen)
6. [Three-Scene Switching](#6-three-scene-switching)
7. [Block Lifecycle State Machine](#7-block-lifecycle-state-machine)
8. [Scrolling: Plain DOM + follow-bottom](#8-scrolling-plain-dom--follow-bottom)
9. [Input Box Visibility State Machine](#9-input-box-visibility-state-machine)
10. [Rendering Pipeline](#10-rendering-pipeline)
11. [Output Extraction and Color](#11-output-extraction-and-color)
12. [State Management](#12-state-management)
13. [Backend (Rust PTY Layer)](#13-backend-rust-pty-layer)
14. [Complete Data Flow Timeline](#14-complete-data-flow-timeline)
15. [Key File Index](#15-key-file-index)
16. [Split Panes and Window Layout](#16-split-panes-and-window-layout)
17. [Agent / AI Chat (Code Agent)](#17-agent--ai-chat-code-agent)
18. [Theme System](#18-theme-system)

---

## 1. Overview and Product Form

- **chat-first**: the terminal is the primary surface, with the input bar at the bottom; AI chat (Anthropic BYOK direct connection) is displayed as an inline panel above the terminal, with no separate Chat sidebar.
- **Block architecture**: each command is a Block. Completed blocks are rendered by React as real DOM (color HTML), and only the **active command** is handled by a hidden xterm.js.
- **No homegrown terminal emulator**: VT/ANSI parsing and grid storage are entirely delegated to xterm.js; we only handle block boundaries and lifecycle.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Backend | Rust (`portable-pty` for PTY sessions, `rusqlite` for persistence) |
| Frontend | React 19 + TypeScript + Vite |
| Terminal | `@xterm/xterm` (main terminal + per-block offscreen xterm) |
| State | zustand |
| AI | `@anthropic-ai/sdk` (BYOK) + react-markdown + KaTeX |
| Testing | vitest (unit tests), Playwright (e2e) |

## 3. Top-Level Layout

`src/App.tsx` (100vh flex column):

```
App
├── TopDock            (28px full-width top bar, left/right action zones + draggable buttons)
├── flex row
│   ├── SidePanel (left)   — controlled by Dock buttons
│   ├── TerminalView       — main terminal area (core)
│   └── SidePanel (right)  — controlled by Dock buttons
├── StatusBar (removed, 2026-09)
├── CommandPalette (overlay)
├── ToastContainer (overlay)
└── ApiKeyField     (fixed bottom-right, out of the document flow)
```

`TerminalView` (`src/features/terminal/components/TerminalView.tsx`) is the main terminal surface, driven internally by the SessionController's **scene state** (see §6).

The left navigation bar and the top-right navigation zone share `DockNavigation`, supporting reordering within one side and moving across sides. `leftZone` / `rightZone` in `dock.ts` determine both button order and sidebar position; open sidebars move with their button, and closed sidebars stay closed. The layout is persisted via `dock-layout-v4`; on load, custom positions are retained, duplicates are removed, and missing buttons are filled in. The drag source and insertion position are maintained temporarily by `navigationDrag.ts` and are not written to settings. The settings entry also supports dragging and defaults to the right side; `NAVIGATION_DEFS` contains sidebars and page actions, while `PANEL_DEFS` contains only real sidebars. Clicking the settings entry opens or activates the single settings page without creating a settings sidebar. Window control buttons stay fixed.

Navigation buttons are dragged via Pointer Events by `useNavigationButtonDrag`, starting only after the pointer moves more than 6px. The source button remains mounted but is removed from the arrangement, and its icon follows the pointer via `NavigationDragPreview`; a real 32px placeholder is inserted at the target position and the other buttons rearrange to make room. The placeholder region retains the corresponding insertion index, preventing the drop point from jumping due to repeated hits after the rearrangement; the gaps between buttons are computed from the neighboring positions. The preview does not modify the layout or persist anything; the commit happens only on release, and the original arrangement is restored on cancel. HTML5 Drag and Drop is forbidden: native file drag-and-drop in Windows desktop windows intercepts these events, and browser preview cannot verify that behavior directly. Native file drop-in is retained; navigation buttons and the top-right action zone are not marked as window drag regions. Esc, blur, pointercancel, and unmount cancel the drag; the click produced on release does not trigger a panel switch. Interaction tests disable HTML drag-and-drop events to confirm that pointer dragging works independently.

The top bar uses `useBalancedTitlebar` to observe the actual width of the right-side action zone and reserve symmetric space on the left and right of the search box. Adding or moving navigation buttons does not switch to an asymmetric grid; a narrow window only tightens the search box width, and it expands again in sync once the width is restored, keeping the search box centered and avoiding covering the buttons.

## 4. End-to-End Layering

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Rust backend (src-tauri/src)                                                    │
│  pty.rs               portable-pty session lifecycle                             │
│  shell_integration.rs zsh ZDOTDIR / bash --rcfile injection                      │
│                        OSC 133 (block boundary) + OSC 7 (cwd)                    │
│  history.rs/search.rs rusqlite persistence / full-text search                    │
└───────────────────────┬──────────────────────────────────────────────────────────┘
                        │ Tauri IPC (invoke + event emit/listen)
┌───────────────────────▼──────────────────────────────────────────────────────────┐
│  lib/*.ts (IPC wrappers)                                                         │
│  pty.ts  pty_spawn/write/resize/close + pty-output/exit                          │
│  ai.ts   anthropicStream (BYOK streaming)                                        │
│  sessionManager.ts  session/block persistence orchestration                      │
└───────────────────────┬──────────────────────────────────────────────────────────┘
                        │ zustand stores + React
┌───────────────────────▼──────────────────────────────────────────────────────────┐
│  terminal/pipeline/*.ts (event consumption + three-scene state machine, see §5)  │
│  events.ts (ScanEvent mirror) → SessionController                                │
│  → main xterm / single offscreen xterm (executing block)                         │
└───────────────────────┬──────────────────────────────────────────────────────────┘
                        │ React components
┌───────────────────────▼──────────────────────────────────────────────────────────┐
│  TerminalView → TerminalBlockList → BlockItem/RunningItem                        │
│  TerminalPanel (live xterm)  /  InputEditor (input bar)                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

`src/platform/` is the only infrastructure access layer: `platform/api/*` wraps `invoke` calls and cross-process contract types by domain, and the view/domain layers never invoke directly. Local path semantics are centralized in `platform/path.ts` (separators, drive-letter roots, parent directories); every file path crossing the IPC boundary is normalized in both directions in `platform/api/fs` (as well as workspace/search) — arguments are first canonicalized into the frontend-wide `/` form before invoking, and native paths returned by the backend are canonicalized before entering business state. The business layer uses canonical paths directly and does not handle separators itself (normalization of the terminal cwd's OSC 7 is still the terminal pipeline's responsibility).

## 5. Synchronous Dispatch and the Three-Scene State Machine: PTY Output to Screen

Each chunk of Rust PTY output is no longer first written to the main xterm and then awaited via an asynchronous parser callback; instead it is first **scanned synchronously on the Rust side**, producing events in byte order that are delivered in one batch over Tauri IPC and consumed synchronously by the frontend SessionController.

### 5.1 Rust StreamScanner (`src-tauri/src/terminal/scan.rs`)

- Input: `push(chunk)` returns an ordered `ScanEvent` stream whose order matches byte order; it is merged via `pty.rs` into the Tauri event `pty-output`.
- Event shape (serde tag=kind, camelCase): `{kind:'data', text}` / `{kind:'osc', code, payload, raw}` / `{kind:'altEnter'|'altExit', raw}`; the frontend mirror type is in `src/features/terminal/services/pipeline/events.ts` (`DispatchEvent`).
- OSC parsing: recognizes `133;A` / `133;B` / `133;C` / `133;D;ec` / `133;E;b64` / `133;G;b64`, `7;path`, `0/2;title`; OSC is stripped from the data segment, but `raw` is retained for pass-through to the main xterm in the classic / altScreen scenes (preserving OSC 8 hyperlinks, OSC 52 clipboard, etc.).
- alt-screen observation: detects `\x1b[?1049/1047/47[hl]`, emits an event only, and keeps the sequence itself in the data segment.
- Across chunk boundaries: incomplete ESC / OSC sequences are stored in `pending` and concatenated with the next chunk before scanning.
- The input is the UTF-8 string decoded by the StreamDecoder; what is scanned is entirely ASCII single-byte control characters, so byte indexing is safe.

### 5.2 SessionController (`src/features/terminal/services/pipeline/sessionController.ts`)

One instance per tab (one per pane when split), consuming `DispatchEvent` synchronously:

- **Three-scene state machine**
  - `classic`: default; before any `133;A` is received, the main xterm works full-screen.
  - `blockList`: entered after the first `133;A` is received; the main xterm is hidden and the React block list is rendered.
  - `altScreen`: after an alt-screen enter sequence is detected in the data segment, it layers on top of the two scenes above and the main xterm takes over.

- **Block lifecycle**
  - `133;A` → creates a new block (status=`pending`); if the previous block has no `D`, it is marked `interrupted`.
  - `133;E;<b64>` → records the command text.
  - `133;G;<b64>` → records the git branch.
  - The block's input bar submitting a command, or a received `133;C` → the block turns `executing` and a single offscreen xterm (`outputTerm`) is created; after the input bar submits, it does not wait for the remote preexec marker, and a late `133;C` does not start it a second time.
  - `133;D;ec` → extracts `outputHtml` / `outputText`, disposes `outputTerm`, status=`done`.
  - Ordinary output segments are routed by the current scene: pending → `earlyBuf`; executing → `outputTerm`; classic / altScreen → the main xterm.

- **Store synchronization strategy**
  - block creation / completion / status change → immediately push `useBlockStore.setBlocks`.
  - executing block output → throttled synchronization at ~250ms, only when there is new output.
  - scene switch → immediately write `useTerminalStore.scenes`.

### 5.3 xterm.js Instance Responsibilities

- **Main xterm**: visible and receiving keyboard input in the `classic` and `altScreen` scenes; hidden in the `blockList` scene.
- **Single offscreen xterm**: one `outputTerm` per `executing` block, disposed immediately on completion, keeping only the `outputHtml` snapshot.

`createOffscreenTerm(cols)` and `extractSnapshotFromBuffer` in `terminalSnapshot.ts` handle creation and snapshot extraction. xterm.js correctly handles cursor movement, screen clearing, `\r` overwriting, 256 colors, and all other ANSI — this is where "no homegrown terminal emulator" lands.

## 6. Three-Scene Switching

`TerminalView.tsx` reads `useTerminalStore.scenes` (written by the SessionController) to decide the current rendering:

| Scene | Condition | Rendering |
|------|------|------|
| `loading` | The current tab has no PTY session yet | `LoadingState` ("Starting shell…" spinner) |
| `classic` | No `133;A` received, or shell integration not in effect | Main xterm full-screen (`TerminalPanel`) |
| `blockList` | After the first `133;A` is received | `TerminalBlockList` + bottom `InputEditor` |
| `altScreen` | An alt-screen enter sequence is detected in the data segment | Main xterm covering the full screen (zIndex 100) + `TuiBanner` |

`altScreen` layers on top of `classic` or `blockList`; after exiting alt-screen the SessionController restores the previous scene. After a full-screen app (vi/htop, etc.) exits or is killed, **the final alt buffer frame is no longer backfilled into the block history**; the block retains only the shell noise after teardown. Input box visibility is determined by `inputVisibility.ts` from the current scene and whether there is a long-running command (see §9).

## 7. Block Lifecycle State Machine

`TermBlock` state definitions are in `src/features/terminal/services/pipeline/termBlock.ts`:

```
pending ──(input bar submit / 133;C)──▶ executing ──(133;D)──▶ done
   │                      │
   └──── no D, straight A ────┘           interrupted (triggered by the next 133;A)
```

**Shell hook driven** (OSC 133 / Final Term shell integration):

| Sequence | Meaning | Triggered action |
|------|------|---------|
| `133;A` | precmd | Creates a new pending block; if the previous block has no `D`, marks it `interrupted` |
| `133;B` | prompt end | The line editor can now accept input; marks the pane's shell as ready (deferred commands such as file open are dispatched based on this); it itself creates no block and is not written to the main xterm |
| `133;E;<b64>` | command text | Records `command` |
| `133;G;<b64>` | git branch | Records `gitBranch` |
| `133;C` | preexec | status→executing, creates a single offscreen `outputTerm`; `earlyBuf` is discarded or written back per the typeahead heuristic |
| `133;D;<code>` | command_finished | Extracts the final outputHtml/outputText, disposes `outputTerm`, status→done |

**Completion progression**:
1. `finishBlock(exitCode)`: extracts the snapshot from the `outputTerm` buffer and releases the xterm.
2. Updates `useBlockStore` (status, exitCode, outputHtml/outputText/outputRaw, linesTruncated).
3. The next `133;A` creates a new pending block.

Command text has two sources: stashed per pane when the InputEditor submits, and the shell's `133;E` as a supplementary source that may arrive after `133;C` and correct the command name of the executing block. When the controller is not registered yet, the InputEditor stash is still retained and consumed by the next preexec; when there is no command text the value stays empty, and carrying over the previous block's command is forbidden. When spawning the PTY child process, the inherited `VTE_VERSION` is removed, to prevent GNOME VTE's Bash hook and Vrykell from both sending `133;C`.

## 8. Scrolling: Plain DOM + follow-bottom

In the `blockList` scene, `ScrollStateMachine` was removed in favor of plain DOM scrolling + `useFollowBottom` (`src/features/terminal/hooks/useFollowBottom.ts`):

- When the list is < 2 lines from the bottom, new output scrolls to the bottom automatically.
- Scrolling up by the user disengages following; manually returning to the bottom re-engages it.
- The scroll container observes the entire output content and its own size; when the running xterm changes height, a bottom-pinned view stays pinned. When reading history, the text position near the viewport is recorded, and after reflow caused by a panel opening/closing or a terminal width change, the view is restored using the text anchor.
- Scrolling in the `altScreen` / `classic` scenes is handled by the main xterm itself.

Running blocks hold their in-block xterm through the `SessionController`, and `RunningTerm` mounts it into a visible host. The controller, pending commands, and the width synchronization callback use the same registry that survives hot updates, so that after a module update in dev mode the PTY does not keep writing to the old controller while the page cannot obtain the live terminal. The diagnostic log records `running-terminal-mounted`, `running-terminal-mount-missing`, and the line count of the first visible output.

## 9. Input Box Visibility State Machine

Corresponds to §7. `isInputBoxVisible` in `inputVisibility.ts` (simplified to 4 conditions):

```
1. isReadOnly            → hidden
2. isAltScreenActive     → hidden
3. isLongRunning (not agent-controlled/tagged) → hidden
4. default               → visible
```

Conditions such as agent control, shared sessions, conversation tombstones, and AI block confirmation are not yet implemented. When a long-running command hides the input box, `getLongRunningHint` provides the hint "● <command> running · press End to return to the input bar".

## 10. Rendering Pipeline

The current rendering path is determined by the scene:

**(A) Main xterm** (`TerminalPanel`): takes over full-screen in the `classic` / `altScreen` scenes, rendering PTY output directly and receiving keyboard input.

**(B) Block DOM** (`TerminalBlockList`): in the `blockList` scene React renders the entire block list. Completed blocks show the `outputHtml` snapshot; running blocks mount the live xterm held by the controller, presenting PTY output directly; pending blocks are not shown. The list uses plain DOM scrolling, and whole-output changes drive bottom-pinning via `ResizeObserver`.

The live terminal uses the character height measured by xterm, avoiding clipping the top strokes of the first line when the line height is forcibly compressed; the HTML snapshot of completed blocks uses the corresponding default line height.

Terminal width updates with the window, the sidebars, and the split-pane layout, calling resize on the PTY and the live xterm; a horizontal scroll container is not used as a substitute for size synchronization. When extracting the snapshot of a completed block, only soft wraps are merged according to the xterm buffer's `isWrapped`, preserving explicit newlines, blank lines, spacing, and colors; historical output re-wraps with the current container width. Authentication and screen snapshots still retain the physical grid rows. Terminal history uses a vertical themed scrollbar, with the thumb area reserved in advance, avoiding column-width changes when it overflows.

`TerminalBlockList` groups by status:

| Group | Condition | Rendering |
|------|------|------|
| `completed` | `done` / `interrupted` | `BlockItem` (context line + command + outputHtml, hover toolbar) |
| `running` | `executing` | `RunningItem` (pulsing dot, live output, elapsed time, terminate button) |
| `pending` | `pending` | `PendingItem` (shows only the context line) |

## 11. Output Extraction and Color

`terminalSnapshot.ts` is the core of "extracting color HTML + plain text from the xterm buffer":

- `extractSnapshotFromBuffer(buf, cols)`: reads foreground/background colors cell by cell, generates `<span style="...">`, **merges adjacent cells with the same style**, trims trailing blank lines, and joins lines with `<br>`. Supports bold/italic/underline/strikethrough/dim/inverse.
- `createOffscreenTerm`: a hidden xterm (offscreen) used as the extraction carrier.
- `captureTerminalOutput(rawAnsi, cols)`: replays raw ANSI into an offscreen xterm and then extracts — correctly handling cursor movement, screen clearing, and `\r` overwriting that anser/regexes cannot.
- Color: the 256-color `PALETTE` in `blockTypes.ts` (ANSI 16 + 6×6×6 cube + 24 grayscale), with `indexToCss` mapping to CSS color values; default colors go through `var(--fg/--bg/--cursor)`.

## 12. State Management

zustand, split by domain (`src/features/*/stores/`):

| store | Key state |
|-------|---------|
| `workspace` | tabs, activeId, activate/close, per-tab cwd |
| `terminal` | sessions (tabId→PTY id), dims, `scenes` (tabId→classic/blockList/altScreen), altScreenActive, keyboardTarget, pendingInput; `termInstances` (module-level Map, not in state) |
| `blocks` | `byTab: tabId → TermBlock[]`, setBlocks/updateBlock/clearBlocks/setBlockCollapsed/setAllCollapsed |
| `chat` | per-tab AI messages, send, setDefaultStream |
| `history` | command history |
| `ui` / `dock` / `workspaceDirs` / `searchHistory` / `searchHighlight` | UI panels, search, etc. |

`TermBlock` (`src/features/terminal/services/pipeline/termBlock.ts`) is the UI-layer block projection, with fields: id/command/cwd/gitBranch/status/exitCode/startedAt/endedAt/wasLongRunning/outputHtml/outputText/outputRaw/linesTruncated/collapsed/agent.

## 13. Backend (Rust Layer)

`src-tauri/src/`:

| Directory/File | Responsibility |
|------|------|
| `terminal/pty.rs` | `portable-pty` session lifecycle, commands registered as `pty_spawn/write/resize/close`, events `pty-output`/`pty-exit` (includes StreamDecoder + scan.rs wiring; when TERM/COLORTERM are empty at GUI launch, supplies `xterm-256color` + truecolor) |
| `terminal/scan.rs` | Rust StreamScanner (synchronous byte-stream scanning, see §5.1) |
| `terminal/shell_integration.rs` | zsh (ZDOTDIR) / bash (--rcfile) / PowerShell injection of the OSC 133/7 shell integration script |
| `terminal/shells.rs` | shell type detection and list_shells |
| `db/` | rusqlite persistence: history, sessions, blocks (including the `output_html` color snapshot), groups, workspaces, downloads, SSH connections (`HistoryDb` layering; a legacy DB with `user_version<2` is reset outright) |
| `commands/` | Tauri command forwarding layer (search/session/group/workspace/download) |
| `files/` | filesystem operations (fs, `fs_disks` disk list, file_open) |
| `remote/ssh.rs` | SSH/SFTP (connection CRUD, host fingerprint TOFU, SFTP download/upload) |
| `agent/` | AI streaming (ai.rs), Skills, memory, MCP, scheduling, web scraping, custom agents |
| `theme.rs` | theme configuration persistence |
| `lib.rs` / `main.rs` | Tauri command registration, AppState assembly, startup/exit archiving |

The frontend interacts with the backend through `invoke`/`listen` in `src/platform/pty.ts`.

## 14. Complete Data Flow Timeline

Taking the execution of `ls -la` as an example:

```
T0   The user types "ls -la" in the InputEditor and presses Enter
       → stash the command name → ptyWrite(sessionId, "ls -la\n")
       → Rust pty.rs writes to the PTY → the shell executes it

T1   shell_integration emits OSC 133;E (command text) → 133;C (preexec)
       → If an external 133;C arrives first, the controller consumes the InputEditor stash first; a later 133;E only updates the current block
       → The PTY chunk enters the Rust StreamScanner, producing osc events synchronously (delivered via the pty-output event)
       → SessionController: 133;C turns the block status→executing and creates outputTerm

T2   PTY output "total 48\n..." arrives
       → Rust scan → data events → SessionController routes them to outputTerm
       → ~250ms throttle: extractSnapshotFromBuffer extracts outputHtml
       → useBlockStore.setBlocks updates the RunningItem's live output

T3   The shell emits OSC 133;D;0 (command_finished, exit code 0)
       → SessionController: extracts the final outputHtml/outputText, disposes outputTerm
       → status→done, setBlocks pushes
       → The next 133;A creates a new pending block

T4   Render frame
       → TerminalView reads scene==='blockList'
       → TerminalBlockList renders BlockItem (DOM + outputHtml)
```

Dev mode automatically writes `terminal-debug.jsonl`. When troubleshooting a hanging command, correlate `command-submit`, `command-start`, `route-data`, `terminal-scene-focus`, `terminal-input`, `terminal-input-write-complete`, and `command-done` by time; the log keeps only lengths, statuses, and error types, and does not record commands or raw terminal content. `session-controller-register/dispose` and `command-pending-deferred` are used to locate hot-update or lifecycle races.

## 15. Key File Index

### Terminal Core

| File | Contents |
|------|------|
| `src/App.tsx` | Top-level layout (Dock + SidePanel + TerminalView + wallpaper background layer) |
| `src/features/terminal/components/TerminalView.tsx` | scene-driven UI: loading / classic / blockList / altScreen (including split panes) |
| `src/features/terminal/hooks/useTerminalSession.ts` | event wiring + controller lifecycle + main xterm lifecycle |
| `src/features/terminal/hooks/useFollowBottom.ts` | block list bottom-follow hook |
| `src/features/terminal/services/pipeline/events.ts` | `DispatchEvent` type (mirror of the Rust `ScanEvent`) |
| `src/features/terminal/services/pipeline/sessionController.ts` | block lifecycle + three-scene state machine (classic/blockList/altScreen) |
| `src/features/terminal/services/pipeline/termBlock.ts` | UI-visible TermBlock type |
| `src/features/terminal/model/terminalSnapshot.ts` | offscreen xterm + buffer→HTML/plain text extraction |
| `src/features/terminal/model/blockTypes.ts` | 256-color palette + `indexToCss` |
| `src/features/terminal/inputVisibility.ts` | input box visibility state machine |
| `src/features/terminal/components/TerminalBlockList.tsx` | block list + BlockItem/RunningItem/PendingItem |
| `src/features/terminal/components/TerminalPanel.tsx` | main xterm panel (classic / altScreen full-screen) |
| `src/features/terminal/components/InputEditor.tsx` | bottom input bar (command/AI mode, visibility consumption, attachments/permissions) |
| `src/features/terminal/components/BlockOutput.tsx` | block output rendering (HTML/text/highlight) |
| `src/features/terminal/hooks/useTerminalFocus.ts` | terminal focus routing |
| `src/features/terminal/stores/terminal.ts` | session/dimensions/keyboard routing store + `termInstances` |
| `src/features/terminal/stores/blocks.ts` | block store |
| `src/platform/pty.ts` | Tauri IPC wrappers |
| `src/features/workspace/services/sessionManager.ts` | session/block persistence orchestration |
| `src/utils/sanitizeHtml.ts` | bidirectional sanitization of outputHtml on persist/render (span whitelist style + br, injection protection) |
| `src/features/workspace/model/windowLayout.ts` | split-pane layout model (TerminalSpec / pane splitting) |
| `src-tauri/src/terminal/pty.rs` | portable-pty session lifecycle + scan wiring |
| `src-tauri/src/terminal/scan.rs` | **Rust StreamScanner** (synchronous PTY byte-stream scanner) |
| `src-tauri/src/terminal/shell_integration.rs` | OSC 133/7 shell integration injection |

### Agent / AI and Panels

| File | Contents |
|------|------|
| `src/features/agent/services/agentStream.ts` | AI SDK streaming implementation for the chat store (streamText + tools) |
| `src/features/agent/model/messageParts.ts` | message part model (ToolRun state, etc.) |
| `src/features/agent/tools/` | tool set (runCommand/terminal/files/skill/webSearch/webFetch/subagent/memory/schedule) |
| `src/features/agent/stores/permissions.ts` | permission modes (standard/strict/allow) |
| `src/features/agent/model/context.ts` | context strategy (off/window/compact + summary compaction) |
| `src/features/agent/services/skills.ts` / `src/features/agent/services/mcp.ts` | Skills / MCP tool assembly |
| `src/features/chat/components/PanelChat.tsx` | global AI chat panel (dock sidebar) |
| `src/features/chat/components/AiBlock.tsx` / `ToolRunCard.tsx` | inline AI block / tool run card |
| `src/features/settings/` | settings page (AI behavior/model/MCP/Skills/shortcuts/terminal open mode/theme) |
| `src-tauri/src/agent/` | AI stream/config/memory/Skills/MCP/scheduling/web scraping backend |
| `src-tauri/src/remote/ssh.rs` | SSH/SFTP (host fingerprint TOFU, password authentication) |

### File Panel (single implementation for local / SSH)

The local file panel and the SSH file panel are **not two implementations**: there is only one browsing and operation state machine, and the differences converge into
the single state variable "execution target".

| File | Contents |
|------|------|
| `src/features/files/model/fileOps.ts` | `FileOps` interface + `FileOpsTarget` (`{kind:'local'}` / `{kind:'ssh', connectionId}`) + `fileOpsFor(target)`, the single implementation selection point; `resolveTargetDir` unifies the "right-click/drag-drop target" semantics (folder = itself, file = same level, blank = current directory) |
| `src/features/files/services/localFileOps.ts` | local implementation: `@platform/api/fs` + `@platform/path` |
| `src/features/ssh/services/fileOps.ts` | remote implementation: SSH commands + POSIX path utilities |
| `src/features/files/model/filePanelConfig.ts` | panel configuration: menu item key lists (row/multi-select/blank/more), drag-and-drop semantics (whether dragging out downloads first, whether dragging in moves or uploads), open semantics, test identifiers — the parts that "vary by state" live only here |
| `src/features/files/hooks/useFileBrowser.ts` | shared browsing and operation state machine: directory loading, tree lazy loading, selection, view snapshot undo, clipboard, undo history (≤20 steps), create/rename/delete |
| `src/features/files/components/FilePanel.tsx` | shared view: top bar breadcrumb (editable), file tree, right-click/blank/more menus, confirmation modal, drag-and-drop wiring |
| `src/features/files/components/PanelFiles.tsx` / `src/features/ssh/components/RemoteFiles.tsx` | thin wrappers: provide only their respective specialized menu callbacks, icons, error views, and download management entry points |

Conventions:

- All file operations go through `FileOps` to backend commands; the view layer must not `invoke` file commands directly, nor handle path separators itself.
- When adding an entry that "is only meaningful for a certain kind of target", first add the menu key and the configuration item, and let the configuration decide whether to show it, avoiding entries that report "the current target does not support this" as soon as they are clicked.
- Name-collision avoidance is guaranteed by the backend (`unique_path` / `unique_remote_path`, with the sequence number inserted before the extension); the real target path is returned, and the undo history is recorded by real path.
- If a difference between local and remote is a matter of "capability" rather than "appearance", it should be expressed as a configuration item (such as `drag.externalDropMode`), not written as `if (isSsh)` inside a component.

### Path Semantics Layering (Local / Remote / Platform Layer)

Whether a path is "absolute or relative, how it is joined, and what its parent is" are platform-dependent judgments, always funneled into the platform layer; business modules do not decide them on their own:

| Path kind | Frontend | Rust |
|---|---|---|
| Local path | `@platform/path` (separators, drive-letter root `C:/`, parent directory, path segments) | `std::path` (`files/fs.rs`) |
| Remote (POSIX) path | `@platform/posixPath` (`isPosixAbsolute` / `joinPosix` / `parentPosix` / `fileNamePosix` / `normalizePosix`) | `src-tauri/src/platform/path.rs` (`is_absolute` / `join` / `parent` / `file_name` / `normalize` / `numbered_name` / `name_from_listing` / `is_within`) |
| IPC boundary | `@platform/api/fs` normalizes local paths in both directions | remote paths are sent and received as-is (already POSIX) |

Rules:

- Remote paths **must not** use `std::path`: on a Windows host, `Path::is_absolute("/home/user")` is `false`, `PathBuf::join` inserts backslashes, and the semantics of `Path::new("/a/b").parent()` are also inconsistent with the remote side. Using `Path::new(&posix_string)` in an SFTP call merely hands the string to libssh2; the judgment and joining must be done first with the platform-layer helpers.
- `ssh2`'s convenience `Sftp::readdir` joins paths with the host separator (`\` on Windows): retrieving the file name must go through `platform::path::name_from_listing(listed, dir)`, and then `join` generates the POSIX path.
- The same applies to the frontend: remote absolute/relative judgment and joining go through `@platform/posixPath`; `features/ssh/utils/remotePath.ts` only re-exports and provides store/pane-related utilities.
- When developing remote features on Windows, unit tests must cover "the joined result contains no `\`" and "`/home/user` is judged to be an absolute path"; otherwise this kind of bug only surfaces during real-machine operation.

### Theme

| File | Contents |
|------|------|
| `src/config/theme/tokens.ts` | theme CSS variables (light/dark) |
| `src/features/settings/model/terminalTheme.ts` | terminal theme Store (wallpaper data URL + app opacity + import/export) |
| `src-tauri/src/theme.rs` | theme configuration persistence (JSON file) |

---


## 16. Split Panes and Window Layout

Each terminal tab can be split left/right or top/bottom into multiple independent PTY panes; **each pane has its own SessionController and blocks store key**, and they share the bottom input bar (input is routed to the currently focused pane, `useTerminalStore.focusedPaneId`).

- The layout model is in `src/features/workspace/model/windowLayout.ts` (`TerminalSpec` / `layoutLeaves` / `firstLeaf`): a tab's layout is a **split tree** (N/S/E/W edges), and the leaves are the panes.
- `TerminalView.tsx` renders per leaf: each leaf mounts a `TerminalPanel` + scene-driven view, all managed by `useTerminalSession` for PTY/xterm/controller.
- Split startup flow: NewTabModal (TopDock `+`) to choose the type → `beginSplit` (enter drop-point selection: which side of the original pane to split on) → create the new pane.
- Adjacent pane sizes use absolute positioning + percentages, and dragging adjusts `windowLayout` through a ResizeHandle to update the tree.

### True alignment of the terminal area (not "centered")

The padding of the layers inside a terminal pane is **deliberately asymmetric**; read this section before changing the layout, or it is very easy to push full-width elements off-center:

| Layer | Padding | Notes |
|---|---|---|
| `.terminal-pane` (the pane root of `TerminalView`) | 0 | Left/right are both 0: **full-width elements such as the status line and authentication input bar align strictly with the pane's left and right edges** (left and right padding are equal, both 0) |
| Terminal screen container (xterm host `[data-testid="ssh-terminal-screen"]`, snapshot `pre`) | left 8px, right 0 | The 8px on the left is visual padding for terminal text/prompts; **nothing is left on the right**, so that the native scrollbar sits flush against the pane's right edge |
| Top status line / authentication input bar | symmetric | the status line is `4px 8px`; the authentication input bar is `padding: 12`, so its content has 12px on each side |

Therefore:

- Terminal **content** (text, cursor, scrollbar) is **left-padded and flush right** relative to the pane: the text is indented 8px beyond the pane's left edge, while the pane's right edge leaves no padding for the scrollbar. This is not "centering", nor is it a mistake; it is a deliberate trade-off (flush scrollbar takes priority).
- Full-width elements that need left-right symmetry (authentication input bar, input bar, panel borders) **must be mounted at the pane root level**, not inside the container that carries the 8px left margin; conversely, the terminal screen content must keep that 8px.
- The "authentication input bar is left-right symmetric within the terminal area" case in `e2e/ssh-auth.spec.ts` locks this convention in: if someone adds the left margin back to the pane root level, the case will fail.

## 17. Agent / AI Chat (Code Agent)

AI chat consumes the same chat store in **two forms**:

- **Inline**: `InputEditor` ⚡ mode; the answer is rendered as an `AiBlock` above the terminal (AI block, rendered at tiered levels according to load).
- **Panel**: `PanelChat` (the "AI" panel in the dock sidebar, a cross-pane session transcript segmented by originating pane).

### Streaming Pipeline (`src/features/agent/`)

```
chat store send → agentStream (AI SDK streamText)
  ├─ createChatModel (provider wrapper: Anthropic/Gemini/OpenAI compatible)
  ├─ buildSystemPrompt + buildSkillsContext + memory/agent lists (platform IPC)
  ├─ buildTools (terminal/runCommand/files/*/skill/subagent/memory/schedule/webSearch/webFetch/webCrawl)
  ├─ buildMcpTool (one tool per MCP server; mcp.rs on the Rust side starts/stops connections)
  ├─ text delta → onChunk (store batches at 50ms); tool events → ToolRun (rail node card)
  └─ stepCountIs(maxSteps) loop; run_command dispatches the command to the currently focused pane
```

- **Permission modes** (`permissions.ts`): standard (decided per tool per the settings page) / strict (ask every time) / allow (dangerous commands still ask every time); the Shield status-bar chip cycles through them.
- **Context strategy** (`context.ts`): off (full) / window (token budget) / compact (budget + automatic summary compaction), with estimates from `estimateTokens`.
- **Settings layering** (`agentSettings.ts`): global defaults + per-model overrides (merged by `resolve(modelId)`), persisted in localStorage; connection settings such as key/provider/model remain in the Rust `config.json`.
- **Smart titles** (`agent/title.ts`): when there is enough block/conversation activity, an LLM is called to generate a tab title (the App calls `initAutoTitle()` on startup).
- **Backend**: `src-tauri/src/agent/` (`ai.rs` SSE streaming, `skills.rs`, `memory.rs`, `mcp.rs`, `schedules.rs`, `web.rs` scraping, `agents.rs` custom agents).

## 18. Theme System

The theme has two layers:

| Layer | Contents |
|---|---|
| Design tokens (`src/config/theme/tokens.ts`) | Two sets of CSS variables, light/dark (`--canvas/--text-primary/--border/...`); `applyTheme` writes them synchronously on the first frame to prevent FOUC |
| Appearance theme (`src/features/settings/model/terminalTheme.ts` + Rust `theme.rs`) | wallpaper (data URL, a background layer fixed to fill at zIndex 0) + app opacity (only takes effect when a wallpaper exists) + theme import/export JSON |

- Configuration is persisted on the Rust side (`theme_config` command, JSON file); on startup `applyCachedWallpaper()` runs first, then `load()` asynchronously.
- Terminal colors (ANSI palette) are in `src/features/terminal/model/blockTypes.ts`, independent of the design tokens.
