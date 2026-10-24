# Overlay Form and SSH Interaction Flow Audit

Date: 2026-10-05.

Earlier, Browser Use was used to operate the actual frontend components, with the backend simulated by local test fixtures. Six kinds of overlay windows were checked, along with the no-Shell-integration scenario in SSH block mode. At this stage, the user's desktop windows, real connection data, known_hosts, or external SSH servers were not touched. Browser window sizes were 1280×720 and 720×480, the minimum size the desktop app allows; font sizes covered the default 13px and 18px, the maximum the settings allow. The user later authorized connecting to an external chat service; the real connection results are in the supplementary record at the end.

## Overlay Window Inventory

| Scenario | Check Result | Evidence and Priority |
| --- | --- | --- |
| Create, edit SSH connection | Fixed width 400px, with many fields crammed into a small area; input boxes about 28px high, save button about 56×30px; closing by mistake and reopening resets all unsaved fields | Browser reproduces draft loss on create; unit tests and E2E cover the create/edit close behavior. High |
| First host fingerprint confirmation during an SSH test | The confirmation popup is nested inside the SSH form overlay; when the upper overlay is clicked to cancel, the event bubbles and the underlying connection form also closes, losing the draft | Browser reproduces it by simulating `HOST_KEY_UNKNOWN`; the trust button was not clicked. High |
| Secondary confirmation for file rename | The name is edited in the list first, then confirmed in an overlay; after closing the confirmation by mistake the new name is lost. The generic confirmation popup has no max height or scroll area | Local rename reproduces draft loss and long-name overflow at a large font size. Remote uses the same confirmation component; the cancel state was checked from source. Medium |
| Confirmation for file delete and clearing download records | No form to save; still shares the confirmation component that lacks a height cap, so a long file name combined with a large font size may affect button reachability | Shared-component inspection; the clear-download-records copy is short, and no sizing problem was reproduced this round. Medium/Low |
| New tab | 420px wide, with a scrollable list; it only searches and selects an existing type/connection, with no connection configuration to fill in | Browser: type a search term, close; at 720×480 the filtered window is about 145px high. Low |
| Model selection | 480px wide, with a height limit and an independent scrollable list; model selection takes effect immediately, and closing only clears the filter | Browser: open, search, close; at 720×480 the filtered window is about 198px high. Low |
| Global search | 480px wide, with a height limit; the input is a search query, with no multi-field configuration to save | Browser: search, close; at 720×480 the window is about 346px high. Low |
| Command palette | 520px wide, with a height limit; it executes actions after searching, with no form to save | Browser: search, close; at 720×480 the window height limit is 264px. Low |

The table above separates the generic confirmation window by business use; there are actually 6 independent overlay components: `SshFormModal`, `ConfirmDialog`, `NewTabModal`, `ModelPicker`, `GlobalSearch`, `CommandPalette`. The transparent outside-click layer for thinking effort and model scope is part of an options menu; source inspection found no multi-field draft there.

Model, MCP, memory, subagent, scheduled task, and skill editing in the settings pages use in-page forms, and none of them were found to host editing through the overlays above. They are not counted in this round's overlay issue list.

## Specific Issues Reproduced

### The SSH Form Save Button Is Clipped

At the default font size and a 720×480 window, the SSH popup has a max height of 393.6px; the visible content height is about 392px, but the content scroll height is 427px. The save button's bottom is at y=455.2, beyond the popup bottom at y=436.8, so it is partially clipped. After clicking "Test connection" and getting the "Please enter a host first" prompt, the scroll height grows to 467px, the save button moves to y=464.8–495.2, and it leaves the popup's visible area entirely, requiring scrolling.

The title, form, and save button are in the same scroll container; after scrolling to the bottom, the title and top fields disappear. This causes frequent back-and-forth between filling in, checking, and submitting.

Source: `src/features/ssh/components/SshFormModal.tsx`; sizing is in the popup styles, field resets are in the `[open, initial]` effect, and submission is in `doSave`.

### The Upper Confirmation Overlay Closes the Underlying Form

Reproduction: create SSH → enter name and host → test connection returns an unknown fingerprint → click outside the fingerprint confirmation window. Both popups disappear at once. The `ConfirmDialog` overlay invokes the cancel callback but does not stop event bubbling, so the outer `SshFormModal` overlay also receives the click.

This is a different operation from normally clicking the SSH form's own overlay to close it: closing the upper fingerprint confirmation should return to the already-filled form.

Source: the outside click in `src/ui/feedback/ConfirmDialog.tsx`; the nested confirmation at the end of `src/features/ssh/components/SshFormModal.tsx`.

