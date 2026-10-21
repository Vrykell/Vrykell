# Workspace refinements, 2026-10-21

This follows baseline `03144ed` and implements the confirmed layout refinements directly on dev.

- Navigation uses compact shared rows, header history/collapse actions and one Settings footer destination. Collapse removes the sidebar completely. Entering a narrow window collapses it, with manual expansion still available through an unhighlighted titlebar control.
- Only navigation exposes the existing acrylic material. Other workspace regions are opaque, and content/auxiliary boundaries are square. Wallpaper opacity retains its existing purpose.
- The right auxiliary panel begins below the global toolbar. Connected instance tabs and content occupy its left column; compact toolbars retain secondary actions in shared menus.
- A single native conversation moves through a stable host between main and right areas, retaining its draft and reader. Session tabs and ACP content remain in the main AI workspace. Side-focused shortcuts operate on native conversations and cannot close a connected session.
- Terminal dragging carries the complete tab or group component. Existing reorder, close protection and color menus remain in use.

Validation: typecheck and architecture passed; 2017 unit tests passed, one skipped. The first 134-test browser batch passed 126 cases and exposed eight outdated navigation/material/geometry expectations. Their affected files and the final style corrections then passed all 64 cases on a fresh server. Connected-tab corner checks passed in both themes at three display densities; editor, comparison, external-session, terminal-focus, divider and running-output scenarios are included in the first batch. Screenshots cover both themes, expanded/collapsed navigation, docked AI and full-component dragging.

Visual inspection also caught a hover rule overriding the collapse control after its transition, and an inner comparison-editor radius. Both were corrected before the final browser batch. Raw results and final screenshots are in `docs/audit-evidence/2026-10-21/ui-refinements/`. Browser tests verify surface boundaries; the native compositor supplies the actual acrylic backdrop.

The separately requested manual-fullscreen, resize, analysis-length and native-close fixes follow this visual commit.
