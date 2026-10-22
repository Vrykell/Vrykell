# Workspace request audit, 2026-10-22

This checklist records the three earlier request sets and their later corrections. Each line has one final behavior and its regression evidence. Where a later request changed an earlier direction, the later direction is authoritative.

## Session and terminal regressions

| ID | Final behavior | Status and evidence |
|---|---|---|
| R1 | The sidebar collapse control has no resting highlight; a completely collapsed sidebar leaves only a top-bar expand action. | Complete. `WorkspaceSidebar` and navigation geometry tests. |
| R2 | Native acrylic is confined to the left navigation and has an opaque platform fallback. | Complete. Theme/material tests and `workspace-surface-refinements.spec.ts`. |
| R3 | Editor, auxiliary and main-region boundaries are square. | Complete. `workspace-usability.spec.ts` and surface tests. |
| R4 | Auxiliary panels begin below the first toolbar and do not create a detached tab strip. | Complete. Nine-grid layout and independent docking tests. |
| R5 | A docked assistant shows one conversation rather than its own conversation-tab strip. | Complete. AI placement tests. |
| R6 | Dragging a tab or group uses the complete component bounds. | Complete. Group-bound and reorder tests. |
| R7 | A full-screen `tail -f`-style command repaints and keeps input after switching tabs and back. | Complete. `manual-fullscreen-regressions.spec.ts`. |
| R8 | Full-screen width changes keep one stable grid and avoid text jitter. | Complete. Manual and alternate-screen resize regressions. |
| R9 | Sending a command to the assistant preserves the complete available command and output. | Complete. `analysis-completeness.spec.ts`. |
| R10 | Titlebar and taskbar close actions can close the app. | Complete. `native-window-close.spec.ts`. |
| R11 | Fixes target `dev`. | Complete. This work is committed on `dev`. |

## Navigation and interface requests

| ID | Final behavior | Status and evidence |
|---|---|---|
| N1 | The left sidebar is drag-resizable, bounded, auto-folds below its minimum and uses a temporary overlay when no normal width remains. | Complete. Sidebar unit and browser tests. |
| N2 | The middle column exposes stable left/right auxiliary docking and preserves panel state while moving. | Complete. `PanelSurfaces` and independent-docking tests. |
| N3 | Left docking actions are full-width shared sidebar rows beneath the workspace navigation. | Complete. Shared `SidebarItem`, geometry assertions in `unified-surfaces.spec.ts`. |
| N4 | Both placement previews use the configured material treatment. | Complete. `placement-previews.spec.ts`. |
| N5 | Read-only editor access is an explicit permission button with the shared elevation menu. | Complete. `ReadOnlyFileAccess` tests. |
| N6 | The terminal workspace exposes a grouped overflow menu. | Complete. Terminal toolbar tests. |
| N7 | Global search is centered relative to the application and compresses before actions collide. | Complete. Navigation layout tests. |
| N8 | Connected tab corners do not expose black seams. | Complete. Folder-corner pixel tests. |
| N9 | Group rename uses the shared menu input; double click does not rename a group. | Complete. Panel and header tests. |
| N10 | Auxiliary surfaces and result toolbars use the auxiliary gray, distinct from the top chrome. | Complete. Unified-surface tests. |
| N11 | Selected workspace and tool rows use a blue icon. | Complete. Unified-surface tests. |
| N12 | A group is a draggable tab container, but its label has no selected state. | Complete. `PanelTabs` and group-drag tests. |
| N13 | SSH opens as a resource dashboard with cards and a table view; collection pauses when the page is inactive or all metrics are disabled. | Complete. `ssh-dashboard.spec.ts`. |
| N14 | Host management remains available as an explicit dashboard mode, with address and recent-connection context. | Complete. Dashboard mode switch and SSH management tests. |
| N15 | Settings model controls use standard shared button sizes and the shared reload control. | Complete. Provider model tests and the shared `ReloadButton`. |
| N16 | The side assistant is titled “AI assistant”. | Complete. Shared navigation labels. |
| N17 | Main AI history and settings actions live in the top instance toolbar; the composer keeps composition actions. | Complete. AI workspace tests. |
| N18 | Conversation settings use a floating panel. | Complete. AI conversation tests. |
| N19 | Local and SSH terminals remain one terminal model. The host page is a jump dashboard; unified history searches terminal and AI records together. | Complete. `unified-history.spec.ts` and terminal workspace tests. |
| N20 | Search controls use the shared field/menu treatment rather than browser-default inputs. | Complete. Shared `TextInput`, history search toggle and search styling tests. |
| N21 | New terminal has a direct default action and an adjacent options action that opens the centered picker. | Complete. Terminal toolbar tests. |
| N22 | Tab exchange uses the complete tab component bounds. | Complete. Group-bound browser regression. |
| N23 | The collapsed expand button has equal left/top visual inset and no fill highlight. | Complete. Sidebar browser geometry. |
| N24 | Desktop material and context-menu capabilities fall back or hide actions on unsupported platforms. | Complete. Platform/material tests. |
| N25 | The agent architecture has an explicit migration direction rather than continuing to expand the renderer-owned runtime. | Complete as a design review. Implementation remains a separate migration. |

## Current follow-up review