### The Long-Name Confirmation Window Extends Off-Screen

At 720×480 with a page font size of 18px, the old and new names are each 224 characters (220 Chinese characters plus `.txt`). The measured confirmation window height is 754px, its top edge at y=-137 and its bottom edge at y=617; the cancel and rename buttons are at y=564.6–600.2, completely invisible. It has no internal scrolling to restore button reachability.

This is a long-name boundary scenario. Overflow was not reproduced at the default font size or with a short old name paired with a long new name, so this cannot be used to judge all confirmation popups as unusable in daily use.

![Long-name confirmation window at the maximum font size](../audit-evidence/2026-10-05/confirm-overflow.png)

Source: `src/ui/feedback/ConfirmDialog.tsx` only constrains width and has no max height or scroll area.

## SSH Operations Provided by the User: Support Gaps

The terminal records provided by the user cover: manually typing an SSH command, a non-default port, first host confirmation, password prompts, server-side text prompts and disconnects, an interactive program after login, and timeout exit. These should serve as acceptance samples for the full flow. The migration notices in the records are just server output; the commands in them were not executed this round, and no external service was connected or verified.

### Existing Capabilities

- The backend launches sessions via system SSH and a PTY, supporting a specified user, port, and `-t`.
- The connection management entry point already has host fingerprint checking and an explicit trust flow.
- SSH block mode already has a separate password/passphrase response input; classic mode already has a direct terminal input path.
- The pipeline already has normal-screen and alternate-screen switching, and VT/ANSI parsing uses xterm.js.

Thus the gaps are concentrated in the product closed loop of state, input, and undo, rather than requiring separate adaptation to a particular SSH application.

### Reproduced and Fixed: A Program Without Shell Markers Was Left on the Authentication Screen

In the reproduction environment, the SSH launch mode was set to block mode and a service without OSC 133 Shell integration was simulated. Test fixtures replayed clear-screen and cursor-positioning output showing "Interactive program: login complete", "Use arrow keys to select, Enter to confirm, Esc to exit". The UI still showed "SSH connection interaction", the password response input, and "Cancel authentication". The original classic-mode setting was restored after testing.

`TerminalPanel` binds the SSH interaction UI to the classic scene; the controller switches to the block list only after receiving the remote Shell's prompt marker. The old logic recognized and remembered handled password prompts using whole-screen text; a screen redraw after login changes the text, so the password response box appears again and covers the xterm. When a program does not send Shell markers, the user cannot smoothly return to terminal key operations such as arrow keys, Enter, and Esc.

After the fix, password prompts are recognized by the current prompt line; the same prompt does not pop up again after a screen redraw, an authentication rejection re-provides the response box, and the user can also manually switch to password input or direct terminal input. The SSH xterm mount node is retained in the block-list scene, and the original terminal screen is restored when entering an alternate-screen program. Servers without Shell integration still use xterm's native interaction path, without relying on the program name or hand-written VT parsing.

![A logged-in program still shows the password response UI](../audit-evidence/2026-10-05/ssh-interaction-stuck.png)

Source: `src/features/terminal/components/TerminalPanel.tsx:25`, `src/features/terminal/hooks/useTerminalSession.ts:204`, `src/features/terminal/services/pipeline/sessionController.ts`.

This image verifies the behavior of locally simulated output passing through the actual frontend; the text the user posted did not preserve the original ANSI sequences, so it cannot be determined whether that external program uses the alternate screen. Therefore it cannot be claimed that the same failure has been reproduced on sshfm.

### Other Closed-Loop Risks Confirmed from Source

| Stage | Current Behavior and Risk | Follow-up Acceptance Focus |
| --- | --- | --- |
| Running `ssh` after logging into an ordinary terminal | The bottom command input still submits as an ordinary command and sets a pending command; there is no dedicated subprocess response mode | `yes/no`, password, and verification responses should go to the current process; passwords should not enter command history or the AI context |
| No remote Shell integration / forced interactive program | Block mode appends remote Shell integration commands; after falling back it may still remain on the authentication screen | Keep the generic interaction path when the service does not support integration or rejects remote commands; do not rely on identifying the program name |
| Interactive program keystrokes | Normal terminals and the alternate screen already have a keystroke path; the separate authentication form only submits a whole line of text | Arrow keys, Enter, Esc, Tab, Backspace, Ctrl+C, and window resizing should be available at the corresponding stages; ordinary input must not all be treated as a password |
| Remote closes the connection | On PTY exit the session is cleared and "Process exited" is output; authentication-view input is disabled, but there is no full reconnect entry or disconnect-reason display | Preserve the last output, show the disconnect state, and support reconnecting; distinguish it from returning to the local prompt after running SSH inside a local shell |
| Terminal and remote file panel | Double-clicking a connection automatically opens the file panel; the file service uses a separate SSH/SFTP authentication path | When an interactive service has no SFTP, terminal temporary password, or interactive challenge, a file error should not prevent the terminal from continuing to operate |
| Test connection | `ssh_test_sync`'s "Connection successful" only verifies the connection and authentication | It should not be treated as proof that the remote Shell, interactive apps, and SFTP are all available |

