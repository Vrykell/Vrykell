import { test, expect } from '@playwright/test';
import { emitPtyOutput, expectAnyTermContains, setupTauriMock } from './tauri-mock';

test('large command history stays readable and input reaches the terminal promptly', async ({ page }) => {
  test.setTimeout(60_000);
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  const history = await page.evaluate(async () => {
    const path = '/src/features/terminal/stores/blocks.ts';
    const { useBlockStore } = await import(path) as typeof import('../src/features/terminal/stores/blocks');
    const scope = window as unknown as { __vrykellSessionRegistry: { controllers: Map<string, { seed(blocks: import('../src/features/terminal/services/pipeline/termBlock').TermBlock[]): void }> } };
    const paneId = [...scope.__vrykellSessionRegistry.controllers.keys()][0]!;
    const blocks = Array.from({ length: 200 }, (_, i) => ({
      id: `performance-${i}`, command: `history-${i}`, status: 'done' as const, exitCode: 0,
      startedAt: i + 1, endedAt: i + 2, wasLongRunning: false, linesTruncated: 0,
      outputText: Array.from({ length: 150 }, (_, row) => `row-${i}-${row}`).join('\n'),
      outputHtml: Array.from({ length: 150 }, (_, row) => `<span style="color:var(--success)">row-${i}-${row}</span>`).join('<br>'),
      outputRaw: '',
    }));
    const started = performance.now();
    scope.__vrykellSessionRegistry.controllers.get(paneId)!.seed(blocks);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { mountMs: performance.now() - started, blocks: useBlockStore.getState().byTab[paneId]?.length };
  });
  await expect(page.locator('[data-testid^="command-block-"]')).toHaveCount(200);
  // Warm the input path first: focus and the first frame pay one-time costs, and the metric is
  // about steady-state typing while the history is large.
  for (let warm = 0; warm < 3; warm += 1) await page.getByPlaceholder(/输入命令/).press('a');
  const latencies: number[] = [];
  for (let i = 0; i < 12; i++) {
    const started = Date.now();
    await page.getByPlaceholder(/输入命令/).press('a');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    latencies.push(Date.now() - started);
  }
  await page.getByPlaceholder(/输入命令/).fill('');
  const started = Date.now();
  await emitPtyOutput(page, '\x1b]133;A\x07\x1b]133;E;ZWNobyBuZXc=\x07\x1b]133;C\x07new-output\r\n\x1b]133;D;0\x07\x1b]133;A\x07');
  await expect(page.locator('[data-testid^="command-block-"]').last()).toContainText('new-output');
  const appendMs = Date.now() - started;
  const scroll = page.locator('[data-testid^="terminal-scroll-"]').first();
  const scrollHeight = await scroll.evaluate(element => element.scrollHeight);
  await scroll.evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByTestId('command-block-performance-1')).toContainText('row-1-0');
  await emitPtyOutput(page, '\x1b]133;E;c3RyZWFt\x07\x1b]133;C\x07');
  await expect(page.getByTestId('running-term')).toBeVisible();
  const outputSpans = await page.locator('.command-block-output span').count();
  expect(outputSpans).toBeLessThan(500);
  const profiler = process.env.TERMINAL_PROFILE === '1' ? await page.context().newCDPSession(page) : null;
  await profiler?.send('Performance.enable');
  await profiler?.send('Profiler.enable');
  await profiler?.send('Profiler.start');
  const beforeProfile = await profiler?.send('Performance.getMetrics');
  const scrollFrames = await page.evaluate(async () => {
    const history = document.querySelector<HTMLElement>('.terminal-block-scroll')!;
    const scope = window as unknown as { __TAURI_INTERNALS__: { emitPtyOutput(data: string): void } };
    const frames: number[] = [];
    const boundaries: number[] = [];
    let previousBlock = '';
    let boundaryFrames = 0;
    for (let frame = 0; frame < 90; frame++) {
      const start = performance.now();
      scope.__TAURI_INTERNALS__.emitPtyOutput('live output\r\n'.repeat(20));
      history.scrollTop += frame < 45 ? 800 : -800;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const elapsed = performance.now() - start;
      const currentBlock = history.parentElement?.querySelector<HTMLElement>(':scope > .pinned-command-clip > [data-pinned-block-id]')?.dataset.pinnedBlockId ?? '';
      if (currentBlock !== previousBlock) boundaryFrames = 2;
      previousBlock = currentBlock;
      if (boundaryFrames > 0) { boundaries.push(elapsed); boundaryFrames--; }
      frames.push(elapsed);
    }
    return { frames: frames.sort((a, b) => a - b), boundaries };
  });
  const scrollP95Ms = scrollFrames.frames[Math.floor(scrollFrames.frames.length * 0.95)]!;
  if (profiler && beforeProfile) {
    const afterProfile = await profiler.send('Performance.getMetrics');
    const { profile } = await profiler.send('Profiler.stop');
    console.log('SCROLL-COST', afterProfile.metrics.filter(item => /Duration/.test(item.name)).map(item => ({ name: item.name, delta: item.value - (beforeProfile.metrics.find(previous => previous.name === item.name)?.value ?? 0) })));
    console.log('SCROLL-HOTSPOTS', profile.nodes.filter(item => item.hitCount).sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0)).slice(0, 18).map(item => ({ name: item.callFrame.functionName, url: item.callFrame.url, line: item.callFrame.lineNumber, hits: item.hitCount })));
    await profiler.detach();
  }
  const scrollWorstMs = scrollFrames.frames.at(-1)!;
  const boundaryWorstMs = Math.max(...scrollFrames.boundaries);
  console.log('TERMINAL-SCROLL-PERFORMANCE', JSON.stringify({ scrollP95Ms, scrollWorstMs, boundaryFrames: scrollFrames.boundaries.length, boundaryWorstMs }));
  expect(scrollFrames.boundaries.length).toBeGreaterThan(4);
  expect(boundaryWorstMs).toBeLessThan(100);
  expect(scrollP95Ms).toBeLessThan(40);
  expect(scrollWorstMs).toBeLessThan(100);
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const worst = sorted[sorted.length - 1]!;
  console.log('TERMINAL-PERFORMANCE', JSON.stringify({ ...history, appendMs, inputMedianMs: median, inputWorstMs: worst, scrollHeight }));
  // A shared machine can stretch one frame, so the budget guards the steady state (median) and
  // allows a single spike — but not a hang.
  expect(median).toBeLessThan(250);
  expect(worst).toBeLessThan(1200);
  expect(appendMs).toBeLessThan(1200);
});

