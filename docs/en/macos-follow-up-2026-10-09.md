# macOS feedback audit (2026-10-09)

This checklist merges repeated feedback and preserves the latest corrections. The user has verified resize, short-command history movement, shared inputs, edge hairlines, automatic scrolling, and input latency, and explicitly narrowed the remaining scope to shared theme controls, descriptions and shortcut hints, and vi corner protocol text. Completed items are no longer listed as awaiting verification.

| # | Request | Current status and actual change |
| --- | --- | --- |
| 1 | Build SSH without Homebrew and address macOS compiler warnings | Implemented: vendored OpenSSL/libssh2 on macOS; platform conditional compilation and clipboard encoding changes. |
| 2 | Adapt the macOS titlebar and inset the settings button | Implemented: native window control positioning, title clearance, and right-side spacing. |
| 3 | Restore the custom colored terminal tiles and original size | Implemented: solid colored terminal tiles with dark prompt marks, default 20px tab-row size. This final request supersedes earlier requests for existing assets and larger icons. |
| 4 | Preserve colored icons when opening files in terminal tabs | Implemented: propagate the actual shell type when creating a tab. |
| 5 | Share all input components and disable correction, capitalization, and press-and-hold menus | Verified by the user: shared TextInput/TextArea disable correction, capitalization and spelling, with macOS text-service policy configured. |
| 6 | Stop typed text flashing in the classic terminal corner | The user confirmed the input fixes: retain helper-input visibility and focus handling, and keep this separate from vi protocol characters at the lower right. |
| 7 | vi works but character sequences appear in the bottom-right corner | The follow-up screenshot confirms a remaining `~@k` flash, a temporary special-key repaint from the editor. The first response and its cleanup could enter different output batches; input responses now share a window capped at 2ms, preserving showcmd. Startup-query fixes remain. Native rechecking is still pending. |
| 8 | Remove width-dependent hairlines at classic terminal edges | Verified by the user: terminal geometry and edge treatment pass. |
| 9 | Use the application gray surface for global search instead of a large near-black area | Implemented: search overlay uses application surface colors. |
| 10 | Prefix scoping, removable scope chips, history chips, fewer redundant controls, and an ordinary divider | Implemented: prefix parsing, scope chips and history labels; hide the filter button for active prefixes and use an ordinary divider. |
| 11 | Avoid background highlights stacking in search results and history | Implemented: transparent result and history row backgrounds. |
| 12 | Search individual settings in both global and settings search | Implemented: shared field index; results carry specific setting targets. |
| 13 | Navigate to a setting without highlighting its card | Implemented: scroll to and focus the control; remove target-card highlighting. |
| 14 | Remove SSH form focus decoration and equalize top-right buttons | Implemented: shared inputs, no form focus outline or shadow, consistent button sizes. |
| 15 | Configure a default terminal | Implemented: persist the default shell for new tabs, startup, and opening files in terminals. |
| 16 | Match block and classic terminal backgrounds | Implemented: both modes use the same terminal background source. |
| 17 | Show a gray placement preview as a navigation button crosses a nearby target | Follow-up completed: preview and hit testing share their full bounds, so release works across the entire frame. Panels, splitting and moving terminals share the gray DropPlacementPreview surface. |
| 18 | Establish consistent menu ordering | Implemented: shared primary, clipboard, edit, view, organize, and removal groups applied to major context menus. |
| 19 | Hide meaningless classic-terminal command-block counts in history | Implemented: show counts according to terminal mode; chat messages are separate from command blocks. |
| 20 | Recover historical SSH sessions whose saved connection was deleted | Implemented: validate saved references; allow another connection or fresh authentication with the historical address. |
| 21 | Unify command controls, exit status, text, and icon contrast | Completed in this iteration: shared IconButton/TextButton, permission control and CommandStatus. Overrideable theme variables control color, hover, active, disabled and status styles across composers, chat and small settings actions. |
| 22 | Shorten settings and hover descriptions and use shared shortcut icons | Completed in this iteration: shorter permission and attachment hover hints and settings descriptions. KeyHint icons also cover completion Tab/Escape hints and TUI controls. |
| 23 | Fix intermittent block-mode automatic scrolling | Verified by the user: automatic scrolling fix passes. |
| 24 | Stop short commands such as ls reloading and shifting the whole history | Verified by the user: short-command history movement fix passes. |
| 25 | Fix classic resize flicker, frame drops, and text oscillation | Verified by the user: resize oscillation, flicker and horizontal text movement fixes pass. |
| 26 | Check and fix input latency | Verified by the user: input latency fix passes. |
| 27 | Align the model name, icon and actions | Fixed: header controls share a 32px height and align with the input; save feedback stays below it. |
| 28 | Select valid images only for wallpapers | Fixed: image-extension filtering and successful decoding with valid dimensions are required before saving; disguised, corrupt or timed-out files preserve the previous wallpaper. |
| 29 | Reduce overall UI font weight | Fixed: body text uses 400 and headings or selected items primarily use 500, with shared theme weight variables. Bold output requested by terminal programs retains its meaning. |

## Verification limits

- TypeScript and architecture checks pass.
- The full unit suite for this iteration passed: 176 files passed and 1 skipped; 1044 tests passed and 1 skipped.
- Browser tests cover search, navigation, SSH recovery, block output, and real vi interaction. Tauri mocks and Python PTY tests do not replace the native WKWebView and Rust PTY path.
- Diagnostics have been read. They contain metadata only, so they cannot reveal the actual corner characters. Successful resize calls alone do not establish stable rendering.
- Passing unit tests, code changes, and mocked browser interactions must not be reported as resolution of native feedback. Unconfirmed items remain on this checklist.

## Verification for this iteration

Added startup-query forwarding unit coverage. Real vi uses its built-in defaults and checks both opening modes, editing and saving, protocol-free corner frames, and one reply per version request. The native application symptom still requires rechecking; browser coverage does not replace that conclusion.

Related WebKit regressions cover real vi, icons, shared controls, command-block actions and AI composers, with 26 checks passing. The narrow-window check also verifies that the hover label and shortcut share one row and the tooltip stays within the viewport. Final TypeScript, architecture and shared-control unit checks pass.

## Follow-up screenshot verification

Five WebKit regressions pass for model alignment, wallpaper restrictions, full panel release bounds and moving terminals. Real vi coverage now explicitly enables showcmd, keeps PTY dimensions and resizing aligned with the UI, and links the production Rust output window. It verifies that raw editor output contains special-key repaint fragments while parsed bottom-row frames do not display them. The full Rust suite passes 136 tests, with 2 ignored. The native flash still needs rechecking; failure to capture a single frame is not evidence of absence.
