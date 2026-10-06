# Vrykell Product Development Log

> Compiled from git history (2026-07-20 → 2026-09-02, current branch `dev`).
> This project is a **chat-first terminal**: the terminal is the primary surface, each command renders as a **command block (Block)**, AI conversations (BYOK multi-provider) are presented in two forms — inline AI blocks + a global AI panel — and it supports a code agent (tools, permissions, Skills, MCP, memory, scheduling).

---

## Milestone Overview

| Phase | Date | Theme | Key Artifacts |
|---|---|---|---|
| Phase 0 | 07-20 | Electron core terminal | v0.1.0 source code (blocked by the require bug) |
| Phase 1 | 07-22 | Tauri v2 migration | Electron → Rust backend + system WebView |
| Phase 2 | 07-22 ~ 07-24 | v1 in-house DOM terminal | Self-written CSI parser + DOM rendering (later abandoned) |
| Phase 3 | 07-23 ~ 07-25 | Terminal stability and experience | VT screen model, alt screen, resize fixes |
| Phase 4 | 07-24 ~ 07-27 | Layered architecture refactor | Layered backend + feature-based frontend |
| Phase 5 | 08-01 ~ 08-07 | Theme exploration | Multiple rounds of theme experiments + settings tab |
| Phase 6 | 08-08 ~ 08-11 | v2 chat-first refactor | Block architecture, OSC 133, command palette, bookmarks |
| Phase 7 | 08-13 ~ 08-14 | Synchronous single-pass dispatch refactor | StreamDispatcher + SessionController |
| Phase 8 | 08-15 | Batch performance/memory fixes | OSC/CSI, fileOpen, AI streaming pushed down into Rust |
| Phase 9 | 08-15 ~ 08-16 | Enterprise features and security | SSH, download, session history, grouping, code audit |
| Phase 10 | 08-16 ~ 08-17 | Split panes, global search and wrap-up | Split-pane block list model, Cmd+F search, unit test completion |
| Phase 11 | 08-18 | Branding and cross-platform | Renamed to Vrykell, PowerShell integration, split-pane window layout model |
| Phase 12 | 08-21 ~ 08-24 | AI agent (code-agent style) | Tool calls, permission modes, attachments, context management, smart titles, message parts |
| Phase 13 | 08-25 ~ 08-26 | Settings system and model capabilities | Skills/MCP/settings pages, multi-model management, ContextRing, e2e convergence |
| Phase 14 | 08-27 ~ 08-30 | Security hardening and experience polish | SSH security (keychain/command injection protection), session history filtering, panel drag-to-collapse, visual details |
| Phase 15 | 08-31 ~ 09-02 | Persistence security and file panel polish | Command block color snapshots persisted + bidirectional HTML sanitization, disk cards, breadcrumb back in the top bar, status bar removed |

---

## Phase 0 — Starting Point: Electron Core Terminal (2026-07-20)

The project started with Electron, targeting a Phase 1 core terminal.

- `v0.1.0: Phase 1 core terminal — source code complete`, but **the Electron `require` bug blocked running**, and the app could not start.
- Then a round of fixes around the Electron main process: updated the Electron version, added a post-install patch, improved terminal message handling.
- Refactored the Electron API loading logic, removed the obsolete patch script, optimized the main process entry point.
- Updated the backend interface so that session input/output accepts string data.

**Summary**: Electron's module loading and IPC problems exposed the fragility of that stack in this scenario, setting the stage for the migration to Tauri in the next phase.

---

## Phase 1 — Tauri v2 Migration (2026-07-22)

Electron was abandoned entirely, turning to the lighter Tauri 2.

- `Tauri v2 migration: Electron → Rust backend + system WebView frontend`.
- Deleted all Electron remnants and unused dependencies, rewrote the documentation.
- Cleaned up the root directory debug scripts and `sdk/`, rewrote the README, fixed `.gitignore`.
- Rewrote `docs/plan.md` (the complete Tauri plan), updated `docs/index.md`.
- Cleaned up the build artifacts `dist/` + `target/` (**3.1GB in total**).
- Fixed tsconfig (added `src/api`), `.gitignore` (added `gen/`).

