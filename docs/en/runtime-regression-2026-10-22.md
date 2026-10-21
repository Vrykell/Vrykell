# Runtime regression, 2026-10-22

The workspace baseline is `03144ed`; visual refinements are `9044beb`. These runtime fixes and the regression follow-up are committed directly on dev before the next requested interface changes.

## Fixes

- Manual fullscreen previously combined a global flag with a per-pane scene. Switching tabs cleared the flag while leaving the scene fullscreen, revealing an empty main terminal. Fullscreen presentation now belongs to its pane, restores that pane's focus, and keeps the same running terminal. Background panes cannot claim another pane's fullscreen host or clear its preference.
- Manual fullscreen previously had two resize owners, using different grids and toolbar heights. One scene-aware driver now sizes the output and PTY from the visible host. Pixel checks also exposed a backing canvas smaller than its GPU viewport at fractional display density. That environment falls back to DOM rendering while retaining the buffer. The check handles plugins loaded before the terminal opens as well as already-open terminals; diagnostics contain geometry metadata only.
- Both command-analysis entry paths silently sliced output at 2000 characters. References and model requests now retain the entire available block command and output, including trailing error markers. Existing terminal retention limits remain explicit and unchanged.
- The native close callback completes an accepted close through a destroy operation, but the main-window capability omitted that permission. Adding it restores titlebar and system close. The existing unsaved-document guard still preserves cancellation and failed writes. Browser mocks read the actual capability list and exercise the callback's full close/destroy path.
- Full regression caught a missing Settings tooltip after the sidebar moved. The shared hint and shortcut are restored. Navigation and geometry tests now exercise the confirmed fully-collapsed sidebar, upper auxiliary panel and independent AI conversation behavior.

## Validation

- Typecheck and architecture checks passed. Final unit run: 2025 passed, one skipped across 331 files. Backend run: 264 passed, three ignored.
- The complete 637-case browser run finished with 624 passed, 11 failed and two skipped. Failures identified an initial page-load timeout, obsolete layout/interaction expectations, the missing hint and the deferred-renderer check above. No assertion was removed to hide a functional failure.
- The affected 106-case rerun passed 103 cases. Three remaining test adaptations concerned restoring the original expanded sidebar before comparing exact terminal dimensions, preserving narrow-window collapse when closing SSH status, and distinguishing a conversation title from its question text. Their three files then passed all 20 cases.
- Fullscreen checks cover 1x and 1.25x display density, visible colored pixels, unchanged terminal identity, restored keyboard input, continuous width changes, a stable text origin and row count, and agreement between the final PTY and output grid. Static text pixels remain unchanged through resizing. Close checks cover clean, save, discard, cancel and failed-save paths. Analysis checks inspect the submitted model request.

Raw results and screenshots are in `docs/audit-evidence/2026-10-22/runtime/`. The two platform-dependent browser cases remain skipped on this host. Browser mocks verify application behavior and permissions; they do not exercise the native compositor or a live remote server. No installer was built and no remote branch was pushed.
