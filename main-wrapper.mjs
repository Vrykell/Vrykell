// ESM wrapper entry point for Electron 28+
// Use createRequire to access Electron's built-in electron module
// via CJS require, which Electron's module loader intercepts.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Get the real Electron API via require (Electron intercepts this)
const electron = require('electron');

// Store globally for any code that needs it
globalThis.__ELECTRON_API__ = electron;

// Now load our CJS app
try {
  require('./dist/main/main/index.js');
} catch (err) {
  console.error('Failed to load app:', err);
  process.exit(1);
}
