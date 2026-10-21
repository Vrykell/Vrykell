# Integration review, 2026-10-21

> This is the pre-fix review snapshot. See the [integration fix record](integration-fixes-2026-10-21.md) for subsequent changes and validation.

This reviews an **unfinished integration**, comparing pre-integration dev `91abc88` with `b7c4f68` (198 files). Scope: ACP, model configuration, usage accounting, authorization, and their effect on recent regression fixes. This task delivers review evidence only; it changes no application behavior and creates no commit or push.

## Priorities

### R1 · P1 · Conversation approvals became global: reproduced regression

Locations: `src-tauri/src/agent/permissions.rs:299`, `:626`; `src/features/agent/services/toolPolicy.ts:28`; `src/features/chat/stores/chat.ts:377`.

The previous implementation stored temporary grants in `Map<conversationId, Set<tool>>`. The backend now has global `session_grants` and `shape_grants`; authorization and approval requests carry no conversation identity. After conversation A approves `npm run`, conversation B receives approval for the same shape without asking. Closing one conversation or changing its target also clears grants belonging to every conversation. This contradicts the menu's conversation scope.

Probe: conversation B expected `asked: true, proceeded: false`, but received `asked: false, proceeded: true`. The probe exercises the real frontend and test IPC policy; backend source independently confirms the missing scope. Carry conversation identity through approval, authorization and revocation, and revoke only the affected conversation when its execution target changes. Native confirmation must continue to precede temporary grants.

### R2 · P1 · Windows executables receive an extra path argument

Location: `src-tauri/src/agent/acp.rs:114`.

`launch_command` uses the resolved executable as the program, then inserts that path again as its first argument. Ordinary `.exe` configurations therefore receive an invalid argument. An actual `node --version` launch parsed its own binary as a script and exited with `SyntaxError`. In-memory protocol tests do not cover the launch wrapper.

Preserve original arguments for executables; wrap only command scripts. Cover executable files, command scripts and paths containing spaces. This is a defect in the new ACP implementation.

### R3 · P1 · Leaving settings immediately after saving loses server edits

Location: `src/features/settings/pages/harnessPage.tsx:49`.

The editor's save updates local state; persistence waits 600ms. Unmounting clears that timer without flushing. A probe added a server and immediately closed settings: after five seconds, no `acp_harness_save` call had occurred. Connecting immediately can also read the old configuration file.

Reuse the existing settings save queue and page feedback. Persist before closing the editor or connecting, flush on departure, and retain drafts and retry controls on failure. A separate save-list button does not repair the automatic-save contract.

### R4 · P1 · Failed credential migration can delete its source: source-confirmed

Location: `src-tauri/src/agent/ai.rs:247`.

Migrating a family key to endpoint keys sets `carried = true` regardless of write success. The old account is then deleted whenever the family has a model. If a destination key did not exist and writing it failed, the only usable source key is lost. No fault was injected into real credentials during this review.

Confirm every destination exists or was written successfully before deleting the source. Preserve it for retry if any write fails. Also return storage errors from `set_provider_key`: it currently logs a failed write and returns success, causing the frontend to close the editor and mark the provider configured.

### R5 · P1 · Closing an ACP tab does not reliably end its process: source-confirmed

Locations: `src-tauri/src/agent/acp.rs:807`, `:618`.

The event pump upgrades its weak reference and holds the resulting strong reference across `next_event().await`. Removing the client from the runtime map leaves a quiet process owned by the waiting pump, so `kill_on_drop` cannot run. After an event, the loop can upgrade the reference again. Restarting or reconnecting can accumulate background processes; active requests also retain clients.

Give sessions an explicitly cancellable pump and process shutdown path. Closing must cancel requests, resolve pending permissions and end the process rather than wait for references to disappear. Add real child-process exit tests. External agent shutdown was not marked as runtime-verified here.

## Incomplete interactions

### R6 · P2 · The working directory ignores the focused split pane

Location: `src/features/workspace/stores/workspace.ts:333`.

The opener always uses `firstLeaf` of the active terminal tab. From another page, it treats the last terminal in tab order as the most recent session. A probe focused the right pane but received the left pane's directory. A local ACP process must also not silently interpret an SSH directory as a local project.

Reuse the workspace's focused-target resolution and capture an explicit local directory. From nonterminal pages, retain the last valid local context or provide project selection. Existing sessions should keep and display their own directory.

### R7 · P2 · Tab switches lose drafts and reading position

Locations: `src/features/terminal/components/TerminalView.tsx:118`; `src/features/chat/components/HarnessView.tsx:121`.

Inactive ACP pages unmount while drafts remain in component state. A probe entered `unfinished draft`, switched away and returned to an empty composer. A 300px reading position returned to zero. Messages survive in the store; interaction state does not.

Reuse the existing conversation draft store and retain reading position, focus and necessary input state per internal session. The singleton shell and its session state must survive page unmounts independently.

### R8 · P2 · Streaming replies stop following the bottom

Location: `src/features/chat/components/HarnessView.tsx:156`.

The follow effect depends only on exchange count and `pending`, neither of which changes while text is appended to one reply. Checking the gap after growth also loses the previous follow state. A probe started at the bottom and ended 5298px above it during streamed output.

