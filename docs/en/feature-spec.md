# Vrykell Feature Spec and Test Checklist

> Last updated: 2026-08-26 (new: AI agent, permission modes, Skills, MCP, settings pages, themes, model management — see sections 16 ~ 20)

## 1. Terminal Core

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| T1 | Shell launch | Automatically connects the local shell after a tab is opened | Launch the app, green dot in the status bar, bottom input bar usable |
| T2 | Command execution | After a command is entered and Enter is pressed, the output is displayed as a Block | Type `ls` and press Enter; a Block appears on the page showing the file list |
| T3 | Real-time output | While a command is still running, the output is visible inside the running block and keeps following | Type `for i in 1 2 3; do echo $i; sleep 1; done` and observe the output line by line |
| T4 | Multi-tab session keep-alive | Switching tabs does not lose shell state | In tab 1 type `export FOO=bar`, switch to tab 2 and back, type `echo $FOO` and it outputs `bar` |
| T5 | Exit code display | The block header shows ✓ (success) or ✗ (exit code) | `true` shows ✓, `false` shows ✗ 1 |
| T6 | TUI fullscreen mode | Programs such as nano/vim/htop automatically take over the fullscreen xterm.js | Type `nano` and the terminal becomes fullscreen |
| T7 | TUI exit restore | Exiting a TUI program restores block list mode | Press Ctrl+X in nano to exit |
| T8 | TUI keyboard passthrough | In TUI mode keyboard input goes straight to the terminal | In fullscreen, keystrokes act directly on the program |
| T9 | TUI hint bar | In fullscreen the bottom shows the "TUI mode" hint | Visual check |

## 2. Block Command Blocks

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| B1 | Compact command block layout | Path and precise duration stay above the bold command. At the default terminal size, the context row is 16px tall with a 2px command gap, output follows after 8px, and top/bottom padding is 16px. Command and output share a 16px outer inset (12px at a shared split edge); vertical spacing follows terminal row height | Unit tests cover context, duration and failure state; E2E measures two-row output height (106px), alignment, spacing and multiline commands |
| B2 | Run status | Path, duration and running indicator remain visible. Exit code, agent marker and branch appear on hover or control focus; failures have a subtle error background and inset rail without moving content. Adjacent failure rails remain continuous across dividers | E2E checks idle, hover and keyboard focus, including running commands, and rail pixels at 1x/2x density; unit tests check failure state |
| B3 | Always-visible output | Command output cannot be collapsed; single-block and global expand/collapse controls and persistence APIs are removed. Legacy collapse flags are ignored without deleting history | Unit and Rust tests restore legacy collapsed records; E2E checks full restored output and absence of collapse controls |
| B4 | Hover controls | Completed blocks have one more button; running interrupt, foreground-process termination and fullscreen controls appear on hover or control focus. Hover and an open menu keep the block background unchanged | Unit tests check accessible names; E2E checks hover, keyboard and stable geometry |
| B5 | AI analysis | The more menu sends the command and up to 2000 output characters to AI in the owning pane | Unit tests check bounded output and pane routing; E2E selects the action in the menu |
| B6 | Re-run | The more menu reruns the command in its owning terminal | Unit tests and E2E check the PTY write |
| B7 | Copy command and output | The more menu has separate command and output copy actions | Unit tests and E2E verify clipboard text |
| B8 | More menu | Hover or keyboard focus reveals the more button; the menu groups rerun, AI analysis, copying and clear actions. Arrow keys navigate; Escape closes and restores focus | Unit tests and E2E check keyboard operation, right-click anchoring and viewport bounds |
| B9 | Block divider | The thin line extends to both edges of the terminal while the text keeps its padding | Run several commands and observe |
| B10 | Context menu | Right-clicking a block pops up a context menu | Right-click the block area |
| B11 | Auto-scroll | Live output follows the bottom through content growth, fractional scroll offsets, viewport resizing and pane remounts; following state is saved separately from position. Scrolling up pauses following and preserves the reading anchor; a new command resumes following. Block history has an overlay scrollbar with a transparent track, preserving full-width backgrounds and dividers; dragging, wheel and keyboard navigation remain available. Embedded-terminal wheel events scroll the outer history while fullscreen terminals retain native scrolling. Diagnostic state markers contain geometry only | Unit tests cover scroll geometry, keyboard input, remounts, hidden panes and layout changes; E2E checks transparent track pixels, dragging and keyboard navigation in both themes, plus streaming growth, manual pause, resizing and new-command resume |
| B12 | Output free of garbage | No OSC sequences such as `]133;D;0` are displayed | Run a command and check the output |
| B13 | Output free of prompt | The shell prompt text is not displayed; after the line editor redraws, block mode marks the start of the output and resets the PTY screen origin, avoiding old authentication text and absolute cursor positions being carried into a new command | Run a command and check the output, prompt leftovers and extra whitespace |
| B14 | Bottom input bar | Terminal and AI inputs use equally sized SVG mode controls. Clicking cwd opens a compact 280px directory menu with transparent flat rows, gray hover/keyboard focus, fixed search and parent navigation above the scrolling child list, keyboard selection, retry and shared local/SSH file operations; selecting a folder submits a safely quoted command while preserving the draft. Empty and repeated Enter each add a normal cwd block with empty command/output. The latest-output button uses a down arrow and retains End | Unit tests cover quoting, search, retry, stale requests and repeated submissions; `terminal-input-navigation.spec.ts` checks navigation, drafts, empty blocks and mode sizing |
| B15 | Output retention and truncation notice | Output beyond the visible height enters the scroll history and does not count as truncation; only when the buffer actually discards earlier lines is it counted and reported; a wide window allocates terminal columns according to the actual content width, preserving the command's own line breaks and alignment | Check that 100 lines of output show no truncation notice; when exceeding the 5000-line scroll history verify the actually discarded line count; in a 1550px window output a single line longer than 160 columns |
| B16 | Concurrent terminal initialization | The same version of the integration script is reused directly, and updates are published atomically via a temporary file; opening several terminals at once never reads a half-written script | Read continuously while starting and updating concurrently, and verify the complete script content |
| B17 | Unified terminal background | Block mode and classic mode both use the terminal-specific background; command blocks, running output, split pane whitespace, the outer input area and the fullscreen terminal stay in sync; switching themes and custom terminal backgrounds stays consistent, and explicit ANSI background colors are preserved | Unit test verifies the running background, theme updates and inverse text; E2E verifies light and dark themes and independent background overrides |
| B18 | Command block action readability | Hover controls use shared 28px icon buttons with 16px icons; the four completed-command actions live only in the more menu. Context stays above content and does not consume command width; long paths truncate while commands wrap | Unit tests and E2E cover menu actions, narrow layouts, Ctrl+C and termination escalation |
| B19 | Stable height on interaction redraw | The display height of the same running command keeps the lines already occupied; clearing the screen and partial redraws do not shrink it and then grow it again; new content may expand the height and real terminal line-count changes may adjust it; content height changes do not trigger width sync | Use the real buffer of a hidden xterm to unit test screen clearing, cursor movement and filled lines; E2E types character by character and replays redraws, verifying stable height and no duplicate terminal size messages |
| B20 | Startup and empty workspace | Supports restoring the last tabs, creating a new default tab, or creating none; closing the last tab shows session history directly without automatically creating a terminal; old active sessions from a non-restore startup are archived to history | Unit test verifies the three startup modes and closing the last tab; E2E verifies selection persistence and closing an SSH tab |
| B21 | Logging and diagnostics | A standalone settings page provides JSONL detailed log export and optional auto-save; auto-save is off by default; logs retain ordering, runtime environment, IPC parameters and durations, terminal state and error stacks while filtering out credentials and body text | Unit test verifies collection, redaction and failure; Rust tests verify export metadata, ordering, dedup and rotation; E2E verifies default-off and export |
| B22 | SSH cursor | The custom SSH cursor blinks with the xterm style, renders in inverse color and respects the terminal cursor hidden state, avoiding covering the character being typed | Unit test verifies block cursor style and hidden state; E2E checks the authentication and interaction screens |
| B23 | Command presentation | Optional syntax coloring applies to native input and command-block headers, preserving text, selection and IME. Brighter theme colors cover subcommands, ordinary arguments, numbers, paths, assignments, variables inside quotes, shell keywords and nested command substitutions; both input and output backgrounds retain readable contrast. Completion stores full suggestions so typing only shortens the muted suffix without shifting the shortcut button. Its compact menu selects acceptance keys (Right, Tab, Shift+Right or a custom modified character), persists them and keeps multiple choices enabled; Tab cycles and Escape restores the prefix. Right-arrow accepts only at the end without a selection. Blue native text carets have a separate token; terminal block cursors retain their original theme colors | Token, preference and completion unit tests; command-presentation.spec.ts covers stable positions, menu placement, shortcut persistence and editing; terminal-background.spec.ts checks original terminal cursor colors |
| B24 | Viewport command title | When a command title scrolls out of view, its cwd, duration and command stay above the output. The title follows the block crossing the viewport top, including running commands; gaps and visible original headings clear it. Hover reveals a collapse control without changing the background. Collapse hides only this title and leaves output and scroll position intact; the collapsed choice is a persisted global preference shared by every pane and kept across launches, so it survives scrolling across commands and returning to the original title until explicitly restored. A small rounded restore control appears only on hover or keyboard focus; its opaque hover background stays legible without reserving output space. Wheel scrolling over the title still scrolls history, and reading anchors stay below the overlay. The existing more menu acts on the viewed command | Viewport selection and collapse unit tests; pinned-command.spec.ts checks scroll switching, top alignment, hover-only restoration, collapse persistence and unchanged output |

