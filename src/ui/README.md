# Shared interface packages

The interface layer remains business-agnostic. Import a component from its owning package,
without compatibility files or a global export barrel in this directory.

- `actions/`: buttons and action primitives.
- `fields/`: text entry, selection and value controls, with colocated styles.
- `menus/`: anchored menus and their shared ordering and placement rules.
- `feedback/`: notifications, errors, dialogs, progress and hover hints.
- `layout/`: tabs, sidebar rows, stable content hosts, split panes, placement and scrolling.
- `editor/`: editing, comparison and syntax surfaces, plus their lazy runtime adapters.
- `history/`: business-agnostic history lists, group cards and palettes.
- `icons/`: interface icons, application marks and shell identities.
- `hooks/`: shared interface behavior and localization-aware memoization.

Tests live in each package's `__tests__/` directory. The architecture check rejects source
components at the interface root. Terminal and mixed-resource panes use the same flat split
renderer, divider, pane surface and placement overlay; resource ownership stays in domain stores.
