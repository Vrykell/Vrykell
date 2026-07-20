/**
 * Main process entry point (CJS).
 *
 * Key insight: require('electron') might only be intercepted by Electron's
 * c._load when called from the MAIN entry module. We test this by calling
 * require('electron') HERE (the main entry) instead of from sub-modules.
 */

// Call require('electron') from the MAIN entry — this is where Electron's
// c._load might properly intercept it
let electronAPI;
try {
  electronAPI = require('electron');
  console.error('[main-wrapper] electron type:', typeof electronAPI);
  console.error('[main-wrapper] electron keys:', typeof electronAPI === 'object' ? Object.keys(electronAPI).slice(0, 10).join(', ') : electronAPI);
} catch(e) {
  console.error('[main-wrapper] require(electron) failed:', e.message);
}

// If we got a string (npm package intercepted), try alternative
if (typeof electronAPI === 'string') {
  console.error('[main-wrapper] Got path string, trying _linkedBinding...');
  try {
    electronAPI = process._linkedBinding('electron_common_features');
    console.error('[main-wrapper] _linkedBinding result:', Object.keys(electronAPI).slice(0, 5));
  } catch(e2) {
    console.error('[main-wrapper] _linkedBinding failed:', e2.message);
  }
}

// Store whatever we got globally for sub-modules
globalThis.__ELECTRON_API__ = electronAPI;

// Now load the application
require('./dist/main/main/electron-prelude');
require('./dist/main/main/index');
