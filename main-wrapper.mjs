// ESM wrapper entry point for Electron.
// Uses createRequire to bridge ESM → CJS for the compiled main process code.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// On a normal machine, require('electron') returns the real Electron API.
// Store globally so compiled CJS modules can use globalThis.__ELECTRON_API__
// as a fallback if their own require('electron') call fails.
try {
  const electron = require('electron');
  globalThis.__ELECTRON_API__ = electron;
} catch (e) {
  console.error('[main-wrapper] WARNING: require("electron") failed:', e.message);
}

// Load the compiled CJS application
try {
  require('./dist/main/main/index.js');
} catch (err) {
  console.error('Failed to load app:', err);
  process.exit(1);
}
