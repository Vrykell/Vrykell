# Workspace compositions

## Ownership

A composition uses the canonical `WorkspaceContainer` shared by terminal, code and AI scopes and owns a layout of resource references. See [Unified workspace foundation](workspace-foundation.md) for the ownership map and audit. Terminal processes and blocks retain their session and stable pane identifiers. Documents, comparisons, native conversations and external connections retain their domain stores and close guards. The common strip lists composition tabs, not every globally open resource. Each tab preserves its own layout, focus and optional zoom. Start is the empty-workspace fallback and never remains beside content tabs.

Each terminal pane exposes one movable content host. The common workspace places that existing host instead of mounting another terminal. An existing terminal split projects its tree into the common layout, preserving directions, ratios and pane identities, without nested terminal layouts. Switching views does not restart processes or copy buffers.

Creation reuses the profile, saved-host and external-agent pickers. Local profiles and saved hosts have separate scopes, including keyboard defaults. File creation and opening remain separate. Actions initiated in the common workspace remain there.

All four workspace strips place the shared resource switcher in the leading slot. The right toolbar omits duplicate resource switching and splitting controls; editor opening-in-terminal and conversation project selection remain available through menus. Tab and pane context menus expose a Split tab submenu containing the resource types allowed in that scope. Terminal, server and agent choices retain their full launchers, and resources are created only after placement. The common toolbar offers side docking for its focused native or external conversation; a dock that cannot fit leaves the main placement intact.

## History and restoration

Startup restores terminal owners referenced by the saved workbench, including mixed layouts, rather than every leftover active database record. Composition records never spawn terminal processes. Old inactive, untouched, default-titled empty conversation placements are filtered without deleting conversation history; selected, named, grouped, shared and nonempty drafts remain. Sidebar-only owners do not suppress the AI start tab.

The existing history repository stores a composition as a `workspace` metadata record. Its versioned payload contains the shared layout, focus and bounded references, never transcripts, commands, document contents or credentials. Resizing, focus and membership changes update the identity of that tab; restoring retains it. Each tab has its own serialized writer, so switching tabs cannot redirect pending writes. Atomic historical writes prevent startup from mistaking a composition for a terminal process.

Materialized source and split flags are maintained at the database boundary on inserts and payload changes. An additive transactional migration backfills existing rows once. Paged filtering reads summaries instead of parsing every layout on every query. Mixed combinations match every member type; all/single/split is an independent filter. Restoring conversation metadata reads one primary-key record, not the full catalog.

The list shows one combination with its pane count and types. Expansion shows members; the default action restores the whole layout. Forgetting a combination removes metadata only, not the referenced resources.

The history entry point passes an explicit destination. Restores initiated in the common workspace stay there, including single-resource history. Mixed combinations always use that workspace. One service delegates restoration to the existing owners, maps saved identities to live references and commits the layout only after every member resolves. Missing members report errors without replacing the current layout. Pending restores are coalesced; independent later user actions remain available.

External references carry their exact session identifier and directory rather than altering the global last-used reference. Missing unsaved drafts never become empty replacement documents. Split adds siblings through the shared placement controller. Moving a pane to a new tab and merging tabs preserve owners and use explicit placement. Zoom is temporary and retains the full tree. Closing a pane closes its resource; closing a composition checks all document and external-session guards before closing any member. Every scope uses the same group model and delete/archive lifecycle, with native history adapted at the storage boundary. All scopes share geometry, dividers and placement controls.

## Regression checklist

Editor and conversation workspaces retain independent reference layouts created by the same pane store factory. They share the content-host canvas, placement controls and dividers with mixed compositions, without navigating to the common workspace. The terminal workspace uses the same generic tree operations and pane canvas through its native wire adapter. A visible slot exclusively owns each content host; inactive slots cannot overwrite it. Focused native resource headers stay in their native strip. Homogeneous composition history restored from native history returns to the matching native workspace; common-origin restoration stays common.

- Distinct creation scopes and keyboard defaults; creation and file opening retain destination.
- Per-member source matching, independent split filtering and bounded cursor pages.
- Whole-combination and member restoration, missing references, retry and exact external references.
- Stable history identities across resizing and restoration; no duplicate writes or content copies.
- Existing terminal splits project without nesting, process restarts or lost drafts.
- Pane movement preserves owners; pane and tab closure retain guards.
- Independent tab layouts, explicit merge placement, reversible zoom and empty-only start.
- Additive migration, maintained summary flags, invalid metadata and content-field rejection.