## 3. Block Context Menu

| ID | Feature | Expected behavior |
|---|---|---|
| M1 | Copy command | Copies the block's command text |
| M2 | Copy output | Copies the block's output text |
| M3 | Re-run | Re-runs the command in the terminal |
| M4 | Send to AI for analysis | Sends the command + output to the AI |

## 4. Input Area

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| I1 | Command mode | Typing text and pressing Enter runs a command | Default `$` prompt, type `ls` and press Enter |
| I2 | AI mode toggle | Clicking `$` switches it to ⚡, and typed text is sent to the AI | Click `$` to turn it into ⚡, type a question and press Enter |
| I3 | Prompt line | Shows the shell status dot + zsh + CWD + mode label | Observe the top of the input area |
| I4 | Enter to run | Enter runs (not Shift+Enter) | Type a command and press Enter |
| I5 | Shift+Enter newline | Inserts a newline without running | Shift+Enter for multi-line input |
| I6 | Auto-grow | The textarea grows taller automatically for multi-line input | Type multiple lines of text |
| I7 | Send output to AI | Clicking ⤴ sends the last 30 lines of output to the AI | Run a command then click ⤴ |
| I8 | Input layering | The input area uses a faint background and shows no permanent outline; the background strengthens slightly on focus, following the current theme | Click the input box |
| I9 | Draft isolation | Commands and AI each keep their own draft; opening the AI panel restores the command draft, and natural language is never submitted as a command | Type an AI draft then open the panel, press Enter in the terminal, then close the panel and switch back to AI to check the draft |
| I10 | Directory display | Preserves drive letters, root directory and network path prefixes; truncates when space is insufficient and shows the full path on hover | Switch between different paths and narrow the window |

## 5. Shortcuts

| ID | Feature | Shortcut | Test method |
|---|---|---|---|
| K1 | New tab | Cmd/Ctrl+T | Press it, tab count +1 |
| K2 | Close tab | Cmd/Ctrl+W | Press it, tab count -1 |
| K3 | Undo close | Cmd/Ctrl+Shift+T | Close a tab first, then press the shortcut to restore it |
| K4 | Switch tab | Cmd/Ctrl+1..9 | Press the corresponding number |
| K5 | Terminal search | Cmd/Ctrl+F | Press it and the search overlay appears |
| K6 | Command history | Ctrl+R | Press it and the history panel appears |
| K7 | Command palette | Cmd/Ctrl+P | Press it and the search box appears |
| K8 | Open settings | Cmd/Ctrl+, | Press it and settings appear |
| K9 | Fixed page scale | Cmd/Ctrl+±/0, Ctrl+wheel | Page scale and terminal font size stay unchanged |

## 6. Command Palette (Cmd+P)

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| P1 | Open | Cmd+P opens the overlay search box | Press Cmd+P |
| P2 | Search filtering | Typing text filters the command list | Type "New" and only related commands are shown |
| P3 | Keyboard navigation | ↑↓ to select, Enter to run, Esc to close | Keyboard operation |
| P4 | Shortcut display | Each item shows the corresponding shortcut label on the right | Observe the command list |
| P5 | Click the overlay to close | Clicking outside the panel closes it | Click the dimmed background area |

## 7. Tab Bar

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| TB1 | Context menu | Right-clicking a tab shows a menu | Right-click a tab |
| TB2 | Close others | Closes all tabs except the current one | Choose "Close Others" from the context menu |
| TB3 | Rename | Double-click or use the context menu to rename | Double-click a tab to enter editing |
| TB4 | Copy title | Copies the tab title to the clipboard | Choose "Copy Title" from the context menu |
| TB5 | + dropdown | Clicking + pops up new-tab options | Click the + button |
| TB6 | First message naming | The first message of an AI conversation automatically names the tab | Send an AI message and observe the tab title |
| TB7 | Middle-click close | Middle-clicking a tab closes it | Middle-click a tab |

## 8-A. Terminal Empty State

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| E1 | Empty state hint | Guidance text is shown when there are no blocks and no AI messages | Open a new tab and observe the middle area |
| E2 | Hint copy | "Start from a single command", explaining the bottom command input and the AI assistant entry in the top right | Visual check |

