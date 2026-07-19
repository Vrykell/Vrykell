/**
 * ELECTRON API PRELUDE
 *
 * In Electron 32+, the built-in electron module is handled by Electron's
 * own module loader. The npm electron package's index.js no longer tries
 * to detect the runtime (it just returns the binary path). This prelude
 * is a no-op for Electron 32+ but kept for compatibility.
 */

// No patching needed for Electron 32+
// Electron's Module._load natively intercepts require('electron')
