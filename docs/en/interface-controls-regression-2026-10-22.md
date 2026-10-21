# Interface controls regression, 2026-10-22

The read-only path indicator now opens a shared permissions menu. Viewing the explanation does not elevate access; the separate action retains the existing guarded editing path. The persistent banner is removed, while editing and saving remain disabled until permissions actually change.

Terminal navigation now has a leading shared action menu, a default-terminal action and a separate arrow for the centered local/remote picker. Session search uses the existing field treatment. Group names are edited in a menu input, with Enter or dismissal committing and Escape cancelling; double-clicking does not rename. Group headings share the connected card shape and retain the footer color palette.

Validation:

- Typechecking and architecture checks passed. The existing two-command architecture advisory remains.
- Full unit suite: 2042 passed, one skipped.
- Browser suite: 87 of 88 passed. The remaining draft-preservation test used the previous AI panel close label. Both affected close-label scenarios passed after updating their selectors, including the additional auxiliary-close scenario.
- Reviewed dark/light terminal controls at 1240 and 760 px, and the narrow read-only permissions menu. Existing editor drag, fractional-density corners, terminal-type settings, AI drafts, scripts, navigation and shortcut scenarios passed in the affected suite.

Raw logs and screenshots are in [control evidence](../audit-evidence/2026-10-22/interface-controls/). Sidebar docking, bounds-based grouped dragging, AI toolbar placement and the host dashboard remain subsequent work.
