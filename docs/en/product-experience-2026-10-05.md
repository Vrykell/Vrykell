# Product Logic Closed-Loop Experience Record (2026-10-05)

## Test Plan and Pass Criteria

For each feature domain, at least one main path of "entry → operation → visible result → return or restore" is walked; for input and asynchronous operations, tab switching, cancellation, failure, and retry are also checked. The detailed entries in the feature specification are still indexed by `docs/en/feature-spec.md`. This record does not count opening a page as completing external service validation.

Execution order: real SSH interaction and file-capability degradation → sessions and split panes → AI conversation and drafts → files and search → settings pages → automated regression. UI issues found retain reproduction steps, impact, and suggested acceptance criteria; capabilities without real validation are listed as gaps and are not marked as passed.

Environment and evidence levels:

- **Real network experience**: system SSH + an actual PTY, connecting to `www.altzin.com:2222`; production React, session controller, and hidden xterm rendering, receiving output and sending keystrokes through a temporary local HTTP adapter. File connections use an actual libssh2 handshake.
- **Manual browser experience**: the actual product UI and interactions, with isolated mock data for Tauri IPC, AI replies, and file and configuration storage. Operations are performed by a browser tool; the user's native desktop is not taken over. This level cannot prove native file picking, on-disk persistence, model service quality, or successful execution of external tools.
- **Automated regression**: the repository's Vitest, Playwright, and Rust tests. They supplement coverage of interaction boundaries and do not replace acceptance against real external services.

## Main Paths Executed

