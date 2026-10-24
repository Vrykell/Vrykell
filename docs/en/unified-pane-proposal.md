# Unified workspace proposal

Status: implemented as a sidebar destination. The common strip references existing terminals, documents, comparisons, native conversations and external sessions. The all-workspace dropdown remains a resource switcher, not its entry point. Up to four mixed panes share a reference-only layout. Existing tab models and stores remain authoritative for activation, reordering, saving, process ownership and guarded closure; moving a mounted host does not recreate its resource.

## Decision

One workspace containing terminal, conversation and document panes is viable. The shared tab strip, drag interactions, command draft references and dockable conversations already provide a useful foundation. Unify presentation and placement, not the underlying session models: these three surfaces have different lifetimes and safety boundaries. This is a medium-sized architectural change, not a small layout adjustment.

## Existing constraints

- `src/features/workspace/model/windowLayout.ts` stores a terminal-specific split tree. Leaves carry local or remote terminal configuration; minimum widths, drop targets and session restoration assume terminal leaves.
- `src/app/layout/WorkspaceShell.tsx` composes stable domain hosts. Editors, terminals and conversations preserve mounted state independently while navigation changes their visibility.
- `src/features/chat/stores/aiWorkspace.ts` manages conversation tabs independently of persisted conversations. Closing a tab does not delete its saved history.
- Documents require dirty-buffer close guards and revision-aware saving. Terminals own processes, output parsers and resize drivers. Conversations own streams, pending permissions, execution-terminal references and drafts. Moving a view must not recreate any of these resources.

## Current shape

Resource identity is separate from placement. Existing workspace tabs, file keys, conversation IDs and external connection IDs remain the source of truth. The common strip projects those references and delegates selection and guarded closure to their existing owners; it does not introduce a second live tab registry. A layout leaf only records a stable pane ID and an existing resource reference. The shared split layer handles geometry, placement and resizing. Domain adapters keep process, stream, document and draft lifetimes unchanged.

The same document may appear in multiple views only if both views share its document model. A terminal or streaming conversation must have one live owner, even when its placement changes. Hidden panes must not retain keyboard focus or receive global shortcuts.

## Incremental delivery

1. Agree on navigation and close semantics. First unify the top-level tab presentation without changing resource identities or moving existing data.
2. Extract a versioned generic split container alongside the existing terminal layout. Start with one terminal and one document; preserve the original renderer and resize path.
3. Add native and external conversations through adapters, including stream ownership, pending approvals, composer state and explicit execution-terminal binding. Add drag-to-split and per-pane tabs only after focus and close guards are stable.
4. Migrate persisted layouts with validation, fallback and rollback. Keep saved history and file access grants separate from layout restoration. Make the new workspace opt-in until recovery tests pass.

## Acceptance gates

- Moving, splitting and switching panes never restarts a process, stream or document model.
- Save, discard and cancel work for both pane and window closure; failed writes retain drafts.
- Narrow windows enforce domain-specific minimums and never wrap toolbars or capture focus in hidden panes.
- Local and remote terminals retain their own directory, credentials and command context. Conversations never silently change execution targets when another pane gains focus.
- Restore handles removed files, unavailable remote hosts, missing sessions and older layout versions without losing recoverable data.
- Unit and browser tests cover mixed layouts, resizing, drag cancellation, keyboard navigation, dirty files, active streams and restart recovery before replacing the existing workspace.

## Delivered boundary

The common container and terminal workspace use the same flat renderer, pane surface, divider, placement geometry and hover picker. A split action chooses an existing resource or a new terminal, document, conversation or external session, then uses the existing placement interaction; canceling never creates a resource. Editors and external-session workspaces expose the same split action. External sessions have separate owners; side docking uses a distinct side-panel icon. Focused-resource tools join the right-hand tab toolbar, never an extra toolbar or pane caption. The separate common start page reuses the existing launcher structure and controls. At most four panes are visible. New, close and numeric-selection shortcuts follow the common strip. Native conversations retain separate readers and composers. Narrow horizontal splits stack when available width is insufficient.

Version-one layout preferences contain references, order, focus and ratios only. Restoration validates the tree, rejects duplicate owners and excessive depth/count, clamps ratios and removes unavailable references when the workspace opens. It does not reopen arbitrary files, grant access, or reconstruct resources from layout metadata. Existing domain history and recovery remain independent. Missing resources fall back to available tabs; documents still require the original unsaved-change guard.

Per-pane tab groups and drag-to-split remain optional later extensions, not prerequisites for the delivered shared strip and mixed splits. Existing domain workspaces remain available alongside the opt-in workspace. Unit and browser tests cover stable identity, restoration validation, mixed resources, independent drafts, resizing, narrow layouts and external-session close protection.
