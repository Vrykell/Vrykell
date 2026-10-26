# Agent architecture and local memory review

Reviewed on 2026-10-26. The design goal is a small desktop agent with no separate memory service, model download or new runtime dependency.

The existing streaming SDK already owns generation, tool schemas, step limits and provider adapters. Execution targets, cancellation, queues and approval state belong to individual conversations. Keeping these boundaries is appropriate; adopting a second orchestration framework would add overlap. There is no single certification for a “modern agent framework.” This review uses explicit state ownership, typed tools, bounded context, reproducible history, durable-write authorization and failure recovery as engineering criteria.

## Findings and changes

| Finding | Consequence | Change |
| --- | --- | --- |
| The entire fact file and recent journal were appended to system instructions | Irrelevant and obsolete facts entered every request, across projects | Scoped records with full-text retrieval, six-fact and 800 estimated-token ceilings; active/unexpired filters |
| A memory update replaced the whole file | Concurrent writers could lose changes; contradictory copies accumulated | Unique subject keys per scope, atomic transactions and required expected revisions for updates |
| Global overrides were resolved only among retrieved candidates | A stale global fact could return when the project replacement did not match the query | Apply active, unexpired project overrides before search ranking and pagination; retain both records during explicit archive review |
| Memory writes masked storage errors as duplicate keys | A read-only or failing database produced misleading recovery advice | Translate only unique-key violations; preserve other database errors |
| Old files had no review or expiry state | Historical assumptions appeared current | Import as pending; originals remain unchanged; default validity is 90 days, maximum 365 days through the tool |
| Next-turn history contained only one-line tool summaries | The model lost execution evidence | Persist the complete returned result separately from its display preview; recreate standard call/result pairs without executing them |
| Message trimming excluded instructions and tool schemas | The configured input budget could be exceeded before tool use | Reserve fixed context and schemas; include images and results; check each iteration and preserve call/result groups |
| Tool name and target command could be combined freely in authorization requests | An unrelated allow-level tool could request a different command's lease | Validate the tool-to-command mapping in both authorization and approval paths |
| Shared privileged interface commands accepted no lease | A direct call bypassed the intended dispatch contract | One shared registry and dispatch guard; single-use leases bind exact arguments, and interface leases also bind the native webview label |
| Built-in model instructions mixed languages | Maintenance and prompt review were inconsistent | English model-facing instructions and schema descriptions; responses follow the user's language; interface copy uses the translation catalog |

Subagent definitions, their tools/settings/IPC, scheduled tasks and the application polling loop were removed. Existing configuration files are not deleted. External harness connections remain a separate existing capability.

## Memory contract

The embedded database at `~/.vrykell/memory.sqlite` uses the application's existing database library and its full-text index with built-in ranking. No external process, inference endpoint or embedding model is added. Retrieval is lexical, not semantic inference. Short queries use bounded literal results. Database work runs off the interface thread.

Each record has an identifier, scope, stable subject key, content, status, source, update time, expiry and revision. Local directories are isolated from remote host/user/port/directory scopes. Unknown environments use a conversation scope. Global facts are intended only for explicit cross-project preferences; an active project fact with the same key overrides a global one. Directory scopes are exact and do not imply repository-root discovery or automatic inheritance.

Automatic recall searches only the current question and never loads the archive wholesale. Denying the memory tool also disables automatic recall. Returned facts are marked as untrusted historical evidence; current user statements and observed state take precedence. Retrieval failure does not prevent ordinary chat and records only a metadata diagnostic.

The memory tool supports paged bounded read/search, creating one fact, and replacing/deactivating one fact using its identifier and revision. `includeInactive` permits explicit review of pending, expired and inactive records; such records are excluded from automatic recall. An existing active or inactive fact retains its scope; a project override is a separate scoped fact. Pending imports can be assigned a scope during review. Updates require approval through the existing durable-write policy. Stable keys prevent exact duplicates, not arbitrary semantic contradictions: changing evidence still requires an explicit update or deactivation. Expiry is a fallback, not proof a fact remained true until that date.

Legacy files are preserved. Import is transactional and idempotent, bounded to 2 MB per file, 1,000 nonempty lines per file and 2,048 characters per imported line. Larger or omitted material remains in the original archive and is not automatically recalled. A migrated item must be reviewed and assigned an appropriate key/scope/expiry before activation.

The settings page reads aggregate counts only. It contains no memory-body list, editor or bulk activation. Full content is retrieved only through an explicit tool operation. The tool permission page remains the control for disabling memory access.

## Boundaries retained

- Token counts and image costs remain lightweight estimates, as requested. There is no tokenizer package or new token-counting service. The budget is not an exact provider token guarantee. Deliberately disabled context management remains unrestricted.
- Full results mean the complete value returned by a tool; tool-specific range/read limits still apply. Old truncated previews cannot be reconstructed. Completed history is replayed as data, never as an instruction to execute tools again.
- The main renderer still owns interactive terminal access. Interface leases enforce payload/caller binding and prevent reuse; they are not proof of a physical user gesture and do not isolate code within a fully compromised main webview. Existing path grants and native execution confirmations remain necessary.
- The streaming loop is conversation-owned in the renderer. Persisted history does not provide a durable mid-tool checkpoint or automatic process restart. Replaying arbitrary commands after a crash is intentionally avoided.
- Local storage and lexical ranking cannot determine that an unobserved real-world fact has changed. Sources, explicit updates, deactivation, scope and expiry address lifecycle; they do not replace verification.

## Verification references

Validation completed on 2026-10-27 against an isolated source snapshot of the intended commit: the frontend build, typechecking and architecture guard passed. The full unit run passed 2,543 tests with one skipped; the backend full run passed 335 tests with five ignored, including all seven memory cases. Of 34 browser regression cases, 33 passed together; the remaining case exceeded its initial page-load deadline and passed on an isolated rerun. Approval timeout, complete tool history, memory status/retry, narrow/wide layouts and settings regressions passed. Dependency manifests and lockfiles are unchanged.

Owning tests: `src/features/agent/__tests__/memory.test.ts`, `modelHistory.test.ts`, `context.test.ts`, the streaming IPC tests, memory/permission backend tests, `src/platform/__tests__/sharedCommandLeases.test.ts`, the memory settings component tests and `e2e/memory.spec.ts`. Browser regression also covers approvals, tool failures, independent conversations and settings surfaces.

The repository-wide static interface audit currently reports pre-existing ownership/textarea/scrollbar findings outside the new status page. Its output is `.tmp/agent-ui-audit.json`; it is not a runtime correctness or accessibility certification.

Design references: [agent loops](https://ai-sdk.dev/docs/agents/overview), [long-term memory](https://docs.langchain.com/oss/javascript/langgraph/memory), [embedded full-text indexing](https://www.sqlite.org/fts5.html). These are design references, not copied implementations.
