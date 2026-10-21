# Integration fix record, 2026-10-21

Addresses R1–R9 from the [integration review](integration-review-2026-10-21.md). The integration remains unfinished: this change resolves entry points, interaction consistency and data safety without completing unplanned protocol features. These fixes are committed as a separate baseline for the subsequent workspace layout changes; the prototypes are outside this batch of application changes.

## Results

| Finding | Fix | Main validation |
|---|---|---|
| R1 Approval scope | Carry conversation IDs through approval, authorization and revocation; isolate tool and shape grants and revoke only the affected conversation when it closes or changes target | Backend isolation and revocation tests, `authorizationScope.test.ts`, approval e2e |
| R2 Launch arguments | Resolve the Windows program while retaining the original argument array; let the process builder encode it, removing the extra path argument and manual script wrapper | Real native test executable and command script with spaces in its path and arguments |
| R3 Lost configuration | Remove page-level delayed writes; update the list and close the form only after persistence, locking inputs while saving; retain failed edits with retry; report corrupt configuration and replace files through a temporary file; refresh the server list when returning to the empty ACP workspace | `HarnessSettings.test.tsx`, immediate navigation, reload and return-to-list e2e, backend configuration tests |
| R4 Lost credentials | Remove legacy credentials only after every target succeeds; retain sources on partial failure and preserve existing endpoint keys; report failed writes without marking a key configured | Backend migration and retry tests, frontend failed-write test, model settings e2e |
| R5 Leaked connections | Explicitly stop process trees and I/O tasks and settle waiting requests; clean up probes and failed opens; remove frontend state before closing and ignore late events and open results | Real idle-child shutdown test, request and event-pump tests, late-open test |
| R6 Project context | Use the focused local pane directory, including before its PTY connects; retain the latest local context across page switches; exclude SSH paths and offer explicit folder selection | Workspace unit tests, split-pane directory e2e |
| R7 Drafts and reading position | Use shared internal connection tabs in one ACP workspace; retain mounted sessions across page and connection switches; use the shared draft store and separate reading positions; create an internal connection for a new session | Workspace and follow unit tests, draft, reading position and new-session e2e |
| R8 Streaming follow | Extract the existing conversation follow behavior for both surfaces; pause while reading earlier content and offer return to latest; reuse the composer container | Follow unit test, streaming and pause e2e, existing conversation and composer layout regressions |
| R9 Hidden navigation | Exit settings when opening usage, ACP or activating a workspace page, making search and settings destinations visible | Workspace unit tests, search navigation, usage and editor e2e |

The ACP entry point uses the editor's singleton page pattern and shared `FolderTabs`. Connection selection, errors, inputs, confirmation and focus behavior reuse existing components. Closing pages or internal tabs with active work or drafts requires confirmation. Local connection IDs are separate from remote resume IDs, preventing collisions between processes. Diagnostics retain metadata without directories, commands or raw errors. Terminal scanning, state machine and editor implementations were not changed.

## Validation and evidence

- Before committing the baseline, type and architecture checks pass again, with all 1992 frontend tests, 264 backend tests and 23 focused interaction tests passing. Logs: [frontend](../audit-evidence/2026-10-21/pre-layout-unit.log.txt), [backend](../audit-evidence/2026-10-21/pre-layout-rust.log.txt), [interactions](../audit-evidence/2026-10-21/pre-layout-interactions.log.txt).
- `npx tsc --noEmit`, `npm run check:architecture` and `git diff --check` pass.
- Frontend unit tests: 322 files and 1992 tests pass; 1 existing test remains skipped. [Log](../audit-evidence/2026-10-21/fixed-unit.log.txt).
- After the final entry-point and save interaction adjustments, all 20 unit tests in the 5 affected files and all 11 ACP interaction tests pass. [Unit log](../audit-evidence/2026-10-21/fixed-focused-unit.log.txt), [interaction log](../audit-evidence/2026-10-21/fixed-acp-final.log.txt).
- Backend: 264 pass and 3 existing tests remain ignored. Includes real Windows executable, spaced command-script arguments and child shutdown tests. [Log](../audit-evidence/2026-10-21/fixed-rust.log.txt).
- Interaction coverage spans 134 distinct cases across ACP, approval, settings, usage, existing conversations, terminal, editor, SSH, splits and window layout. The broad run passed 110/111 initially; both pinned-control scale cases passed separately. The focused run passed 22/23 initially; the entry-point cases passed 2/2 after an initial page-load timeout. Assertions were not relaxed and automatic retries were not added. Logs: [broad](../audit-evidence/2026-10-21/fixed-interactions-broad.log.txt), [pinned controls](../audit-evidence/2026-10-21/fixed-pinned-rerun.log.txt), [focused](../audit-evidence/2026-10-21/fixed-interactions-focused.log.txt), [entry point](../audit-evidence/2026-10-21/fixed-launcher-rerun.log.txt).
- Inspected [1240-pixel](../audit-evidence/2026-10-21/fixed-acp-workspace-1240.png) and [760-pixel](../audit-evidence/2026-10-21/fixed-acp-workspace-760.png) layouts. The editor case that also failed before integration passes in this regression run.

Validation ran on Windows; the Unix process-group cleanup branch has not been exercised on its target platform. Interaction tests use test IPC and do not establish protocol compatibility with every external server. An open request that has not yet returned a connection ID is cleaned up when its result arrives; it cannot restore a closed page or overwrite its resume record.
