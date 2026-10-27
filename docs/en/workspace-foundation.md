# Unified workspace foundation

The terminal, code, AI and common workspaces use the same layout-owning tab, scoped group, selection and lifecycle contracts. A tab-strip row identifies a container, including when that container has only one pane. Resource handles supply presentation and never own placement.

## Model at a glance

```
domain stores                canonical workspace layer                 shared UI
terminal tabs / panes   ->   WorkspaceContainer { scope, layout,  ->   useWorkspaceContainerTabs
documents / comparisons      focused, zoomed, group, history }        FolderTabs -> GroupedTabList
conversations / agents       WorkbenchSnapshot { tabs, groups,          WorkspacePaneCanvas
                             selected, order }                         ResourceContent slots
                             |
                             +-> paneTree / paneLayout (geometry and tree operations)
                             +-> workspaceHistory (references + serialized writes)
```

- A container owns placement; the native store owns the process, buffer or conversation. A resource has at most one placement per scope, plus an optional placement in the mixed scope.
- Every strip row comes from a container. Utility pages and start pages remain singletons and only participate in strip ordering.
- The workbench snapshot is the only persisted tab/group/selection/order state. Area stores expose the selected container as a read-only projection, never a second layout.
- Pane operations share `paneTree`, `paneLayout` and `WorkspacePaneCanvas`; terminal wire layouts and native session payloads are adapters at the persistence boundary.
- Close, delete, archive, detach, merge and restore go through the same resource protocol and history queues.

## Ownership and boundaries

| Concern | Canonical owner | Boundary adapters |
| --- | --- | --- |
| Tab identity, scope, title, focused/zoomed pane, group membership | `model/workbench.ts`, `stores/workbench.ts` | Native owners retain process, document and conversation identities |
| Binary pane tree, traversal, replacement, collapsing removal and ratios | `src/core/paneTree.ts` | `WindowLayout` is the terminal-leaf instantiation of the same tree; placement converts it to resource references |
| Pane geometry and placement | `src/core/paneLayout.ts` | Terminal wire conversion and responsive fitting feed the same canvas |
| Resource capabilities, activation, guarded closure, deletion and serialization | `model/paneResource.ts`, `services/workspaceResources.ts` | Terminal process/history, document buffers, comparisons, conversations and agent references |
| Scoped groups, strip order and tab actions | `useWorkspaceContainerTabs`, `GroupedTabList` | Domain providers supply icons, titles, creation and system-page actions |
| Close, undo, detach, merge, zoom, batch delete/archive and synchronization | `services/workbench.ts` | Native terminal ownership transfer preserves stable pane identities |
| Versioned snapshots and history write queues | `stores/workbench.ts`, `services/workspaceHistory.ts` | Existing native session rows and reference-only workspace history records |

The shared `workspace-containers-v2` snapshot stores containers, pane references, scoped groups, per-scope selection and interleaved group/loose-tab order. It is the only workspace layout record: development builds do not read older area layout keys or navigation order. Area stores expose the selected container as a read-only projection; they do not own independent area layouts. Native session hydration completes before reconciliation or snapshot writes may discard unavailable references.

The native terminal session payload is the boundary encoding used by current history. It is validated for finite ratios, bounded depth/count, valid terminal metadata and unique pane identities. Its traversal, ratio updates and geometry use the shared algorithms. The `workspace` row kind is metadata, never a native page or a process owner. Resource repositories and singleton utility pages remain domain concerns; the side panel remains a placement of an existing conversation host.

## Resource presentation routing

Every action that creates or moves a resource into the workspace uses one presentation rule. When the current area is not the unified workspace, the resource is activated in its native area: files open in the code workspace, terminal-backed opens in the terminal workspace, and conversations or agents in the AI workspace. When the current area is the unified workspace, the resource is created natively and a reference is added to the active composition instead; the area stays unified. If the active composition already holds four panes, the reference opens in a new composition tab.

This rule covers preferred-editor and terminal file opens, file-panel new tabs, AI side conversations moved back to the workspace, SSH and command-history terminal launches. Resource activation remains the native owner's responsibility after routing.

## Pane actions and split flow

Pane context menus use one order in every scope: Split tab, Change pane position, Zoom pane / Restore panes, Move pane to new tab, Remove pane. Terminal panes append clipboard, running-command, SSH and terminal-type actions, and show a single-terminal close action when only one pane remains. The tab action menu exposes the same common pane actions.

