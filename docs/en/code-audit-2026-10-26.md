# Code audit and regression fixes — 2026-10-26

## Concurrent conversations and model connection recovery

Main, split and sidebar native conversations now run concurrently under separate owners. Queues, stop controls, history working flags, editing guards and finalizers belong to each owner. Background schedules still begin while idle but no longer block a later interactive conversation. Two connected agent sessions are also verified to complete independently.

Transient model connection failures before response headers retain explicit retry metadata through the proxy. The model transport retries twice with exponential backoff and supports stopping during the wait. Authentication/configuration errors and started responses are not replayed; exhaustion keeps manual retry available. This backend change requires an application restart and does not change an external agent's own networking.

Opening the sidebar no longer restores an in-content toolbar or hides the main tab's settings action. Terminal analysis stages its reference in a compatible independent sidebar owner without moving main/split content or granting execution access. Historical tool errors stay quiet until explicitly reviewed. Legacy browser selectors and history-opening assumptions now follow their actual owners.

Final verification: 2488 frontend tests passed with 1 skipped. Backend verification for this change reports 323 passed and 5 ignored; the final localized connection-error adjustment also passes its targeted backend test. Nineteen expanded browser cases and eight lifecycle/sidebar regressions pass. Typechecking and architecture checks pass. The strict UI audit retains its 64 existing findings. Concurrent edits to the separate external-session runtime were excluded from this commit and from these backend verification claims.

This batch fixes the sixteen previously reported defects and follows their callers and adjacent boundaries. Repository-wide type, architecture and test checks complement that source review. They do not establish that every source file received a complete manual review or that the project has no remaining defects.

## Previously reported defects

| Area | Corrected behavior | Regression evidence |
| --- | --- | --- |
| Cross-device moves | Preserve the complete destination when source cleanup partially fails. | Injected partial source removal in the file backend tests. |
| Snapshot sanitization | Remove every attribute from line breaks. | Sanitizer tests and terminal snapshot consumers. |
| Stream scanning | Invalid control sequences preserve multibyte text without slicing inside a character. | Split input followed by a valid protocol marker. |
| DNS resolution | Resolve hostnames with an explicit placeholder port while retaining address validation. | Local hostname resolution and private-address rejection. |
| Terminal file opening | Reject terminal control characters in paths before sending keystrokes. | Local and remote command construction tests. |
| Credential redirects | Authenticated clients return redirect responses without forwarding headers or bodies. | A local redirect server and the shared client builder. |
| Batch deletion | Return completed mappings alongside per-item errors so successful deletions remain undoable. | Backend, API, file browser and browser regression tests. |
| Command completion | Reschedule completion after a later statement exceeds the snapshot grace period. | Two-statement execution with a delayed second result. |
| Conversation persistence | Redact titles, messages and structured metadata at the database boundary. | Restored JSON retains its shape while secrets are masked. |
| Plain output | Display literal characters exactly once and render search highlighting safely. | Component tests and terminal references in both themes. |
| Text reads | Read only a bounded prefix of regular files, with an 8 MB maximum. | A sparse large-file fixture and a special-file check on supported systems. |
| Write backups | Give every backup a unique name. | Rapid overwrites retain both original versions. |
| Tool connections | Keep global state locks out of connection I/O, cancel on disconnect and bound complete requests and response frames. | Notification, blocked-write, cancellation and oversized-frame tests. |
| Tool failures | Preserve a server's declared failure instead of returning successful-looking text. | Backend conversion and frontend propagation tests. |
| Scheduled turns | Reserve the send slot before recording the run and coalesce overlapping polls. | Concurrent manual submission, failed persistence and overlapping-poll tests. |
| Shell selection | Construct commands for the same shell used to launch the file terminal. | Shell-specific quoting tests and browser directory synchronization. |

## Follow-up review