## Workspace Navigation and Space Allocation

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| W1 | Vertical navigation | The 44px toolbar holds the session, SSH and resources buttons by default and controls the left panel; the AI and settings entries sit in the top right by default; selection uses a single faint background layer, and the settings entry can be dragged to the left | Click the different entries and observe |
| W2 | Keyboard operation | Toolbar buttons support Tab focus, Enter and Space to toggle panels | Use the keyboard to open and close the session panel |
| W3 | Panel switching | One panel is shown at a time per side; after switching, the session filter, file path and connection filter state are preserved | Edit a filter, switch panels and return |
| W4 | Narrow window | When space is insufficient the panel on the other side collapses, preferring the panel just opened; when resizing the window the already open AI panel is preferred | Open multiple panels in a 720px window |
| W5 | AI entry | The AI assistant can be opened from the top right on first launch | Clear the layout cache and check the entry |
| W6 | Navigation layout customization | The left toolbar and the top-right navigation support drag reordering and two-way cross-side movement, including AI and settings; the dragged icon follows the pointer, the target position frees up a full button slot and other buttons shift automatically; empty areas can receive buttons, cancel restores the original arrangement, and saving only happens on release; an open sidebar moves with its button, same-side reordering keeps it open, and a closed button stays closed after moving; sidebar entries open on the side where the button lives, and the settings entry opens or activates the standalone settings page; left/right order and panel widths are persisted automatically and are not forced back on restart; old layouts automatically gain the settings entry and each button appears only once; window control buttons are fixed | `navigation-drag.spec.ts` actually drags left/right reordering, two-way movement, placeholder shifting, drop stability, empty-side drop, drag-out cancel, the 720px layout, reload and settings page opening; unit tests check open state, persistence, old-config migration and duplicate repair |
| W7 | Split pane guidance | Position selection immediately shows the region boundary, direction label and an Esc cancel hint | Open split pane selection, do not move the mouse, and check the hints |
| W8 | Window and body layering | Sessions, files and connections default to 180, 200 and 208px wide; the top bar and the vertical toolbar share a color; tabs, files, SSH, AI and the settings sidebar share another gray layer; the body uses its own base color, forming three layers, with a 14px outer frame radius, while input boxes keep their original compact size and 8px radius; navigation font size is 13px, session and SSH row height is 40px, selected items use only a single gray layer, and active icons, primary actions and focus hints use neutral gray; the sidebar sits flush with the body, the thin line sits on the real boundary, is low contrast at rest and darkens on hover or drag, and the drag hotspot spans both sides of the boundary; an over-wide sidebar in an old cache is tightened only once, after which the manual width is kept | Switch between sessions, files and connections and drag panel edges |
| W9 | Unified theme colors | Light and dark themes update the window, content, forms, headings and selected states through the same palette; settings use the app content base color, all terminal modes share the terminal-specific background, and settings navigation and forms use the secondary surface; dark-theme body, secondary and muted text reach a 4.5:1 contrast ratio on shared surfaces; restoring the default theme clears old variable overrides | Switch light/dark themes and check settings, the terminal and the AI panel |
| W9a | Unified icons | The whole app uses Fluent UI Regular icons, imported on demand through a shared entry point; icons keep their native shape and stroke weight, inherit the theme color and keep their display sizes and action semantics, and decorative icons do not interfere with accessible names | Unit test verifies display size, SVG, color inheritance and accessible attributes; E2E checks navigation, settings, dropdowns and window buttons in light and dark themes |
| W9b | Icon readability | Workspace navigation icons are 24px, list icons 20px, common actions 18px and auxiliary icons 16px; shared sizes and placeholders stay consistent and icons neither squeeze text nor exceed their buttons | Unit test verifies action icon sizes; E2E checks the display sizes and button bounds of navigation, list and chat actions |
| W9c | Action meaning and click area | SSH uses a connect icon, directory navigation uses a folder arrow, tabs use a tab page and split pane uses a left/right split; common icon buttons are 32px and inline actions 28px, and tab close can be triggered from the keyboard; the thinking level in the model selection dialog shares the themed dropdown | Unit test checks button sizes and model controls; E2E checks click areas, keyboard closing and narrow-window layout |
| W9d | Saved value echo | After auto-save, the actual value after range clamping, rounding and whitespace trimming is shown; empty numeric values show a validation error, and a new draft being saved is not overwritten by an older result | Unit test checks boundaries, empty values and concurrent input; E2E verifies the echoed value matches the value after re-entering settings |
| W9e | Search settings jump | Theme and file open-with results in global search go directly to the corresponding settings page, whether settings is not yet open or already open | Unit test checks first mount and already-mounted navigation; E2E verifies theme and local editor search jumps |
| W9f | AI task draft loop | Unsent text and attachments in the assistant panel are kept per session; they can be continued after switching sessions or closing the panel; edit-and-resend refills the original message and attachments | Unit test verifies session isolation and resend attachments; E2E verifies switching, reopening, sending and edit-and-resend |
| W9g | File read failure recovery | Distinguishes loading, read failure and empty directory; directory and tree expansion failures can be retried; an older directory request cannot overwrite a newer directory | Unit test verifies failure retry, tree expansion recovery and request races; E2E verifies the error hint, retry and falling back to the previous view |
| W9h | Shell and SSH marks | Restore the original custom colored terminal tiles and dark prompt at the original 20px tab-row size; silhouette, palette and prompt colors stay centralized, and unknown shells retain the generic terminal icon | Unit tests verify tile geometry, default size and theme variables; E2E checks modal, tab and SSH marks in both themes |
| W10 | Top search centered | The search bar is horizontally centered on the whole window, with the settings page and the terminal page sharing the same center; in narrow windows the search shrinks in width to avoid covering the title and the window control buttons | Check in 600, 720, 900, 1240 and 1550px windows |
| W10a | Native desktop titlebar | On macOS, native window buttons align with the 48px titlebar, the title reserves their space, and right-side actions keep a 16px edge inset and an 8px gap; fullscreen releases the native-button reservation and restores it on exit; search remains centered and blank titlebar areas remain draggable | Unit tests cover fullscreen changes and native-state failure; E2E checks 720/1240px geometry, fullscreen, search and settings clicks; native geometry probe checks the window buttons |
| W10b | Workspace search palette | Surface-colored grouped results and recent queries have transparent row backgrounds; keyboard selection uses a thin marker. Prefixes `>` actions, `@` settings, `/` files, `!` command history, `#` output and `%` sessions temporarily override source filters; equivalent textual aliases such as `file:` are supported. Bare `>` and `@` list available entries. An active prefix becomes a removable input card and also appears on recent queries, hiding redundant source toggles. The header keeps its normal separator; keyboard navigation and failed-source retry remain available | Unit tests cover prefixes, source isolation, navigation and retry; E2E checks themes, prefixes, transparent rows, actions and a 360px viewport |
| W10c | Literal input and granular setting search | Shared TextInput/TextArea disable correction and capitalization while preserving IME; terminal preedit starts at the cursor and macOS held keys repeat normally. Both global and settings-sidebar search index individual fields, tool permissions and shell modes, with scrolling and control focus, without highlighting the target field; page search remains a fallback for unindexed pages | Unit tests cover literal input, composition, refs, shell identity and granular navigation; E2E checks WebKit inputs, both search entry points and file tabs |
| W10d | Shared control appearance | Flat, bright shell marks, icon controls and SVG modifier/navigation key badges share theme variables. Search has one compact input row and a normal header separator. Hover actions keep command geometry stable. SSH controls share a 32px height | Unit tests cover accessible key hints and themed controls. E2E checks toolbar geometry, SSH control height and light/dark search surfaces |
| W10e | Terminal defaults and panel drop previews | Settings choose the shell used for new tabs, startup and terminal file opening; explicit shell choices take precedence and unavailable shells fall back to the system default. Block and classic output use the same terminal background. Dragging a navigation action near either content edge shows a gray panel preview and release opens it there | Unit tests cover defaults and edge targets; E2E checks persistence, preview cancellation and opening the panel |
| W10f | Consistent action menus and history recovery | Independent action menus replace the previous menu, including right-click openings; clicking inside preserves the current menu. Menus group primary actions, clipboard, editing, view, organization and destructive actions in that order. Classic sessions omit command-block counts; AI messages are separate. Restored SSH references are checked before starting authentication and deleted profiles offer another connection or fresh authentication using the saved address | context-menu-exclusivity.spec.ts verifies menu replacement; unit tests cover menu ordering, history metadata and SSH recovery; E2E restores a deleted profile without entering a connecting loop |
| W10g | Editor input and stable short commands | Escape reaches classic and alternate-screen editors. Native text commits omitted by keyboard events are forwarded once while composition remains owned by xterm. Real wrapped history heights and pre-paint following prevent transient whole-list jumps on short commands | Unit tests cover composition and deduplication; POSIX vi E2E edits and saves a real file, and scroll/performance tests cover long history and short commands |
| W11 | Notification overlay | Bottom-right notifications use the theme gray background, a 10px radius, a light border and a small shadow; state is expressed through icons and no colored side bar is shown; hover-to-pause and close stay available | Trigger a copy failure and close the notification in light and dark themes |
| W12 | Working directory format | In the OSC 7 working directory, no extra URI slash is kept before a Windows drive letter; directory labels in old records are corrected the same way, and percent signs in POSIX, UNC and raw paths are preserved | Check a Windows path with spaces and percent signs and a remote Linux path |
| W13 | Terminal rearrangement | Drag rearrangement is enabled only with multiple split panes, and a running PTY is kept alive; a single terminal does not intercept drags, and the old separate rearrange button is no longer shown | Drag in the blank area of a single terminal, then split and drag to move |
| W14 | Title bar dragging | The window drag handle covers the title text itself, the whitespace between the title and the search bar, and the blank space between the search bar and the navigation buttons; the search bar, navigation buttons and window control buttons keep their own click behavior, and double-clicking the handle maximizes/restores | E2E takes real coordinates at 1240px and 720px to verify whether the hit element carries the drag marker, and confirms that dragging is not triggered at the buttons |

