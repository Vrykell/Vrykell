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
- The workbench snapshot is the only persisted tab/group/selection/order state. Area stores expose the selected container as a compatibility projection, never a second layout.
- Pane operations share `paneTree`, `paneLayout` and `WorkspacePaneCanvas`; terminal wire layouts and native session payloads are adapters at the persistence boundary.
- Close, delete, archive, detach, merge and restore go through the same resource protocol and history queues.

## Ownership and migration

| Concern | Canonical owner | Boundary adapters |
| --- | --- | --- |
| Tab identity, scope, title, focused/zoomed pane, group membership | `model/workbench.ts`, `stores/workbench.ts` | Native owners retain process, document and conversation identities |
| Binary pane tree, traversal, replacement, collapsing removal and ratios | `src/core/paneTree.ts` | `WindowLayout` is a type alias with the older `dir` wire field; the reference tree uses `direction` |
| Pane geometry and placement | `src/core/paneLayout.ts` | Terminal wire conversion and responsive fitting feed the same canvas |
| Resource capabilities, activation, guarded closure, deletion and serialization | `model/paneResource.ts`, `services/workspaceResources.ts` | Terminal process/history, document buffers, comparisons, conversations and agent references |
| Scoped groups, strip order and tab actions | `useWorkspaceContainerTabs`, `GroupedTabList` | Domain providers supply icons, titles, creation and system-page actions |
| Close, undo, detach, merge, zoom, batch delete/archive and synchronization | `services/workbench.ts` | Native terminal ownership transfer preserves stable pane identities |
| Versioned snapshots and history write queues | `stores/workbench.ts`, `services/workspaceHistory.ts` | Existing native session rows and reference-only workspace history records |

The shared `workspace-containers-v2` snapshot stores containers, pane references, scoped groups, per-scope selection and interleaved group/loose-tab order. Older area layout keys are read for migration and are not written as parallel state. Area stores expose the selected container as a compatibility projection; they do not own independent area layouts. Native session hydration completes before reconciliation or snapshot writes may discard unavailable references.

The native terminal session payload remains a boundary encoding for existing history. It is validated for finite ratios, bounded depth/count, valid terminal metadata and unique pane identities. Its traversal, ratio updates and geometry use the shared algorithms. The historical `workspace` row kind is metadata, never a native page or a process owner. Resource repositories and singleton utility pages remain domain concerns; the side panel remains a placement of an existing conversation host.

## Lifecycle and history

Switching a tab restores its entire pane tree, focused pane and zoom state. Choosing an existing resource in a native workspace opens or selects its owning container; the common workspace's switcher moves the reference into the active composition and focuses it when already present. Splitting is an explicit placement action. Detach and merge keep pane/resource identities and live content hosts; terminal effects follow the stable pane identity while reading the current persistence owner.

All close guards complete before a batch changes resources. Deleting a group deletes every member through the resource protocol and then removes the group/history metadata. Document deletion closes its view; it does not unlink the file. Conversation deletion does not create a replacement conversation during a batch. Agent deletion forgets the local durable reference. Archive is a separate confirmed action that retains the original group and restorable history. Storage failures retain a persistent error with retry, details and dismissal.

Terminal detach/merge serializes history writes behind ownership transfer. The database transaction moves only the selected pane's command blocks and pane chat, including legacy primary-pane rows. Removing a mixed group's terminal pane deletes that pane's history without deleting siblings. Merged source sessions are removed only after transfer succeeds. In-memory chat follows the same pane identity, and old history references can locate the transferred pane's current owner.

Workspace history writes serialize by both live container and durable history identity, including restoration into a different live container. Pane and history identities use bounded generated identifiers rather than document paths. Close, autosave, archive and deletion share the queues. Retries retain the captured identity even after closure or reuse of a live container identifier. Suppression checks the queued request's captured identity; reopening clears the appropriate suppression and writer cache. History snapshots contain references and layout metadata, never transcript contents or credentials. Unsaved documents retain their existing save/discard guards; unavailable or discarded draft references report an explicit restoration failure.

## Refactoring review