**Summary**: Established the long-term technical foundation of a Rust backend + system WebView frontend, and the project directory was given a fresh start.

---

## Phase 2 — v1 In-House DOM Terminal (2026-07-22 ~ 07-24)

After entering the v1 stage, the team tried to replace xterm.js with a **self-built terminal emulator**.

- `DOM terminal replaces xterm.js: TerminalBuffer + react-virtuoso`.
- `Self-written CSI parser + DOM rendering, zero external dependencies`.
- Implemented PTY session management (spawn/write/resize/close + output event stream).
- Supported **CJK character width handling** and **IME composition input**, added CJK test cases.
- Optimized virtual scrolling and line rendering, added unit tests for `DomTerminalView`.
- Rewrote the buffer as a **VT screen model (screen + scrollback)**, implemented DEC 1047/1048/1049 **alternate screen buffers**.
- Built an authoritative emoji width table (measured from string-width@7), aligning with wcwidth semantics.
- Fixed the parser so that it no longer mistranslates unknown sequences into valid ones.

**Summary**: This was an educational, in-depth in-house attempt that produced solid VT/ANSI parsing experience. But the final conclusion was "no self-built terminal emulators"; that approach was archived to the `archive/v1-dom-terminal` branch, and v2 delegated back to xterm.js.

---

## Phase 3 — Terminal Stability and Experience Polish (2026-07-23 ~ 07-25)

Filled in stability and desktop experience details on top of the v1 terminal.

- Structured terminal event handling, **splitting large event batches to avoid Tauri IPC truncation**.
- PTY resize: debounce to prevent SIGWINCH flooding, estimating the initial size from the window dimensions, clamping the cursor after resize.
- Close tab confirmation dialog (including a force-kill warning), **forced kill of child processes**, i18n copy.
- Show the quit dialog only once when closing the last tab.
- Switched the theme to a classic pure black background + bright white text.
- Scroll fixes: the viewport does not jump on input, reflow on resize, the main scrollback is hidden while alt screen is active.
- e2e tests: terminal usage, vim interaction, real Claude resize integration test.
- Layout: moved the hidden textarea out of the scroll container, fixed scattered lines at 60 columns.

**Summary**: The terminal reached a "usable day to day" state, and desktop interaction details (close confirmation, resize, scrolling) largely converged.

---

## Phase 4 — Layered Architecture Refactor (2026-07-24 ~ 07-27)

Tidied up the code structure for the subsequent large-scale feature expansion.

- Reorganized the project into a **layered backend + feature-based frontend**.
- Extracted the app Shell, added feature entries and path aliases.
- Forward special keys and modifier key combinations to the PTY.
- Cleared all existing tsc errors (at the type level).
- Added a script to capture Claude Code startup output, corrected the README description.

**Summary**: Established the layered and modular skeleton, paving the way for v2's large-scale feature development.

---

## Phase 5 — Theme Exploration and rich-theme (2026-08-01 ~ 08-07)

A concentrated period of visual experimentation, with multiple rounds of theme iteration, eventually converging into controllable settings.

- Fixed the invoke command names to snake_case to match the Rust commands.
- Introduced **flow layout + inline rich-content rendering** into the terminal (inline LaTeX formulas).
- Multiple rounds of theme experiments: `proof margin`, `ink & violet`, `modern chrome`, `graphite & amber`, `flat design`, `frosted-glass` (zero gradients, frosted glass).
- The palette converged to classic terminal colors (black/white/gray/blue/green).
- **box-drawing character detection** for grid alignment; window transparency + backdrop blur.
- Added a **settings tab** (appearance and rich content options), tab dragging, fixed the quit dialog logic.
- Added the Tauri `macos-private-api` feature, fixed the windowEffects config key.
- rich-rendering toggle (Cmd+Shift+L).

**Summary**: The theme converged from "directionless repeated color trials" to "restrained defaults + configurable", and the settings system was initially established.