- Directory synchronization reuses the shared shell-aware command builder and rejects all terminal controls. Remote directory commands retain literal argument handling.
- Live terminals record the resolved system shell; directory pickers and path completion use it even when the saved layout has no explicit shell.
- Empty staging destinations remain empty across path normalization; they cannot turn into a root-directory undo mapping.
- File-opening fallback metadata uses the frontend's field names. Repeated remote file placeholders are all replaced, and remote parent directories use remote path semantics.
- Highlighting walks decoded text nodes, preserves entities and marks every match without changing attributes.
- Snapshot styles reject escaped, commented and quoted image sources.
- HTTP failure snippets truncate by characters, including multibyte responses from search, fetch and registry requests.
- File search and skill discovery/copy skip linked directory cycles. File search also skips special files and bounds content reads.
- Skill installation uses unique staging directories and preserves the previous installation until replacement succeeds. A failed replacement restores the previous directory; failed restoration leaves the previous copy available at the reported recovery path.
- Reviewed session grouping handles draft tabs without creating empty history records, waits for existing first writes, and rejects tabs closed during that wait. Empty group metadata is valid; saved memberships retain transactional validation.
- A child quick menu handles Escape before its parent profile picker. Numeric side-conversation switching restores composer focus so the next shortcut keeps the same routing owner.
- Individual terminal drag previews retain their measured width; automatic width applies only to group previews.
- Script submission also uses the live process shell when the layout preference is unspecified.

## Verification and limits

Verification is performed on the current desktop workspace. Platform-specific linked-directory and special-file tests are conditionally compiled for systems supporting those fixtures. External-service and packaged-helper tests retain their existing explicit exclusions.

The strict UI auditor reports 64 existing findings: 29 unresolved ownership heuristics and 35 static rule violations. These remain unresolved; the check is not reported as passing. The maintained UX contract already documents these categories. Runtime browser checks, typechecking and architecture validation are recorded separately.

Final verification: typechecking, the complete frontend unit suite and architecture checks pass. Backend tests report 321 passed and 5 explicitly ignored. The initial browser run reported 710 passed, 85 failed and 2 skipped; failures were reviewed and corrected in code or outdated fixtures. A serial intermediate recheck reported 78 passed and 16 failed. After the remaining fixes, the final confirmation run covering the failed scenarios and added regressions reports 90 passed. This is not presented as a single clean full-suite run. No production credentials or external service calls are needed by the added tests.

## Interface and question recovery follow-up

Conversation settings reuse the shared dropdown field trigger. Tool refusal matches the failed badge; cancellation reuses the approval badge palette and remains cancellation when stopped. Selected question options retain the chat bubble palette in live and restored results. Tool errors use the shared notification region, with quiet history mounting and explicit result review.

The repeated-confirmation loop came from leaving questions available after a denial while execution stayed blocked. A denial now ends all tool access for that turn. Each turn can open at most one question; answered questions are removed from subsequent tool choices, and both internal and external tool adapters reject repeated or paraphrased attempts. Existing execution authorization stays authoritative. The focus requirement concerns the application main window, not terminal visibility.

The final complete frontend unit run reports 2477 passed and 1 skipped; the last synchronous cancellation adjustment also passes 26 focused tests. The final question/recovery browser run reports 12 passed, in addition to four theme/width feedback cases and eleven earlier workspace/feedback regressions. Typechecking and architecture checks pass. Native shell resources regenerate from the canonical vector and pass native resource tests; this verification does not build an installer or replace an already registered shell extension. The strict UI audit remains at the same 64 unresolved baseline findings. Main-workspace/sidebar ownership changes remain a design proposal and are not implemented in this batch.

## Subsequent requested corrections

The follow-up implements the previously proposed independent main/sidebar ownership. Side conversations retain their own membership and selection, including when a different side conversation is selected or closed. Opening the panel never borrows main or split resources. Explicit movement preserves the mounted owner and can detach a conversation from its main split. Both native and external conversations are covered.

Completed questions now retain only the selected option or typed answer as plain inset text. Inactive choices and blue selection backgrounds are removed, including restored history. Pending choices retain horizontal insets. Code execution buttons use the shared terminal vector icon.

Native confirmation is now requested independently of application focus. This intentionally replaces the earlier foreground policy at the user's request; dangerous operations still require an actual native answer and a single-use lease. Timeout, dismissal and late-approval rejection remain enforced. Loading this backend change requires an application restart; browser tests cannot prove native dialog behavior.

Verification: 2479 frontend tests passed with 1 skipped; the final scoped-movement adjustment passed 27 focused tests. Backend tests report 322 passed and 5 ignored. The expanded browser run reported 31 passed and four outdated global-composer selectors failed; after assigning those selectors to the side surface, all 12 surface, question-spacing and ownership cases passed. A final five-case ownership run also passes explicit movement of split and external conversations. Typechecking and architecture checks pass. The strict UI baseline remains 64 findings. Earlier verification paragraphs describe their respective stages rather than the final behavior.
