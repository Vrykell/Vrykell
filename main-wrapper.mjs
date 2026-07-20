/**
 * Main process entry point (ESM) for Electron 43+.
 *
 * Theory: electron/main exports may be populated asynchronously.
 * We try multiple strategies with timing delays.
 */
import { createRequire } from 'module';

let electronAPI = null;

async function tryGetElectron() {
  // Strategy 1: Immediate import
  const mod1 = await import('electron/main');
  console.error('[wrapper] immediate import keys:', Object.keys(mod1).join(', '));
  if (mod1.app) {
    console.error('[wrapper] ✅ immediate import has app');
    return mod1;
  }

  // Strategy 2: Wait 100ms and retry
  await new Promise(r => setTimeout(r, 100));
  const mod2 = await import('electron/main');
  console.error('[wrapper] 100ms retry keys:', Object.keys(mod2).join(', '));
  if (mod2.app) {
    console.error('[wrapper] ✅ 100ms retry has app');
    return mod2;
  }

  // Strategy 3: Wait 500ms and retry
  await new Promise(r => setTimeout(r, 500));
  const mod3 = await import('electron/main');
  console.error('[wrapper] 500ms retry keys:', Object.keys(mod3).join(', '));
  if (mod3.app) {
    console.error('[wrapper] ✅ 500ms retry has app');
    return mod3;
  }

  // Strategy 4: Try electron (without /main)
  try {
    const mod4 = await import('electron');
    console.error('[wrapper] electron (root) keys:', Object.keys(mod4).join(', '));
    if (mod4.default?.app) {
      console.error('[wrapper] ✅ electron.default has app');
      return mod4.default;
    }
  } catch(e) {
    console.error('[wrapper] electron root:', e.message?.slice(0,80));
  }

  // Strategy 5: Try electron via CJS require (with prelude patching)
  try {
    const req = createRequire(import.meta.url);
    const mod5 = req('electron');
    console.error('[wrapper] require(electron) type:', typeof mod5);
    if (typeof mod5 === 'object' && mod5.app) {
      console.error('[wrapper] ✅ require(electron) has app');
      return mod5;
    }
  } catch(e) {
    console.error('[wrapper] require(electron):', e.message?.slice(0,80));
  }

  console.error('[wrapper] ❌ All strategies failed to get electron API');
  return null;
}

electronAPI = await tryGetElectron();

globalThis.__ELECTRON_API__ = electronAPI;

const require = createRequire(import.meta.url);
try {
  require('./dist/main/main/index.js');
} catch (err) {
  console.error('Failed to load app:', err);
  process.exit(1);
}
