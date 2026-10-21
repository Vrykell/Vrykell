# Interface regression, 2026-10-22

The titlebar, content and auxiliary panels now share the previous auxiliary surface. Left navigation uses the former titlebar color, with a fixed material tint and an opaque fallback. Fields, cards and selection colors retain their existing hierarchy.

This batch also centers search across the full application, aligns the collapsed expand control, removes fractional-scale strokes from connected tabs, colors selected navigation icons, names the side conversation AI assistant, enlarges model actions and shares refresh feedback. Unsupported system integration is absent from settings navigation and search; unavailable restored destinations resolve to a supported page.

Validation:

- Typechecking and architecture checks passed. The architecture command retains its existing advisory about two unused credential commands.
- Full unit suite: 2036 passed, one skipped.
- Initial browser run: 39 passed, two fractional-density corner failures. Overlapping masked connectors resolved both; six corner scenarios then passed.
- Final palette run: 45 passed, two settings assertions still expected the previous navigation color and blur. Updating those expectations to the approved palette and shared material produced three passing settings scenarios. All 47 affected browser scenarios passed across the final run and that focused rerun.
- Reviewed dark/light, narrow/wide screenshots, including whole-application search placement, collapsed control spacing and model controls. Native effects are covered through API unit tests and browser mocks; these screenshots do not establish compositor behavior on other physical systems.

Logs and screenshots are in [interface evidence](../audit-evidence/2026-10-22/interface-polish/). Subsequent sidebar docking, group interactions and host dashboard work are outside this batch. Local and remote terminals retain their unified workspace and database layout.