| Feature Domain | Actual Operation and Result | Evidence Level / Still Needs Verification |
|---|---|---|
| SSH interaction | Any test account and password → numeric captcha → main menu → arrow keys into `/agent-intel` → Esc back to the root directory → q to quit. Also checked close and reconnect when the captcha first expired | Real network; passed. No messages sent to chat participants |
| SSH file capability | The real file client handshake failed, but the terminal remained fully operable; verified the separate notice, technical details, and continuing to use the terminal | Real handshake + browser UI; an incompatible handshake does not directly imply the server has no SFTP |
| SSH connection configuration | Open quick connect → submit empty → submit host with an illegal port → cancel; in the new form fill name and host → click the overlay → reopen | Browser; port validation works; found draft loss and an empty-form prompt-order issue. Real private-key and jump-host connections were not accepted |
| Command execution and command blocks | Type `echo vrykell-loop-check` → output, exit code, and duration display → collapse and expand; right-click to open the menu and click copy command | Browser-mocked PTY; command block operations work. Writing to the system clipboard was not verified by the mocked IPC |
| Session switching | Create a new Bash session → type an unsent command → switch back to the original session → return to Bash | Browser; command draft isolation and restoration passed |
| Split pane | Choose a type → click the drop zone on the right → the new split pane runs `echo split-check` → close the split pane | Browser; independent output and returning to a single pane after closing passed |
| History restore | Close the test Bash tab → session history → restore the just-closed session | Browser; the unsent command was still there after restoring the session. No history data was deleted |
| AI basic conversation | Open the assistant → type a question → send → mock reply displayed; after closing the assistant the terminal returns to command mode | Browser; UI closed loop passed; real model requests were not accepted |
| AI drafts and attachments | Edit-resend → modify the draft → close and reopen the assistant; paste 3300 characters of text which becomes an attachment → switch sessions → return to the original session → remove the attachment | Browser; draft and attachment restoration per session passed. Edit-resend deletes the original conversation early; see issue P1 |
| AI model and mode | Open the model picker → search for "local" → select; open the conversation-mode dropdown → select Chat | Browser; selection feedback and panel restoration passed |
| AI error recovery | In the mock environment set a failing service address → send → display the connection-failure reason → restore the address → return to the same session → regenerate → display a successful reply | Browser; the recovery flow passed; no network request was actually sent to the failing address |
| Local files | A file item opens a new tab; enter a directory without permission → clear error → retry → parent directory → file list restored | Browser; the error and back closed loop passed. Opening, editing, and saving in a real terminal editor were not accepted |
| Download management | Enter download management → empty-record prompt → return to file browsing | Browser; entry and return passed. Real upload, download, progress, and cancellation were not accepted |
| Global search | Search for "theme" → select the settings result → land on the theme page | Browser; navigation passed. Search data is mock results, so search accuracy is not a pass item this time |
| Command palette | Windows Ctrl+P → type "file" to filter → Enter to switch the file panel → overlay closes | Browser; the operation passed; for the shortcut-label display issue see P2 |
| Theme and font size | Switch to light → open the custom font-size dropdown → select 14px → restore default → switch back to dark | Browser; immediate effect and saved state passed; theme file import/export and persistence across a real restart were not accepted |
| Model configuration and behavior | Set as the current model; edit the system prompt then immediately switch pages and return → the value is still there → restore the original value | Browser; commit-on-page-switch passed; the user's real keys were not read or modified |
| Model permissions and networking configuration | Check the tiered permissions and click the current option; view the web search method and the unconfigured-key prompt | Browser; permissions were not lowered. Real approval, web search, and page fetching were not accepted |
| Skills | Open the list → skill details → view the body → back → skill marketplace → select a repository → browse the list | Browser; the details, back, and marketplace UI work; real marketplace requests, import, installation, and script execution were not accepted |
| MCP | Modify the server display name → switch pages and return → the value is saved → restore the name | Browser; saving passed, but after renaming the connection status becomes disconnected; see P3. Real tool enumeration and invocation were not accepted |
| Memory | Modify persistent knowledge → switch pages immediately → return to confirm → restore the original text | Browser; commit-on-page-switch passed; AI organization and injection into real conversations were not accepted |
| Subagent | Modify the description → switch pages and return → confirm it is saved → restore the original description | Browser; configuration editing passed; real delegation and result return were not accepted |
| Scheduled task | Add a disabled task → rename, set prompt and interval to 120 minutes → switch pages and return to confirm the values | Browser; configuration closed loop passed. To avoid background auto-triggering, the experience environment always returns the disabled state; real enabling/disabling and on-time execution were not accepted |
| Terminal launch mode | Change Bash block mode to classic → switch pages and return to confirm → restore block mode | Browser; configuration saving passed; the mode behavior of a native new shell is covered separately by automation |
| Local / remote editor | Change the default command from vim to nano respectively → switch pages and return to confirm → restore vim | Browser; configuration saving passed; actually running the editor was not accepted |
| Shortcut help | Open the help and actually use Ctrl+P | Browser; found that Windows displays Mac key symbols; see P2 |

## Fixes This Round

1. Opening a saved SSH connection keeps the connection panel and no longer forcibly opens file browsing. When the file panel is hidden or collapsed, no new directory request is issued.
2. File-service failures distinguish capability unavailability, authentication problems, and real read errors; an incompatible file-channel handshake uses a neutral notice. The original reason is placed under "Technical details", with "Continue using the terminal" and "Retry file service" provided. When no connection is established, no fake root directory or non-functional upload and directory-sync operations are shown.
3. Switching SSH connections re-establishes the corresponding file view, avoiding carrying over another connection's paths and errors.
4. An interactive session disconnect shows "SSH connection disconnected"; only a cancellation during authentication shows "Authentication cancelled".
5. On Windows, when the child process has exited but the host-side handle is still held, the PTY now also emits an exit event and cleans up the session; a real child-process exit-detection test was added.

![File service notice after the real SSH session ends](../audit-evidence/2026-10-05/ssh-files-unavailable-after.png)

## Confirmed Issues Not Yet Fixed

### P1: Edit-Resend Deletes the Original Conversation Before the User Submits (High Priority)

Reproduction: send and receive a reply → click "Edit and resend" → without sending, close the assistant and reopen it. The draft is restored, but the original question, answer, and subsequent conversation have already been deleted from the record.

Code basis: `editResend` in `src/features/chat/stores/chat.ts` immediately truncates `byTab` and calls `deleteChatMessage`. Existing unit tests explicitly assert this behavior, so passing automation will not catch this product problem.

