import { terminalDebug } from './terminalDebug';

let startupSequence = 0;

/** Each effect gets an identity so cancelled mounts cannot be mistaken for a live startup. */
export function terminalStartupTrace(paneId: string, host: HTMLElement) {
  const startupId = `${paneId}:${Date.now()}:${++startupSequence}`;
  const startedAt = performance.now();
  let previousAt = startedAt;
  return (stage: string, detail: Record<string, unknown> = {}) => {
    const now = performance.now();
    terminalDebug('terminal-startup-stage', {
      paneId, startupId, stage,
      elapsedMs: Math.round(now - startedAt),
      stageDurationMs: Math.round(now - previousAt),
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      hostConnected: host.isConnected,
      ...detail,
    });
    previousAt = now;
  };
}