Change pane position is a shared placement mode: the moving pane is removed from the target geometry before the overlay is measured, and `moveWorkspacePane` reinserts the same pane identity at the chosen slot. It clears zoom before opening the overlay, keeps focus on the moved pane and persists the resulting terminal order through the existing workbench projection.

Splitting is always an explicit placement action and stops at four panes. In the unified workspace, splitting a terminal opens the shared split-resource menu (existing unplaced resources, new terminal/file/conversation, file picker or agent) instead of creating a terminal by default. Native terminal splitting still selects a slot first and inherits the focused terminal type; the terminal-type picker remains a native terminal action. Global shortcuts follow the same rule: the unified shortcut opens the split menu, while native terminal shortcuts keep their inheritance/direct-split behavior.

## Lifecycle and history

Switching a tab restores its entire pane tree, focused pane and zoom state. Choosing an existing resource in a native workspace opens or selects its owning container; the common workspace's switcher moves the reference into the active composition and focuses it when already present. Splitting is an explicit placement action. Detach and merge keep pane/resource identities and live content hosts; terminal effects follow the stable pane identity while reading the current persistence owner.

All close guards complete before a batch changes resources. Deleting a group deletes every member through the resource protocol and then removes the group/history metadata. Document deletion closes its view; it does not unlink the file. Conversation deletion does not create a replacement conversation during a batch. Agent deletion forgets the local durable reference. Archive is a separate confirmed action that retains the original group and restorable history. Storage failures retain a persistent error with retry, details and dismissal.

Terminal detach/merge serializes history writes behind ownership transfer. The database transaction moves only the selected pane's command blocks and pane chat. Removing a mixed group's terminal pane deletes that pane's history without deleting siblings. Merged source sessions are removed only after transfer succeeds. In-memory chat follows the same pane identity, and history references locate the transferred pane's current owner.

Workspace history writes serialize by both live container and durable history identity, including restoration into a different live container. Pane and history identities use bounded generated identifiers rather than document paths. Close, autosave, archive and deletion share the queues. Retries retain the captured identity even after closure or reuse of a live container identifier. Suppression checks the queued request's captured identity; reopening clears the appropriate suppression and writer cache. History snapshots contain references and layout metadata, never transcript contents or credentials. Unsaved documents retain their existing save/discard guards; unavailable or discarded draft references report an explicit restoration failure.

## Refactoring review