test('continuous classic output does not extract HTML frames or delay native keyboard input', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({
    version: 8, state: { global: { openModeByShell: { zsh: 'classic', bash: 'classic', powershell: 'classic', pwsh: 'classic', cmd: 'classic' } }, overrides: {} },
  })));
  await page.goto('/');
  await expect(page.locator('.xterm').first()).toBeVisible();
  await expect(page.getByPlaceholder(/输入命令/)).toHaveCount(0);
  await page.waitForFunction(() => {
    const scope = window as unknown as { __vrykellTerms?: Map<string, unknown>; __PTY_SPAWNS__?: unknown[] };
    return Boolean(scope.__vrykellTerms?.size && scope.__PTY_SPAWNS__?.length);
  });
  const timings = await page.evaluate(async () => {
    const path = '/src/platform/diagnostics.ts';
    const { useDiagnosticSettings, flushDiagnostics } = await import(path) as typeof import('../src/platform/diagnostics');
    useDiagnosticSettings.setState({ autoSave: true });
    const scope = window as unknown as {
      __vrykellTerms: Map<string, { input(data: string, wasUserInput: boolean): void; buffer: { active: { getLine(row: number): { translateToString(): string } | undefined; length: number } } }>;
      __PTY_WRITES__: string[];
      __TAURI_INTERNALS__: { emitPtyOutput(data: string): void };
    };
    const term = [...scope.__vrykellTerms.values()][0]!;
    const data = 'continuous-output\r\n'.repeat(200);
    const started = performance.now();
    for (let chunk = 0; chunk < 100; chunk++) scope.__TAURI_INTERNALS__.emitPtyOutput(data);
    const samples = [];
    for (let index = 0; index < 12; index++) {
      const before = performance.now();
      term.input('z', true);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      samples.push(performance.now() - before);
    }
    await flushDiagnostics();
    return { elapsedMs: performance.now() - started, maximumInputFrameMs: Math.max(...samples), keys: scope.__PTY_WRITES__.filter(data => data === 'z').length };
  });
  console.log('TERMINAL-STREAM-PERFORMANCE', JSON.stringify(timings));
  expect(timings.keys).toBe(12);
  expect(timings.maximumInputFrameMs).toBeLessThan(250);
  await expectAnyTermContains(page, 'continuous-output');
  // One second of the data path is one aggregated record: a burst of 100 output batches must not
  // write hundreds of them (it did before the window: five records per batch).
  await page.waitForTimeout(1100);
  const log = await page.evaluate(() => (window as unknown as { __DIAGNOSTIC_RECORDS__: { event: string; detail: Record<string, unknown> }[] }).__DIAGNOSTIC_RECORDS__);
  const pipeline = log.filter(record => record.event === 'terminal-io');
  expect(pipeline.length).toBeGreaterThan(0);
  expect(pipeline.length).toBeLessThan(5);
  expect(pipeline.reduce((sum, record) => sum + Number(record.detail.rxBatches), 0)).toBeGreaterThanOrEqual(100);
});