---

## Phase 6 — v2 chat-first Refactor (2026-08-08 ~ 08-11)

**The most important refactor of this project**: abandoned the v1 in-house terminal and rewrote the product with a "chat-first + Block architecture".

### Scaffolding and Infrastructure
- `v2 scaffolding (Tauri 2 + React + TS, create-tauri-app template)`.
- Rust PTY session backend, PTY IPC wrapper + vitest infrastructure.
- Overlay window + e2e infrastructure (Playwright + Tauri mock + Anthropic SSE mock), 16 cases.

### Core Features (in commit order)
- Connected the xterm.js terminal panel to the PTY backend.
- Chat panel + Markdown/LaTeX/table/code block rendering.
- Anthropic BYOK streaming conversation integration.
- One-click dispatch of command blocks to the terminal + chat/terminal dual-surface layout.
- **Layout refactor: terminal as the primary surface, Chat as a collapsible sidebar**, then further **removed ChatPanel and inlined AI into the terminal**.

### Block Architecture Evolution (multiple rounds of iteration within a day)
- From "Block containerization (independent background rectangles)" → "completed blocks rendered independently, only active commands use xterm.js" → "BlockOverlay segmentation" → "true Block list architecture" → "xterm.js hidden, only the Block list + InputEditor".
- Blocks hold the raw ANSI output, and the Overlay renders colored content consistent with xterm.js.
- Filtered OSC/DCS/non-SGR escape sequences, fixed garbled Block output; based on **OSC 133 A to truncate the prompt precisely**.
- Real-time display of running commands + auto-scroll to the bottom.

### Interaction Features
- Global shortcuts (Cmd+T/W/number/F/,), terminal search bar, link detection.
- Command palette Cmd+P, font zoom Cmd+/-/0, undo closed tab Cmd+Shift+T.
- Block bookmark system, Toast notifications, Tab double-click rename + context menu, middle-click close, active indicator.
- copy-on-select, Block menu (bookmark/clear all blocks), collapse/expand all blocks.
- **TUI fullscreen mode** (alt screen detection and switching, a v1 leftover redone here).
- InlineAI animation, terminal empty state.

### Design References and Documentation
- Organized the visual and layout specs: theme color values, layout constants, ShellIndicator, block list, input area.
- The feature list expanded from 317 items to 413 items (30 → 43 categories).
- Wrote the feature spec and test checklist (60+ test items, 10 categories).

### Architecture Rewrite Design
- Terminal architecture rewrite design document: Handler layering, Block lifecycle, scroll state machine, three-way dispatch.
- Code review fixes such as making backend shell detection asynchronous and cleaning up KillState leaks.

**Summary**: The v2 product shape (chat-first + Block) was finalized at this stage, a large number of interaction features landed, and systematic feature spec/feature list documentation was established.

---

## Phase 7 — Terminal "Synchronous Single-Pass Dispatch" Refactor (2026-08-13 ~ 08-14)

Rewrote the temporary "three-way dispatch" pipeline of early v2 into the documented **synchronous single-pass dispatch architecture** (the current architecture).

- Wrote the terminal page refactor design document + implementation plan (12 tasks).
- Fixed PTY output UTF-8 streaming decoding (multibyte characters spanning read boundaries no longer produce U+FFFD garbage).
- shell integration reports the git branch (OSC 133;G).
- **StreamDispatcher**: a synchronous scanner for the PTY byte stream (OSC stripping / alt observation / cross-chunk concatenation).
- **SessionController**: block lifecycle + three-scene state machine (synchronous single-pass dispatch).
- The store switched to the new TermBlock type, added setBlocks/scenes.
- **useTerminalSession**: wiring of the main xterm + synchronous pipeline, replacing useXterm (multiple rounds of review fixed listener leaks, PTY races, resize/focus/cleanup).
- TerminalView three-way dispatch changed to **scene-driven** + follow-bottom replacing the scroll state machine.
- TerminalBlockList visual adjustments: context line, bold command, thin dividers, removed the left border and pill.
- Sending output to AI now takes the output from the block store; added forceHidden to InputEditor.
- Deleted the old pipeline (BlockTracker/BlockListManager/blockOps/scrollState/useXterm).
- e2e adapted to the new block UI + classic fallback/altScreen scenes.

