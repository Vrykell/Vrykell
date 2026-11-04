import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('new terminal diagnostics correlate creation, repeated mounts and shell readiness', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // Let the restored terminal finish its own detection before creating the traced one.
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/platform/diagnostics.ts';
    const { diagnosticSnapshot } = await import(path) as typeof import('../src/platform/diagnostics');
    return diagnosticSnapshot().some(record => record.event === 'terminal-startup-stage'
      && (record.detail as { stage: string }).stage === 'input-ready');
  })).toBe(true);
  const create = page.getByTestId('tab-new-default');
  await expect(create).toBeVisible();
  await create.click();
  const trace = () => page.evaluate(async () => {
    const path = '/src/platform/diagnostics.ts';
    const { diagnosticSnapshot } = await import(path) as typeof import('../src/platform/diagnostics');
    const records = diagnosticSnapshot();
    const request = records.filter(record => record.event === 'terminal-create-request').slice(-1)[0]?.detail as { paneId: string } | undefined;
    return records.filter(record => record.event === 'terminal-startup-stage'
      && (record.detail as { paneId: string }).paneId === request?.paneId).map(record => record.detail as {
        startupId: string; stage: string; reason?: string; elapsedMs: number;
      });
  });
  await expect.poll(async () => (await trace()).some(detail => detail.stage === 'input-ready')).toBe(true);
  const stages = await trace();
  const ready = stages.find(detail => detail.stage === 'input-ready')!;
  const live = stages.filter(detail => detail.startupId === ready.startupId);
  expect(live.map(detail => detail.stage)).toEqual(expect.arrayContaining([
    'effect-start', 'renderer-loaded', 'initial-fit', 'shell-detection-start', 'shell-detection-complete',
    'pty-invoke', 'pty-returned', 'prompt-marker', 'input-ready',
  ]));
  expect(ready.reason).toBe('prompt-marker');
  expect(live.every(detail => detail.elapsedMs >= 0)).toBe(true);
  const startup = await page.evaluate(async () => {
    const path = '/src/platform/diagnostics.ts';
    const { diagnosticSnapshot } = await import(path) as typeof import('../src/platform/diagnostics');
    const records = diagnosticSnapshot();
    const request = records.filter(record => record.event === 'terminal-create-request').slice(-1)[0]!;
    const recent = records.filter(record => record.sequence > request.sequence);
    return {
      detections: recent.filter(record => record.event === 'ipc-start' && (record.detail as { commandName: string }).commandName === 'list_shells').length,
      grid: recent.filter(record => record.event === 'terminal-startup-stage' && (record.detail as { stage: string }).stage === 'pty-invoke').map(record => record.detail as { cols: number; rows: number; startupId: string }),
    };
  });
  // A development strict-mode mount can probe shells twice; validate the grid of the
  // startup that became ready, not the cancelled first mount.
  expect(startup.detections).toBeGreaterThanOrEqual(1);
  const liveGrids = startup.grid.filter(grid => grid.startupId === ready.startupId);
  expect(liveGrids).toHaveLength(1);
  for (const grid of liveGrids) {
    expect(grid.cols).toBeGreaterThan(2);
    expect(grid.rows).toBeGreaterThan(1);
  }
});

test('a real blocked main thread leaves a long-task observation beside the frame gap', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-new-default')).toBeVisible();
  const started = await page.evaluate(() => new Promise<number>(resolve => {
    setTimeout(() => {
      const started = Date.now();
      const until = performance.now() + 350;
      while (performance.now() < until) { /* Exercise a bounded synchronous task. */ }
      resolve(started);
    }, 0);
  }));
  await expect.poll(() => page.evaluate(async started => {
    const path = '/src/platform/diagnostics.ts';
    const { diagnosticSnapshot } = await import(path) as typeof import('../src/platform/diagnostics');
    return diagnosticSnapshot().some(record => record.timestampMs >= started && record.event === 'main-thread-long-task'
      && (record.detail as { durationMs: number }).durationMs >= 300);
  }, started)).toBe(true);
});
