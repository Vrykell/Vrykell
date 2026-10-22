# Color restoration, 2026-10-22

Content, terminal, titlebar and auxiliary panels return to their previous surface levels. Left navigation retains its current tint and material. Terminal and AI composers share a dedicated theme token: dark RGB 54/54/54, with the existing white surface retained in light mode. Ordinary editable fields keep their existing color.

Typechecking and architecture checks passed, with the existing two-command advisory. All 15 affected browser scenarios passed, including dark/light composer colors, settings and narrow layouts. The initial full unit run found one outdated terminal fallback-color expectation; after updating it, the full suite passed 2045 tests with one skipped. Reviewed dark/light screenshots are in [the evidence folder](../audit-evidence/2026-10-22/color-restoration/).