**Summary**: The current v2 architecture (StreamDispatcher + SessionController three-scene state machine + one offscreen xterm per block) was finalized here, with significant improvements in performance and maintainability.

---

## Phase 8 — Batch Performance/Memory Fixes and Pushing Down into Rust (2026-08-15)

A batch of systematic performance and memory fixes that pushed key strategies from the renderer process down into the Rust backend.

- Batch security/performance/memory fixes (Merge fix/security-perf-batch1).
- **OSC/CSI scanning pushed down into Rust**.
- **fileOpen strategy pushed down into Rust** + get_search_context uses the active tab's cwd.
- **AI streaming pushed down into Rust**, memory leak fixes, killForeground upgrade pushed down into Rust.
- Deleted the v1 leftover dead code `src/renderer`.
- Fixed the issue where the fullscreen TUI width collapsed to 2 columns.
- PTY session management optimization: output batching + non-blocking writes.
- Added the clear command history feature (frontend/backend data consistency); made fs_list asynchronous to avoid blocking the main thread; fixed BlockOutput's HTML rendering logic to enhance security.
- Enhanced session handling and terminal interaction, scrolling behavior.

**Summary**: After pushing hot-path logic down into Rust, the renderer process's responsibilities became purer, reducing complexity for subsequent feature expansion.

---

## Phase 9 — Enterprise Features and Security (2026-08-15 ~ 08-16)

Filled in "productivity" capabilities such as remote/file/session management, and did a rigorous round of code audit and security hardening.

### Features
- SSH connection management + session history view.
- Download management + delete/rename confirmation dialogs.
- Settings management refactor + AI configuration enhancements.
- Frontend domain modularization (ssh/files/settings).

### Tab Grouping and Dragging
- tab grouping + drag-and-drop reordering + session history grouping.
- Backend db module split + custom mouse dragging + history grouping polish.
- Several fixes: migration order (ALTER before creating indexes, avoiding a startup panic), archive race condition, group_id persistence, adding a tab to the group header, serde snake_case mismatch making history groups invisible, delete group archiving instead of deleting, history group sorting.

### Security and Audit
- Added `docs/security-review.md`, `docs/code-audit.md`.
- **Fixed SFTP download path traversal**, reject empty SSH users, SSH port validation.
- Multiple rounds of audit fixes: session upsert, chat ghost state, search filter responsiveness, preserving shell/ssh metadata when undoing a tab restore, bookmark block eviction, workspace lastClosed type.
- Deleted the dead code MessageItem.tsx, finalized the list of fixed items in code-audit.

**Summary**: Capabilities such as remote SSH/SFTP, downloads, and session history grouping landed, and a rare "documented + closed-loop" style code audit was completed, notably improving the security posture.

---

## Phase 10 — Split Panes, Global Search and Wrap-Up (2026-08-16 ~ 08-17)

The final sprint stage, filling in the two high-frequency needs of split panes and global search, and strengthening test coverage.

### Split Panes
- MVP split panes: each terminal tab can be split left/right or top/bottom into two independent PTY panes.
- Multiple rounds of fixes: blank screen after splitting (the main pane stays mounted instead of being unmounted), keeping the input bar, re-calibrating the size after the PTY is ready, restoring the original rendering on the unsplit path, fixing the sessionControllers key, adding a split button at the top.
- **Rewritten as a "split-pane block list" model**: each pane has its own block list + a shared input bar.
- PTY starts with a fallback size (0×0 → 80×24) to avoid blank split panes.

### Global Search and Settings
- Global search feature: Cmd+F opens a centered modal and focuses it.
- Fixed clicking the filter panel so it doesn't crash, ensuring the search box is interactive.
- Added a keyboard shortcuts help page to settings, showing the currently supported keyboard shortcuts.