| Finding | Resolution |
| --- | --- |
| Opening files and moving AI conversations chose navigation targets inconsistently | Added one presentation rule: native areas route to the resource's workspace, unified adds a reference and stays unified |
| Pane menus differed by scope and had no reposition action | Added one common action order and a shared pane-move overlay for terminal, code, AI and unified panes; tab action menus expose the same common actions |
| Unified terminal split silently inherited a terminal and skipped the split picker | Unified split now opens the shared split-resource menu; the pending-terminal-split path was removed |
| Terminal pane menus offered split/type actions at four panes | Split and terminal-type entries now follow the same four-pane limit as every other pane menu |
| Resource-projection rows could masquerade as tabs | Removed the projection-only tab model and native composition-page variant; every content row comes from a canonical container |
| Terminal, scoped and common trees repeated mutation/geometry code | Shared generic tree operations, ratio updates, geometry and pane canvas; retained only wire/domain adapters |
| Terminal store retained unused group mutation/archive APIs | Removed those APIs and their obsolete semantics; group actions use the common lifecycle service |
| Scoped and common pane removal bypassed the common batch guards | Routed both through `removeContainerPane` |
| Restoring an existing container changed its strip position | Release peer resource references while retaining the destination's identity and position |
| Startup reconciliation could erase a not-yet-hydrated layout | Added the hydration/write barrier and reruns the common workspace effect when hydration finishes |
| Visible group reordering could disturb other scopes or archived history | Persist partial order within saved slots; retain hidden and unrelated groups |
| Terminal detach could lose history or restart a process | Transactional pane ownership transfer, serialized writes, stable content hosts and owner references |
| Closing/deleting a mixed terminal member could remove sibling history | Added bounded pane-specific deletion and delete the owner only when no live sibling remains |
| Batch conversation deletion could create a new unwanted member | Added resource-owned deletion without automatic fallback activation |
| Pending merge placement could be covered by fullscreen output | Fullscreen visibility observes shared placement state |
| Corrupt terminal layout could reach live hydration unchecked | Added bounded validation before conversion/restoration |
| Navigation and AI stores still exposed independent strip ordering | Removed live ordering APIs and resource-projection ordering; editor command navigation reads the canonical container order |
| Utility-page dragging was omitted from the common ordering path | Utility identities participate in the same persisted strip order and numeric selection, while retaining singleton routing |
| Resource focus could unmount the header controlling an active drag | Transfer the captured gesture to the same visible logical list until release or cancellation |
| Visiting the AI sidebar could register an unwanted default conversation | Mount only explicitly registered main and side resources |
| Startup activation could replace settings or an explicitly selected utility page | Preserve those destinations while aligning restored resource selection |
| Long paths could invalidate pane or history identifiers | Generate bounded identities and validate long-path snapshot round trips |
| Closing and restoring the same history record could race across container queues | Serialize by durable history identity and retain immutable retry identities |
| Retrying partial group creation could create duplicate groups | Retain the generated group identity across retries and make database creation idempotent |
| Merge, cloning and directory updates retained local recursive tree walkers | Route them through the shared tree update/map operations |
| History could target the former owner after a pane moved out while its siblings remained | Find the pane's current persisted owner before restoration |
| Replacing a start placeholder could leave selection on a removed container | Route placeholder removal through the same selection-repair path as other removals |
| A native terminal activation that kept the same focused pane could leave the strip on another container | Follow the native active session identity separately from pane focus |
| Renaming a one-resource conversation tab changed only the label | Delegate the rename to the conversation owner and keep the tab and history title aligned |
| Group headers were buttons without the shared drag handle, and cross-group drops lost their units | Restore the group-header handle, accept tab/group units across boundaries and append a group dropped on the ungrouped tail |
| A tab dropped onto a grouped member could be ungrouped again by synchronization | Capture the destination group before the canonical update and persist that group explicitly |
| The common-workspace switcher opened a second tab instead of extending the active composition | Move the reference into the active composition, release its previous placement and focus it when already present |
| Area projections still carried an unused tab order and start-open flag | Remove the second order state; the workbench snapshot is the only strip order |
| Legacy per-area layout keys and the old navigation order were still read | Removed both readers; `workspace-containers-v2` is the only workspace layout record |
| Session restore still parsed pre-layout `shellType` and `ssh` payloads | Restore requires the current `{ layout }` payload |
| History metadata parsed pre-layout terminal payloads | History reads only the current terminal pane tree |
| Pane transfer and deletion still handled null legacy pane rows | Both operate on explicit pane ids only |
| The old native `workspace` tab kind still had a routing entry | Removed the route and its stale tests |
| Dock layout still read v3-v5 records and renamed legacy entries | Read only the current `dock-layout-v6` record; unknown versions reset to defaults |
| Foundation copy was hardcoded in Chinese inside code | Route default titles, limits, empty hints, restore failures and degraded-restore notices through the i18n catalog |

The remaining adapters only convert current domain payloads: terminal session JSON, document and comparison references, and conversation or agent references. They are not alternate tab, tree, group or close implementations, and they do not read older data formats. Native editor and agent pages register resource hosts; content-strip rows come from canonical containers. Utility pages retain singleton routing and use the same ordering mechanism. New workspace behavior belongs in the canonical model/service/provider, with a domain adapter only when process, content or storage behavior differs.

The generic interface scanner also ran in strict mode. Its 64 repository-wide findings require manual interpretation: the selector pattern treats authored `Select` components as native tags, wrapper buttons forward their actions through props, textarea sizing is owned by shared styles, and test fixtures are scanned as product UI. The tab track deliberately hides its native scrollbar while the application has global themed scrollbar rules. No new group or pane surface appears in that report. This is a recorded heuristic report, not a claimed clean scanner result.

## Verification contract

`npm run test:workbench` requires **100% statements, branches, functions and lines** across the explicit shared foundation in `vitest.workbench.config.ts`. It includes the generic tree/geometry, workbench models/stores/lifecycle, resource/history adapters, feedback store and common tab provider. No source coverage-ignore directives or uncovered-code exclusions are used. This gate is for the unified foundation; it does not claim 100% coverage for unrelated application features or native code.

Unit regressions cover all scopes, independent layouts, malformed snapshots, hydration barriers, shared operations, guards, history queues, suppression, retries, partial ordering, native ownership transfer and retained process hosts. Browser regressions cover group creation/rename/membership/collapse/colors/confirmation/deletion in all four scopes, narrow/wide layouts, common-workspace restoration and terminal merge/detach without process restart. Native tests cover transactional transfer, sibling-safe deletion, partial group ordering and history metadata validation.