| Finding | Resolution |
| --- | --- |
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
| Corrupt legacy terminal layout could reach live hydration unchecked | Added bounded validation before conversion/restoration |
| Legacy navigation and AI stores still exposed independent strip ordering | Removed live ordering APIs and resource-projection ordering; editor command navigation reads the canonical container order |
| Utility-page dragging was omitted from the common ordering path | Utility identities participate in the same persisted strip order and numeric selection, while retaining singleton routing |
| Resource focus could unmount the header controlling an active drag | Transfer the captured gesture to the same visible logical list until release or cancellation |
| Visiting the AI sidebar could register an unwanted default conversation | Mount only explicitly registered main and side resources |
| Startup activation could replace settings or an explicitly selected utility page | Preserve those destinations while aligning restored resource selection |
| Long paths could invalidate pane or history identifiers | Generate bounded identities and validate long-path snapshot round trips |
| Closing and restoring the same history record could race across container queues | Serialize by durable history identity and retain immutable retry identities |
| Retrying partial group creation could create duplicate groups | Retain the generated group identity across retries and make database creation idempotent |
| Merge, cloning and directory updates retained local recursive tree walkers | Route them through the shared tree update/map operations |
| Old history could target the former owner after a pane moved out while its siblings remained | Find the pane's current persisted owner before restoration, retaining the legacy primary-pane fallback |
| Replacing a start placeholder could leave selection on a removed container | Route placeholder removal through the same selection-repair path as other removals |
| A native terminal activation that kept the same focused pane could leave the strip on another container | Follow the native active session identity separately from pane focus |
| Renaming a one-resource conversation tab changed only the label | Delegate the rename to the conversation owner and keep the tab and history title aligned |
| Group headers were buttons without the shared drag handle, and cross-group drops lost their units | Restore the group-header handle, accept tab/group units across boundaries and append a group dropped on the ungrouped tail |
| A tab dropped onto a grouped member could be ungrouped again by synchronization | Capture the destination group before the canonical update and persist that group explicitly |
| The common-workspace switcher opened a second tab instead of extending the active composition | Move the reference into the active composition, release its previous placement and focus it when already present |
| Area projections still carried an unused tab order and start-open flag | Remove the second order state; the workbench snapshot is the only strip order |
| Foundation copy was hardcoded in Chinese inside code | Route default titles, limits, empty hints, restore failures and degraded-restore notices through the i18n catalog |

The retained adapters have explicit owners and compatibility purposes. They are not alternate tab, tree, group or close implementations. The legacy terminal-strip order is a read-only migration input and is no longer written by navigation. Native editor and agent pages register resource hosts; content-strip rows come from canonical containers. Utility pages retain singleton routing and use the same ordering mechanism. New workspace behavior belongs in the canonical model/service/provider, with a domain adapter only when process, content or storage behavior differs.

The generic interface scanner also ran in strict mode. Its 64 repository-wide findings require manual interpretation: the selector pattern treats authored `Select` components as native tags, wrapper buttons forward their actions through props, textarea sizing is owned by shared styles, and test fixtures are scanned as product UI. The tab track deliberately hides its native scrollbar while the application has global themed scrollbar rules. No new group or pane surface appears in that report. This is a recorded heuristic report, not a claimed clean scanner result.

## Verification contract

`npm run test:workbench` requires **100% statements, branches, functions and lines** across the explicit shared foundation in `vitest.workbench.config.ts`. It includes the generic tree/geometry, workbench models/stores/lifecycle, resource/history adapters, feedback store and common tab provider. No source coverage-ignore directives or uncovered-code exclusions are used. This gate is for the unified foundation; it does not claim 100% coverage for unrelated application features or native code.

Unit regressions cover all scopes, independent layouts, malformed snapshots, hydration barriers, shared operations, guards, history queues, suppression, retries, partial ordering, native ownership transfer and retained process hosts. Browser regressions cover group creation/rename/membership/collapse/colors/confirmation/deletion in all four scopes, narrow/wide layouts, common-workspace restoration and terminal merge/detach without process restart. Native tests cover transactional transfer, sibling-safe deletion, partial group ordering and history metadata validation.