### Test Completion
- Enhanced terminal input handling and pane management.
- Added unit tests for the pane, terminal, and workspace stores, enhancing coverage of input state management and focus logic.

**Summary**: Split panes (independent block list per pane + shared input bar) and global search landed, test coverage was filled in, and this round of development wrapped up.

---

## Phase 11 — Brand Rename and Cross-Platform Completion (2026-08-18)

- The project was renamed from "AI Terminal" to **Vrykell**, and the related documentation and configuration were updated.
- **PowerShell integration**: shell commands and filesystem handling adapted to PowerShell/CMD, shell types extended to `zsh/bash/powershell/pwsh/cmd`.
- **Split-pane window layout model**: TerminalSpec / split tree (N/S/E/W), created by dragging and adjusted with ResizeHandle.
- Terminal window management (drag-restore of multiple tabs), tab row icon and style optimization, improved current directory display logic (directory length limit), font size and style adjustments.
- Drag support requires checking the Tauri internal environment (`is_in_tauri_env`).

**Summary**: The brand was finalized, and cross-platform shell support and the split-pane layout model landed.

## Phase 12 — AI Agent (code-agent style features) (2026-08-21 ~ 08-24)

Upgraded AI from "pure chat" to a **code agent**: tool execution + permissions + context governance.

### Agent Infrastructure
- **agentStream**: the measured path of the AI SDK `streamText` (stepCountIs loop + run_command tool), replacing the earlier direct anthropic stream; the **message parts model** (`messageParts.ts`: ToolRun state, tool node rendering).
- Network layer `createChatModel` injects a Rust proxy fetch (the API key never leaves Rust); multiple providers: Anthropic / Gemini / OpenAI-compatible + Tavily search.
- **Permission modes**: three levels — standard/strict/allow (cycled via the Shield chip in the status bar, distinguished by two color channels).
- **Attachment system**: import/paste/save attachments (trimmed according to provider capabilities), LIMITS and type hints.
- **Context management**: three strategies off/window/compact + token estimation (`estimateTokens`) + summary compaction; added permission mode switching to the input editor/terminal components.
- **Smart titles**: generate tab titles with an LLM once block/conversation activity is sufficient (`agent/title.ts`, `initAutoTitle` on App startup).
- **Tool set**: runCommand, terminal, files, skill, subagent, memory, schedule, webSearch, webFetch, webCrawl (two kinds: Tavily/built-in).
- Chat panel enhancements: the dual forms of inline (AiBlock) + panel (PanelChat session transcript); model picker (ModelPicker/ModelPill).

### Interaction and Styling
- Input editor: history prefix-match candidates, local history completion; code block style optimization (line wrapping for long content).
- Persistence: AI conversation/streaming configuration enhancements, attachments/tool run state.

**Summary**: AI capabilities were upgraded from "Q&A" to an "executable agent", and context governance (budget and compaction) and permission layering took initial shape.

## Phase 13 — Settings System, MCP/Skills and Wrap-Up (2026-08-25 ~ 08-26)

- **Skills management**: skill list + tree + detail panel (install/disable/edit), `standardSkills`, skill tool integration.
- **MCP integration**: server list/start-stop/connection test/tool enumeration (`mcp_save_server` and other commands), tools wired into agentStream.
- **Settings page system**: AI behavior, model configuration (per-model overrides), MCP management, keyboard shortcuts help, terminal open mode (classic/block per shell, SSH always classic), theme customization (import/export + transparency).
- **ContextRing**: a context usage visualization component (token budget ring).
- Model capability model (vision/reasoning/tools/search capabilities), e2e initialization logic and assertion optimization.
- Minor fixes: scrollbar hover display, error boundaries, component refactoring.

**Summary**: Settings evolved from a single page into a multi-page system (layered behavior/model/agent/theme), MCP and Skills completed the agent ecosystem, and the feature scope converged toward stability.

