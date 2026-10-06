# Terminal Performance Verification (2026-10-06)

This round targets the lag after the amount of historical output grows, and the input latency when verbose logging is enabled. Terminal parsing, the cursor, and interaction are still handled by the existing xterm pipeline.

## Identified Additional Overhead

- A normal terminal extracts styled HTML after parsing output each time and then updates React state; this overhead occurs even when the screen is drawn by the terminal itself.
- When block state updates, new projection objects are created for all historical blocks, causing completed blocks to re-render.
- Historical output still participates in layout and painting after leaving the visible area.
- After logging is enabled, every input-related event calls IPC independently; the backend reopens the file, checks the file size, and writes to disk for every record.

## Implementation

- The historical block projection keeps references to unchanged objects and arrays, and the block and output components use memoized rendering.
- Historical output uses `content-visibility: auto`, provides an intrinsic height based on the number of terminal lines and the uniform line height, and preserves scroll position, output content, and copy capability. Environments that do not support this CSS property continue with normal rendering.
- A normal local terminal no longer generates connection page snapshots. SSH generates styled snapshots only on an authentication prompt, authentication rejection, or connection end/failure; normal interaction updates do not extract HTML.
- The frontend log keeps every structured record and sends them in batches within a window of at most 64 records or 50ms, and commits pending records before export and before changing the auto-save setting.
- The Rust log reuses a buffered file handle from a background thread, writing to disk within at most 64 records or 50ms; it explicitly flushes on export, on toggling the auto-save setting, and on normal exit. Rotation and redaction rules keep their previous behavior. Forcibly terminating the process can still lose the last small segment of pending records.
- After input occurs, the next batch of PTY output is sent with priority, avoiding continuing to wait for the usual 16ms output aggregation window; continuous output is still batched by the original window and byte thresholds.

## Local Comparison

Using Playwright, a development build, and Tauri mocks, through the real React and terminal frontend pipeline. The history scene loads 200 command blocks, each with 150 lines of styled output, about 30,000 lines in total. Each item is a single measurement and does not represent network or real desktop-environment end-to-end latency.

| Metric | Before Change | After Change |
|---|---:|---:|
| History load through two animation frames | 1028.8ms | 634.8ms |
| Wait for new command output to become visible | 1141ms | 186ms |
| Input editor keypress to next frame, P95 across samples | 72ms | 50ms |
| Scrolled content height after appending a command | 489481px | 489481px |

Another scene enables auto-save logging, continuously sends 20,000 lines of output to a classic terminal, and at the same time sends 12 keystrokes through the terminal input API; all keystrokes reached the PTY mock and the output also entered the terminal buffer, and the longest frame wait in this measurement was 53.3ms. It verifies frontend scheduling and the logging path, and does not measure the SSH network round trip.

Among the most recent 4000 log records on the existing test machine, 212 `pty_write` completions had a median duration of 2.3ms, a P95 of 11.4ms, and a maximum of 26.6ms. This is the IPC write duration in records that already existed before optimization, not key echo or a post-optimization comparison result.

## Regression Entry Points

- `e2e/terminal-performance.spec.ts`: 30,000 lines of history, input, new output, returning to history to view; 20,000 lines of continuous output and keystroke delivery after logging is enabled.
- `e2e/follow-bottom.spec.ts` and `e2e/block-width.spec.ts`: sticking to the bottom, reading position, font size, and running/completed width.
- `e2e/ssh-auth.spec.ts`: authentication prompts, cancelling trust, host key changes, disconnection, and remote block output.
- `src/features/terminal/model/__tests__/blockProjection.test.ts`: reference reuse, collapsed state, and invalidation on change.
- `src/features/terminal/model/terminalFrame.test.ts`: snapshot reuse for authentication and normal interaction.
- `src/platform/diagnostics.test.ts` and the Rust diagnostics tests: batch delivery order, timed commit, errors, redaction, record integrity, and file rotation.
- Rust PTY tests: input echo sent with priority, continuous output still batched.

## Dependency Check

The local machine has `@xterm/xterm` 6.0.0 installed, npm's `latest` on that day was also 6.0.0, and `beta` was 6.1.0-beta.304. fit 0.11.0, web-links 0.12.0, and webgl 0.19.0 all match the current version. This round retains the stable version and introduces no beta dependencies.

## Final Verification

`tsc`, the production build, and the architecture check pass; Vitest passes 843 items with 1 skipped; Rust passes 112 items with 2 manual network tests ignored; after source modifications stopped, the full Playwright suite passes 201 items. In the final full run, the new output wait in the history scene was 187ms and the longest input frame wait in the continuous output scene was 68.7ms; timings fluctuate normally between runs.
