# AI toolbar regression, 2026-10-22

Main-workspace history and conversation settings now use the top toolbar. The settings menu floats above the existing conversation without shifting its draft or transcript. Side conversations retain compact heading actions, and moving between main and side preserves the same composer element and draft.

Nested selectors retain outside-click ownership, close before their parent on Escape, and allow workspace modifier shortcuts to reach the focused AI conversation. The selected navigation icon inherits its actual theme blue through the icon container.

Validation:

- Typechecking and architecture checks passed; the existing two-command advisory remains.
- Full unit suite: 2045 passed, one skipped.
- Initial affected browser suite: 64 of 65 passed. The remaining geometry assertion captured the input before automatic narrow-window sidebar collapse completed. After awaiting that transition, all six final toolbar, icon-color and platform scenarios passed.
- Reviewed dark and light menus at 1240 and 760 px. Nested Escape, main/side movement, retained DOM and drafts, and focused new-conversation shortcuts passed.

Evidence: [logs and screenshots](../audit-evidence/2026-10-22/ai-toolbar/). The change adds no IPC, capabilities, content source, authorization path or resource scope.