## Suggested Fix Order

1. Enlarge the SSH form's input space, unifying fields and buttons to easier-to-click sizes; keep the title and bottom action area visible, with only the body scrolling. Continue to allow closing by clicking the overlay. **Done**: the popup was converged to a compact 480px-wide two-column layout with a scrolling body and a fixed action area; see "Follow-up Fix Records".
2. Save drafts for new/edit SSH and support restoring them on reopen. Distinguish draft saving from a formal connection submission; incomplete fields may also be preserved. Keep password drafts only in the current runtime memory to avoid adding new plaintext persistence. (Not fixed)
3. Fix the click bubbling of the nested confirmation; the upper cancel should only exit the fingerprint confirmation and return to the original form. (Not fixed)
4. Limit the height of the generic confirmation window so long content scrolls independently; after cancelling the rename confirmation, return to the original input and keep the new name. Renaming involves real file changes, and preserving a draft does not perform file operations early. (Not fixed)
5. Complete the SSH no-integration fallback, handling authentication prompts and post-login interaction separately; retain xterm's native keystrokes and the alternate-screen display. (Fixed this round and passing mock E2E; re-verification on a real SSH server has not yet been performed)

## Next Round's SSH Acceptance Plan

The matrix below is a plan to be executed and cannot be marked as real-backend acceptance passed. Use a controllable test SSH service and a non-sensitive test account, where the server can reproduce prompt, raw keystroke, normal-screen/alternate-screen, exit, and SFTP capability differences.

| Scenario | At Least One Full Experience | Pass Criteria |
| --- | --- | --- |
| Manually typed SSH in an ordinary terminal | Command → first fingerprint reject/confirm → password → exit back to local | Prompts and input correspond to the same process, passwords do not leak; returns to the original local input state |
| Connection management entry | New draft → restore after accidental close → save → test → connect | Drafts restore, buttons are always reachable, and the verification and connection states are understandable |
| Non-default port and unknown/changed fingerprint | Use a test port, reject once, confirm once, simulate a key change | Port is accurate; a rejection does not start a session; a key change is explicitly rejected |
| Authentication failure and retry | Wrong password → prompt again → correct test password | One input is not recorded as a new command; after a successful retry the authentication stage is exited |
| Key passphrase / interactive authentication | The server requires multiple rounds of responses | Every prompt can be answered; cancelling cleans up the corresponding connection |
| No Shell integration | An ordinary prompt after login, with no OSC markers sent | Commands can be entered and executed, exit is supported; the password box is not shown indefinitely |
| Going directly into an interactive program | Normal screen and alternate screen once each | Arrow keys, Enter, Esc, Tab, Backspace, Ctrl+C, and resizing are passed through correctly |
| Server-side prompt followed by an active disconnect | Close the connection after migration or exit text is output | The prompt is preserved, the disconnect state is clear, reconnecting is possible; no further writes go to the dead PTY |
| Timeout and program exit | The user completes the interactive challenge themselves; simulate a timeout return | Timing and the final output are visible; the connection state after exit is accurate |
| A service without SFTP | The terminal succeeds and the file channel explicitly reports unsupported | The terminal remains usable as usual, and the file panel shows a capability explanation and a recovery entry point |

## This Round's Code and Verification

- Restored overlay-close for the outside of the SSH form per the latest requirement; kept the stop-bubbling behavior inside the fill-in area.
- Updated the corresponding unit tests, 2 E2E cases, and SSH11 in `docs/en/feature-spec.md`.
- TypeScript checks passed.
- Full Vitest: 128 test files passed, 1 skipped; 796 tests passed, 1 skipped.
- SSH form-close E2E: the 2 cases for create and edit passed. The full E2E suite and real Rust/SSH backend acceptance were not run.
- The other form sizing, draft, nested confirmation, and remote disconnect-state issues this round were only recorded and reproduced, not yet fixed; the no-Shell-integration interaction and TUI restoration in SSH block mode were fixed and verified separately below.

### No-Integration Interaction and TUI Restoration in SSH Block Mode

