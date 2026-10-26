# Code audit and regression fixes — 2026-10-26

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
