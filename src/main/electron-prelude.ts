/**
 * ELECTRON API PRELUDE
 *
 * On a normal machine, Electron's built-in module loader (c._load from
 * node:electron/js2c/node_init) intercepts require('electron') and returns
 * the real API. The npm electron package's index.js is only reached when
 * called from OUTSIDE Electron (CLI usage), where it correctly returns
 * the binary path.
 *
 * This prelude exists as a hook point for environments where the built-in
 * interception fails (see docs/reference/electron-require-issue.md).
 * On normal machines, it's a no-op.
 */