- The password response box is now based on the current prompt line, using the handled prompt text rather than a whole-screen snapshot to decide whether it is a duplicate; after an authentication rejection the response box is shown again, and after the user switches to direct input the same old prompt will not steal focus back.
- The SSH panel continues to retain the xterm mount node when hidden in the block-list scene, avoiding an empty terminal being shown when an alternate-screen program returns.
- Vitest covers the old prompt, rejection retry, and direct input; Playwright covers arrow keys/Enter/Esc against a server without OSC 133, and xterm screen restoration after entering the alternate screen during a running SSH block. The tests use a mock PTY and have not yet been re-verified on an external server.

### 2026-10-06: No Output After Submitting in the SSH Block Input

The previous round's fix covered only authentication input and scene switching, not the actual command path where the user submits `ls` in the block input bar. This round added a reproduction: after the remote sends a prompt marker, if the command-start marker is missing, the submitted command does not enter the executing state, and its output stays in an unshown pending-execution buffer; the end marker also cannot produce an output snapshot.

- Submitting a command in the block input bar immediately starts the corresponding output block, and a subsequent OSC 133;C does not start it again; SSH sessions without Shell integration continue to use the native terminal input path.
- Remote-injected commands no longer use `2>/dev/null` for the entire interactive Shell, so command error output can return to the UI via SSH.
- A visual check of actual SSH output also found that trailing blank lines in a snapshot were wrapped by letter-spacing styles into non-empty HTML, causing short output to occupy the entire terminal height and be scrolled out of the viewport. Now the empty representation of blank lines is preserved, trailing blank lines are trimmed, and blank lines between content are kept; E2E adds assertions for the height of a short-output block and output entering the viewport.
- Added unit tests and persistent E2E covering consecutive execution of `ls` and `pwd` with complete/missing preexec markers; the Rust test actually runs the remote Bash startup script, confirming that output, status markers, and standard error are preserved.
- Separately, a temporary test bridge connected the real Vrykell input bar in the browser to Windows OpenSSH and then to an isolated local SSH service and the actual Bash startup script. Both configurations — complete and missing preexec markers — verified two `ls` runs, `pwd`, and `ls missing-test-path`: output displayed, errors visible, execution status completed. This verification used real SSH transport and a real Shell; desktop ConPTY and Tauri IPC are still substituted by the test bridge, and the user's remote account was not used.
- [Screenshot of actual SSH command output and error status](../audit-evidence/2026-10-06/ssh-block-real-command-flow.png).
- Final verification: TypeScript, the build, and architecture checks passed; Vitest 834 passed, 1 skipped; Rust 108 passed, 2 ignored; the persistent Playwright suite passed all 198 items. The additional real OpenSSH browser test passed in both configurations.

## Follow-up Fix Records

### SSH Connection Form Sizing and Button Reachability

The popup was converged from a 620px-wide single-column long form to a compact 480px-wide layout: host/port, account/authentication method, and jump host/keepalive interval each occupy one row of two columns; the title and action area are fixed, with only the body scrolling; "Test connection" was moved to the left side of the action area, in the same row as "Cancel" and "Save".

- Default 1240×800: the popup is about 470px high, and all fields and buttons are visible at once.
- Minimum window 720×480 with the font size scaled up 1.4×: the popup does not exceed the window, save, cancel, and test connection always stay inside the popup, and the body scrolls independently.
- Also fixed an accessibility issue along the way: "Authentication method" originally wrapped two buttons in a `<label>`, causing the "Password" button's accessible name to be overridden by the label text; it is now a button group with `aria-label`, and each button keeps its own name.
- Regression coverage: `e2e/ssh-form-preservation.spec.ts` adds sizing cases (default window, minimum window + large font size, key-mode input row width); the SSH-related E2E and unit tests passed.

### The Focus Outline of Full-Width Inputs Is Clipped

Testing found that when the "Password" input is focused, the left and right sides of the focus ring are cut off. The cause is that the theme's focus style is `outline: 1px` + `outline-offset: 2px`, i.e. extending 3px outward; but the scrolling body area has `padding: 0` and the input is full width, so the outline falls exactly outside the `overflow: auto` clipping boundary, missing a segment on each side.

The fix is to use `margin: -4px` + `padding: 4px` in the scrolling body area to free up 4px of margin: the clipping boundary moves out into the popup's padding, and the field positions stay aligned with the title and action area. The regression case measures the margin on all four sides of the input within the scrolling body area, requiring at least 3px, covering the two full-width fields: connection name and password.

Draft saving, nested-confirmation bubbling, and the max-height of the generic confirmation window are still unfixed.