## Phase 14 — Security Hardening and Experience Polish (2026-08-27 ~ 08-30)

The wrap-up stage's security hardening and interaction/visual detail polish, focused on SSH credential security, panel interaction, and rendering consistency.

### SSH and Path Security
- **SSH passwords stored in the keychain**: added `secret.rs` secret storage (macOS Keychain / platform fallback file), SSH passwords no longer land in SQLite, plaintext in old databases is migrated automatically, and secrets are cleaned up when a connection is deleted.
- **Command injection protection**: SSH hostname validation (prevents shell injection), sensitive path checks in `sensitivePaths.ts`, remote path utility functions (`remotePath.ts`) and the corresponding unit tests.
- SSH integration enhancements: added PowerShell support to shell_integration, tool descriptions consolidated into `toolTexts.ts`.

### Session History
- **Session history filtering and restore**: added filtering to SessionHistoryView (`sessionFilter.ts`), restoring archived sessions, with accompanying e2e and unit tests.

### Interaction and Visuals
- **Panel drag-to-collapse**: ResizeHandle supports collapsing and dragging back, with release-confirmation logic (Toast enhancements).
- **Code block copy**: one-click copy of code blocks in AI output + copied state; markdown layout optimization.
- Fine-tuning of the input card and terminal styles (margins/background color/transparency), TUI toolbar style optimization.
- **Inter-line gap fix**: aligned block output rendering height (BlockOutput line height aligned with xterm), fixing the 1px gaps between blocks; the PTY child process PATH merges the user bin directories (`merge_user_bin_paths`, addressing the problem of missing directories such as `/usr/local/bin` and Homebrew when launched from the GUI).

### Documentation and Tests
- Updated the README's Rust backend testing notes, added new review entries to security-review.md.

**Summary**: SSH credential security came full circle (keychain + injection protection + migration), session history restore is fully usable, and panel interaction and rendering details converged.

## Phase 15 — Persistence Security and File Panel Polish (2026-08-31 ~ 09-02)

### Terminal Robustness
- **Filling in TERM/COLORTERM on GUI launch**: apps launched from Finder/Dock have an empty TERM, zsh degrades to dumb, and TUIs that rely on terminal capability detection (truecolor fullscreen apps) hang/show a black screen; at `pty_spawn` time, if both are empty they are filled in with `xterm-256color` + truecolor, while explicit user settings take precedence and are left untouched.
- **Block terminal column count derived from the measured DOM character width**: the live terminal canvas is laid out using the xterm cellWidth (≈8.16px), while completed block HTML snapshots render with browser fonts (≈8.43px, ~4% wider), so at the same column count the snapshot overflows the card and wraps; the blockList scene now uses the DOM character width to determine the column count, making the live terminal and completed blocks the same width, while manual fullscreen (pure canvas) still fills the host using cellWidth.
- **Fullscreen TUI frames no longer enter the command block history**: removed the logic that back-filled blocks with the alt buffer's final frame, so after fullscreen apps like vi/htop exit or are killed, the block history only keeps the shell noise after teardown.
- **Old databases are deleted and reset outright**: databases from v1 and earlier lack new columns, causing SQL such as record_block to fail; instead, on open, if `user_version<2` is detected the whole database is deleted and the tables are created from scratch, with no more column-by-column migration.
- Dependency update: added `@types/node` to support TypeScript type definitions.

### Persistence Security
- **Command block color snapshot persistence**: the blocks table gains an `output_html` column, written by `record_block` and read back on session restore — command blocks on newly created pages have colors, and restored pages no longer degrade to plain text.
- **Bidirectional sanitization of output HTML**: outputHtml passes through `sanitizeOutputHtml` on both sides — writing to the DB and reading out (sessionManager restore + BlockOutput rendering) — (keeping only the whitelisted span style + br), so even a tampered DB cannot inject anything.

