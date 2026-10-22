# Workspace surface and tab interaction regression, 2026-10-22

Dark mode now uses `#2E2E2E` for the application titlebar, `#282828` for auxiliary panels, result toolbars, settings navigation and settings/history content bases, and `#333333` for settings, history, usage and tool cards plus the terminal and AI command composers. Shared cards have square separation through their surface color and no shadow. Settings navigation and content have a resting hairline. The right auxiliary divider remains hidden until hover or resize.

All left sidebar rows use the shared sidebar row geometry. Workspace, toolbar and Settings entries have the same height, inset, icon slot, corner radius, hover surface and blue selected icon. The toolbar section has no divider above it. Left-panel titles are omitted; its stable content is separated from the toolbar by a hairline.

Terminal groups and loose tabs use one reconciled top-level order. A group card has no selected state when one of its members is active, reveals a card surface on hover, folds visually while being dragged and restores on release. Group nesting is rejected. The new-tab dialog contains the default profile, profile choices, current/home/custom locations, new-window and split actions, and uses shared icons and shortcut hints.

Typechecking, architecture checks and the full unit suite passed: 2079 tests passed with one skipped. The affected browser suite passed all 55 scenarios across settings, history, unified surfaces, left/right docking, tab grouping, new-tab creation, navigation and responsive layouts. Screenshots are in [the audit folder](../audit-evidence/2026-10-22/workspace-surface-unification/).

Browser scenarios use the desktop IPC mock. They verify layout, colors, persistence and interaction state; native window creation and platform material rendering remain desktop-runtime concerns.
