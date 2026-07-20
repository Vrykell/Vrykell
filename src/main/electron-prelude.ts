/**
 * ELECTRON API PRELUDE
 *
 * Fixes require('electron') in CJS compiled code to return the real
 * Electron API instead of the npm package's binary path string.
 *
 * Strategy: The ESM main-wrapper.mjs imports the real API via
 * `import { app } from 'electron/main'` and stores it on globalThis.
 * This prelude intercepts CJS require('electron') and returns the
 * cached API from globalThis.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as any;

if (process.versions?.electron) {
  const originalLoad = Module._load;

  Module._load = function (request: string, parent: any, isMain: boolean) {
    if (
      (request === 'electron' || request.startsWith('electron/')) &&
      (globalThis as any).__ELECTRON_API__
    ) {
      return (globalThis as any).__ELECTRON_API__;
    }
    return originalLoad.apply(Module, arguments as any);
  };
}
