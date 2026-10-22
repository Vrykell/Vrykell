# Component bounds regression, 2026-10-22

Horizontal grouped tabs now use the complete dragged component against stable neighboring slots, independent of the pointer's grab offset. Group neighbors include their member width. Returning to the original position preserves membership; empty and collapsed destinations use the component center. Full component previews, cancellation and edge scrolling retain the shared implementation.

The focused unit suite passed 40 cases. The combined full suite passed 2068 with one skipped; typechecking and architecture checks passed. Six new/heading browser cases passed. The affected command, file-navigation and reorder suite initially passed 29 of 31: its old horizontal helper chased a neighbor while the placeholder moved it, returning the drag to the original position. Capturing the original destination fixed that helper; all five reorder cases passed on rerun. Evidence is in [the bounds folder](../audit-evidence/2026-10-22/grouped-tab-bounds/).
