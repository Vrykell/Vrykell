# Vrykell Pitfalls

> Compiled from git history (140+ commits, 2026-07 → 2026-09) and in-code comments.
> Each entry tries to give: **Symptom → Root cause → Conclusion/Fix**, and cites the source commit, for archaeology and regression.
> Category navigation: [Strategic](#1-strategic-pitfalls) · [Terminal emulation](#2-terminal-emulation--vt-parsing) · [PTY/resize](#3-pty--resize--dimensions) · [Character width](#4-character-width--rendering) · [Scrolling/viewport](#5-scrolling--viewport) · [Cross-platform](#6-cross-platform) · [Tauri/Rust](#7-tauri--ipc--rust-backend) · [Persistence](#8-sqlite--persistence) · [Security](#9-security) · [React/state](#10-react--zustand-frontend-state) · [AI/streaming](#11-ai--llm--streaming) · [Rich content](#12-rich-content--latexmarkdown) · [Testing](#13-testing) · [Process management](#14-process-management) · [UI/interaction](#15-ui--interaction)

---

## 1. Strategic Pitfalls

### 1.1 Electron `require('electron')` Bug — the Entire Tech Stack Scrapped (`05c9d07` → `260bf48`)
- **Symptom**: v0.1.0's source code was finished, but under Electron 28~32 `require('electron')` returns a path string instead of the API object, the app can't start, and there's no fix on any platform (Electron issue #49034).
- **Lesson**: betting the critical path on a known and unfixable upstream bug is fatal. Post-install patches, an ESM→CJS bridge (`main-wrapper.mjs`), and module-resolution patches were all tried, and all failed.
- **Conclusion**: migrated entirely to Tauri 2 (Rust backend + system WebView), reusing ~85% of the frontend. After the migration, all Electron remnants, debug scripts, and the `sdk/` placeholder directory were deleted (`5256b25`, `87804b2`).

### 1.2 Home-Grown Terminal Emulator — Abandoned After Two Rewrites (Phase 2 → `9557cc0`/`78be803`/`6459ab1` → v2 falls back to xterm.js)
- **Process**: first `TerminalBuffer + react-virtuoso` was used to replace xterm.js, then a complete CSI parser was written from scratch, then the buffer was rewritten as a VT screen model (screen + scrollback), implementing the DEC 1047/1048/1049 alt screen. Each round fixed one batch of artifacts and produced a fresh one (see the many entries in §2 and §4 — most of those pitfalls were hit precisely during the home-grown period).
- **Conclusion**: written into Development Rules item 12, "**home-grown terminal emulators are forbidden**"; v2 delegates to xterm.js, with the constraint that "xterm.js is invisible" (it only does PTY session management and VT parsing; the UI is a Block list). That approach was archived to `archive/v1-dom-terminal`.
- **Lesson**: a terminal emulator is an exercise in "reconciling the line-accounting models of countless TUIs": wide characters, pendingWrap, alt screen, reflow, and resize semantics can each independently create ghost bugs, and three rounds of patches can only narrow the problem, never eliminate it (the words of `6459ab1`).

### 1.3 Build Artifacts Committed — 3.1GB Cleaned Up in One Go (`161d8f1`)
- **Symptom**: `dist/` and `target/` were committed to the repository, 3.1GB in total.
- **Conclusion**: added `target/`, `gen/`, and `test-results/` to `.gitignore`; `package-lock.json` was corrected the other way round to **must** be committed (it had once been wrongly ignored, `87804b2`).

---

## 2. Terminal Emulation / VT Parsing

> Most of this section is pitfalls hit during the v1 home-grown period; after v2 switched to xterm.js they are kept as a footnote to "why not build it ourselves".

### 2.1 A Single lines Array + an Absolute Cursor = Permanently Out of Sync with TUI Accounting (`6459ab1`)
- **Symptom**: TUIs (Claude Code etc.) showed leftover characters, misalignment, and ghost cursors, and three rounds of patches could only mitigate it.
- **Root cause**: the buffer was "one ever-growing lines array + an absolute cursor". CUP addressed into the scrollback rather than the screen; CUD clamped to 9999 instead of rows-1; there was no bottom-line scrolling. For any TUI that uses absolute positioning/scrolling erase, its line accounting is bound to fall out of sync with ours — this is the structural root cause.
- **Fix**: rewritten as a VT screen model: the screen is always rows lines, the cursor is screen-relative, LF at the bottom line scrolls the top line into the scrollback (or discards it on the alt screen), and ED 0/2/3 is layered per xterm semantics.

### 2.2 Unknown Escape Sequences "Mistranslated" as Valid Sequences (`d4335f3`)
- **Symptom**: TUI output had scattered characters, multiple cursors, and underlines appearing out of nowhere.
- **Root cause**: the parser translated three kinds of unrecognized sequences into **different valid sequences**:
  - `ESC ( B` (charset designation) only skipped the designator byte, so the final `B` leaked into the text stream;
  - `CSI > 4 m` (xterm modifyOtherKeys) was treated as SGR(4), underlining all subsequent text;
  - `CSI < u` / `CSI > u` (extended keyboard protocol) was treated as RestoreCursor, teleporting the cursor to a stale position — this was the real culprit behind the broken-up Claude frames and the "multiple cursors".
- **Fix**: CSIs with a `> < =` parameter prefix are ignored entirely; charset designation skips two bytes; `ESC 7/8` maps correctly to Save/RestoreCursor; ITU colon subparameters (`SGR 38:5:220`) are treated as semicolons. **And an end-to-end replay test using a real captured Claude Code startup frame (100×30) asserts zero garbage.**
- **Lesson**: for a parser, "explicitly ignore" beats "best-effort guess"; mistranslation is far more harmful than discarding.

### 2.3 ED (erase display) Truncating the lines Array Dropped Lines (`1a403c7`)
- **Root cause**: the ED implementation truncated the array outright instead of just clearing the cells. The same commit also found that `React.memo` was blocking re-renders — the cells were mutated in place and the reference didn't change, so memo decided there was "no update".
- **Lesson**: using `React.memo`/shallow comparison on mutable data structures is a hidden time bomb.

### 2.4 Cursor Movement Sequences' Default Parameter Is Not 1 (`1091ad8`)
- `CSI A` (no parameter) semantically means "move up 1 line", but the implementation defaulted it to 0, misaligning the spinner's redraw.

### 2.5 While the alt screen Is Active, the Main Scrollback Is Still Concatenated into the Display (`f11a121`)
- **Symptom**: after entering a full-screen TUI, the shell history was still shown above the TUI, so it "didn't look full-screen".
- **Root cause**: `buffer.lines` always returned scrollback + screen.
- **Fix**: while altActive, expose only the alt screen, restoring it on exit (xterm semantics).

### 2.6 resize Only Clamped the Cursor and Didn't reflow → Historical Output Kept Its Old Line Breaks Forever (`2f52a0c`)
- This required tracking the soft-wrap chain on `TerminalLine.wrapped`, and on a width change doing a logical reflow: merge and re-split the chain, don't split wide characters, keep hard line breaks, and have the cursor follow the logical position.
- **Later reversal**: in late v1 this was changed again to **no-rewrap resize (xterm semantics)** (`529ca65`) — the "redraw N lines upward" accounting of self-repainting TUIs depends on a constant line count and reflow breaks it; over-long lines were instead clipped at render time (`b732817`). Each of the two semantics suits its own target, and the final choice sided with xterm and mainstream terminal behavior.

### 2.7 Wide Characters Double Line-Feeding + the wrapped Flag Poisoned (`123f515`)
- **Symptom**: after dragging the window repeatedly, the TUI screen was duplicated/misaligned.
- **Root cause** (three overlapping issues):
  1. When a wide character (CJK/emoji) followed a full line at pendingWrap, `putChar` triggered `lf()` twice — once in the wide-character edge branch and once in the pendingWrap block — and the ghost blank line pushed all subsequent lines down;
  2. the wide-character edge branch marked the new line `wrapped=true` even when the source line was very short (clamped over by a dimension-mismatched CUP/CHA), poisoning reflow into merging two unrelated lines ("Welcome back! back!");
  3. `resize()` dropped pendingWrap for lines that were "full but had padding" (the restore check trims trailing whitespace — but for TUIs that whitespace is content that was written).
- **Lesson**: pendingWrap must be handled before all other branches; "trailing whitespace" is disposable to a shell but is content to a TUI.

### 2.8 Full-Screen TUI Output Polluting the Command Block History (`d9ae0e1`)
- **Symptom**: after exiting vi/htop, a whole screen of frozen output was left in the block history.
- **Fix**: removed the logic that "back-filled the block with the alt buffer's final screen"; the block keeps only the shell output after teardown.

### 2.9 DSR Queries Silently Dropped → the PowerShell Prompt Never Appears (`b2ab619`)
- **Symptom**: on startup PSReadLine emits `CSI 6 n` (report cursor position) and **blocks waiting** for the terminal to reply `CSI row;col R`; the parser didn't recognize `CSI n` and dropped it outright → the prompt didn't render and input wasn't echoed, so it looked like "PowerShell had hung".
- **Fix**: added `TerminalEvent::Dsr`, and the frontend replies with the cursor position (dsr 6) / terminal-ok (dsr 5).
- **Lesson**: "silently dropping unknown sequences" is a deadlock for query-type sequences (DSR/DA); the same commit also fixed "a read error silently breaking the loop" and "treating an empty `$SHELL` as valid".

### 2.10 An alt screen combined with other DEC private modes polluting the block history again
- **Symptom**: after force-killing a TUI that enables the alt screen in the same CSI as other modes (for example `\x1b[?1049;2004h`), a whole screen of TUI output still appears in the block history.
- **Root cause**: the scanner matched whole strings such as `\x1b[?1049h` exactly, so a combined sequence passed through untouched into the running block's xterm, which switched to its own alternate buffer; the snapshot taken on command end then read that active buffer.
- **Fix**: the scanner inspects every parameter instead (final byte `h`/`l` plus a 1049/1047/47 parameter), while the full raw sequence is still written to the main xterm so the other modes (bracketed paste and the like) keep their effect. The Rust scanner, the front-end test mirror and the e2e mock stay in step.

### 2.11 A manual fullscreen overlay fighting a real alt screen for the surface → a black full-screen TUI (`useTerminalSession.ts`, `onSceneChanged`)
- **Symptom**: the user first presses "Enter fullscreen interaction" on a running block; when the program then switches to the alternate buffer (cmdc/vim and the like) the whole pane goes black, and "Redraw terminal" appears to do nothing (it repaints the hidden main xterm and a block terminal that receives no output).
- **Root cause**: bytes from a real alt buffer are written only to the main xterm (`routeData` → `sinks.writeMain`), while the manual fullscreen is exactly what hides the main xterm (`showXterm = scene==='altScreen' && !altScreenActive`) in favour of the block terminal. The old code only "did not set" the manual-fullscreen flag on a scene change — it **never cleared the one already in effect**, so the overlay kept covering the live TUI.
- **Fix**: when the controller reports a real `altScreen` for a pane that is manually fullscreened, hand the surface back immediately (`setAltScreenActive(false)`, diagnostic marker `manual-fullscreen-cancelled`). Regression coverage: `running-term.spec.ts` ("a real alt screen under a manual fullscreen") and the matching `useTerminalSession.test.tsx` case.

### 2.12 Image paste routed through `term.paste()` → bracketed paste turns the key into text (`terminalClipboard.ts`)
- **Symptom**: with an image on the clipboard, Ctrl+V in the terminal never reaches the foreground CLI (Claude Code, cmdc and friends), so the image is not attached. The log line `terminal-clipboard-paste` reads `image:true, chars:0` — detection is fine; the transport is what breaks.
- **Root cause**: `term.paste()` means "write **pasted text**": when the foreground program enabled bracketed paste (DECSET 2004, which real CLIs do), xterm wraps the payload in `\x1b[200~…\x1b[201~`. The image path sends a **key** (`\x16`, Ctrl+V), and once wrapped the program only sees a pasted text character.
- **Fix**: the image path bypasses the terminal and writes `ptyWrite(sessionId, '\x16')` directly; text keeps going through `term.paste()` so bracketed paste and line-ending normalization survive. Regression coverage: `terminal-paste-focus.spec.ts` now enables `\x1b[?2004h` in the TUI and asserts the PTY receives the bare `\x16` (reverting to `paste()` yields `\x1b[200~\x16\x1b[201~` and fails); `terminalClipboard.test.ts` gained the "a registered terminal instance must still get a raw write" case — the old test only covered the no-terminal fallback, which is why it stayed green.

### 2.13 A whole paste as one `pty_write` → the interrupt queues behind all of it (`terminalWriteQueue.ts`)
- **Symptom**: after pasting a large block the terminal looks stuck: Ctrl+C does nothing until the whole payload has been written, and with a foreground program that never reads stdin it never happens at all.
- **Root cause**: `term.paste()` fires one `onData`, which sent one `ptyWrite`. On the Rust side `write_all` does not return until the consumer has taken the whole payload and holds the writer lock meanwhile, so every later write of that session — `\x03` included — waits behind it. The IPC payload and the blocking thread grow with the paste too.
- **Fix**: terminal input goes through `terminalWriteQueue` (16K code units per chunk, split on code points, serialized per session): a slow consumer only holds back the chunk in flight, and `\x03` drops the unsent remainder before it is queued. Multi-line and over-64K pastes ask first through `PasteConfirmHost`. Regression coverage: `terminalWriteQueue.test.ts`, `terminalClipboard.test.ts`, `PasteConfirmHost.test.tsx`, `terminal-paste-large.spec.ts`.
- **Lesson**: "one action, one write" is fine while the payload is small, but once the user decides the size it wrecks cancellation — being interruptible requires the write itself to be divisible.

### 2.14 One log record per output chunk → a full-screen TUI writes megabytes per minute (`io_window.rs`, `sessionController.ts`, `useTerminalSession.ts`)
- **Symptom**: a full-screen CLI session inflates the log by megabytes per minute — one 4.5-minute session wrote 87,919 records / 23.9 MB at ~420 records/s in busy seconds (876/s at the peak) and five to seven records per output chunk (`read-chunk`, `output`, `pty-output`, `controller-events`, `route-data`); the diagnostics writer lagged 1.5 s behind at p95 (36 ms median), and another 13-minute session reached 84 MB. During a 3.8 MB paste the input-to-next-paint gaps reached 6.3 s / 12.3 s / 10.2 s — part of the "frozen" feel was the logging itself, and the flood also pushed the useful records out of the in-memory ring.
- **Root cause**: one output chunk was counted at five stages while the chunk rate is decided by the foreground program (a full-screen app sends one per frame), so log volume tracked the frame rate: whoever runs a TUI writes the log dry.
- **Fix**: both halves aggregate into a one-second window. Rust `pty-io` (`reads/read_bytes/chars/max_read/outputs/events/data_bytes/osc/alt/held/max_gap_ms`) replaces `read-chunk` + `output` + `input-response-batch`; the frontend `terminal-io` record sums rx (IPC intake), ctl (controller intake) and the routing destinations (chunks and characters for main / block / early, `maxChars`, command-echo filtering). A stall no longer has to be inferred from missing records: silence is written as `read-idle` at 1 s, 2 s, 4 s, … Regression coverage: `io_window.rs` unit tests, `terminalIoLog.test.ts`.
- **Lesson**: pick the logging granularity from whoever decides the event rate; recording user-sized data chunk by chunk hands the log size to the user.

### 2.15 The identity package's `Application` pointing at the app itself → Windows terminates the running app on a right-click in Explorer (`AppxManifest.xml`, `shell_host.cpp`, `manage.ps1`)
- **Symptom**: while the app was in use (a TUI streaming in a terminal, the log rolling normally), **right-clicking a folder in Explorer** — before even choosing the menu entry — made the whole window **vanish** and the process exit cleanly: no crash entry in the Windows event log, and the app's own diagnostics stop at the instant of death. `Microsoft-Windows-AppModel-Runtime/Admin` lines up with it: the right-click creates an AppX activation (Id 210/211), that activation is terminated a second later (Id 217), and the running app dies at Id 217. Reproduced from PowerShell by triggering the package's COM server activation (`[Activator]::CreateInstance(GetTypeFromCLSID('{8D41BA19-…}'))`): **every** `vrykell.exe` process disappeared at once, including debug instances in other worktrees.
- **Root cause**: an identity manifest needs an `<Application>` to carry `windows.fileExplorerContextMenus`, and it declared `Executable="vrykell.exe"` — **the application's own executable**. Windows therefore treated **any** process with that image name as the package's app (`FinishPackageActivation` events even cover debug builds at different paths); when the shell extension's COM activation ends, the AppModel terminates the package's app processes — so a right-click (load the extension, release it) was enough to kill the app in use. Because every instance also shares one WebView2 user data folder (one browser process), the killed instance took the others with it.
- **Fix**: the identity package gets a dedicated host, `windows-context-menu\VrykellShellHost.exe` (`shell_host.cpp`, which only forwards a launch and holds no product logic); the manifest's `<Application Executable>` points at it and the application's own exe stays outside the package identity. Three regression guards: `prepare-context-menu.mjs` refuses to package a manifest that does not declare the host, `manage.ps1` treats "declares another executable" as `available=false` (and refuses to enable), and `scripts/test-context-menu.ps1` asserts the post-enable `available`/`stale` state. `manage.ps1` also prunes content-addressed extension DLLs the current package does not use and reports `stale` when the registration points at another bundle or executable, so the settings page asks for a re-registration (an updated application must re-register or it keeps loading the old extension).
- **Follow-up**: moving `<Application Executable>` to the host left the matching `<msix>` identity in the main application's embedded `application.manifest`, while the host had none. Native manifest metadata is another path to package identity, so the main process could still acquire the shell package identity. Remove that metadata from the main manifest, embed it through `shell_host.manifest` in the host target, and reject shell identity in the main build. `contextMenuIdentity.test.ts` checks both manifests and the host build wiring without activating COM or launching the app. This follow-up was identified statically; a live right-click was deliberately avoided because it could terminate the agent's own application.
- **Lesson**: isolate both the package's `<Application Executable>` and the executable's embedded `<msix>` metadata. A dedicated host alone does not isolate the main process while its native manifest still requests the shell package identity. Multi-instance use under a shared browser process can also spread the effect of process termination.

---

## 3. PTY / resize / Dimensions

### 3.1 Adding and Reverting the resize debounce — Symptom Treatment vs Root Cause (`83913b6` → `9f7e8ae` revert → `9966540`)
- **First version**: ResizeObserver fired resizePTY on every pixel change, flooding SIGWINCH, and text wrapped at the old column width → added a 200ms debounce.
- **Reversal**: the debounce was reverted. The true root cause was **in-flight output mismatched with the buffer dimensions**: while dragging the window, output already on the IPC path had been generated at the old width but was applied to the new, already-resized buffer, so its wrapping didn't match the writer's intent, and the phantom lines permanently desynced the TUI's frame accounting.
- **Final fix**: Rust **tags every `pty:output` batch with the cols/rows at generation time** (per-session dimensions are updated atomically, written only after the PTY resize succeeds); before applying an event the frontend first resizes the buffer to the batch's tag value, and it no longer resizes the buffer directly in onResize.
- **Lesson**: "which dimensions the output belongs to" must flow with the data, rather than each end guessing the timing on its own.

### 3.2 Initial PTY Dimensions Used the 80×24 Default → the First Frame Was Already a Mess (`cb346f7`)
- **Root cause**: because of the 380px AI sidebar, only ~60 columns were actually visible in the terminal area, yet Claude rendered at 80 columns → every line wrapped → characters scattered.
- **Fix**: estimate cols as `(windowWidth - 390) / 8.4`, then fine-tune once the ResizeObserver mounts.
- **Pitfall within a pitfall later on**: the estimate unconditionally subtracted 390px, but the sidebar starts collapsed → the first frame was again ~40 columns too narrow (incidentally fixed in `69061f4`); later still, a blockList scene card was ~50px narrower than the main surface, so full-width output was clipped at the card's right edge (see the scene-aware width comment in `useTerminalSession.ts`).

### 3.3 After resize, CUP/CHA Didn't Clamp the Target Column (`f0f7eac`, `d94903d`)
- **Symptom**: after going from 120 → 60 columns, a TUI positioned with `CUP 10;80`, and `putChar` padded the line with spaces out to 80 columns → characters scattered.
- **Two rounds of fixes**: first clamp `cx`, then discover that the CUP/CHA target column **likewise** had to be clamped, and that it had to be fixed on **both paths** — the structured events and the `write()` CSI table.
- **Lesson**: when the same semantics are implemented on multiple code paths, fixing a bug requires searching out every path.

### 3.4 A Collapsed Panel's Host Width Read as 0 → the PTY Squeezed Down to 2 Columns (`useTerminalSession.ts` comment; Phase 8 "full-screen TUI width collapses to 2 columns")
- **Root cause**: the mirrored scene state (synced via onSceneChanged) lagged behind the store — manual full-screen only wrote `store.scene` without calling back, so the local mirror stayed at blockList and took the card-width branch, while the host had `clientWidth≈0` when `display:none`.
- **Fix**: take the store's scene as authoritative; when the host width is ≤0, fall back to the main xterm's full width and correct once the ResizeObserver settles.
- **Related**: the same applies to a blank split pane — the PTY started at 0×0 → fall back to 80×24 (Phase 10).

### 3.5 pty_write Holding the Lock for Blocking Writes → the "End" Button Also Hangs When the Buffer Is Full (`code-audit.md`, high priority)
- **Symptom**: a write held the session lock with no timeout, so when the PTY buffer filled up every operation on that session (kill included) hung; those commands were synchronous (main thread), so the whole UI froze and force-quitting the app was the only way out.
- **Root cause**: one session lock was shared by a write that may block indefinitely and by resize / close / kill, and the latter three ran synchronously on the main thread.
- **Fix**: the writer moved out of the session lock into its own `Arc<Mutex<..>>`, so a blocking write never occupies it; `pty_resize` / `pty_close` / `pty_kill_foreground` became `async` + `spawn_blocking` so a blocking pseudo-console call no longer runs on the main thread.
- **Evidence**: 233 logged writes were all ≤1ms while `pty_resize` reached 542ms and `pty_close` 667ms - the stalls are those calls themselves. The regression test `session_lock_stays_free_while_a_write_is_stuck` (real PTY + a child that never reads stdin + an 8 MiB write) shows the session lock is available in 800ns while the write is stuck, and fails with a 3s timeout once the write is put back under the session lock.
- **Related**: the first press of "end" sends Ctrl+C, which is input written to stdin and cannot be delivered while a stuck write holds that channel - it now waits at most 1s and then reports an actionable error (pressing again inside the escalation window escalates to a kill).

### 3.6 GUI Startup Missing TERM/COLORTERM → TUI Apps Hang (`4c4f15a`)
- **Symptom**: launching from Finder/Dock left `TERM` empty, zsh degraded to dumb, and full-screen TUIs that rely on terminal capability detection (truecolor apps) hung/went black. Launching from a terminal was fine — **only the GUI cold-start path reproduces it**.
- **Fix**: in `pty_spawn`, if either is empty, fill in `xterm-256color` + truecolor, with an explicit user setting taking precedence.

### 3.7 GUI Startup Missing User bin Directories → PATH Inconsistent with a Terminal (Phase 14, `pty.rs` `merge_user_bin_paths`)
- The GUI process doesn't go through a login shell, so `/usr/local/bin` and the Homebrew directories aren't on PATH. Fixed by merging them in while preserving the inherited PATH and de-duplicating.

---

### 3.8 Blank frames during canvas resizing

Fitting that clears the renderer before resizing causes an additional blank frame. A canvas size change also clears its pixels before the scheduled repaint. Keep those operations in the shared resize adapter and finish the resized repaint before presenting the frame. The synchronous repaint uses a version-sensitive renderer capability guarded in that adapter. Do not delay input or add a long resize debounce. Send the first PTY size immediately, skip duplicate dimensions and retain only the latest pending size while IPC is busy. Log `terminal-resize-frame` geometry and `terminal-input-render-complete` timing to distinguish layout shifts from output or paint latency.


## 4. Character Width / Rendering

### 4.1 A Hand-Written charWidth Table Inconsistent with the TUI's string-width Accounting → the Cursor Split in Two (`69061f4`, `3eb3b7e`)
- **Symptom one**: zero-width modifiers (VS16 U+FE0F, ZWJ, combining marks) were counted as 1 column and written into the cell → rendering `?` garbage.
- **Symptom two**: emoji presentation characters (✨ ⏸) were counted as 1 column while the TUI counted 2 → the whole line shifted right and phantom wraps appeared, and the TUI's erase-lines redraw could never clear the old frame (a 96-column welcome box ghost remained even after a 140-column redraw).
- **Symptom three**: the hand-picked BMP emoji ranges missed `▶ ◀ ⚠ © ® ™` (which string-width counts as 2 columns), and each miss undercounted the line by 1 column → a line the TUI padded to exactly cols became cols+1 for us → wrapping → an inserted phantom line that "split the cursor in two".
- **Final fix**: **stop hand-writing it** — measure every emoji code point with string-width@7 to generate the authoritative table, and lock both sides down with tests (2 columns: ▶◀⚠©®™; 1 column: ❯●⧉←·✘✦); `©®` sit below the CJK cutoff and must be checked **before** the `< 0x1100` early return. Also added dev-mode wrap forensics: any automatic line wrap inside the alt screen (TUI frames should never wrap) console.warns the code points at the end of the line.
- **Lesson**: when sharing "column count" as an accounting unit with an external program, the width table must come from the same authoritative implementation; hand-picking will always miss something.

### 4.2 xterm cellWidth Differs from Browser Font Rendering by ~4% → Wrapping Right When a Block Ends (`c39e74e`)
- **Symptom**: a running block was perfectly fine, but the snapshot wrapped the **instant the command ended**.
- **Root cause**: the live terminal canvas lays out by xterm cellWidth (≈8.16px), while the finished block's HTML snapshot renders with browser fonts (≈8.43px). At the same column count the snapshot is wider than the card.
- **Fix**: the blockList scene now determines the column count from the character width measured in the DOM (a probe span of 100 'W's averaged and cached); manual full-screen (pure canvas) still uses cellWidth.

### 4.3 xterm Has No Public API for Dimensions, Only the Private `_core._renderService.dimensions` (`lib/termMetrics.ts`)
- This private access used to be inlined in three places, so upgrading xterm required syncing several spots → consolidated into a single point, `getCellMetrics()`, which falls back to defaults (7.8/14) when it can't read them. **This private path needs regression verification when upgrading xterm.**

### 4.4 Horizontal Seams on Half-Block Characters in the DOM renderer (`useTerminalSession.ts` WebglAddon comment; `3d6b4fb`)
- **Root cause**: the DOM renderer lays out CSS line boxes by font baseline, so `▀▄` half-block characters inevitably leave a seam between adjacent lines (TUI icons/dialogs showed horizontal cracks).
- **Fix**: the WebGL renderer aligns exactly by cell; when WKWebView has no WebGL, a try/catch falls back to the DOM renderer (in a GPU-less environment the seam **cannot be eliminated** and simply has to be accepted).

### 4.5 Content Sniffing of Block Output Snapshots Misfiring (`TerminalBlockList.test.tsx` regression comment)
- The old logic sniffed HTML with `includes('<span')`, which misjudged unstyled multi-line output (`file1<br>file2`) as plain text → rendering a visible `&lt;br&gt;` garbled string. The sniffing signature must cover the generator's entire structure (counting br too).

### 4.6 Over-Long Lines Not Clipped → Wrapped box-drawing Lines Broke the Whole Grid (`b732817`)
- After a no-rewrap resize, retained lines can exceed the visible column count; the box-drawing render path didn't set `whiteSpace`, so an over-long line wrapped onto a second visual line and the entire grid desynced. Every render path now uses `end = min(contentEnd, cols)` + `overflow:hidden` + fixed height.

### 4.7 Estimated Snapshot Row Height from a Font-Size Formula → Reverse-Video / Block Art Overlapped Row by Row (`terminalFont.ts` `measureTerminalDomCellHeight`)
- **Symptom**: the startup logo of a TUI CLI (Command Code, for instance) paints whole rows with **reverse-video spaces**; in the **completed block history** it degrades into a stack of overlapping bars, while the same program renders correctly in another terminal.
- **Root cause**: one grid, two sources of size. The live canvas uses xterm's measured cell height (`getCellMetrics().height` — **20px** at a 14px font); the completed block's `outputHtml` snapshot uses the CSS variable `--terminal-row-height`, which came from the font-size formula `ceil(fontSize * 16/14 * lineHeight)` (**16px** at the same settings). Four pixels apart: a 20px-tall painted row lands in a 16px line pitch, so the next row's background covers the bottom of the previous row's glyphs and the artwork is sliced into bands. Plain text hides it — only fully painted rows expose it.
- **Fix**: `--terminal-row-height` is now **measured from the resolved font**: `floor(natural line box × lineHeight)` — the same derivation xterm uses (verified against a matrix of 8 font sizes × 3 line heights). The terminal layer publishes it when fonts finish loading and when typography changes; the formula survives only as a fallback where no measuring DOM exists (unit tests). `config/typography.ts` no longer guesses the value.
- **Residual risk (not fixed)**: East Asian "ambiguous width" characters (`█▀▄─│`, U+2580–259F) render as **full-width** glyphs in the browser (measured 14px = 2 cells) while xterm accounts for them as one cell (`getCell().getWidth() === 1`). A TUI that draws with block characters therefore overflows the row and wraps in a snapshot; the CLI in this report paints with reverse-video spaces and never triggers it. Fixing it means forcing the cell advance inside the snapshot (or changing the font stack) — far larger blast radius than this row-height change, so it is left as a separate change.
- **Lesson**: a row height is not "font size × a factor". A terminal is a grid, so the size must come from the same measurement as the canvas; wherever a canvas and the DOM have to reproduce one grid, neither may derive it from a formula of its own.

### 4.8 The Preedit Mirror Carries No Caret and Covers the Block Cursor — Composing Text Shows No Insertion Point; Once Newer Terminal Builds Lay It Out Right-to-Left, an In-Flow `::after` Lands Before the Text (`theme.css` composition-view rules, `terminal-ime-restore.spec.ts`)
- **Symptom**: while an East Asian IME composes (pinyin preedit "ni'hao") the terminal shows the preedit with no cursor after it; outside composition the block cursor in the same cell is visible.
- **Root cause**: the preedit is drawn by the parser's own mirror layer (`.composition-view`), which has no caret element, while the native caret lives in the hidden helper textarea — and that one has to stay `opacity: 0`, otherwise the terminal paints the text twice. The mirror is anchored on the block cursor's cell with an opaque background, so it hides the block cursor and the visible insertion point goes with it.
- **Fix**: while the mirror is active, reserve one cell at the box edge in the inline direction (`padding-right: 1ch`) and paint an absolutely positioned `::after` block in the terminal cursor colour, blinking on the renderer's one-second cycle.
- **Trap**: newer terminal builds lay the mirror out with `direction: rtl` (so a long preedit keeps its end visible). An **in-flow** `::after` is then ordered by the bidi algorithm *before* the text, which reads as a caret in front of the preedit; only an absolutely positioned caret against the **physical** right edge (`right: 0` plus the reserved cell) holds in both writing directions.
- **Regression**: `terminal-ime-restore.spec.ts` keeps a caret after an active preedit, asserting the preedit text, the caret styles and the pixels (the caret cell must not equal an empty cell).

### 4.9 One Terminal Clearing the Shared WebGL Glyph Atlas → Every Other Terminal Keeps Drawing Garbled Rows (`terminalRepaint.ts`, `terminalResize.ts`, `xtermRenderer.ts`; upstream xtermjs/xterm.js#6014, #6042, #6055)
- **Symptom**: a long-running fullscreen TUI (heavy CJK text) occasionally garbles: **some rows show a different piece of text printed on top of them** while others stay correct; the redraw action restores the screen immediately; the more text on screen, the more likely it triggers.
- **Root cause** (three layers):
  1. Terminals with the same font, theme, device pixel ratio and cell metrics **share one glyph atlas** (the render layer caches atlases by config). Every pane terminal and every running-block terminal in this app happens to match, so a dozen canvases draw from one GPU atlas.
  2. `term.clearTextureAtlas()` clears that **shared** atlas (all pages plus both glyph caches) but only rebuilds the vertex data of **the renderer that called it**; stable 0.19.0 tells no other renderer (upstream #6014, fixed only in the 7.0 milestone by #6042/#6055). The other terminals still hold glyph coordinates into the pages that were just emptied, so their next frame samples **whatever glyphs another terminal has written there since** — wrong glyphs and overprinting rather than blank cells.
  3. A fullscreen TUI rewrites only the lines that changed, so untouched rows are never rebuilt: the corruption **does not heal** until that terminal gets a full refresh (manual redraw, resize or a tab return).
- **Amplifiers**: the old code ran the atlas clear inside **single-terminal** repaints, and there are many repaint entry points that step on each other — tab switches and pane re-shows, `visibilitychange` (one listener per terminal, so the last terminal to finish wins and **every terminal before it is left garbled**), running-block terminal mounts (once per command start) and the manual redraw itself (main terminal first, block terminal second — the block clears the atlas the main just rebuilt). The more text there is, the more atlas slots are in use, and the more likely a cleared slot is refilled with a different glyph: that is the "more text, more likely" effect.
- **Fix**: atlas-level work is one **app-wide operation**, `resetTerminalSurfaces()` (`terminalRepaint.ts`): clear the shared atlas once, then refresh **every live terminal** in the same tick (pane terminals plus running-block terminals registered through `registerBlockTerminal`). The ordinary repaint (`repaintTerminal()`) only calls `refresh` and **never clears the atlas**, and the per-terminal `visibilitychange` listeners coalesce into one reset via `recoverTerminalSurfaces()`. The dependencies moved to the versions carrying the upstream fix (`@xterm/xterm` 6.1.0-beta, `@xterm/addon-webgl` 0.20.0-beta: `clearTexture()` bumps `pageLayoutVersion` and every renderer compares it for itself). Diagnostics marker: `terminal-atlas-reset` (reason, paneId, rendererRebuilds, terminals).
- **Lesson**: invalidation of a shared GPU resource has to follow an app-wide lifecycle; an action that "repairs me" must not break everyone else behind its back.

### 4.10 WebGL Contexts Are Borrowed, Never Returned → Random Terminals Garble at the Cap (`xtermRenderer.ts`; upstream xtermjs/xterm.js#6068)
- **Symptom**: intermittent blank or garbled content on a terminal the user **never touched**, with "Too many active WebGL contexts" in the console.
- **Root cause**: the WebGL addon's `dispose()` removes the canvas but does **not** release the WebGL2 context. A browser caps live contexts per document (around 16) and drops the **oldest live one** once the cap is exceeded — which can belong to any terminal in normal use. Every manual redraw (a dom→webgl rebuild), renderer preference change and running-block teardown in this app used to burn one.
- **Fix**: `xtermRenderer.ts` hands the context back explicitly whenever a renderer is dropped (`WEBGL_lose_context.loseContext()`, ignored when the extension is missing or the context is already gone) and releases it before a terminal is disposed; the `terminal-webgl-context-released` marker records how many were handed back.
- **Lesson**: GPU resources must be returned explicitly; `dispose` is not release.

---

## 5. Scrolling / Viewport

### 5.1 The "Typing Jumps the Viewport" Plague — the Real Culprit Was a Hidden textarea Inside the Scroll Container (`cf40d69`, after two rounds of misdiagnosis in `05004f4`/`5fdee90`)
- **Symptom**: the viewport teleported when typing characters, and it couldn't be fixed for a long time.
- **Misdiagnosis one** (`05004f4`, never reached dev): thought it was the nearBottom override logic.
- **Misdiagnosis two** (`5fdee90`): the nearBottom clause snapped the render slice within 5 lines of the bottom to maxScroll (so any re-render teleported the viewport) — fixed that, then added a 150ms typing guard to onScroll to roll back the down-scroll. Still not the root cause.
- **True root cause**: the IME/keyboard-hidden textarea was placed **inside the virtual scroll container**, anchored with `bottom:(lines-1-cy)*LH`. An absolutely positioned child's `bottom` resolves relative to the scroller's **padding box (≈the first screen)** rather than its content → with a long scrollback the textarea hovered hundreds of pixels above the cursor's intended position, and Chromium's per-keystroke scroll-caret-into-view teleported the viewport there. **No JS wrote scrollTop at all** (confirmed by reproducing in real Chromium with a setter trap).
- **Fix**: moved the textarea to a non-scrolling wrapper using viewport-relative coordinates (`top = cy*LH - scrollTop`); the IME candidate window still follows the cursor. Added a Playwright regression (scroll up and type; scrollTop must not move).
- **Lesson**: "the browser scrolled it itself" is also a scroll source; never put an input element inside a scroll container.

### 5.2 When the Container Grew Taller, scrollTop Fell Out of Step with the Render Slice (`1be4bdb`)
- **Root cause**: the window grew taller → maxScroll shrank, but the element's actual scrollTop kept the old large value while the render computed the slice from the new maxScroll → stale content appeared at the bottom. The ResizeObserver needs to re-pin scrollTop while pinned.

### 5.3 The follow-bottom Latch Wrongly Killed by a "Late scroll Event" (`useFollowBottom.ts`)
- After a snap, read back the browser-clamped actual scrollTop into a ref; if the late scroll event the browser emits as content grows is compared directly against the threshold, it wrongly concludes "the user has scrolled up". In a real browser `scrollTop=scrollHeight` is clamped to `scrollHeight-clientHeight`, and tests must simulate this behavior.

- Content growth and browser anchoring can change the offset before a resize callback; keep the following latch during layout scroll events and tolerate fractional programmatic offsets. Save the latch separately from the position across remounts, because detached output may grow before restoration. Observe the entire output wrapper. Apply committed history geometry in a layout effect and resize-observer following before paint; postponing a resize snap to another animation frame exposes a one-frame jump. Avoid estimated intrinsic heights for wrapped output, since becoming visible can change the height of the whole history tree.

### 5.4 The "Jump to Latest" Slot Shakes — Self-Oscillation When Layout Feeds Its Own Input (`c52ceb2` -> `6d012e8` -> `1c2da4f` -> `8f39e10` -> `e5e22f1` -> `cd28681` -> `f3f46e7` -> `9b5dc51`)
- **Symptom**: the AI side panel shook violently when the scrollbar was dragged to the bottom, and later it shook while just sitting there; the shake happened exactly at the slot that holds the "jump to latest reply" button.
- **Misdiagnosis chain**: "the follow logic fights the drag" (`c52ceb2`) -> "the ResizeObserver also writes scrollTop" plus "browser scroll anchoring interferes" (`1c2da4f`). Each step only reduced it. The true root cause was found after one sentence from the user: "the shake happens at the back-to-bottom button."
- **True root cause**: the follow flag flips -> the slot appears/disappears -> the transcript's height changes by ~34px -> the "at the bottom" check flips -> the follow flag flips again: **the layout feeds its own input**, so it oscillates without any outside action.
- **Fix**: (1) make the slot not affect layout (constant reserved strip, then an absolutely positioned overlay, and finally a constant padding band above the input with a 30px round button); (2) keep a single writer of scrollTop (removed the ResizeObserver write); (3) `overflow-anchor: none` to switch off browser scroll anchoring; (4) add a temporary probe first (`14753da`) and remove it once located (`80adc4f`).
- **Lesson**: any control whose appearance changes a container's height (a slot, a badge, a notice bar) that also feeds a check like "is at the bottom / is hovered" can self-oscillate. Fix it by taking it out of layout instead of tuning thresholds; a scroll container gets exactly one hand that writes scrollTop.
### 5.5 First Wheel-Up After Pre-Mount Output Jumps to the Top of the Scrollback (scrollbar model out of sync with the buffer, `TerminalBlockList.tsx` RunningTerm)
- **Symptom**: when more than a screen of output arrives within the first two seconds of a command (before the running block mounts), the first wheel-up over the live terminal collapses the view to the very top of the scrollback; the viewport leaves the bottom and new output stops following until the user scrolls back down.
- **Root cause**: the block's live terminal is written before it is opened (headless writes). While headless the render dimensions are 0, so every output scroll writes `viewport line x cell height (0) = 0` into the scrollbar model: the model stays at the top while the buffer is already at the bottom. Opening the terminal (or a size change) only updates the model's range, never its position, so the first wheel computes from position 0 and clamps there. Any real scroll after mount (even one line of output) heals it; waiting alone does not.
- **Fix**: on the first frame after mount, when the viewport is at the bottom, force two real scrolls (`scrollToTop()` + `scrollToBottom()`) so the correct position is written back; `scrollToBottom()` alone is a no-op at the bottom because it computes a zero-line delta. Scheduling sits outside the `term.element` check so the second StrictMode mount still schedules it.
- **Regression**: `running-term.spec.ts` "运行块挂载前到达的输出不破坏首次滚轮回溯".

### 5.6 The Syntax-Highlight Mirror Only Listened to the textarea's scroll Event → Typed Characters Stay Invisible When Content Grows Without Moving the Offset (`InputEditor.tsx`, `command-presentation.spec.ts`)
- **Symptom**: with "Command syntax highlighting" on, pressing Shift+Enter a few times and then typing letters shows **no** new characters, although the input really holds them (Enter still submits); with highlighting off everything looks normal.
- **Root cause**: the colored text is painted by a same-font mirror layer above the textarea, whose own text is transparent; the mirror only re-synced its scroll position from the textarea's `scroll` event. Once the content passes the capped height (120px) the caret line is still inside the viewport, so further typing does **not** change `scrollTop` and fires no scroll event; the mirror content had already grown but stayed parked at its earlier (clamped) offset, leaving the new line below the visible area — "typed in but not rendered".
- **Secondary**: `white-space: pre-wrap` creates no line box for a **trailing newline** while the textarea still reserves that caret line, so the two layers' `scrollHeight` differ by one line and the synced offset clamps permanently short.
- **Fix**: (1) re-sync the mirror's `scrollTop` from a layout effect on every text/completion-suffix change (the scroll-event path stays for user and browser scrolling); (2) append a zero-width space whenever the text ends with a newline, restoring the caret line box so both layers share the same scroll geometry.
- **Regression**: `command-presentation.spec.ts` "the colored input mirror stays aligned while multiline content overflows the capped height" asserts equal `scrollTop`/`scrollHeight` and probes pixels to prove the typed line is painted.

### 5.7 A Long Completion Suffix Glues to the Last Word as One Unbreakable Token → the Typed Character Wraps Below the Clip and Disappears (`theme.css` `.command-completion-suffix`, `command-presentation.spec.ts`)
- **Symptom**: with command syntax highlighting on, when history holds a command starting with `cd C…` (a long path), typing `cd C` shows **no** `C`; the text is really there (Enter runs it, and the `composer-input-change` lengths in diagnostics agree).
- **Root cause**: the highlight mirror renders the typed text plus the completion suffix as one inline flow. A long suffix offers no space to break at, so it glues to the just-typed `C` into a single unbreakable word; `overflow-wrap: break-word` only breaks inside a word when the line has **no other acceptable break point**, and the line still has the space after `cd` — so the whole word moves to the next line and only then splits. The mirror box is exactly the textarea's height (one line), so the second line is clipped by `overflow: hidden` and the typed character with every following one lands on a clipped line.
- **Fix**: let `.command-completion-suffix` break at any character (`word-break: break-all`), so the suffix can never push typed text to another line.
- **Regression**: `command-presentation.spec.ts` "a long completion suffix cannot push the typed word out of the visible mirror line" asserts the typed character's bounding box stays inside the mirror box (before the fix it sat below it) and that both layers share the same scroll offset.

### 5.8 `color-mix()` Turns `getComputedStyle` Colors into `color(srgb …)` — Naive Number Parsing Reads 0-1 (the `--menu-bg` floating recipe)
- **Symptom**: `field-surfaces.spec.ts` asserts "fields are at most 36 levels lighter than their panel"; after merging dev both themes failed (deltas 58.9 / 254.1) because the panel channels read as 0.
- **Root cause**: dev switched floating surfaces to `--menu-bg: color-mix(in srgb, var(--canvas) 50%, var(--surface))`; Chromium serializes `color-mix()` results as `color(srgb 0.14 0.14 0.14)`, and the old parser `color.match(/\d+/g).slice(0,3)` treated the 0-1 components as 0-255.
- **Fix**: the parser matches `color(srgb …)` first and scales by 255; the floating-surface assertions follow dev's recipe (background `--menu-bg`, no border, shadow-only separation).
- **Lesson**: computed colors serialize as `rgb()` or `color(srgb …)`; normalize before comparing, never assume `rgb()`.

---

## 6. Cross-Platform

### 6.1 PowerShell 5.1 Reads .ps1 as ANSI When There's No BOM → Injected Scripts Must Be Pure ASCII (`shell_integration.rs:61`)
- If the shell integration script contains any non-ASCII character (including Chinese comments), it is garbled and fails to run under Windows PowerShell 5.1. **The script must be pure ASCII**.

### 6.2 The Frontend Sends `\n`, PowerShell/cmd Receives No Carriage Return (`pty.rs:445`)
- Command sending must normalize `\n` → CR, otherwise PSReadLine/cmd doesn't respond.

### 6.3 BSD ps Has No `--ppid` (`3bc60eb`)
- Detecting the foreground process was changed to building the tree itself with `ps -axo pid=,ppid=`. GNU-habit flags don't exist on macOS.

### 6.4 Killing the Shell on Windows Leaves Orphaned Foreground Apps (`pty.rs`, several places)
- TerminateProcess on only the root shell left foreground apps like vim/builds alive. A Toolhelp snapshot must be used to collect and terminate **the entire process tree** along with it; after kill you must `wait` to reap, or else zombie processes.

### 6.5 macOS 12 WKWebView Doesn't Support Regex Lookbehind (Development Rules item 13; `24aff5a` remarkGfmSafe)
- The constructs `(?<=…)`/`(?<!…)` throw `SyntaxError: invalid group specifier name` outright. The worst victim was remark-gfm's autolink-literal (which uses lookbehind to recognize emails/URLs): **any AI reply containing a bare link broke rendering**.
- **Fix**: `remarkGfmSafe` reassembles the four GFM features per the stock recipe, dropping only autolink-literal — the cost being that bare URLs don't become links, traded for consistency across all platforms.
- **Similar cases**: WKWebView's xterm helper element needs dedicated CSS compatibility (`9d42419`); without WebGL, xterm falls back to the DOM renderer (§4.4).

### 6.6 Detecting the Windows Default Shell Was Slow on Every spawn (`pty.rs:302`, `shells.rs:105`)
- Probing for pwsh could take hundreds of milliseconds, and `list_shells` once ran several `Command::output()` synchronously on the main thread → UI freeze. Fix: an in-process cache + async/spawn_blocking to move it off the main thread.

---

## 7. Tauri / IPC / Rust Backend

### 7.1 Large Event Batches Exceeded the Tauri IPC Message Limit and Were Truncated (`7e34192`)
- **Symptom**: one Claude TUI frame was 500+ events, and the JSON serialization exceeded the limit → the frontend received truncated, corrupt events.
- **Fix**: batch so each emit carries at most 128 events.
- **Lesson**: IPC message size has a hidden limit, so high-frequency batched data must be controlled at both the splitting and batching ends (the output side likewise flushes on a byte threshold, `pty.rs:421`).

### 7.2 The Tauri 2 Config Key Is `windowEffects`, Not `effects` (`7e84e63`)
- Getting it wrong doesn't error until schema validation; only `cargo tauri dev` reveals it.

### 7.3 serde snake_case Not Matching the Frontend's camelCase → History Grouping "Invisible" (Phase 9)
- Fields were silently serialized under a different naming, the frontend read undefined, and the feature failed entirely with no error at all. The AI model config likewise requires camelCase alignment (with a dedicated comment at `ai.rs:27`).
- **Lesson**: every struct at the Rust↔TS boundary needs an explicit `#[serde(rename_all)]`, locked down via shared types/tests.

### 7.4 UTF-8 Multi-Byte Characters Cut Across Boundaries
- **PTY output side**: streaming decode across read boundaries produced U+FFFD garbage (fixed in Phase 7); invalid bytes require "drop n bytes, insert U+FFFD, continue the loop" (`pty.rs:37`).
- **AI SSE side**: running `from_utf8_lossy` independently per chunk caused garbling → a byte buffer splits complete lines on `\n` before decoding (`ai.rs:454`).
- **Search side**: content-match context slicing wasn't aligned to UTF-8 boundaries, so **searching Chinese files panicked outright** → `floor/ceil_char_boundary` (`search.rs:172`).
- **Rust scan side**: the end of a flushed text event must be a character boundary (`scan.rs:43`).
- **Lesson**: any "byte-stream slicing" must pass through the UTF-8 boundary check, and this same pitfall was hit independently in four places.

### 7.5 Synchronous commands Blocking the Main Thread/async runtime
- `fs_list`'s LIKE full-table scan and `which_cmd_sync` spawning a login shell (50-500ms with a heavy zshrc) both once ran synchronously on the main thread/runtime worker → UI stutter. Fix: async + spawn_blocking (`fs.rs:251`, `file_open.rs:157`, `shells.rs:105`).

### 7.6 MCP Child Process stderr Not Drained → the Pipe Filled Up and Hung the Child (`mcp.rs:260`)
- A background thread continuously drains stderr (logs discarded, a v1 trade-off). Similar: the blocking read in the test at `shell_integration.rs:300` must also go on a background thread, or the test hangs.

### 7.7 Environment Variables Are Process-Level State, So Parallel Tests Pollute Each Other (`web.rs:1106`)
- Tests that mutate proxy environment variables must be serialized.

### 7.8 Tauri Internal Environment Detection — Drag-and-Drop Silently Fails in the Browser (`7860ee3`)
- The e2e/browser environment has no `__TAURI_INTERNALS__`, so paths that rely on Tauri APIs, such as drag-and-drop, must first check `is_in_tauri_env`.

### 7.9 A GUI-Launched Shell Has No Locale → vi and Other Fullscreen Programs Render CJK as Garbage (`pty.rs:merge_locale_env`)
- **Symptom**: launched as a GUI app (Finder/Dock, no `LANG`/`LC_*`), `vi` shows Chinese in a UTF-8 file as `~H`, `~@`, `~C` and the like; `cat`/`ls` look fine.
- **Root cause**: locale-aware programs pick their encoding from `LC_CTYPE` (the C locale by default). vim therefore reads the file as latin1 and paints the C1 high byte of every UTF-8 CJK character as `~X`; programs that just pass bytes through never consult the locale, so they look correct. Some terminal emulators set the locale themselves, which is why the same command is fine elsewhere.
- **Fix**: `merge_locale_env` sits next to `merge_term_env` in `spawn_pty` — when nothing in the environment requests UTF-8 it supplies `LC_CTYPE` (`en_US.UTF-8` on macOS, `C.UTF-8` on other Unix), plus `LANG` when it is empty; an existing UTF-8 setting is left alone so the message language is preserved.
- **Lesson**: a GUI launch is missing not only PATH/TERM but also the locale; for any "fine locally, broken in the app" text issue, check `LANG`/`LC_CTYPE` first.

### 7.10 A Single-Instance Redirect Must Be Queued Before Its Signal (`platform/context_menu.rs`)
- **Symptom**: the second start (context menu) handed its directory to the frontend through an event alone. When the window had just started and the webview had not subscribed yet, the event was lost: the user picked "Open in Vrykell" and nothing happened.
- **Fix**: the Rust side queues the directory first and only then emits a wake-up signal; the frontend drains the queue once right after subscribing. The drain is atomic (one side takes an entry), so the event path and the catch-up path never open the same tab twice.
- **Lesson**: when a running instance must serve an external request, the event is only a wake-up call and the data belongs in a replayable queue. The single-instance plugin also has to be registered before the other plugins, so a second start is intercepted before the rest of the setup runs.

### 7.11 Windows 11 Draws a 1px Border Around Every Window and `DWMWA_COLOR_NONE` Does Not Remove It (`platform/window_chrome.rs`)
- **Symptom**: the main window (transparent, `decorations: false`) showed a one pixel seam along the top edge and leaked the desktop through its rounded corners.
- **Root cause**: the outermost pixel ring of the window belongs to the native frame: with `shadow: true` tao insets the client by that frame (1px at the top, the invisible resize border at the sides), and Windows 11 paints a one pixel border there. `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE` (0xFFFFFFFE) fails to remove that border on some system builds and falls back to a dark default line (about #1A2129 in dark mode), which reads exactly as a seam. The frame area outside the rounding has no surface to draw on a **transparent** window, so the desktop shows through at the corners.
- **Fix**: the main window runs with `shadow: false`, so the client covers the whole window and the webview content reaches the rounded corners (the window stays `transparent: true`, so the application's own translucency and shaders still show the desktop). A full-client undecorated window no longer gets automatic rounding, so `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND` is requested explicitly, and `DWMWA_BORDER_COLOR` is painted in the window surface color (the main window's `--chrome-bg`, a tool window's `--surface`) through `syncWindowFrame`, which re-runs on startup and on every theme change. Tool windows stay opaque with the native frame, so the compositor paints their corner areas.
- **Trade-off**: the main window no longer has a system drop shadow (tao's `shadow` switch drops the frame with it); an application-drawn shadow can replace it.
- **Lesson**: the outermost pixel ring of an undecorated window belongs to the system and can only be recolored, not removed, and on a transparent window the frame area outside the rounding is bound to leak the background - either let the client cover the whole window or accept the system drawing. Do not use `DWMWA_COLOR_NONE` as a way to hide the border.

---

## 8. SQLite / Persistence

### 8.1 Wrong Migration Order → Startup panic `no such column: group_id` (Phase 9)
- The index was created before the ALTER. ALTER first, then create the index.

### 8.2 Migrations Relying on "Swallowing ALTER TABLE Errors" and Hoping for the Best (`code-audit.md` → `security-review.md`)
- Couldn't distinguish "the column already exists" from a real failure. → `PRAGMA user_version` versioning + `ensure_column` checking column by column.

### 8.3 Column-by-Column Migration Still Not Enough: an Old DB Missing a Column → History Blocks Silently Vanished (`c64a24d`)
- A v1 database was missing the `output_html` column, `record_block`/`get_session_blocks` SQL failed, but the failure was swallowed → blocks weren't persisted and disappeared after reloading the session, and **all the user saw was "the history is gone"**.
- **Conclusion**: a local cache-type database doesn't get archaeological migrations — when `user_version < 2`, the whole database is dropped and the tables are created from scratch. When data is reproducible, "drop and recreate" is far cheaper and more reliable than a "migration matrix".

### 8.4 `INSERT OR IGNORE` Silently Discarding Real Information (`code-audit.md`, `db/session.rs:10`)
- A fallback row (placeholder) written first caused the later real title/cwd/created_at to be IGNOREd entirely. → `ON CONFLICT DO UPDATE`. Similar: keeping the fallback INSERT OR IGNORE before record_block to preserve the foreign key, so blocks aren't silently dropped (`session.rs:176`).

### 8.5 `HistoryDb::open().expect()` → panic on Startup (`code-audit.md`)
- If the DB file is corrupt or has permission problems, the app simply won't start. → degrade to an in-memory DB: history is unavailable, but the app keeps running.
- **Lesson**: a failure in a non-core subsystem (history/cache) must never take down startup.

### 8.6 The Injection Surface of Persisted HTML Snapshots (`593edad`, `cdc146c`)
- `outputHtml` is persisted and then rendered via `dangerouslySetInnerHTML`, so tampering with the DB file enables injection. → a `sanitizeOutputHtml` whitelist (a restricted style on span + br), **sanitizing on both sides, restore (sessionManager) and render (BlockOutput)** — sanitizing on only one side is as good as not sanitizing at all.

### 8.7 Archiving active Sessions on Exit → All "Last Opened Tabs" Lost (`d61b5a1`, `lib.rs:30/191`)
- The semantics of active should be "opened last time and not closed", restored by the frontend on startup; auto-archiving on exit turned it into "start from scratch on every restart". Removed exit archiving.

### 8.8 Restoring a Session Losing Metadata (`code-audit.md`)
- `restore()` writes only `{id,title,kind,cwd}`, so the shellType/ssh metadata is lost → an SSH/a specified-shell tab comes back spawning the default shell. `RestoreMeta` was added to fill this in; blocks in the old persistence that lack a paneId are "visible only in the panel and don't enter the block stream" (`sessionManager.ts:178`).

### 8.9 API Keys Plaintext in config.json with Fully Open Permissions (`security-review.md`)
- Fixed: API keys now join SSH passwords in the platform secret store (`secret.rs`) — DPAPI-sealed into `secrets.json` on Windows (only the current user can unseal), the system keychain on macOS, and a 0600 file elsewhere (no system keyring there; a documented limitation). `config.json` uses `skip_serializing` and no longer carries keys; there is no plaintext migration - the runtime reads decryptable sealed values only, and unsealed (legacy plaintext) or tampered values count as missing until entered again, which seals them; the directory stays 0700 and the file 0600 as defence in depth. An older build cannot read migrated keys (it shows "not configured"), so the key has to be entered again there.

---

## 9. Security

> For the full list see `docs/en/security-review.md`; here we record only the "almost never thought of" pitfalls.

### 9.1 DNS Rebinding Bypassing the SSRF Check (`6c94150`)
- In the window of "resolve → validate the IP → issue the request (re-resolve)", an attacker alternating responses can make the second resolution return an internal IP.
- **Fix**: `PinnedResolver` resolves once → validates → caches (TTL 60s), and the connection reuses the validated result.
- **Lesson**: the SSRF check must be bound to **the IP actually used for the connection**; if "what was validated" and "what was connected to" come from two separate resolutions, it's as good as no check at all.

### 9.2 IPv4-mapped IPv6 (`::ffff:127.0.0.1`) Bypassing the Internal-Network Block (`web.rs:316/1071`)
- `is_private_ip` must recursively judge mapped addresses by IPv4 semantics.

### 9.3 Three Proxy Pitfalls (`web.rs:256-259`)
1. reqwest **doesn't read environment-variable proxies by default** → all proxy users went direct (`env_system_proxy` builds it by hand);
2. if NO_PROXY contains IP/CIDR entries and validation is skipped, you can't rule out "a domain bypasses the proxy and connects directly to the internal network" → kept the validation conservatively;
3. only remote-resolving proxies (http/socks5h) may skip the local DNS check; socks4/socks5, which resolve locally, must always be validated.

### 9.4 zip bomb: Using the Size Declared in the zip Header as the Cap (`skills.rs:403`)
- The declared value can be inflated. You must count **the bytes actually written** in a streaming fashion and abort when the limit is exceeded. Similar: every HTTP response body is streamed through `read_body_capped` for truncation (web 10MB / SKILL.md 1MB / install files 2MB), and reading the whole thing with `text()/bytes()` is a memory DoS surface.

### 9.5 Redirects Escaping the "Hardcoded Trusted Host" Promise (`web.rs:424`)
- The skill marketplace hardcodes GitHub for the first hop, but redirects can go anywhere → the `is_github_host` whitelist applies to the first hop **and every redirect hop**.

### 9.6 Concurrent known_hosts Read-Modify-Write Overwriting Each Other (`ssh.rs:75`)
- Multiple SSH connections doing TOFU writes to known_hosts at the same time meant later writes overwrote earlier ones, and the whole-file overwrite in `write_file` destroyed other hosts' records → a process-level Mutex serializes the "full read-modify-write".

### 9.7 SSH Hostname Argument Injection (`c7700b8`, `pty.rs:131`)
- A hostname starting with `-` can inject `-oProxyCommand=…` to gain arbitrary command execution → reject names starting with `-` or containing whitespace.
- **Similar thinking**: the remotely injected script must be a static constant inside the binary (never written to disk, never assembled from remote data), passed via base64, with `umask 077 + mktemp`; `exec "${SHELL:-sh}" -i` is quoted to prevent word splitting — a malicious `$SHELL` only causes a failed connection, never execution.

### 9.8 Empty Username Defaulting to root (`ssh.rs:52`)
- A "convenient" default is an accident amplifier when it comes to credential operations. Just error out.

### 9.9 `fs_rename`'s new_name Can Contain `/`, `..` (`fs.rs:187`)
- A rename API is naturally a path-traversal entry point, so a single path component must be validated. SFTP recursive download has the same disease: an unvalidated remote entry name can escape the download directory (reject `.`/`..`/anything with separators).

### 9.10 WebView With No CSP + asset scope `$HOME/**` Wide Open (`c7700b8`)
- Fix: CSP (script only self/inline, connect only ipc, no remote img, object/frame forbidden); asset scope narrowed to `$APPDATA/**`; wallpapers are dynamically `allow_file`-authorized based on the user's choice.
- **Wallpaper validation must read through the backend**: the asset protocol serves only authorized paths (`$APPDATA/**` or an already saved wallpaper), so decoding a not-yet-saved candidate through its asset URL gets a 403 and is misreported as "not a valid image". The candidate is read by `read_image_data_url` before decoding, and the asset URL reaches the background layer only after `set_theme_config` authorized the file, otherwise the one-shot image request is denied.
- **Windows production builds need `http://asset.localhost` in `img-src`**: on Windows the asset protocol is served from `http://asset.localhost` while the CSP source `asset:` only matches `asset://` (macOS); omitting it blocks even authorized wallpapers.
- **Remaining trade-offs**: script-src includes `'unsafe-inline'` (needed by Vite HMR in dev mode); remote images in markdown are all downgraded to link text (exfiltration/tracking surface).

### 9.11 LIKE Wildcards Not Escaped (`code-audit.md`)
- User input `%`/`_` was concatenated straight into the LIKE pattern. The same file had another near SQL injection: `filter_session_status` concatenated SQL → parameterized (`session.rs:222`).

### 9.12 Agent File Tools Can Be Driven by Prompt Injection to Read Secrets (`sensitivePathReason`)
- Once injected, the LLM "legitimately" calls read_file to read `~/.ssh/id_rsa` and sends it out. → a sensitive-path heuristic (.ssh/.aws/.env/config.json) **forces a per-call prompt regardless of the permission mode**.
- **Lesson**: the trust boundary of an agent permission system must guard against "manipulated legitimate calls", not just illegal ones.

### 9.13 Signal Whitelist and Kill Protection (`pty.rs:523/528`)
- The frontend could pass an arbitrary signal and kill processes at random → a whitelist; when the foreground process group == the shell itself (no app running), sending a signal is refused, to avoid killing the shell by mistake.

---

## 10. React / zustand Frontend State

### 10.1 StrictMode Double Execution
- **Triggering a toast inside the reducer** → a double notification (`store/blocks.ts:69`). Side effects must go outside `set`.
- **xterm mounted twice** (StrictMode/switching back to a tab) → check `term.element` before `term.open(el)`, and if already mounted just move the el (`TerminalBlockList.tsx:513`).

### 10.2 zustand selector Returning a New Object → useSyncExternalStore Infinite Loop (`AiStatusBar.tsx:41`)
- `resolve()` returned a new object each time, so putting it in a selector made every frame decide it "changed" → infinite re-render. A selector must return a stable reference/primitive value.

### 10.3 Module-Level Variables Used as State → Not Reactive (`code-audit.md`, two places)
- The set of enabled search filter sources and the AI model name were both module-level caches, so after switching, the UI didn't update until input was re-entered. → put everything in the zustand store.

### 10.4 Module-Level store State Accumulating After a Tab Is Closed (`2114f6c`, `workspace.ts:299/426`)
- Closing a tab closed only the tab, leaving per-terminal blocks/chat/cwd/PTY records behind → slow growth with long-term use. dropTab must clean up **all** per-tab/per-terminal derived state; the AbortController of a streaming request must also be aborted in dropTab to prevent leaks (`store/chat.ts:63`).

### 10.5 Closing a Tab Mid-Stream → Ghost Empty Entry (`code-audit.md`)
- Both `appendChunk`/`finally` must check whether the tab still exists, or they revive entries for an already-closed tab.

### 10.6 Fast Panel Dragging Not Keeping Up — a Stale Closure Swallowing the Delta (`store/dock.ts:235`)
- When the drag callback used "the absolute width passed in from outside", under fast dragging the render closure was stale and the delta was lost (the panel didn't move while the terminal flex changed instead). → accumulate "current value + delta" inside the store.
- **Similar drag races** (`2114f6c`): a repeated mousedown on ResizeHandle must unbind the old listener first (`ResizeHandle.tsx:40`); the collapse threshold needs hysteresis, to avoid the panel popping out and jittering when you drag back one or two pixels (`SidePanel.tsx:53`).

### 10.7 Collapsing by Drag Unmounting the Component Immediately → Dragging Back to Regret It Loses All State (`dc25a44`)
- Collapsing was changed to marking + hiding (the content instance is kept), with **the decision to keep or discard made only on mouse release**; persistence saves it as closed. After dragging the file panel back it stays in the original directory rather than acting like a reload.

### 10.8 Tab Drag-Reorder Mixing Two Index Spaces (`ebb0de9`)
1. the drop handler mixed the sessions array index with the "combined sessions+settings array" index, so when the settings tab wasn't at the end, the swap silently landed wrong;
2. the target-detection loop hit **the dragged tab's own rect** first — follow-transform makes it move with the mouse, so every position matched the source index and dragging the leftmost tab right was always a no-op.
- **Lesson**: drag logic must explicitly unify into one index space and then project back; hit detection must skip the source element. Only a transform-aware mock where "the rect follows the mouse" can catch the second bug.

### 10.9 All hooks Must Be Called Before a Conditional hook / early return (`FilterPopover.tsx:15`)
- Switching open from false→true crashed outright. A classic React rule, but it has a dedicated regression test guarding it.

### 10.10 IPC Return Values Sharing a Reference with an External Mutable Collection (`useSessionHistory.ts:89`)
- After a delete the original array changed in place, so React's shallow comparison decided it "didn't change" and skipped the update. IPC/mock return values must be copied.

### 10.11 ErrorBoundary Not Resetting → a Single Transient Error Permanently Degrades (`SafeMarkdown.tsx:33`)
- A single transient parse error during streaming render left the entire message showing the degraded text forever. The error state must be reset when the content updates.

### 10.12 The Fallback Polling for Focus Management (`useTerminalFocus.ts`)
- If the input bar is `display:none`/unmounted, losing focus **doesn't necessarily fire focusout** → low-frequency polling as a fallback; without focus, the IME can't start composing and keystrokes have nowhere to go.
- Similar: the xterm inside a card doesn't consume wheel (customWheelHandler returns false), otherwise with the wheel over a running card the whole page won't scroll (`TerminalBlockList.tsx:560`).

### 10.13 Batch-Cleaning Up Listener/Timer Leaks (`2114f6c`)
- Numerous addEventListener/setTimeout calls had no matching cleanup; the Toast auto-dismiss path also had to clear its timer, or a manual close/hover-pause leaves it behind (`Toast.tsx:36`). The PTY output listener should be **registered globally once** and track the sessionId in a ref, rather than registered per session (`a1d0a13`, the same lesson from the v1 period).

### 10.14 A Terminal in the Unified Workspace Still Judged Visibility from Its Native Tab → No Keyboard Input for a Running Block and a Blank Manual Fullscreen
- **Symptom**: after a terminal pane was placed in the unified workspace, a running command could not receive keyboard input; entering fullscreen interaction showed a blank surface; returning to the terminal workspace took a noticeably long time to recover.
- **Root cause**: `ResourceContent` moved the terminal host out of the native tab's DOM, but keyboard focus and the manual-fullscreen host were still driven by `SessionTabView`'s `active` flag. In the unified workspace the active id is a terminal session while the area is `unified`, so `contentVisible` is false and neither the focus hook nor the top-level fullscreen host rendered; the running block host was hidden by `showBlocks=false`, leaving the fullscreen surface blank. `RunningTerm` looked up its host only when the fullscreen flag changed, so an area switch never rebound it.
- **Fix**: focus dispatch and the manual-fullscreen host moved down to `TerminalPane`, using the `ResourceContentSlot` focus for placed panes. A placed pane renders the fullscreen host inside its own bounds, while the native area keeps the top-level `TerminalView` host; `RunningTerm` rebinds when the area or unified tab changes. Regression: `unified-running-block.spec.ts`, `TerminalView.lifecycle.test.tsx`, `useManualFullscreenVisible.test.tsx`.

---

## 11. AI / LLM / Streaming

### 11.1 AI SDK v7: Putting the system Prompt into messages Throws InvalidPromptError Outright (`agentStream.ts:109`)
- By default `allowSystemInMessages=false`, so system must go through the `instructions` option. When upgrading an SDK major version, check this kind of default-value change first.

### 11.2 A setState per token → O(n²) Stutter (`store/chat.ts:124`)
- Each chunk of a streaming reply triggered a full re-parse of the entire message's Markdown + KaTeX. → batch with a ~50ms flush.
- Similar: `SafeMarkdown.tsx:41` explicitly comments that this is the main source of stutter in long conversations.

### 11.3 a Pending Tool-Approval Promise Freezing agent Stepping (`store/chat.ts:314`)
- When a tab closes/the stream aborts, the Promise pending on the user's approval has nobody to resolve it → the tool's execute hangs. → always release it as a rejection.

### 11.4 run_command Snapshot Extraction Too Fast → the Model Gets Empty Output (`runCommand.ts:146`)
- Extracting the terminal snapshot immediately after the command is done means the output may not have landed on screen yet → give it a grace timer before wrapping up, otherwise the model wrongly concludes "the directory is empty".

### 11.5 The parts Reconstruction Contract for assistant Messages (`messageParts.ts:10`)
- "Don't write `parts: []` for an assistant message elsewhere" — history reconstruction relies on content to rebuild the first text part, and violating the contract silently drops tool nodes.

### 11.6 The Frontend Connecting Directly to the LLM → API key Exposed in the WebView (`9be3245`)
- Streaming requests go through a Rust proxy (`llmFetch`), so the key never leaves Rust. The same commit added streaming error handling and logging.

### 11.7 Scheduled Task Scheduling Written Inside the Settings Page Component (`1215255`)
- **Scheduling only takes effect while the settings page is open**. App-level behavior must hook into the app-level lifecycle (App.tsx) and can't be parasitic on any page component. The same commit cleaned up a batch of unhandled Promise rejections and silent failures.

### 11.8 Idempotent Prompting for Context Compression (`context.ts:103/138`)
- When a summary is merged and updated, the prompt must state "don't repeat or ramble"; when the already-folded part is unchanged, fold only the newly added overflow messages, to avoid re-summarizing over and over.

### 11.9 The proxy fetch cancels the Rust request but never settles its local stream → the UI stays "generating" after Stop (`llmFetch.ts`, `abort`)
- **Symptom**: after pressing "Stop generating" the model request really is gone (the Rust `AbortHandle` cancels the reqwest call; `llm_abort` shows up in the log), yet the answer stays in the generating state and the send button never comes back.
- **Root cause**: on abort Rust returns silently and sends no further `done`/`error`, while `llmFetch`'s local `ReadableStream` is never closed or errored. The AI SDK's wrapper stream only checks `abortSignal.aborted` **after** a read settles, so the reader hangs forever and the `fullStream` teardown (`finally`: clear `sendingTab`, land the terminal state) never runs.
- **Fix**: the abort listener also calls `controller.error(new DOMException(…, 'AbortError'))` so the local stream settles immediately; `llmFetch.test.ts` ("abort mid-stream") locks the behaviour in. On the e2e side, the mock's `llm_abort` must likewise "stop sending and emit no terminal event", otherwise this class of hang cannot be reproduced.

### 11.10 The global send state read as "this conversation is answering", and "mark before send" losing a run (`sendingTab`)
- The store runs one turn at a time (a single `sendingTab` slot), which produced two traps:
  1. `AiBlock` treated `sendingTab !== null` as "this reply is still generating" — a background scheduled turn greyed out Regenerate/Edit/Delete on **every** reply, as if the current conversation were stuck;
  2. `scheduleRunner` called `markScheduleRun` before `sendToChat` — when the send slot was taken, `sendToChat` skipped silently while the task was already recorded as run, so that whole interval (up to an hour) vanished.
- **Rule**: "this conversation is answering" is always `sendingTab === <conversation id>` (`PanelChat` always did this; `AiBlock` now scopes to the owning conversation), and background work must not write a run timestamp before it can truly start — when the slot is busy it waits for the next tick (`isChatTurnActive()`).

---

## 12. Rich Content / LaTeX/Markdown

### 12.1 shell Echo Misjudged as Inline Math (`20afcdc`)
- **Symptom**: PowerShell echoing `$c=$w; $n++`, `try{...}` rendered as a red KaTeX error.
- **Fix with three guards** (always leaning toward plain text — "show what other terminals show" takes priority over rendering math): pandoc-style delimiter validation (no space after the opening `$`, no space before the closing `$`, killing `$5 and $10`); content that begins or ends with an operator/punctuation/quote isn't a formula; unbalanced braces mean a code fragment.
- **Deliberately gave up** pandoc's "closing `$` followed by a digit" rule: an in-place redraw leaves a stale cell after the formula (`$x^2$` overwriting `line 6` → `$x^2$6`), and that rule would kill the real formula.

### 12.2 the CJK Guard Wrongly Killing Chinese `\text{}` Comments (`07a1a18`)
- The guard "reject if the $$ body contains CJK" killed legitimate formulas (the `\text{ (高斯定律) }` in Maxwell's equations), and due to slow-output timing it appeared as "occasionally not rendered". → tightened to reject only when the body has CJK **and** no LaTeX command at all. Bidirectional regression tests.

### 12.3 a Length Threshold Too Tight Missing Long Formulas (`4f8203e`)
- The accepted length for inline math went from 60 → 500 characters (`\nabla\times\mathbf{E}=...`); a single uppercase letter is accepted (`$ surface`), while multi-character all-caps shell variables are still rejected.

### 12.4 Soft Wraps Splitting Formulas Apart (`529ca65`)
- rich-scan must scan by **logical line**: physical lines that soft-wrap are joined with `''` (never `'\n'`), otherwise a `$...$` spanning a wrap gets a newline injected in the middle by the time it reaches KaTeX → red raw text.

### 12.5 KaTeX Doesn't Understand TeX Spacing Parameters (`530de24`, `f0ba794`)
- `\\[4pt]` rendered as a red literal; the terminal markdown renderer also collapses `\\` into `\`, so `\[8pt]` leaks in the same way. → preprocessing strips the optional spacing parameters; a top-level `\\` in display mode is wrapped in a `gathered` environment.

### 12.6 the Scan Boundary Only Looking at the Last 3 Lines → Short Answers Above the Prompt Not Rendered (`713be32`)
- Changed to scanning everything above the cursor line.

### 12.7 Rewriting marked → react-markdown to Close the XSS Surface (`7d1efdc`)
- rehype-raw is not enabled and raw HTML is always escaped. This is the premise of the "no high-severity XSS found in the frontend" conclusion; **read this before introducing any raw HTML rendering**.

---

## 13. Testing

### 13.1 This Repo's vitest 4 Trap: beforeEach + mockRejectedValue Falsely Reporting unhandled (`files.test.ts:8` header comment, referenced by several test files)
- **Symptom**: when a `beforeEach` (clearing mocks) is present in a test file, a `mockRejectedValue` rejection is falsely reported as an unhandled rejection; a probe reproduces it, and removing the beforeEach makes it normal.
- **Convention**: agent-related tests never **use beforeEach to clear mocks**; each case sets up its own mock implementation and asserts with different parameters.
- **Similar**: a `beforeEach(() => mock.mockClear())` arrow function **must have braces** — `() => mock.mockClear()` treats mockClear's return value as the return semantics (`agentStream.test.ts:65`).

### 13.2 ConPTY Environment Artifact: a node stub Can't Test resize (`1658043`)
- Using node as a TUI stub for Windows e2e is unworkable: under ConPTY, node **never receives resize events**, and a full-width output burst runs into ConPTY's deferred-wrap quirk — both are environment artifacts (verified with eventLog that they happen below our code).
- **Alternative**: a PowerShell polling stub (`[Console]::WindowWidth` + `\e[4A` redraw) simulating a self-repainting TUI's line accounting.

### 13.3 e2e mocks Must Replicate the Internals of @tauri-apps/api v2 (`e2e/tauri-mock.ts` header comment)
- `invoke → __TAURI_INTERNALS__.invoke(cmd, args)`; `listen → transformCallback registers window[_${id}] then invokes invoke('plugin:event|listen')`. The mock goes through the real library code path rather than stubbing the library itself, so contract changes on an API upgrade get caught by e2e.
- The mock PTY output emits the full OSC 133 sequence by default (the new pipeline is driven by shell integration for scene switching), and leaves an `integration:false` switch to test the classic fallback.
- The Anthropic mock's init script **must be registered before goto** (header comments in several specs).

### 13.4 Selector/Timing Details of e2e Assertions
- `block-width.spec.ts:37`: take the **innermost** matching div — an outer container that also `includes('<br>')` would be hit by mistake.
- `blocks.spec.ts:77`: keyboard assertions must go **before** the banner button click — the click steals focus from xterm.
- Under WebGL, canvas rendering means reading text must assert on the buffer, not the DOM (`blocks.spec.ts:71`).
- `pane-move.spec.ts:6`: the core assertion of the drag case is "the PTY of a running block must stay alive" — a regression for "running content exits immediately when dragging a terminal/tab".

### 13.5 Using Real Captured Data as Regression fixtures (`d4335f3`, `156660b`)
- A reliable reproduction of terminal bugs comes from **real TUI output captures** (replaying a 100×30 Claude Code startup frame, real resize integration tests); hand-written sequences always miss the actual combinations. The repo has dedicated capture/replay scripts (`68cfca7`: raw PTY byte dumping, probe/record/replay scripts).
- Lesson: **build the capture-replay infrastructure first, then fix terminal bugs**.

### 13.6 Tests and Implementation Sharing a "Single Source of Truth"
- The emoji width table is generated by measuring with string-width@7 and locked from both directions (§4.1); tokens.test.ts syncs its expected values on every theme change (`40c862a`, `ee356b1`) — during the theme experiment period, test expectations forced explicit confirmation of every color-value change.

### 13.7 the Blind Spot of codemod Bulk Import Rewrites (`fb36bab`, `e1ae0a4`)
- A sed codemod converting 658 relative imports to the `@/` alias **didn't match side-effect imports** (`import '@/...'` with no from clause), missing 3 of them. After a bulk replacement you must search globally for residual patterns and not just trust tsc (side-effect imports report no type errors).

---

## 14. Process Management

### 14.1 Closing a Session Without force-kill → Child Processes Left Behind (`29f5d41`)
### 14.2 KillState Entries Never Cleaned Up → Unbounded Growth with Long-Term Use (`code-audit.md`, `pty.rs:496/517`)
- `pty_close`/`reap_session` must synchronously delete the "terminate escalation" state.
### 14.3 pty_spawn Partial Failure Leaking Child Processes (`code-audit.md`, high priority)
### 14.4 reap_session's emit Failure Path Blocking wait (`code-audit.md`)
### 14.5 the Order of Killing the Process Tree (`pty.rs:611`)
- Collect the descendants first, then kill, to avoid the parent dying first and the children being re-parented under a different parent and thus missed.
### 14.6 the Output pending Buffer Trapping the Last Segment When a Session Closes (`pty.rs:353`)
- Output not yet flushed within the batching window (e.g. the cmd/PowerShell prompt) must be force-flushed, or "the last line never appears".
### 14.7 A Full Page Reload Leaving the Previous PTYs Alive (page lifecycle cleanup)
- A page reload or webview recreation does not restart the Rust process: the previous sessions stay in `PtyState`, the new page never learns their ids, and the React unmount cleanup never runs. The shell, its console host and both worker threads stay alive, and their output keeps being broadcast to the new page.
- **Fix**: the main window's `on_page_load` hook and the frontend startup each call `pty_close_all`, and `RunEvent::Exit` clears once more; closing a session sets a `closed` flag, signals the foreground process group before terminating the process tree, and waits with a bounded timeout.

---

## 15. UI / Interaction

### 15.1 Closing the Last Tab Popping Two Dialogs (`f865d06`, `0b30c1e`)
- The force-close confirmation + the exit confirmation after the session count dropped to zero popped up serially; canceling the exit even once wrongly created a new session. → the last tab goes straight to the exit dialog, and canceling keeps the live session. When the settings tab is the last tab, closing it must be **deferred until after the exit confirmation**.
- Related trade-off: only confirm closing when a foreground process is running (an idle shell closes directly, `3bc60eb`).

### 15.2 a Default Theme with a Hue Bias Rejected (`ee356b1`, following the cyan-green theme just done in `40c862a`)
- The conclusion converged on after many rounds of theme experiments (a whole day in Phase 5: ink & violet / graphite & amber / frosted-glass…) was: **neutral by default**, with colored schemes demoted to optional presets (the theme.json override mechanism). Functional semantic colors (success/error/warning) are the exception.
- Lesson: aesthetic exploration needs a mechanized escape hatch to "fall back to the neutral default", rather than flip-flopping on the default value.

### 15.3 Search Race: a Request ID Discarding Stale Results (`search/engine.ts:51/91`)
- Asynchronous search for input suggestions must carry a request ID and discard the response if the ID has already changed by the time it arrives.

### 15.4 fileTree Cycle Prevention (`fileTree.ts:47`)
- A self-referencing symlink, or a backend returning the same listing for any path, caused a stack overflow on recursive expansion. If a directory path is already in the ancestor chain, render the row as usual but don't recurse further.

### 15.5 Path Normalization Must Be Consolidated at the Platform Layer (`da7ee25`; mixed separators `C:/Users/foo\.android`)
- `normPath('/')` → `''`, and `fs_list('')` fails → after `cd /` the file panel shows an empty directory. Path normalization must preserve the filesystem root.
- A Windows drive-letter root must keep its root slash `C:/`: `C:\` is "the current directory on that drive", and `fs_list('C:')` isn't necessarily the root.
- Backend entry paths carry native backslashes, and entering a subdirectory from a terminal cwd (already normalized) produces mixed paths like `C:/Users/foo\.android`. Fix: path semantics consolidated into `@platform/path`, with `@platform/api/fs` (and workspace/search) normalizing in both directions at the IPC boundary; the business layer must no longer hand-write `normPath` on `entry.path`.

### 15.6 waitForSession's 8s Timeout Silently Dropping Commands (`code-audit.md`)
- Cross-panel operations like "sync to terminal" fail silently while the PTY isn't ready, and users think the button is broken. A timeout needs user-visible feedback.

### 15.7 Empty-State Buttons With No Feedback / Sync Operations Popping Needless Notifications
- "Send output to AI" and "Clear conversation" gave silent, feedback-free results in the empty state → added a toast (`code-audit.md`); conversely, a deterministic operation like directory sync **shouldn't** pop a success notification (`d7c569c`). The principle of feedback: prompt only when the outcome is uncertain.

### 15.8 i18n in Name Only (`code-audit.md`)
- A large number of keys had no references and most UI copy was hardcoded Chinese; a missing key displayed the key string directly (`dock.ssh`). Half-baked i18n is worse than none — either complete it or delete it. This project first chose "UI always in Chinese", written into Development Rules item 3, then moved to "English key in code plus a Chinese entry in `src/i18n`"; the lesson stands either way.

### 15.9 Minimum Animation Duration (Development Rules item 19; `2114f6c` fixed animation durations)
- Collapse/expand and hover transitions ≥ 100ms; animations that were too fast, along with hardcoded colors (which should go through CSS variables), were cleaned up together.

### 15.10 the File Panel Drag Doesn't Use HTML5 Drag-and-Drop; Deletes Use In-App Staging to Buy Back Undo
- The desktop window keeps native file drag-in, and HTML5 drag events get intercepted on Windows → row dragging is implemented with pointer events (consistent with navigation-button dragging: a 6px threshold, Esc to cancel, and suppressing one click after the pointer is released).
- Dragging out of the window (dropping onto the desktop/File Explorer) uses `tauri-plugin-drag` (the `drag:default` permission) rather than HTML5: with `dragDropEnabled` on, Windows has no usable HTML5 drag-and-drop and you can only pick one of the two, while native file drag-in needs a real path.
- If a delete goes straight to `trash::delete`, it can't be programmatically restored (the recycle bin has no cross-platform restore API): instead, move it first to `~/.vrykell/undo` for staging, move it back in place on undo, and only when it's pushed out of the history stack or at app startup send the staged item to the system recycle bin — preserving the undo window while keeping the final semantics of "delete = goes to the recycle bin".
- The "copy + delete source" degraded path of a cross-drive move must roll back the destination copy if deleting the source fails, otherwise the user sees "the move failed but a copy was left behind".
- The generic context menu got Esc-to-close added (handled in the capture phase with propagation stopped, to avoid also triggering the global Esc keyboard-target switch).

### 15.11 After Merging Panels, Still Beware of "Selectors Hardcoded per Variant"
- After the local and SSH panels were merged into a single `FilePanel`, the drag hook still contained `[data-testid="file-row-expander"]`: the local panel's expand arrow happened to have that name while the SSH panel's was `remote-row-expander`, so clicking the remote arrow had its click swallowed by `setPointerCapture` and expansion failed entirely (unit tests don't render the DOM, so only a real machine/e2e could find it).
- Conclusion: don't use test identifiers as behavior hooks between shared components; use variant-independent semantic markers instead (`data-file-row`, `data-row-expander`, `data-drop-dir`); test identifiers serve only e2e.
- Similarly, right-clicking blank space initially used `closest('[data-testid^="remote-file-"]')` to determine whether a row was hit, but the tree container itself is named `remote-file-tree`, which also matches that prefix → the blank-space menu could never open. Prefix matching in a shared namespace is a trap.

### 15.12 Name-Collision Avoidance Must Be "the Backend Returns the Real Path", or the Undo History Will Be Wrong
- If paste / drag / rename errored on a same-named item, the user had no choice but to rename it themselves; after changing to auto-numbering (`notes (1).txt`, with the number before the extension, consistent with File Explorer), **the real target path must be passed back to the frontend**: `fs_rename` / `ssh_rename` / `fs_move` / `fs_copy` / `ssh_move` / the new-file command all return the final path.
- The frontend records the undo pair and the selection using only the returned path; if the frontend assembles it itself as "target directory + original name", then once avoidance kicks in the undo will operate on a path that doesn't exist (this is exactly the new bug most easily planted when introducing avoidance).
- Remote copy must also note that `cp -R src dest/` writes using the source file name: after avoidance you must give the full target path explicitly (`cp -R src dest/src (1).txt`), or the avoidance was for nothing.

### 15.13 the Asymmetric Padding of the pane Container Pushing Full-Width Elements Right (the auth input bar "not centered")
- Symptom: the SSH auth input bar had noticeably more whitespace on the left than on the right (the user pointed out directly that "the container is in the wrong place or at the wrong level"), and it was visible at any window size and whether or not the right panel was open.
- Cause: `TerminalView` applied `padding: '8px 0 0 8px'` (left 8, right 0, with the right at 0 so the native scrollbar hugs the pane's right edge) to the container **wrapping the entire terminal panel**, so full-width elements like the auth input bar were pushed right by 8px as well.
- Fix: move that 8px down from the "panel container layer" to the "terminal screen content layer" (the xterm host and the snapshot `pre`), leaving full-width elements at the pane root layer → strictly symmetric left and right (measured left/right whitespace 0/0), and add an e2e assertion (left-right difference ≤ 1px) to lock it in.
- Lesson: which layer the padding goes on is equivalent to "who is treated as a full-width element". Adding **one-sided** padding to a container also pushes along every child element beneath it; it's most easily tripped over when reusing components across layers (panel-level container vs content-level whitespace).

### 15.14 Using `std::path` on a Windows Host to Handle Remote POSIX Paths (paste reporting "must be an absolute path")
- Symptom: copying a file in the SSH panel and then pasting reported "the target directory must be an absolute path"; remote rename / move / new / upload could also generate paths with backslashes during name-collision avoidance.
- Cause: "absolute/relative, joining, taking the parent directory, taking the file name" for remote paths used `std::path`:
  - `Path::is_absolute("/home/user")` returns **false** on Windows (`/home/user` is treated as a relative path);
  - `PathBuf::join` uses `\` on Windows, producing `/home/user\docs`;
  - `ssh2`'s convenience `Sftp::readdir(dir)` likewise joins returned paths using the host separator.
- Fix: add a platform layer `src-tauri/src/platform/path.rs` (POSIX semantics: `is_absolute` / `join` / `parent` / `file_name` / `normalize` / `numbered_name` / `name_from_listing` / `is_within`), and route all remote-path judgment and joining through it; SFTP calls just hand the already-assembled string to `Path::new(&s)`; listing item file names are stripped from the host-joined path with `name_from_listing`. The frontend likewise extracts POSIX helpers into `@platform/posixPath`.
- Lesson: **platform-specific judgment must be the platform layer's responsibility**. The host platform (Windows) and the target platform (a Linux host) can be completely different, and once the business layer "casually uses local semantics" to handle a remote path, it writes code that only breaks on this machine. Unit tests must pin down invariants like "contains no backslash" and "`/home` is an absolute path".

### 15.16 Dragging Out of the Window Looks Like a Copy: the `DROPEFFECT_MOVE` Cleanup Was Never Done
- Symptom: dragging a file from the panel to the desktop/File Explorer produced a file at the drop point while the original was still in the panel — the semantics the user saw was "copy", while the app declared "drag = move".
- Cause: Windows' MOVE convention for drag-and-drop is that "the target moves the file over (on the same drive the target renames the source file)", and for cross-drive or when the target only copies, the source must be deleted by **the drag source itself**; passing only `mode: 'move'` to the system without doing the cleanup leaves the source file behind.
- Fix: when `tauri-plugin-drag`'s `startDrag` callback returns `Dropped`, the move is considered complete and the source is cleaned up in step (local → an in-app staged delete, remote → a remote staged delete), and it enters the undo history; in the same-drive case the system has already moved the source away, so a staging failure is quietly skipped as "already gone". Dragging out remotely is still "download to local first, then hand off to the system", but on a successful drop the remote source file is removed, so it's still semantically a move.
- Lesson: a cross-process/cross-system "move" is a two-phase protocol (target transfer + source cleanup); doing only half degrades it into a copy.

### 15.15 the Undo Stack Must Not Keep a Step That "Can Never Be undone"
- Symptom: after the user moved/deleted the file pending undo in another terminal and clicked undo, the undo failed, but the N in "More → Undo Move (N steps total)" never decreased and the menu item stayed listed forever.
- Cause: the early implementation left the failed undo item at the top of the stack "to make retrying easy", but a target that no longer exists is a permanent failure and a retry will never succeed.
- Fix: every `runUndo` call consumes one step off the top of the stack (removed even on failure); on partial failure it says "N items no longer exist (skipped)", and on total failure it reports the reason and explains that the step has been removed from the history; the `files-op` log carries done/error counts for troubleshooting.
- Lesson: retryable semantics apply only to **transient failures**; a permanent failure like "the file is no longer in place" must let the state converge, or the count and the menu will keep lying.

---

## Terminal renderer and CJK width (order of investigation)

- The renderer is chosen in exactly one place: `src/features/terminal/model/xtermRenderer.ts`, WebGL by default with a DOM fallback when the GPU context is lost. Users switch it under Settings → Theme → Terminal renderer (the `terminalRenderer` field in the typography store); the change applies to already open terminals (DOM disposes the addon, WebGL loads it again) and new terminals read the same preference.
- **Check the font before blaming the renderer** when frames and tables drift: the usual cause is a CJK fallback face whose advance is not two Latin cells, so the right border of a table like `│ name │` shifts row by row. The font stack must reach a monospace CJK face (Sarasa Mono SC / Noto Sans Mono CJK SC). Headless e2e environments rarely have those fonts, so they never decide the renderer question.
- The WebGL renderer cannot be screenshotted without a GPU (headless browser / SwiftShader): `.xterm-rows` is empty and captures come back black, because the selection lives in the canvas texture rather than the DOM. Renderer comparisons must run on real hardware.
- Measured fact: the WebGL canvas is device-pixel aligned (CSS width times dpr is exactly integral), so "canvas rounding" does not explain an edge seam. Measure the `screen` / `region` / `canvas` rects before blaming rounding.
- **Whole-pixel character cells (what mainstream terminals do)**: a monospace advance is often fractional (about 8.4px at a 14px font), so `cols * cellWidth` lands off the pixel grid and the canvas keeps a sub-pixel column at its right edge - which is why dragging the window makes the seam come and go. The fix sets `letterSpacing = round(measured cell) - measured cell` on the xterm (at most half a pixel per cell), locking the cell to whole pixels so the grid lands on device pixels; both `useTerminalSession` and `createBlockTerm` set it at creation and recompute it when the font size changes (`snapLetterSpacing` in `terminalFont.ts` has unit tests).
- **The win32-input-mode key capture also swallows copy/paste**: `attachWin32KeyCapture` calls `preventDefault` plus `stopPropagation` in the **capture** phase, so once a session asks for the mode, Ctrl+C is encoded into a key record and sent to the PTY - copy silently stops working. e2e does not enable that mode by default, which is why it never happens locally but always happens on the user's machine. The predicate needs the terminal itself: always let Ctrl+V through, and let Ctrl+C through only when there is a selection (without one it must be encoded, or the session loses its interrupt key). Regression coverage lives in `terminal-clipboard.spec.ts`.
- **A thin line beside a terminal selection is the terminal's own scrollbar**: `.xterm-viewport` is 8px wider than `.xterm-screen` (that lane is the native scrollbar), and the global `::-webkit-scrollbar-thumb` rule (2px transparent border with padding-box) leaves only a ~4px light sliver in its middle, which hugs the selection and reads as a rendering artifact. The running block already hides its own scrollbar with `display: none`; the pane now does too (wheel, trackpad and keyboard scrolling are unaffected). Switching renderers (WebGL/DOM) does **not** change this, so never treat it as a renderer problem.

---

### Native editor input and restored SSH references

Escape routing must use the focused pane ID, because terminal scenes are keyed by pane rather than tab. Only the block-list input shortcut consumes Escape; classic and alternate-screen editors receive it. Some native commits omit keypress while setting the composed flag. Observe xterm onData first, forward only unhandled insertText commits and retain native composition ownership. Diagnostics record event type, size and whether it was consumed, never text. A real POSIX editor test should save a file after normal-mode, insert-mode and Escape commands.

A historical SSH pane can reference a deleted saved profile. Validate the reference before mounting the connection terminal, retain its address snapshot and offer profile replacement or fresh authentication. JSON whitespace and nested pane layouts must not affect history SSH detection or host search. Classic connection sessions do not have a useful command-block count.

---

## Appendix: Methodological Lessons (Distilled from the Pitfalls Above)

1. **Silent failure is the most expensive failure**: swallowing ALTER errors, swallowing SQL failures, swallowing read errors, discarding unknown sequences, silently dropping commands on timeout, INSERT OR IGNORE — at least 6 kinds of "silence" in this project each caused a hard-to-diagnose production symptom. A failure must either be fixed or make noise.
2. **Both ends' accounting must come from the same source**: the character width table (string-width), the PTY dimension tag (flowing with the batch), serde naming (explicit rename_all), the drag index space (unified then projected). Every place where "the two sides each maintain the same fact" has produced a bug.
3. **Build reproduction infrastructure before fixing bugs**: raw PTY capture/replay, a setter trap to catch browser scrolling, eventLog to distinguish environment artifacts from one's own bugs — the three hardest bugs (§2.2, §5.1, §13.2) were all pinned down with it.
4. **Symptom treatment gets reverted; root-cause fixes don't**: the resize debounce (added then reverted) and the two misdiagnoses of nearBottom vs the real culprit, the textarea, are the best contrasting case.
5. **Reproducible data gets dropped and rebuilt; irreproducible data gets versioned migrations**: §8.3 and §8.2 are two answers to the same question, depending on the value of the data.
6. **App-level behavior hooks into the app-level lifecycle**: bugs of the "feature dies when the component unmounts" kind, like the scheduler parasitizing the settings page (§11.7), are prevented by a code review checklist.
7. **Security checks must bind to the actual execution**: the DNS check binds to the IP actually connected to (pinning), HTML sanitization is on both the render and restore sides, known_hosts read-modify-write happens inside the lock. Any "re-resolve/re-read" between validation and use is a bypass window.
