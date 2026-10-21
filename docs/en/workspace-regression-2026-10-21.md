# Workspace baseline regression, 2026-10-21

This records the functional workspace baseline before the next requested visual refinements. Terminal, code, AI and host resources use a full-height navigation sidebar and horizontal instance strips. Native conversations and external connections retain drafts and mounted content while navigating. Auxiliary panels open on the right.

## Validation

- TypeScript: passed.
- Frontend unit tests: 328 files passed, one skipped; 2014 tests passed, one skipped.
- Architecture guard: passed. It reports the two existing credential commands without frontend callers.
- Full browser run: 622 tests discovered; 609 passed, 11 failed, two skipped on this platform. All 11 failures subsequently passed in focused reruns. The affected files produced 50 passing tests on the first rerun; the remaining reference presentation and blank-area paste tests then passed after repair. A second complete 622-test run was not performed.
- Backend source and capabilities did not change in this baseline. The prior integration baseline recorded 264 passing backend tests and three ignored tests.

The browser regression exposed a real pointer-focus regression: activating a terminal tab on press allowed the nested button's default focus behavior to override the terminal input. Preventing that default preserves command, running-terminal and alternate-screen input focus; all four focus/paste cases passed. Terminal references also now share the tool detail typography variables, fixing a 14px versus 12px mismatch.

Other failures required adapting tests to the new header location, excluding a redundant parked utility header, choosing a color different from the shell's default, comparing non-hovered cards, waiting for resize geometry before scrolling, and waiting for copy feedback that covers the bottom of the right file panel. Existing persistence, clipboard, grouping, close and layout assertions remain.

The earlier development run performed during source hot reload is excluded from the evidence totals. The recorded full run kept source and tests frozen throughout. Reruns used fresh test servers.

## Evidence and scope

Raw results and screenshots are in `docs/audit-evidence/2026-10-21/`: `workspace-full-first.log.txt`, `workspace-rerun-first.log.txt`, `workspace-rerun-second.log.txt`, `workspace-paste-final.log.txt`, and the `workspace-*-commit.log.txt` checks. The second rerun JSON includes the actual blank-click target: copy feedback, outside the file tree.

Screenshots cover expanded and compact navigation, a docked conversation and colored groups. These screenshots represent the baseline, not the subsequent requested design. The next stage changes collapse behavior, surface material, panel geometry, tab dragging and the single-conversation auxiliary AI surface. The separately reported manual-fullscreen black screen, resize jitter, analysis truncation and native window-close defects remain follow-up work and are not claimed fixed here.