### File Sidebar
- **"This PC" displayed by disk**: added the `fs_disks` command (macOS root volume + mounted volumes / Windows drive letters, with total capacity and available space), disks are presented as small capacity cards (icon + name + available capacity + usage bar) and clicking enters them; `fs_roots` is deprecated.
- **Breadcrumb back in the top bar**: left-aligned; when the sidebar narrows, higher-level directories are omitted without wrapping based on the measured width; removed the download management divider; the sync button no longer shows a notification when switching directories.
- **File path moved to the panel's bottom bar**: supports eliding long paths, buttons unified to icon styles; `normPath` preserves the filesystem root (after `cd /` the file manager no longer shows an empty directory).
- **Terminal sync button**: added `syncToTerminal` to PanelFiles, syncing the file manager's current directory to the focused terminal as a `cd`.
- Disk card style iterations: removed the background color, changed the capacity bar to a ring on the right, removed the decorative numbers (information conveyed by hover tooltips).

### UI and Interaction
- **Removed the StatusBar component**: the bottom status bar was deleted to streamline the UI; scrollbars are hidden by default and the hover display logic was removed; the terminal resize logic was adapted to the manual fullscreen scenario.
- **Sidebar drag-to-collapse keeps it mounted**: the panel stays mounted while collapsed, so dragging back after changing your mind loses no state.
- **Session right-click duplicate**: `duplicateTab` clones the entire terminal layout (including split panes) as a brand-new PTY session, appends "Copy" to the title, and preserves group membership.
- Global search bar width 420→360.

**Summary**: The persistence loop closed (color snapshots + bidirectional sanitization) and the file panel form converged (disk cards, breadcrumb back in the top bar, path in the bottom bar); completing the GUI launch environment fixed TUI app compatibility.

## Phase 16 — Enterprise-Grade Frontend Structure and Boundary Closure (2026-09-16 ~ 09-20)

### Directory Migration

- Business domains were unified into `src/features/*`, deleting the old top-level `agent/chat/settings/ssh/files/search/terminal` and `stores/`.
- Generic UI, platform adaptation, protocols, configuration, and utilities were pushed down into `ui/`, `platform/`, `core/`, `config/`, and `utils/` respectively.
- The compatibility layers `components/`, `downloads/`, `hooks/`, `theme/`, `widgets/`, `shared/`, and `entities/` were all removed.
- App startup, Provider, root layout, global commands, and the development entry point were all consolidated under `app/`.

### Boundaries and Quality

- Added the stable aliases `@app`, `@features`, `@platform`, `@core`, `@ui`, `@config`, `@utils`, `@i18n`.
- Architecture guardrails upgraded: old directories, reverse dependencies from lower layers, and Store penetration from the view layer are forbidden.
- Coverage scope switched to the new directory structure, and tests for the SSH Store and search history Store were filled in.
- Search history state corrected so that both in memory and persisted, at most 20 entries are retained.

### Verification

- TypeScript strict passes.
- Architecture check passes.
- Unit tests: 100 files passed, 1 skipped; 652 test cases passed, 1 skipped.
- Coverage: Statements 86.68%, Branches 75.08%, Functions 86.73%, Lines 89.29%.
- Production build passes; splitting large bundles is kept as a follow-up performance task.

---

## Current Status and Next Steps

- **Current architecture** (see `docs/architecture.md` for details): PTY output → **Rust StreamScanner synchronous scan** (`src-tauri/src/terminal/scan.rs`) → SessionController three-scene state machine (driven by OSC 133) → one offscreen xterm per executing block, extracting an outputHtml snapshot on completion → scene-driven UI. When split, each pane has its own controller; the two open modes, classic/block, can be configured per shell.
- **Tech stack**: Tauri 2 (Rust) + React 19 + TypeScript + Vite; terminal `@xterm/xterm`; state zustand; AI SDK (BYOK multi-provider, Anthropic/Gemini/OpenAI-compatible) + react-markdown + KaTeX; tests vitest + Playwright.
- **TODO**: SSH TOFU user confirmation (see `docs/security-review.md`) is implemented; continue filling in the backlog according to the feature list.
- **Compliance**: for third-party dependency license notices, see `NOTICE`.
