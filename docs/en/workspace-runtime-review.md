# Workspace runtime repair review

Date: 2026-10-27

## Design boundaries

The shared model owns tabs, groups, pane placement and guarded lifecycle operations. Domain persistence remains explicit. Opening a resource creates or selects its tab; only a split command changes a composition. Documents, comparisons and unsaved drafts belong to live workspace restoration, not session history. Both history writers remove file references, the native write boundary rejects them, and initialization migrates existing records. File-only records are removed; mixed records retain session members with a pruned layout and repaired focus. Original files, conversation contents and terminal history are not migration targets.

File-only groups have no archive action. Closing their final tab removes the group and persistent metadata. Existing group card geometry and colors remain canonical. Resource titles use a bounded shared menu with ellipsis, full accessible names and themed hints. Memory uses ordinary grouped settings rows with status/reload and an explicit assistant-review button. Review starts a short-titled conversation through normal authorization. Modal command input owns the existing bottom status row, inherits that row's typography and does not compete with metadata or mode text.

## Incident findings and repairs

| Evidence | Cause and repair |
| --- | --- |
| Structured diagnostics and the supplied maximum-update-depth stack pointed to placement cleanup and a hidden pane effect | Provider-wide state updates retriggered slot owners; hidden cancellation depended on a fresh callback. Use resource-specific external subscriptions, stable cleanup ownership, state-based effect dependencies and unchanged-size guards. |
| A copied local workspace snapshot contained more than 1,100 references despite only a few intentionally opened tabs | Startup lifecycle replay restored the same empty drafts under new identities. Share pending/completed restoration, batch stable draft identities, pause reconciliation during hydration and commit containers once. |
| Hidden empty conversations mounted editors and global changes traversed unrelated owners | Mount conversation content on first use and retain it afterward; narrow runtime subscriptions and index resource lookups. Streaming tokens do not reconcile all containers. |
| The common start page disappeared after native resource changes | Reconciliation was also adopting unplaced resources. Reconciliation now only prunes existing placements and maintains an empty start destination. |
| File opening failed with an execution-lease error | File and comparison APIs bypassed the authorized invocation wrapper. Route them through it and reject raw invocation imports in the architecture check. |
| File groups appeared in session history | Layout snapshots were reused without a session-persistence boundary. Filter both frontend writers, reject file members natively, sanitize legacy display and migrate stored metadata. |
| Opening a file silently inserted a split | Resource presentation reused composition insertion. Presentation and switching now select an owning tab; explicit placement remains the only insertion path. |

Local recovery used a complete backup before removing duplicate empty default references. Grouped, selected, named, drafted and content-bearing resources were excluded. The repair was separate from committed application behavior; recovery backups are not included in version control.

## Verification evidence

- The bounded hidden-cancellation regression fails against the earlier implementation in 2.15 seconds and passes after repair. It throws after repeated cancellation so the test cannot hang indefinitely.
- The full unit run passed 2,699 tests with one existing skipped test in 184 seconds. The final foundation run passed 504 tests in 61 seconds while other checks were running.
- The foundation gate reports 1,550/1,550 statements, 1,175/1,175 branches, 524/524 functions and 945/945 lines. This is the explicit shared-foundation scope, not whole-application or native coverage.
- Native tests passed 348 tests, with five existing ignored tests, in 13.3 seconds. This includes native history validation and idempotent migration of file-only and mixed records.
- Typechecking, the architecture guard and the frontend production build passed. The build retains existing bundle-size and shared dynamic/static import notices.
- Browser checks cover file opening into a new tab and reopening without duplication, explicit split placement, resource switching, all four grouping scopes in both themes, empty-group removal, file-history exclusion, retained terminal owners, memory loading/retry and narrow/wide layout, bounded menu titles and modal command geometry.
- A restoration regression seeds 768 AI containers and 357 common containers, reloads twice, checks stable counts, opens/closes settings and types/submits terminal input. Another regression switches a retained terminal/document composition through eight rounds and verifies input and reload recovery.

The generic strict interface audit still reports 64 repository-wide heuristic findings, as recorded in `workspace-foundation.md`; it is not a clean audit claim. The design document linter reports zero errors and eight existing token-reference warnings. Browser verification uses an isolated server and mocked desktop services; native tests separately exercise backend behavior. Coverage is a regression guard and does not prove the absence of runtime defects.