| ID | Final behavior | Status and evidence |
|---|---|---|
| C1 | Unified history rows use the shared hover actions for open and copy. | Complete. `unified-history.spec.ts`. |
| C2 | The main AI workspace has no second title bar; native conversation titles rename inline on the instance tab. | Complete. `ai-workspace-tab-rename.spec.ts`. |
| C3 | Crossing toolbar sides targets the actual panel region below the destination toolbar; vertical left-row ordering uses the vertical pointer axis. | Complete. `navigation-drag.spec.ts`. |
| C4 | Group dragging removes the source container from layout, shows one compact preview with no duplicate chip or offset, and restores the group on release. | Complete. `tab-group-drag.spec.ts` rest, hover, drag and release geometry. |
| C5 | The new-tab picker is compact: the default action keeps its emphasis, profile/location/advanced rows use shared dropdown styling, and more-profiles plus new-window rows are removed. | Complete. `new-tab-design.spec.ts`, `NewTabModal.test.tsx`. |
| C6 | Every earlier item is checked against code and tests rather than inferred from a past summary. | Complete. This document and the final audit report. |
| C7 | The application titlebar has no separator; the right panel/terminal boundary keeps its thin line. | Complete. Surface tests. |
| C8 | The gray hierarchy, card radius, card shadows, left-row geometry and selected-icon color are centralized and tested. | Complete. Unified-surface tests. |
| C9 | History search is a right-aligned toolbar action that expands the shared field, closes without discarding the query on focus loss, and clears on Escape. | Complete. `HistoryPage.test.tsx` and history browser scenarios. |
| C10 | A group has no hover-dependent appearance and no count in its title. The colored edge appears only while expanded and is drawn as a layout-free overlay; collapsed groups show no edge and borrow the body-connected dark surface only while they own the active tab, are hovered or are dragged. | Complete. `panel-header.spec.ts` and `tab-group-drag.spec.ts`. |
| C11 | All terminal and AI records use one complete history workspace with filtering, sorting, grouping, archived groups, group organization, notes, stars, locks, batch actions, hover actions and context menus. | Complete. Unified history model, model tests and history E2E suites. |
| C12 | Workspace navigation rows reorder vertically by drag and retain their order; dropping below the last row (the empty sidebar area) also lands at the end. | Complete. `navigation-drag.spec.ts` (including the below-last-row target) and workspace sidebar tests. |
| C13 | Dropping a loose tab on a group member inserts it into that group, including before the first member, instead of swapping the whole group. | Complete. `tab-group-drag.spec.ts`. |
| C14 | History never shows an in-page loading message; the full-height history action spins while data loads. | Complete. Unified history loading state and sidebar tests. |
| C15 | AI instance tabs rename inline with a visible, editable input. | Complete. Folder tab input geometry and `ai-workspace-tab-rename.spec.ts`. |
| C16 | Active filter cards stay on a single line without a scrollbar; secondary history controls collapse into the More menu at narrow widths. | Complete. `unified-history.spec.ts`. |
| C17 | History filter/sort/group menus open against their trigger without double offset. | Complete. `unified-history.spec.ts` menu geometry assertion. |
| C18 | The strip drag is rewritten on the browser tab-strip model: one visible-element sequence with a leading-edge midpoint scan, explicit group-front/start/member/end/standalone semantics and members draggable straight out; a collapsed group drops after itself by default and joins only after a ~400 ms pointer dwell; group-over-group never nests. | Complete. Element-sequence and dwell unit tests in `listReorder.test.tsx`; stress scenarios in `tab-group-drag.spec.ts` and `reorder.spec.ts`. |
| C19 | A left-docked panel keeps the auxiliary surface with no divider above it; command-history group renaming moves into the action menu's input (matching tab groups); settings and history card areas use the canvas gray (32 32 32, matching usage); terminal history, AI history and usage become system singleton tabs inside their own strips (reorderable, never grouped, never written into the tab order, never restored, active color matching the content below); the group's colored edge is an overlay that no longer shortens its tabs. | Complete. Browser regressions in `unified-surfaces`, `workspace-usability`, `command-history`, `singleton-tabs`, `workspace-history-refinements`, `workspace-ai-utilities`, `tab-group-drag` and `panel-header`, plus the related unit tests. |
| C20 | The left dock holds a single panel: its heading shows the title and close button and the left button row is gone; docking a second left panel or closing the left panel returns the previous panel to the right button row so every panel stays reachable. | Complete. Single-left-panel and reachability unit tests in `dock.test.ts`; `independent-panel-docking.spec.ts` and `navigation-drag.spec.ts` browser regressions. |
| C21 | The settings content, session history page and history toolbar use the canvas gray (32 32 32); their cards and the usage cards use 40 40 40; the primary action blue is `#2C67C5` (44 103 197). | Complete. `tokens.test.ts`, `unified-surfaces.spec.ts`, `workspace-usability.spec.ts` and `settings-window.spec.ts`. |
| C22 | The terminal, code and AI workspaces keep a singleton start page: closing the last tab, closing the start page itself, archiving a group or restarting without restored tabs recreates it; start pages cannot be renamed, never enter groups and are not persisted; the old empty-tab welcome and the ACP launch welcome are removed. | Complete. `workspace.test.ts` covers close, start-page close, archiving and cross-area isolation; browser regressions in `sessions`, `singleton-tabs`, `editor`, `git-panel` and `workspace-ai-utilities`. |
| C23 | Startup settings keep a single "restore session history" switch; the old three-way mode migrates to non-restore, which starts on the start page. | Complete. `settings-startup-diagnostics.spec.ts` switch persistence regression. |
| C24 | The code start page keeps the editor strip's More menu and open-file action, the AI start page offers a new conversation, and the history toolbar and its filter card use 32 32 32. | Complete. `editor`, `git-panel`, `workspace-ai-utilities` and `unified-surfaces` regressions. |
| C25 | Auxiliary panels shrink to the dock width (completed min-width chain) so the heading's close button is no longer clipped; the SSH form dialog portals to the body and is no longer covered by side panels. | Complete. Docked-width probe plus `independent-panel-docking` and `ssh-connection-surface` regressions. |