Suggested acceptance: keep the original conversation during editing; provide cancel-editing; replace the target conversation and subsequent branches only after confirming a resend. Preserve the edit draft when the user closes the panel or switches sessions.

### P2: Shortcut Labels Show Mac Symbols on Windows (Medium Priority)

Reproduction: on Windows, open the shortcut help or the Ctrl+P command palette. Ctrl+P actually works, but the UI shows ⌘P; the other shortcuts also only show ⌘ / ⌥.

Suggested acceptance: use a unified platform formatting method to display Ctrl / Alt / Shift on Windows/Linux and ⌘ / ⌥ / ⇧ on macOS, covering both settings and the command palette.

### P3: The Original Connection Is Lost After Renaming an MCP Server (Medium Priority)

Reproduction: connected server → modify only the display name → switch pages and return. The name saves successfully, but the status changes from "Connected · 3 tools" to "Not connected", requiring the user to reconnect.

Code basis: when renaming, `mcpPage.tsx` saves the new name and deletes the original name; the name also serves as the connection identifier. The browser mock result is consistent with this call path; the real backend rename migration still needs dedicated acceptance.

Suggested acceptance: use a stable ID to store the server configuration and connection; if a modification requires reconnection, explain that in settings and clearly provide a reconnect entry point.

### P4: Unfinished Drafts Are Lost After the Overlay Closes the Form (High Priority)

Reproduction: create a new SSH connection → fill in name and host → click the overlay → create new again. Both fields are cleared. The larger form and fixed bottom buttons solved the layout problem but did not solve restoration after an accidental close.

Suggested acceptance: keep the overlay-close behavior the user requested; preserve drafts for ordinary fields separately for new, edit, and quick connect; closing does not equal a formal save and does not automatically create an incomplete connection; passwords are not written to the ordinary persistence cache. Add an explicit "Discard draft" action.

![Test draft before closing](../audit-evidence/2026-10-05/ssh-draft-before.png)
![Fields empty after reopening](../audit-evidence/2026-10-05/ssh-draft-after.png)

### P5: The Empty Quick-Connect Form Asks for the Optional Name First (Low Priority)

Reproduction: with the quick-connect window empty, click connect. The name is labeled "Optional", but the prompt is "Please enter a connection name". After filling in the host, a nameless connection can proceed, showing that the main feature supports an optional name and that only the validation order is unreasonable.

Suggested acceptance: quick connect prompts for the required host first, then the port; when the name is empty, generate the title from the destination address.

## Regression Results and Real-Experience Gaps

- TypeScript type checking passed; `npm run build` passed. The build still has the pre-existing JS bundle-size warning.
- Vitest: 130 test files passed, 1 skipped; 807 tests passed, 1 skipped.
- Playwright: all 182 tests passed, running serially in about 3.6 minutes. With the default configuration, the first run never started because it timed out waiting for the dev server to start; the same full `e2e/` suite was then run against an already-running isolated Vite service on port 1423 with a temporary configuration, with no cases removed.
- Rust: 104 tests passed, 2 ignored; includes Windows native child-process exit detection.
- Architecture checks and `git diff --check` passed.
- New regression coverage: classification of file service unavailability and incompatible handshakes, hidden panels not loading, on-demand file browsing, failure recovery, disconnect notices, and native PTY exit detection.

The following still cannot be marked as "every feature has genuinely passed": full upload/download with an ordinary SFTP server, real private keys and jump hosts, native file picking and edit-save, real AI services and tool approval, web search fetching, skill installation and execution, MCP tool invocation, subagent execution and scheduled triggering, and theme import/export and persistence across an app restart. The existing mock E2E covers several of these, but this human-style browser experience did not replace those integration acceptance checks.

Next round, in order: first fix the input recovery for P1/P4, then add the external integration main paths above, and finally do cross-regression on small windows, the Chinese input method, weak networks, and repeated operations. Acceptance for each external capability must include real results, failure reasons, and a recovery entry point.
