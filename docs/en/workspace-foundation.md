# Unified workspace foundation

The terminal, code, AI and common workspaces use the same layout-owning tab, scoped group, selection and lifecycle contracts. A tab-strip row identifies a container, including when that container has only one pane. Resource handles supply presentation and never own placement.

## Model at a glance

```
domain stores                canonical workspace layer                 shared UI
terminal tabs / panes   ->   WorkspaceContainer { scope, layout,  ->   useWorkspaceContainerTabs
documents / comparisons      focused, group, history }                FolderTabs -> GroupedTabList
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
| Tab identity, scope, title, focused pane, group membership | `model/workbench.ts`, `stores/workbench.ts` | Native owners retain process, document and conversation identities |
| Binary pane tree, traversal, replacement, collapsing removal and ratios | `src/core/paneTree.ts` | `WindowLayout` is the terminal-leaf instantiation of the same tree; placement converts it to resource references |
| Pane geometry and placement | `src/core/paneLayout.ts` | Terminal wire conversion and responsive fitting feed the same canvas |
| Resource capabilities, activation, guarded closure, deletion and serialization | `model/paneResource.ts`, `services/workspaceResources.ts` | Terminal process/history, document buffers, comparisons, conversations and agent references |
| Scoped groups, strip order and tab actions | `useWorkspaceContainerTabs`, `GroupedTabList` | Domain providers supply icons, titles, creation and system-page actions |
| Close, undo, detach, merge, batch delete/archive and synchronization | `services/workbench.ts` | Native terminal ownership transfer preserves stable pane identities |
| Versioned snapshots and history write queues | `stores/workbench.ts`, `services/workspaceHistory.ts` | Existing native session rows and reference-only workspace history records |

The shared `workspace-containers-v2` snapshot stores containers, pane references, scoped groups, per-scope selection and interleaved group/loose-tab order. It is the only workspace layout record: older area layout keys and navigation order are not read. Area stores expose the selected container as a read-only projection; they do not own independent area layouts. Native session hydration completes before reconciliation or snapshot writes may discard unavailable references.

The native terminal session payload is the boundary encoding used by current history. It is validated for finite ratios, bounded depth/count, valid terminal metadata and unique pane identities. Its traversal, ratio updates and geometry use the shared algorithms. The `workspace` row kind is metadata, never a native page or a process owner. Resource repositories and singleton utility pages remain domain concerns; the side panel remains a placement of an existing conversation host.

## Resource presentation routing

Every action that creates or moves a resource into the workspace uses one presentation rule. When the current area is not the unified workspace, the resource is activated in its native area: files open in the code workspace, terminal-backed opens in the terminal workspace, and conversations or agents in the AI workspace. In the unified workspace, opening a resource creates its own tab or activates its existing tab, preserving every existing layout. The resource switcher follows the same rule. Only an explicit split action inserts a pane into the selected composition.

This rule covers preferred-editor and terminal file opens, file-panel new tabs, AI side conversations moved back to the workspace, SSH and command-history terminal launches. Resource activation remains the native owner's responsibility after routing.

## Pane actions and split flow

Pane context menus use one order in every scope: Split tab, Change pane position, Move pane to new tab, Remove pane. A single pane exposes these actions with invalid movement/removal disabled. Terminal panes append clipboard, running-command and SSH actions, and show a single-terminal close action when only one pane remains. Pane zoom and terminal-type splitting are absent from the context menu. The tab action menu exposes the same common pane actions.

Change pane position is a shared placement mode: the moving pane is removed from the target geometry before the overlay is measured, and `moveWorkspacePane` reinserts the same pane identity at the chosen slot. It keeps focus on the moved pane and persists the resulting terminal order through the existing workbench projection.

Splitting is always an explicit placement action and stops at four panes. In the unified workspace, splitting a terminal opens the shared split-resource menu (existing unplaced resources, new terminal/file/conversation, file picker or agent) instead of creating a terminal by default. Native terminal splitting still selects a slot first and inherits the focused terminal type; the terminal-type picker remains a native terminal action. Global shortcuts follow the same rule: the unified shortcut opens the split menu, while native terminal shortcuts keep their inheritance/direct-split behavior.

## Lifecycle and history

Switching a tab restores its entire pane tree and focused pane. Choosing an existing resource opens or selects its owning container, including in the common workspace. Splitting is an explicit placement action. Detach and merge keep pane/resource identities and live content hosts; terminal effects follow the stable pane identity while reading the current persistence owner.

All close guards complete before a batch changes resources. Deleting a group deletes every member through the resource protocol and then removes the group/history metadata. Document deletion closes its view; it does not unlink the file. Conversation deletion does not create a replacement conversation during a batch. Agent deletion forgets the local durable reference. Archive is a separate confirmed action that retains the original group and restorable history. Storage failures retain a persistent error with retry, details and dismissal.

Terminal detach/merge serializes history writes behind ownership transfer. The database transaction moves only the selected pane's command blocks and pane chat. Removing a mixed group's terminal pane deletes that pane's history without deleting siblings. Merged source sessions are removed only after transfer succeeds. In-memory chat follows the same pane identity, and history references locate the transferred pane's current owner.

Workspace history writes serialize by both live container and durable history identity, including restoration into a different live container. Pane and history identities use bounded generated identifiers rather than document paths. Close, autosave, archive and deletion share the queues. Retries retain the captured identity even after closure or reuse of a live container identifier. Suppression checks the queued request's captured identity; reopening clears the appropriate suppression and writer cache. Session history contains only terminal, conversation and agent references with layout metadata; it excludes files, comparisons, drafts, transcript contents and credentials. Live workspace restoration retains complete file references and draft guards separately. Both write boundaries exclude file members. Initialization deletes old file-only history and prunes file panes from mixed records while repairing focus. File-only groups do not offer session archival.

## Verification contract

`npm run test:workbench` requires **100% statements, branches, functions and lines** across the explicit shared foundation in `vitest.workbench.config.ts`. It includes the generic tree/geometry, workbench models/stores/lifecycle, resource/history adapters, feedback store and common tab provider. No source coverage-ignore directives or uncovered-code exclusions are used. This gate is for the unified foundation; it does not claim 100% coverage for unrelated application features or native code.

Unit regressions cover all scopes, independent layouts, malformed snapshots, hydration barriers, shared operations, guards, history queues, suppression, retries, partial ordering, native ownership transfer and retained process hosts. Browser regressions cover group creation/rename/membership/collapse/colors/confirmation/deletion in all four scopes, narrow/wide layouts, common-workspace restoration and terminal merge/detach without process restart. Native tests cover transactional transfer, sibling-safe deletion, partial group ordering and history metadata validation.
