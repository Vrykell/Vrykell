# Independent auxiliary docking regression, 2026-10-22

Auxiliary actions and their existing content can move between the left middle and right edge. Each side shows one different panel. Stable portal hosts preserve file state and conversation drafts through movement, closing and reopening. Navigation collapse hides the left panel without clearing it. Version 6 stores both sides independently and leaves previous storage versions intact. Both placement surfaces share the material switch and its opaque fallback.

When terminal columns leave less than 160 px for navigation, manual expansion uses a temporary overlay without changing pane geometry. Switching workspace, clicking the primary area or pressing Escape closes it. Its expanded state is not persisted; remembered width and dock assignments remain intact.

Typechecking and architecture checks passed; the architecture guard retains its existing two-command advisory. The full unit suite passed 2070 cases with one skipped. A 31-case browser run passed 29; the two remaining tests required adapting their navigation and terminal click targets to the confirmed overlay interaction. The final six-case rerun passed, covering both failures, width persistence, held-drag reversal, workspace switching, draft preservation and keyboard dismissal. Earlier focused runs passed three new independent-docking cases and ten assistant cases; the affected 52-case run's two failures were resolved by those assistant and overlay reruns. Dark, light and narrow screenshots were reviewed. Evidence is in [the audit folder](../audit-evidence/2026-10-22/independent-docking/).

Browser scenarios use the desktop IPC mock. They establish UI state, geometry and persistence behavior; native desktop material rendering remains platform-dependent.