### SSH Won't Connect: Fingerprint Pre-Check Failure Treated as a Hard Gate

The local diagnostic log (`%LOCALAPPDATA%\com.vrykell.app\logs\terminal-debug.jsonl`) showed that of 13 SSH panels only 3 actually brought up a PTY; the rest ended within tens of milliseconds with `pty-spawn-error`, and all SSH requests were on port 22 — the chat server's 2222 never reached the backend.

A real-machine probe written with production code (`cargo test manual_chat_server_flow -- --ignored --nocapture`) reproduced and confirmed: the libssh2 pre-check failed outright for `www.altzin.com:2222` (`[Session(-5)] Unable to exchange encryption keys`), and `prepareSshHost` threw it as a fatal error, so the real `ssh` never started. The same server can log in, show the captcha screen, and disconnect normally using system OpenSSH.

Fix: a pre-check failure no longer blocks the connection; the ssh client now does its own verification — recorded hosts are still strictly compared, and an unknown fingerprint is asked about inside the terminal (`StrictHostKeyChecking=ask`); it still aborts if the user actively cancels or a recorded key has changed. With the fixed parameters the probe connected to the server: the password was accepted (1.4s), the sshfm UI rendered fully, and it disconnected per the server's behavior after a timeout.

Scope note: the probe verified the backend chain (command construction, PTY, real password/captcha interaction); frontend rendering and keystroke integration are covered by e2e fixtures and were not verified keystroke-by-keystroke on a real server.

## Supplement: Real SSH Chat Server Experience

After explicit user authorization, system OpenSSH was used to connect to `www.altzin.com:2222`. This was a real connection to an external server, not a test fixture; the connection entry point was a standalone tool terminal, not the Vrykell frontend, so it cannot be marked as a project end-to-end pass.

Connection command:

```powershell
ssh -tt -p 2222 -o ConnectTimeout=12 -o StrictHostKeyChecking=yes vrykell_test@www.altzin.com
```

A temporary test username and an arbitrary test password were used, reusing the existing host trust record. known_hosts was not modified, and the user's real credentials were not used.

Flow actually completed:

1. The server prompted for a password, and an arbitrary test password was accepted.
2. The server entered a numeric challenge screen with a countdown; after passing the challenge it showed `captcha passed` and entered the sshfm main UI.
3. The main UI showed a directory list, live status, and raw-keystroke operation hints; arrow keys selected, Enter opened the `Test` directory, and the path became `/Test`.
4. Esc returned to the root directory, and the path was restored to `/`.
5. Pressing the `q` shown in the UI hint exited, displaying `Disconnect from sshfm.` / `See you.`, after which the SSH connection closed. The tool process return code was 1, and the server clearly showed an active-exit message before closing.

No chat messages were sent, no broadcasts made, no nicknames changed, no files created or modified, and no content deleted; other participants' messages or addresses were not saved to the report.

After authentication the server provides an interactive UI directly rather than an ordinary Shell prompt. Control sequences such as clear screen, cursor positioning, line erase, reverse video, and cursor show/hide are visible in the tool terminal. Because the system terminal processes and re-emits control sequences, this tool output cannot be treated as the raw SSH byte stream, nor can it be used to assert that the server never sends alternate-screen sequences or OSC markers.

The real experience confirmed what the next round's project acceptance must cover: connecting to an interactive program immediately after login, a continuously refreshing countdown screen, arrow keys and Enter/Esc passed through as-is, the screen updating after a directory change, and the connection state being restored after exit. The earlier simulated failure in project block mode is still a separate frontend reproduction and has not yet been accepted inside Vrykell using this real server.

## 2026-10-06: SSH Empty-Output Investigation and Command Block Icon Adjustment

- Against the user's auto-saved diagnostic log, both `ls` commands ended normally; the raw block output contained only clear-screen and blank-line redraws, with no directory entries.
- A read-only investigation was performed using the existing connection and host trust record: the user's home directory has 0 non-hidden entries, so the lack of `ls` output matches the actual remote result; `pwd`, `ls /usr`, and standard error output all returned normally. No remote files or settings were modified.
- The above commands were retested using the production SSH command builder, the actual remote startup script, Windows OpenSSH, ConPTY, and the synchronous scanner. Authentication content and credentials are not retained; the sanitized output of the four commands is stored as `e2e/fixtures/ssh-conpty-output.json`, and browser replay covers frontend block rendering; this replay does not represent full desktop IPC acceptance.
- Per the user's request, empty output stays blank and the no-output notice was removed. Completed and running blocks are unified to 28px buttons and 14px action icons; the collapse/expand arrow is 12px.
