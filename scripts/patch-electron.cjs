/**
 * Post-install patch for npm electron package.
 *
 * Fixes require('electron') to return the real Electron API when running
 * inside Electron's main process.
 *
 * Problem: npm electron's index.js returns a path string, not the API.
 * Electron's built-in module interceptor (c._load) doesn't fire.
 *
 * Fix: Add runtime detection to index.js. When process.versions.electron
 * exists, attempt to access the real API through alternative paths.
 *
 * Usage: node scripts/patch-electron.cjs
 * Runs automatically via package.json "postinstall" script.
 */

const fs = require('fs');
const path = require('path');

const ELECTRON_INDEX = path.join(__dirname, '..', 'node_modules', 'electron', 'index.js');

if (!fs.existsSync(ELECTRON_INDEX)) {
  console.log('[patch-electron] electron/index.js not found — skipping');
  process.exit(0);
}

// Read the original file
const original = fs.readFileSync(ELECTRON_INDEX, 'utf-8');

// Check if already patched
if (original.includes('AI-TERMINAL-PATCH')) {
  console.log('[patch-electron] Already patched — skipping');
  process.exit(0);
}

// Create backup
const backup = ELECTRON_INDEX + '.original';
if (!fs.existsSync(backup)) {
  fs.writeFileSync(backup, original);
  console.log('[patch-electron] Backup saved to', backup);
}

// Build the patched version
const patched = `// AI-TERMINAL-PATCH: Runtime detection for real Electron API
const fs = require('fs');
const path = require('path');

const pathFile = path.join(__dirname, 'path.txt');

function getElectronPath() {
  let executablePath;
  if (fs.existsSync(pathFile)) {
    executablePath = fs.readFileSync(pathFile, 'utf-8').trim();
  }
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || 'electron');
  }
  if (executablePath) {
    const fullPath = path.join(__dirname, 'dist', executablePath);
    return fullPath;
  }
  throw new Error(
    'Electron failed to install correctly. ' +
    'Please delete node_modules/electron and try installing again.'
  );
}

// When running INSIDE Electron, return the REAL API
if (process.versions && process.versions.electron) {
  // The real electron module is loaded via Electron's internal system.
  // We need to access it without going through node_modules resolution.
  try {
    // Access the electron module through Electron's internal module cache.
    // In a correctly initialized Electron main process, require('electron')
    // should resolve to the built-in API. The issue is the npm package
    // taking priority. We work around this by forcing resolution through
    // a module with zero search paths.
    var Module = require('module');

    // Save original paths
    var parentModule = module.parent || { paths: [], filename: __filename };
    var origPaths = parentModule.paths ? parentModule.paths.slice() : [];

    // Temporarily filter out all node_modules paths that contain 'electron'
    parentModule.paths = origPaths.filter(function(p) {
      try {
        return !fs.existsSync(path.join(p, 'electron'));
      } catch(e) { return true; }
    });

    try {
      var realElectron = Module._load('electron', parentModule, false);
    } finally {
      parentModule.paths = origPaths;
    }

    // If we got a string (still npm package), try a more aggressive approach
    if (typeof realElectron === 'string') {
      // Last resort: try _linkedBinding (limited, no app/BrowserWindow)
      try {
        realElectron = process._linkedBinding('electron_common_features');
      } catch(e) {}
    }

    if (realElectron && typeof realElectron === 'object') {
      module.exports = realElectron;
      return;
    }
  } catch(e) {
    // If all detection fails, fall through to return the binary path
    console.error(
      '[electron-patch] WARNING: Could not get real Electron API:',
      e.message
    );
  }
}

// Fallback: return the binary path (original behavior for CLI usage)
module.exports = getElectronPath();
`;

fs.writeFileSync(ELECTRON_INDEX, patched);
console.log('[patch-electron] ✅ Patched', ELECTRON_INDEX);