## 8-B. AI Panel Animation

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| AN1 | Show/hide animation | The AI panel expands/collapses with a smooth transition | Send an AI message then clear the conversation |
| AN2 | Transition duration | About 0.25s max-height transition | Visual check |

## 8. Files Sidebar

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| S1 | Directory navigation | A single click on a row only selects; double-clicking a directory enters it and double-clicking a file opens it in the terminal editor; expand/collapse is controlled only by the arrow at the start of the row; after entering, a breadcrumb is shown and the back button returns to the previous file tree view; fast loads replace the list directly and the progress hint is shown only when reading is slower (over 150ms) | Single-click Documents to select, double-click to enter, click the arrow to expand, click back to return; enter an empty directory and observe that the list shows no loading-hint flicker |
| S2 | File type icons | Different file types show different icons | Observe the file list icons |
| S3 | Collapse/expand | Click ◂ to collapse and ▸ to expand; expansion shows a progress hint only when reading is slower (over 150ms), avoiding flicker for fast loads such as empty folders; empty folders render no placeholder row, and a hidden collapse arrow means empty | Click the collapse/expand button; expand an empty folder and observe no flicker, no placeholder row and a hidden arrow |
| S4 | Open file by double-click | When a file is opened by double-click or through the context menu in the terminal editor, a terminal tab is created in the file's directory, and the edit command is written only after the shell reports the prompt is ready (the 133;B marker for bash/zsh/PowerShell; for shells without integration such as CMD the first output segment; old hooks that still show no marker are treated as ready 2.5 seconds after output stops); a startup failure, a closed tab or a timeout gives a clear hint instead of leaving just an empty terminal; the file tree browses independently, keeping the current root directory, expansion state and scroll position, and does not navigate automatically with terminal cd, tab switching or opening the editor; the first open initializes with the current cwd or the home directory | Expand a long file tree, scroll and then open a file in a subdirectory, and check the new terminal command, tree state and scroll position; neither terminal cd nor tab switching changes the currently browsed directory |
| S5 | Disk cards | "This PC" shows small capacity cards per disk, click to enter | Open "This PC", observe the cards and click |
| S6 | Terminal sync | The sync button pushes the file manager's current directory down as a `cd` in the focused terminal | Switch directory then click sync and observe the terminal cwd |
| S7 | Selection and keyboard navigation | A single click highlights the row with the theme selection background; once the file list has focus, ↑/↓ move the selection between visible rows and scroll the target row into view; Enter enters the selected directory or opens the selected file | Click a file row then press ↑/↓ to check the highlight moves, press Enter to check entering/opening |
| S8 | View back | Before each navigation a snapshot of the current file tree view is recorded (root directory, expansion state, selection, scroll position); the back button returns to the previous view rather than a fixed parent directory (the tree supports expansion and can enter deep directories directly); the button is disabled when there is no history; going forward into a directory starts from a blank view at the top | Expand a long directory then double-click directly into a deep subdirectory, click back and check that it returns to the previously expanded and selected view and scroll position |
| S9 | Path editing | Clicking the current path breadcrumb or the breadcrumb blank area switches to a full path input box, with the text fully selected by default for easy copying and editing; Enter jumps to the entered path (normalizing separators and trailing slashes, tolerating the quotes pasted from "Copy as path"), and Esc or clicking elsewhere blurs and cancels; the remaining breadcrumbs still navigate on a single click | Click the breadcrumb to edit the path, press Enter to jump, cancel with Esc and by clicking elsewhere, and confirm the current directory is unchanged without Enter |
| S10 | Path normalization | Local paths are normalized uniformly in the platform layer: `@platform/path` handles path semantics (separators, drive root `C:/`, parent directory) and `@platform/api/fs` normalizes both ways at the IPC boundary, while workspace and search paths are also closed off at the boundary; business layers do not handle separators themselves, so mixed paths such as `C:/Users/foo\.android` do not appear after entering a subdirectory | Unit tests cover platform paths and fs boundary normalization; enter a nested directory on Windows and check the breadcrumb and the path input box |
| S11 | More menu | The rightmost item in the file panel's top bar is the "More" button (the same as the SSH panel, to the right of the back button); the menu offers only currently available actions: download management, and "New tab from the current folder" in a concrete directory (not shown in the drive view); locally unavailable items such as upload do not appear | Open the more menu and check the menu items; verify the tab title of new tab from the current folder, and the number of menu items in the drive view |
| S12 | Multi-select and batch actions | Click selects one, Ctrl/Cmd+click adds or removes, Shift+click selects a contiguous range of visible rows; selected rows are highlighted; when a right-click hits the selection the menu applies to the whole group (copy / cut / delete N items), hiding single-row-only actions such as rename and open with | Ctrl+click two rows then right-click to check the batch menu items and the delete confirmation copy |
| S13 | Clipboard | The context menu and Ctrl/Cmd+C, Ctrl/Cmd+X, Ctrl/Cmd+V all copy/cut/paste, and the paste item is labelled simply "Paste"; paste targets: right-click a folder → inside that folder; right-click a file → that file's sibling folder; right-click blank space or Ctrl+V → the current directory; after pasting the new entry is scrolled into view (the target folder expands when it is a subfolder); cut items appear faded and a cut paste clears the clipboard | After copying, paste by right-clicking a folder, a file, blank space and Ctrl+V respectively, and check the target directory and the scroll position; after cutting check the faded display and the move result |
| S14 | Drag-and-drop move | Hold a row and drag it onto a folder row, onto a file row (dropping into that file's sibling directory) or onto a breadcrumb to move it; the drag preview shows the icon of the dragged file/folder (with a count badge for multi-selection) and the hovered target row is highlighted; Esc cancels; a folder may not be dropped back into its own sibling level or its own subtree; dragging only moves (never copies); pointer events are used inside the panel (on Windows HTML5 drag-and-drop and native file drop are mutually exclusive); dragging out of the window becomes a native OS drag (`tauri-plugin-drag`, effect = move) that can be dropped directly on the desktop/file explorer, and the list refreshes afterwards | Drag a file to Documents and check the move and the target cache refresh; drag onto a file row inside an expanded directory and check it lands in that file's sibling directory; drag out of the window onto the desktop and check the OS side receives the file; dragging into its own subtree is rejected |
| S15 | File operation back | Rename / move (drag, cut-paste, OS drop-in) / delete / create / copy-paste / drag-out-move are all recorded in the back history (up to 20 steps, consecutive backs allowed); the more menu shows "Back <operation>" and includes the step count when there are multiple steps, hides it once exhausted, and does not show it when no file operation has occurred; delete becomes an in-app staged item, and staged items are sent to the OS recycle bin when pushed out of the history or when the app starts; **every back consumes one step**: when the target has already been moved/deleted/renamed elsewhere, a hint is shown and that step is removed, so the count always equals the actual remaining steps | Delete twice in a row then click back twice and check that both steps are restored and the menu item disappears; move a to-be-backed file away in the terminal then click back and check the hint and the decreasing step count; the menu has no back item when nothing has been operated on |
| S16 | SSH panel consistent with local | The remote file panel is not a separate implementation: it shares the `FileOps` interface, `useFileBrowser` and `FilePanel` with the local one, and "operate locally or remotely" is determined only by the `FileOpsTarget` state; single-click select / double-click enter or edit / Ctrl·Shift multi-select / ↑↓+Enter / view back / breadcrumb editing (clicking the root breadcrumb returns to `/` and does not fall back to re-resolving the home directory) / clipboard / back history are all consistent; remote path detection and joining go uniformly through the platform layer (no backslashes or misjudged relative paths on a Windows host); menu and drag-drop semantics are derived from the panel configuration (remote adds upload/download, local adds workspace/open with); dragging out of the window downloads first and then hands over to the OS, and after a successful drop the remote source file is removed with move semantics and enters the back history | Run the same set of interactions in the local and the remote panel respectively and check that behavior is consistent; check that the remote menu has no workspace item and the local menu has no upload item; click the root breadcrumb and check the path is `/`; copy-paste a same-named file remotely and check the avoidance and hint |
| S17 | New file and folder | The context menu offers "New File" and "New Folder": right-click a folder → create inside it, right-click a file → create in that file's sibling directory, right-click blank space → create in the current directory; the default names are Untitled / NewFolder, and after creation the rename input box opens immediately (original name fully selected, Enter submits, Esc keeps the default name); when creating inside an already-expanded directory that directory's child list is refreshed and the new entry is scrolled into view | Right-click to create in a folder row, a file row and blank space respectively, and check the target directory, default name and immediate rename; create inside an expanded directory and check the new entry is visible |
| S18 | Automatic duplicate-name avoidance | Paste, drag, rename and create no longer error on a duplicate name: a number is inserted before the extension automatically (`notes (1).txt`, `Documents (2)`, appending `(1)` when there is no extension), incremented until a free name is found; the returned target path is the real landing path, the back history records the real path, and back restores it accurately; delete goes to staged and restore does not rename | Copy/move a same-named file to the target directory and check the number and the content; rename a file to an existing name and check the number and the back; create a same-named file and check Untitled (1) |
| S19 | Show in file manager | The file/folder context menu and the panel overflow menu offer "show in file manager": a row reveals that entry, the overflow menu reveals the current folder; only the local panel offers it (remote entries have no local path, so the item is hidden) | Right-click a file row and the overflow menu and check the file manager reveals each path; the remote panel menu does not show the item |
| S20 | Hover hints | Every hover hint uses the app's own themed bubble (`data-tip` + `TooltipLayer`): mono type, themed surface and hairline border, ~140ms fade, kept inside the viewport; the unstyled OS `title` tooltip is no longer used | Hover a toolbar icon, a block action button and a sidebar row and check the hints look the same and stay in view |
| S21 | Multi-select lists | Multi-select menus use `CheckboxMenu`: selecting an item toggles it and keeps the menu open so several can be changed in one pass, and it closes only on an outside press or Escape (the search scope filter is the reference case) | Open the search scope filter, toggle two sources and check the menu stays open; press outside to close |
| S22 | SSH reconnect and disconnect | Double-clicking a connection in the SSH panel reconnects: pages of that connection with no live session left (process exited / disconnected) are closed first and a fresh page opens, so no stale retry button remains; when the peer closes the connection during interactive authentication the page shows "process exited" and offers reconnect | Double-click a connection, let authentication time out, then double-click the same connection: the dead page is gone and the new page starts connecting; the disconnected page shows the exit notice and the reconnect action |
| S23 | SSH connection page states | The connection page renders three states through one status row (dot + state + target): connecting = a centred spinner plus a thin progress bar and "Cancel connection", with no explanatory small print; waiting for authentication = an "input mode" single-choice (the shared Select, replacing the button whose label used to flip), no highlight on the prompt line, and the input pinned at the bottom; connection ended = no card: the last lines of output (the reason ssh printed) are printed on the screen as terminal text, selectable for copying, with `[process exited]` appended when missing, while the state text and "Reconnect" stay in the status row | Check the spinner and cancel while connecting; switch the input mode during authentication and check the password box follows; after a disconnect check the reason is printed on the screen, still selectable, and reconnect works; unit tests cover all three states |

## 9. Global

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| G1 | Theme color | Dark background #050505 | Visual check |
| G2 | No bottom status bar | StatusBar has been removed and status information is no longer displayed at the bottom | Visual check that there is no status bar |
| G3 | Terminal copy/paste | No longer copies on selection; the terminal context menu offers Copy and Paste, and the shortcuts are **Ctrl+C / Ctrl+V**: Ctrl+C **copies when there is a selection**, stays the terminal's interrupt without one and Ctrl+V pastes, while Ctrl+Shift+C/V keep working; a session in win32-input-mode must still hit the copy/paste branch first; copy uses the xterm selection or the block-list DOM selection, and paste writes to the focused terminal's PTY | Unit tests verify the copy/paste service (selection, empty selection, no session, PTY write); E2E verifies the context menu items and that the shortcuts write to the clipboard and the PTY |
| G4 | Clear AI conversation | Clicking ✕ clears the current AI conversation | Send a message then click ✕ |

## 10. Terminal Links

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| L1 | HTTP link detection | Links starting with https?:// are clickable | Terminal output contains https://example.com |
| L2 | File path detection | Absolute paths starting with / are clickable | Terminal output /Users/test/file.txt |
| L3 | Git URL detection | Addresses starting with git@ are clickable | Terminal output git@github.com:user/repo.git |
| L4 | Email detection | xxx@xxx formats are clickable | Terminal output user@example.com |

## 11. Toast Notifications

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| TO1 | Rename notification | After renaming a tab, "Renamed to..." pops up | Double-click a tab to rename |
| TO2 | Undo-close notification | After restoring a tab, "Restored closed tab" pops up | Cmd+Shift+T |
| TO3 | Auto dismiss | The toast disappears automatically after 3s | Wait 3s |
| TO4 | Three types | info/success/error use different colors | Trigger toasts of different types |

## 12. AI Conversation

> Note: since 2026-08-21 AI streaming is implemented through `agentStream` (AI SDK + tools) with multiple providers (Anthropic/Gemini/OpenAI-compatible); the original entries in this section align with basic chat behavior, and agent capabilities are in section 16.

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| A1 | Inline display | AI answers are shown above the terminal | Ask a question in ⚡ mode |
| A2 | Code block run | bash code blocks have a ▶ run button | The AI answer contains a bash code block |
| A3 | Markdown rendering | Supports bold, tables and formulas | The AI answer contains markdown |
| A4 | Streaming output | The answer is displayed character by character | Send an AI message and observe |

## 13. Tab Management Enhancements

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| TM1 | Sidebar top bar | The top of the tab panel is, in order, the search box, the session history button and the new button | Open the tab panel and observe |
| TM2 | Session search | The search box filters active sessions by name | Type a title keyword to filter the tab list |
| TM3 | Session history view | Clicking the history button creates a "Session History" tab listing active + historical sessions | Click the history button and click a historical session to restore it |
| TM4 | New dialog | The new button opens a dialog centered on screen showing the machine's available shells + configured SSH connections | Click the new button |
| TM5 | Types shown per machine | macOS shows zsh/bash, Windows shows PowerShell/CMD | Cross-platform verification |
| TM6 | SSH connections | SSH connections are persisted in the backend and the dialog shows the user-defined connection name | Open the new dialog and observe |
| TM7 | Type search | The search box at the top of the dialog filters the types to be created by name | Type a keyword to filter |
| TM8 | Sort by recently opened | Types to be created are sorted by most recent open time, descending | Open different types then observe the order |
| TM9 | Hover close | A close key is shown when a session is hovered (or active) | Hover a tab row |

## 14. SSH Remote Connection Management

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| SSH1 | Management sidebar | A standalone SSH panel (decoupled from settings) with a top bar of search + edit + new | Open the SSH panel and observe |
| SSH2 | Backend persistence | Connection storage/CRUD is in the backend SQLite, and passwords are not echoed back | Add a connection then restart; it is still there |
| SSH3 | List | Connection entries share the single-row style with tabs, the address is shown via a hover hint, and connections are searchable by name | Type a keyword to filter |
| SSH4 | New connection | The new button opens a compact form (480px wide, short fields paired two per row): name/IP/port/account/password or private key/authentication method/jump host/keep-alive/Shell integration/Test connection | Click new, fill in and save |
| SSH5 | Edit/delete | A selected connection can be edited and deleted | Click edit to modify/delete |
| SSH6 | Test connection | Test the connection inside the form, with success/failure hints | Fill in a host and click test |
| SSH7 | Tab linkage | Double-clicking or pressing Enter creates an active terminal tab (the tab title is the connection name) | Click a connection and observe the tab |
| SSH8 | Remote files | Under an SSH tab the file panel connects to the remote machine's directory | Click a connection then open the file panel |
| SSH9 | Host fingerprint confirmation | An unknown fingerprint is confirmed before the SSH session is really opened; known fingerprints are skipped; a changed key refuses the connection; cancel does not start a PTY | Test the first connection, cancel and key change |
| SSH10 | Authentication interaction | SSH block mode follows the remote output: the separate response input appears only when the output really asks for a password/passphrase (password dots enlarged, cleared after sending), and other keystrokes go directly into the interaction screen; after an authentication rejection a response can be given again; servers without a Shell marker keep native xterm interaction and the terminal screen is preserved after entering the alternate screen; cancelling authentication closes the corresponding PTY, clears the session and removes the editable input, and failure can be retried; after receiving the remote prompt marker it switches to command blocks, and old authentication text does not enter the command output | Authentication response, rejection retry, no-integration keystrokes, alternate screen and output isolation tests |
| SSH11 | Form closing | New and edit SSH connections can be closed by clicking the outer overlay, the cancel button or after a successful save; clicks inside the form area do not close | Unit tests and E2E check the overlay, the form area and cancel |
| SSH12 | Form size and reachability | The title and action area are fixed and only the body scrolls; Save/Cancel/Test connection remain fully visible at the minimum window size 720×480 and with enlarged font sizes; text inputs keep a neutral border without focus outlines or shadows; each authentication method button keeps its accessible name | E2E measures the dialog, the buttons, the private key input row bounds and the absence of input focus rings at the default and minimum window sizes |
| SSH13 | Precheck does not block the connection | A failed host fingerprint precheck (e.g. an old server that cannot negotiate algorithms with the precheck library) does not block startup: validation instead falls back to the ssh client, with recorded hosts compared strictly and unknown fingerprints asked inside the terminal; a user cancel or a changed recorded key still aborts | Unit tests cover continuing startup after a precheck failure and aborting on key change; a real-machine probe verifies an old server can connect |
| SSH14 | Block mode command output | Submitting a command from the input bar immediately creates an execution block; streaming output is still shown when the remote lacks OSC 133;C, and a snapshot is saved on the end marker; a late start marker does not create a duplicate block; the remote Shell startup script preserves standard error output | Run ls twice, pwd and an error command in a row; cover both a remote Shell with complete preexec markers and one lacking them |
| SSH14 | Independent file capability degradation | Opening a connection does not force the file panel open; when the file panel is visible it connects on demand; when SFTP is not provided, the file client handshake is incompatible or the jump host is not yet supported, a neutral explanation is shown with expandable technical details and options to keep using the terminal and retry; authentication and real read errors are reported separately, and switching connections does not carry over the old state | Unit tests verify classification and that a hidden panel does not load; E2E verifies a file failure does not affect the terminal and that browsing and further operations resume after recovery |
| SSH15 | Exit state closure | After the remote exits, even if the Windows PTY read side has not yet closed, the frontend is notified that the session is disconnected and the process is cleaned up; only a cancelled authentication shows authentication cancelled, while a normal interactive exit shows disconnected | Native child process exit tests; terminal component tests distinguishing authentication cancel from connected disconnect; real interactive server exit experience |

## 15. Session Lifecycle

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| SL1 | Command block persistence | Every command block is recorded in the backend, and the block count is > 0 after the tab is closed | Run a command → close the tab → view it on the history page |
| SL2 | Command block restore | Restoring a historical session also restores its command blocks | Click restore on the history page and observe the command blocks |
| SL3 | AI conversation persistence | AI Q&A is persisted as session state and backfilled on restore | Send an AI message → close → restore |
| SL4 | Session delete | Historical sessions can be deleted (cascading deletion of blocks and chat) | Click delete on the history page |
| SL5 | Exit/startup archiving | On both exit and startup active sessions are marked as history (startup catches up crashed leftovers), avoiding a dirty active state | Close the app → reopen the history page |
| SL6 | Default naming | The first command becomes the tab title; ssh = connection name; shell = type name | Run a command and observe the title |
| SL7 | cwd restore | Each command block stores its execution directory and restores it independently of the session’s latest cwd, including split panes and search results. Compatible databases gain the column without deleting history; legacy blocks without a path use the saved session cwd when available | Rust tests cover migration and completion upserts; sessionManager tests and session-cwd.spec.ts verify record arguments and restored paths |

---

## 16. AI Agent (Code Agent)

> Implementation is in `src/features/agent/`; the permission mode icon is in the status bar (Shield chip).

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| AG1 | Agent mode | agentMode can be toggled per model: on = all tools registered; off = pure chat | Select Chat / Agent in the mode overlay on the left of the AI panel then send a message, and check per-model persistence and the tool call |
| AG2 | Tool execution | Tools such as run_command/terminal/files are executed from the AI response | Ask the AI to run a command and observe the ToolRun card and the terminal output |
| AG3 | Tool node rendering | Tool calls are displayed as node cards (ToolRunCard) on the rail, showing parameters/results | Observe after the AI calls a tool |
| AG4 | Three permission levels | Standard (decided per tool) / Strict (asked every time) / Allow (passed straight through, dangerous commands still asked) cycle | Click the Shield chip in the status bar to cycle and observe the confirmation dialog |
| AG5 | Smart titles | When block/conversation activity is sufficient the tab title is generated by an LLM | Send a message and observe the tab title change |
| AG6 | Attachments | Attachments (images etc.) can be imported/pasted/saved and are trimmed according to the model's vision capability | Click 📎 in the input bar to add an attachment then send |
| AG7 | Context strategy | Three strategies off/window/compact; compact includes automatic summary compression | Switch the strategy on the settings page and observe the ContextRing usage ring |
| AG8 | Deep thinking | deepThink on (thinkingLevel low/medium/high) passes reasoning parameters through | Adjust per-model deep thinking and thinking level on the model config page then send a message |
| AG9 | Quick model selection | The ModelPill in the input bar/panel switches models; in the panel the mode is on the left and the model on the right, and the mode overlay shows descriptions and a selected background; each model has its own behavior overrides | Click the model pill to switch |
| AG10 | AI dual form | The inline AiBlock (above the terminal) + the global AI panel (dock sidebar) sync in real time | Send inline then open the AI panel and observe |

## 17. Skills

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| SK1 | Skill list | The Skills page in settings lists installed skills (tree + detail panel) | Open Settings → Skills |
| SK2 | Install/disable | Skills can be installed (market or local import), disabled and deleted | Operate then restart to verify the state |
| SK3 | Skill invocation | The AI uses skill content through the skill tool | Send a skill-related instruction and observe the tool call |
| SK4 | Built-in skills | There is a standardSkills built-in set | Observe the built-in skills on the list page |

## 18. MCP

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| MC1 | Server management | MCP page in settings: list/create/delete/start-stop | Add a test server and restart |
| MC2 | Connection setup | After saving, the backend starts a child process and performs the handshake (initialize) | Enable and observe the connection state |
| MC3 | Tool enumeration | The tools of connected servers are registered into the agentStream tool set | Call an MCP tool with the AI and observe ToolRun |
| MC4 | Tool invocation | Forwarded through the `mcp_call_tool` backend, with results backfilled to the AI | Ask the AI to use an MCP tool |

## 19. Settings System

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| ST1 | AI behavior page | Global defaults for agentMode/deep think/context strategy/temperature etc. | Takes effect on the next message after modification |
| ST2 | Model config page | Multi-model CRUD + per-model behavior overrides; all three providers use the configured Base URL, and the gateway uses the corresponding provider's authentication key; switching providers updates the official default address and preserves custom addresses | Save a custom gateway, switch it to current then send a message, and check the actual request address and provider |
| ST3 | Terminal open mode page | zsh/bash/powershell/pwsh can select classic/block mode; CMD uses the interactive classic mode and is compatible with the old block mode setting; SSH block mode enters command blocks after authentication completes; the label stays left and the dropdown is right-aligned | Create a CMD, enter a command and confirm the response; run a command after SSH authentication |
| ST4 | Shortcuts page | Shows the list of currently supported shortcuts | Open Settings → Shortcuts |
| ST5 | Theme page | Terminal theme import/export JSON, background transparency setting | Import a theme file and observe the appearance |
| ST6 | Terminal typography | The theme page adjusts page/terminal size, installed monospace family (including CJK and icon presets), weight 100–900 in 50 steps and line spacing 1.0–1.6, with a live mixed-glyph preview and a shared reset. Commands default to weight 500 and regular text to 400. Preferences persist and immediately update input, running/classic output, snapshots and terminal cell measurements; unavailable fonts use the fallback stack | Unit tests cover validation, migration, persistence, preview and reset; E2E checks fonts, weights and row heights in existing terminals/history, reload and restore |
| ST7 | Settings grouping and selected state | Static section headings and icon rows replace accordion navigation; every page remains directly selectable. The sidebar is 224px wide (192px on narrow windows), with tightly packed 32px rows matching file lists. Related options share a panel under a section heading with inset separators, descriptions on the left and simple controls on the right. Long text and collections stay full width; narrow content columns stack controls below labels. Keyboard selection, automatic saving and search focus remain available without a focus border | Navigation and layout unit tests; settings-layout.spec.ts and settings-feedback.spec.ts cover themes, compact rows, static navigation and persistence |
| ST8 | Unified dropdown | Font size, model thinking level and the skill market repository use the common themed dropdown component; the menu marks the selected option with a check icon (no filled background), and supports disabled items, arrow keys/Home/End, type-to-locate, Enter/Space to confirm, Escape to cancel, and closing on Tab and outside clicks; the overlay avoids container clipping and flips and scrolls according to the window space | Unit tests verify the controlled value, check icon, keyboard and disabled behavior; E2E verifies settings saving, light and dark themes, narrow windows and long lists |
| ST9 | Auto-save | Selections take effect immediately; text saves after a 600ms pause, blur/Enter or page switching. A single page-header summary reports pending/saving/failure; saved confirmation disappears after 1.8 seconds and idle fields show no permanent labels. Failed fields retain local errors and retry. Writes remain serialized, preserve newer drafts and defer during IME composition; invalid MCP drafts are not persisted and delete/cancel undoes pending saves | Unit tests cover aggregation, transient confirmation, debounce, serialization, retry, page switching and IME; E2E covers models, editors, memory, subagents, schedules, MCP and keys |
| ST10 | Default edit command | Both local and remote edit commands are saved as command templates: when `{file}` is present it is replaced with the quoted path, when omitted the path is appended to the end of the command, and `__system__` means hand over to the OS default application; extension templates take precedence over the default command; when the local command is unavailable it degrades in order vim → nano → vi, with separate hints for degradation and system open | Unit tests cover template substitution, argument preservation and `__system__` not triggering editor probing or degradation hints; E2E verifies the settings page saves and echoes back after re-entering |
| ST11 | Terminal renderer setting | The theme page switches between WebGL (default, seamless half blocks) and DOM (cleaner selection edges, slower scrolling): the change applies to already open terminals at once (DOM disposes the WebGL addon, WebGL loads it again), the preference persists and new terminals follow it; a lost GPU context still falls back to DOM | After switching, check open terminals keep working, the setting persists and restore returns to WebGL; unit tests cover reading the preference, applying it both ways and rejecting unknown values |

## 20. Themes

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| TP1 | Wallpaper background | Set a wallpaper data URL, with a fixed full-cover background layer and a uniform content layer opacity | Set a wallpaper and observe |
| TP2 | Transparency | App opacity (only applied when there is a wallpaper) | Adjust the transparency and observe |
| TP3 | Import/export | Export the theme JSON to a file / import from a file | Export then import to restore |
| TP4 | Persistence | Theme configuration is stored as JSON on the Rust side, and at startup `applyCachedWallpaper` runs before async loading to prevent a black screen | Restart the app and observe the wallpaper echo |

| TP5 | Overlay styling | Search, confirmation dialogs, the SSH form, tab and model selectors, menus, attachment previews and notifications share the gray background, light border and rounded corners; search result rows stay transparent with selection markers | Open each overlay in light and dark themes and verify keyboard, confirm and cancel operations; in SSH the empty-input hint is vertically centered and the password dots remain clear after input |
| TP6 | Shared small controls and descriptions | Composer, chat and settings icon actions share color, hover, active and disabled rules; permission controls share state and concise hints; exit codes and durations have no background pills; shortcut badges use shared icons and descriptions use short sentences | `shared-controls.spec.ts` covers permission synchronization, theme overrides, hover hints and settings key badges; unit tests cover mode cycling, disabled actions and result status |
| TP7 | Editor startup query replies | Block terminals answer capability and color queries before view mounting; remounting does not reconnect input forwarding; preserve normal vi key display | Controller unit tests cover pre-mount replies; `real-vi.spec.ts` checks both modes with a real editor, editing and saving, corner frames and request/reply counts |
| TP8 | Input-response repaint batching | Temporary repaint and cleanup share a window capped at 2ms; sustained output retains frame and size thresholds; normal showcmd remains enabled | Rust OutputBatchWindow unit tests and real vi coverage linked to the production batcher, with explicit showcmd and matching PTY dimensions and resize |
| TP9 | Model alignment, typography and wallpaper validation | Model headers align with inputs; UI body weight is 400 and headings mainly 500; wallpaper is saved only after successful image decoding | Wallpaper and SidebarItem unit tests; macos-feedback-refinements.spec.ts covers geometry, weights, file filters and disguised-file rejection |
| TP10 | Shared placement previews and full hit bounds | Panels, splitting and moving share a gray target surface; the whole panel preview accepts release | Navigation pointer unit tests cover hits away from window edges; WebKit compares panel and split surfaces and verifies release across the full frame |
| TP11 | Surface hierarchy | Page → sidebar → panel → floating overlay → editable field uses progressively lighter neutral gray in both themes; the window frame is lighter than sidebars, readouts reuse panels, and focus keeps resting borders without a highlight ring | Palette tests verify brightness, role separation and text contrast; field-surfaces.spec.ts and surface-consistency.spec.ts check all settings pages, field focus, editing and flat search controls |

Surface roles use the following default levels. Nested cards and readouts do not introduce a new fill; borders distinguish their bounds. Text uses primary, secondary and muted levels for content, labels and hints.

| Role | Dark | Light |
|---|---|---|
| Page background | `#1E1E1E` | `#E8E8E8` |
| Sidebars and settings navigation | `#242424` | `#EFEFEF` |
| Window frame and activity rail | `#303030` | `#F5F5F5` |
| Panels, cards and readouts | `#2B2B2B` | `#F5F5F5` |
| Floating dialogs and menus | `#313131` | `#FAFAFA` |
| Editable fields and composers | `#3B3B3B` | `#FFFFFF` |

Global search places only the query in a lighter field, with inset spacing on all sides. Scope, clear and close controls stay flat; recent scope labels and footer shortcuts do not add nested cards. Keyboard focus uses a subtle fill on actions and options rather than a bright edge. Rename fields and split-pane dividers retain their resting border.

## 21. Terminal Performance

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| PF1 | Large history output | Unchanged command blocks are reused and historical output retains real wrapped geometry; historical content and scroll position are preserved | `terminal-performance.spec.ts` loads 200 blocks, about 30k lines, and verifies input, new output and returning to history; regresses bottom-pinning, width, font size, search and copy |
| PF2 | Input during continuous output | Normal interaction does not repeatedly extract HTML; the next batch of PTY output after input is sent with priority | Output 20k lines continuously and send 12 terminal keystrokes, and check that all are delivered and the frame wait; Rust verifies echo priority and batching of continuous output |
| PF3 | Detailed log performance | Auto-save does not call IPC or open the file per event; batched records are ordered, complete and redacted, and flushed before export | Frontend unit tests verify batching 130 records, timing, errors and export order; Rust verifies 1025 records, rotation and write errors; E2E enables logging then tests continuous output input |
| PF4 | Responsive terminal resizing | Fit without clearing the previous frame, repaint resized canvases before presentation, and deduplicate/coalesce pending PTY sizes without a time debounce. Completed commands retain live output until the parsed snapshot is ready. Short commands avoid temporary GPU canvases | Unit tests cover frame repaint, size coalescing and snapshot handoff. `resize-stability.spec.ts` checks continuous narrowing with both renderers and short commands |

Benchmarks and scope of application are in [Terminal Performance Verification](terminal-performance-2026-10-06.md).

## 22. Scrollbars

| ID | Feature | Expected behavior | Test method |
|---|---|---|---|
| SB1 | Terminal history and width changes | Block history uses a 10px transparent overlay track: backgrounds and dividers span the full width without a reserved gutter. Classic mode retains the terminal renderer's transparent track and native navigation. Window, sidebar and split changes resize the PTY and reflow history without horizontal terminal scrolling | `scrollbar.spec.ts`, `block-width.spec.ts` and `follow-bottom.spec.ts` check transparency, dragging, keyboard navigation, reflow and follow state |
| SB2 | Classic terminal scrolling | Uses the terminal's own thumb and scroll buffer; shown on hover or scroll, and history can be viewed after dragging | Output 200 lines, drag the native thumb and check the terminal buffer viewport position |
| SB3 | Long lists and content panels | Settings, tabs, files, SSH, chat, text inputs and popup menus share transparent overlay tracks with themed rounded thumbs. Vertical and horizontal tracks preserve the full content area; tracks stay in the stacking layer of their owning page or popup, so dialogs cover background tracks. Popup tracks follow their clipped surface and dragging keeps menus open | Unit tests cover dynamic surfaces, cleanup and both axes; E2E checks dialog occlusion and restored interaction, settings/chat tracks and long directory menu dragging |
| SB6 | Application window edge | A thin non-interactive border follows macOS window corners and becomes square in fullscreen, without consuming layout space | E2E checks border geometry and pointer behavior |
| SB4 | Input box height restore | The AI and terminal input boxes recompute their height from the text, placeholder, available width and font size; they grow taller when narrowed and shrink back when expanded, up to 120px, preserving the draft | Unit tests verify restore, external draft, hidden restore and font size changes; `composer-resize.spec.ts` actually drags the sidebar and changes the window width to verify empty input and draft restore |
| SB5 | Running block scrollbar | The live xterm inside a running command block no longer stacks a second scrollbar (its own viewport and custom slider are hidden), avoiding a double scrollbar at the right edge; reclaiming that reserved right gutter also keeps it horizontally aligned with completed blocks | `running-terminal-usability.spec.ts` checks that the running block's xterm viewport and sliders are hidden |

## Test Records

| Date | Tester | Passed | Failed | Notes |
|---|---|---|---|---|
| | | | | |
