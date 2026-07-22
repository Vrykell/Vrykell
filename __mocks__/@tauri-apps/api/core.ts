// Lazy access: the backend instance is installed per-test in beforeEach,
// so it must be looked up at call time, not at module load.
export const invoke = (...args: any[]) =>
  (globalThis as any).__FAKE_TAURI_BACKEND__.invoke(...args);