Reuse the existing conversation follow mechanism. Retain follow state before growth and update for streamed content and layout changes while respecting a user's upward scroll.

### R9 · P2 · Usage search navigation remains behind settings

Location: `src/features/settings/services/registry.ts:142`.

The usage search action activates a workspace tab but leaves the settings screen open. A probe invoked the actual registered action with settings open: the target mounted but remained hidden. The ACP settings connection action already has an equivalent integration repair; usage was missed.

Centralize workspace-page navigation so screen selection, activation and focus restoration agree across entry points.

## ACP singleton page and visual consistency

Use **one ACP workspace page with internal session tabs**, following the editor singleton and shared `FolderTabs` pattern. The current implementation creates one workspace page per server, which is a different singleton contract. The entry and container should be singletons; individual servers must retain their own processes and conversations.

| Surface | Proposed behavior |
| --- | --- |
| ACP entry | Open or focus the same ACP page; show available servers and configuration access within its empty state |
| Internal sessions | Retain server, project directory, messages, draft, reading position and execution state; reuse shared tabs |
| Settings | Configure and probe servers; connect into the same ACP page; reuse automatic-save feedback |
| New session | Select server and project explicitly; switching the visible session must not destroy connections |
| Close | Distinguish closing a session from closing the page; reuse existing protection for running work, pending approvals and unsent drafts |
| Usage | Keep a separate statistics page, accessible from both local conversations and ACP with a selected source |

Visual inspection covered 1240×800 and 760×700. ACP already reuses `AiBlock`, input controls and theme variables; settings use existing groups. Preserve that direction. Remaining consistency work:

- Reuse shared dialog keyboard and focus handling in `AcpLauncher`. Its manual key handlers do not constrain or restore focus, and the empty state has no clickable configuration action.
- `ChatComposerShell` is currently used only by ACP while local chat retains a separate shell. Consolidate through shared components while preserving existing behavior and test hooks.
- Use shared errors and retries for connection, probe and configuration-load failures. Both configuration loaders currently turn errors into empty lists.
- Joining arguments with spaces and splitting on whitespace corrupts arguments containing spaces. Preserve argument boundaries during editing.
- New backend errors and several comments contain literal Chinese instead of English source copy and catalog translations. ACP diagnostics also record raw `cwd`, contrary to the path-redaction rule. Include these in integration cleanup.

Screenshots: [wide conversation](../audit-evidence/2026-10-21/acp-session-wide.png), [narrow conversation](../audit-evidence/2026-10-21/acp-session-narrow.png), [narrow settings](../audit-evidence/2026-10-21/acp-settings-narrow.png), [launcher](../audit-evidence/2026-10-21/acp-launcher-wide.png).

## Existing fixes and validation limits

Source comparison confirms that the editor, file feature, terminal pipeline, script submission, clipboard, running-command bar, block list, terminal-session hook, and backend terminal/editor/search commands are identical to `91abc88`. This rules out direct source replacement in those areas, but does not replace integration testing.

| Check | Result |
| --- | --- |
| Typecheck | Passed |
| Architecture | Passed; reports two retained legacy credential commands with no frontend callers |
| Existing frontend unit tests | 1981 passed, 1 skipped; 318 passing files and 1 skipped file |
| Existing backend unit tests | 256 passed, 3 ignored |
| First interaction batch | 58 tests: 56 passed; launcher cold-load timeout passed on isolated rerun; one editor test also fails on the pre-integration baseline |
| Second interaction batch | All 41 passed: terminal follow, running-block resizing, pinned controls, clipboard, SSH status, light/dark appearance, narrow settings, window frame and reply links |
| Combined interaction coverage | 99 distinct tests; after reruns, 98 passed and one also failed on the pre-integration baseline |
| Focused defect probes | Six failing frontend probes cover approval scope, drafts/reading position, focused directory, streaming follow, save flushing and usage navigation; one real executable probe failed |

The old editor test waits for a file tab at `e2e/editor.spec.ts:98` after opening settings and directly activating the editor without closing the settings screen. Both the current branch and a separate `91abc88` checkout fail at the same assertion. The test was not changed to conceal this failure.

The first run encountered a missing newly added dependency. Dependencies were installed from the lockfile and checks rerun; this environment issue was not counted as a product defect. No installer was built and no destructive validation targeted real credentials or external services. Unimplemented protocol capabilities were not classified as regressions merely because they remain unfinished.

Raw probes and evidence are in `docs/audit-evidence/2026-10-21/`, with logs retained as `.log.txt` files. To rerun the frontend diagnostic script, copy `integration-review-probes.spec.ts.txt` to `e2e/review-audit.tmp.spec.ts` and choose an independent `PW_PORT`. It deliberately asserts required behavior and therefore fails on the current implementation. Insert `probe-executable.rs.txt` into the existing ACP test module to rerun the real executable probe. Temporary tests were removed from normal discovery and production source restored after probing.

Resolve R1–R5 before completing integration, then address R6–R9 and the ACP page structure. Add owning unit and interaction tests with each repair. Passing existing checks does not establish absence of regressions; this review found missing coverage for conversation authorization isolation.
