import { expect, test, type Locator } from '@playwright/test';
import { setupTauriMock, ptyWrites, clipboardText } from './tauri-mock';

async function expectConnectionTitle(panel: Locator) {
  const overview = panel.locator('header');
  await expect(overview.getByText('root@prod.example.com:22', { exact: true })).toHaveCount(1);
  await expect(panel.locator('.ssh-status-overview')).toHaveCount(0);
  await expect(panel.getByText('已连接', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('远端资源', { exact: true })).toHaveCount(0);
  await expect(overview.locator('.ssh-status-address')).toHaveCount(0);
  await expect(panel.locator('.ssh-network-route')).toHaveCount(0);
  await expect(overview).toHaveCSS('border-bottom-width', '0px');
  await expect(overview.getByRole('button', { name: '复制连接地址' })).toHaveAttribute('data-compact', 'true');
  const spacing = await overview.evaluate(element => {
    const heading = getComputedStyle(element);
    const reference = document.createElement('div'); reference.className = 'workspace-panel-heading';
    element.parentElement!.appendChild(reference);
    const sidebar = getComputedStyle(reference);
    const keys = ['minHeight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'fontSize'] as const;
    const result = keys.map(key => [heading[key], sidebar[key]]);
    reference.remove(); return result;
  });
  for (const [actual, expected] of spacing) expect(actual).toBe(expected);
  await overview.scrollIntoViewIfNeeded();
  const row = await overview.boundingBox();
  const address = await overview.locator('.ssh-status-identity').boundingBox();
  const copy = await overview.getByRole('button', { name: '复制连接地址' }).boundingBox();
  const actions = await overview.locator('.ssh-status-header-actions').boundingBox();
  expect(Math.abs(copy!.y + copy!.height / 2 - address!.y - address!.height / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(copy!.y + copy!.height / 2 - actions!.y - actions!.height / 2)).toBeLessThanOrEqual(1);
  expect(copy!.x - address!.x - address!.width).toBeGreaterThanOrEqual(4);
  expect(copy!.x - address!.x - address!.width).toBeLessThanOrEqual(5);
  expect(actions!.x + actions!.width).toBeLessThanOrEqual(row!.x + row!.width + 1);
  expect(await overview.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

for (const theme of ['dark', 'light'] as const) {
  test(`resource history and text readings stay together at narrow and wide widths in ${theme} mode`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await setupTauriMock(page);
    await page.addInitScript(value => localStorage.setItem('vrykell-ssh-resource-display', value), theme === 'dark' ? 'bars' : 'chart');
    await page.clock.setFixedTime(new Date('2026-10-17T06:00:00Z'));
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
    await page.getByRole('radio', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-row-ssh-1').dblclick();
    await page.getByTestId('ssh-status-toggle').last().click();
    const panel = page.getByTestId('ssh-status-panel');
    await expect(panel.getByTestId('ssh-resource-memory')).toHaveText('26%');
    await expectConnectionTitle(panel);
    await panel.getByRole('button', { name: '复制连接地址' }).click();
    await expect.poll(() => clipboardText(page)).toBe('root@prod.example.com:22');
    await panel.locator('header').screenshot({ path: testInfo.outputPath(`connection-title-${theme}-300.png`) });
    await page.clock.setFixedTime(new Date('2026-10-17T06:00:15Z'));
    const refresh = panel.getByRole('button', { name: '刷新远端资源' });
    const cpu = panel.getByTestId('ssh-resource-cpu');
    // A connection-state change while the panel settles drops the counter pair the reading is
    // derived from, so retry with the next 15 s interval until two consecutive samples land.
    let seconds = 15;
    await expect.poll(async () => {
      await page.clock.setFixedTime(new Date(Date.parse('2026-10-17T06:00:00Z') + seconds * 1000));
      seconds += 15;
      if (await refresh.isEnabled()) await refresh.click();
      return cpu.textContent();
    }, { timeout: 30_000 }).toBe('12%');
    const writes = await ptyWrites(page);
    const system = panel.locator('.ssh-status-system-section');
    await expect(system).not.toHaveAttribute('open');
    await page.screenshot({ path: testInfo.outputPath(`resources-default-${theme}-300.png`) });
    await system.locator('summary').click();
    await expect(panel.getByText('1 分钟', { exact: true })).toBeVisible();
    await expect(panel.getByText('5 分钟', { exact: true })).toBeVisible();
    await expect(panel.getByText('15 分钟', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, number>).__NETWORK_PROBE_CALLS__ ?? 0)).toBeGreaterThan(0);
    await expect(panel.getByTestId('ssh-network-result')).toHaveAttribute('data-connectivity', 'reachable');
    await expect(panel.locator('.ssh-network-result').getByText('39.0 ms', { exact: true })).toBeVisible();
    const network = panel.getByRole('region', { name: '网络连通性' });
    expect((await network.boundingBox())!.y).toBeLessThan((await panel.locator('.ssh-status-resource').boundingBox())!.y);
    await expect(panel.getByText('10.0 KB/s', { exact: true })).toBeVisible();
    await expect(panel.getByText('5.0 KB/s', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`resources-bars-${theme}-300.png`) });
    for (const seconds of [30, 45, 60, 75, 90]) {
      const before = await page.evaluate(() => (window as unknown as Record<string, number>).__SSH_STATUS_CALLS__);
      await page.clock.setFixedTime(new Date(Date.parse('2026-10-17T06:00:00Z') + seconds * 1000));
      await panel.getByRole('button', { name: '刷新远端资源' }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__SSH_STATUS_CALLS__)).toBeGreaterThan(before);
      await expect(panel.getByRole('button', { name: '刷新远端资源' })).toBeEnabled();
    }
    const chart = panel.getByRole('img', { name: '资源使用率趋势' });
    await expect(chart).toHaveCount(1);
    await expect(chart.locator('[data-series]')).toHaveCount(3);
    await expect(panel.locator('.ssh-status-metric-value')).toHaveCount(3);
    await expect(panel.getByRole('meter')).toHaveCount(0);
    await expect(panel.getByRole('combobox')).toHaveCount(0);
    const traffic = panel.getByRole('img', { name: '上传与下载趋势' });
    await expect(traffic).toHaveCount(1);
    await expect(traffic.locator('[data-series]')).toHaveCount(2);
    await expect(chart.locator('xpath=../..').locator('.ssh-resource-chart-caption')).toHaveText('资源使用率');
    await expect(traffic.locator('xpath=../..').locator('.ssh-resource-chart-caption')).toHaveText('吞吐量');
    await expect(panel.getByTestId('ssh-network-result')).toHaveCSS('border-top-width', '0px');
    const colors = await chart.locator('[data-series]').evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
    expect(new Set(colors).size).toBe(3);
    const tones = await panel.evaluate(element => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      const brightness = (color: string) => {
        context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).reduce((sum, value) => sum + value, 0);
      };
      const probe = document.createElement('span'); element.append(probe);
      const baselines = ['--cmd-argument', '--cmd-pipe', '--cmd-number', '--cmd-path', '--cmd-pipe'];
      const lines = [...element.querySelectorAll('.ssh-status-resource-summary [data-series]'), ...element.querySelectorAll('.ssh-network-rates [data-series]')];
      const values = lines.map((line, index) => {
        probe.style.color = `var(${baselines[index]})`;
        return { actual: brightness(getComputedStyle(line).color), baseline: brightness(getComputedStyle(probe).color) };
      });
      probe.remove(); return values;
    });
    expect(tones).toHaveLength(5);
    for (const tone of tones) expect(tone.actual).toBe(tone.baseline);
    for (const plot of [chart, traffic]) {
      const bounds = await plot.evaluate(element => {
        const chart = element.closest('.ssh-resource-chart')!;
        const frame = chart.getBoundingClientRect();
        const svg = element.getBoundingClientRect();
        const axis = chart.querySelector('.ssh-resource-chart-axis')!.getBoundingClientRect();
        const footer = chart.querySelector('.ssh-status-time-axis')!.getBoundingClientRect();
        const caption = chart.querySelector('.ssh-resource-chart-caption')!.getBoundingClientRect();
        const maximum = chart.querySelector('.ssh-resource-chart-axis > span:last-child')!.getBoundingClientRect();
        return { frame: frame.width, plot: svg.width, rightInset: svg.right - axis.right, leftInset: axis.left - svg.left, scaleBottom: axis.bottom, plotTop: svg.top, plotBottom: svg.bottom, footerTop: footer.top, captionLeft: caption.left - svg.left, labelGap: maximum.left - caption.right };
      });
      expect(Math.abs(bounds.frame - bounds.plot)).toBeLessThanOrEqual(1);
      expect(bounds.rightInset).toBeGreaterThanOrEqual(0);
      expect(bounds.rightInset).toBeLessThanOrEqual(3);
      expect(bounds.leftInset).toBeGreaterThanOrEqual(0);
      expect(bounds.scaleBottom).toBeLessThanOrEqual(bounds.plotTop);
      expect(bounds.footerTop).toBeGreaterThanOrEqual(bounds.plotBottom);
      expect(bounds.captionLeft).toBeGreaterThanOrEqual(0);
      expect(bounds.labelGap).toBeGreaterThanOrEqual(12);
      expect((await plot.boundingBox())!.height).toBe(160);
      await expect(plot.locator('.ssh-resource-chart-frame')).toHaveCount(1);
    }
    for (const surface of ['.ssh-status-resource-summary', '.ssh-network-rates', '.ssh-network-result']) {
      await expect(panel.locator(surface)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(panel.locator(surface)).toHaveCSS('border-radius', '0px');
    }
    const resultBox = (await panel.getByTestId('ssh-network-result').boundingBox())!;
    expect(resultBox.y).toBeGreaterThanOrEqual((await panel.locator('.ssh-network-rates').boundingBox())!.y + (await panel.locator('.ssh-network-rates').boundingBox())!.height);
    await page.screenshot({ path: testInfo.outputPath(`resources-chart-${theme}-300.png`) });
    await panel.locator('.ssh-status-resource').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`resources-chart-${theme}-detail.png`) });
    const summary = panel.locator('.ssh-status-resource-summary');
    const summaryBounds = (await summary.boundingBox())!;
    const chartBounds = (await chart.boundingBox())!;
    expect(summaryBounds.height).toBeLessThanOrEqual(300);
    expect((await panel.locator('.ssh-status-metrics').boundingBox())!.y).toBeGreaterThanOrEqual(chartBounds.y + chartBounds.height);
    await summary.screenshot({ path: testInfo.outputPath(`combined-resources-${theme}-300.png`) });
    await network.screenshot({ path: testInfo.outputPath(`network-full-width-${theme}-300.png`) });
    const separator = page.getByRole('separator', { name: '调整 SSH 状态面板宽度' });
    await separator.focus();
    for (let index = 0; index < 19; index++) await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(604);
    await expectConnectionTitle(panel);
    await panel.locator('header').screenshot({ path: testInfo.outputPath(`connection-title-${theme}-604.png`) });
    await summary.screenshot({ path: testInfo.outputPath(`combined-resources-${theme}-604.png`) });
    await page.screenshot({ path: testInfo.outputPath(`resources-chart-${theme}-604.png`) });
    for (let index = 0; index < 23; index++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(240);
    await expectConnectionTitle(panel);
    await panel.locator('header').screenshot({ path: testInfo.outputPath(`connection-title-${theme}-240.png`) });
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await summary.screenshot({ path: testInfo.outputPath(`combined-resources-${theme}-240.png`) });
    await page.screenshot({ path: testInfo.outputPath(`resources-chart-${theme}-240.png`) });
    await panel.getByRole('button', { name: '关闭 SSH 状态' }).click();
    await page.getByTestId('ssh-status-toggle').last().click();
    await expect(chart).toBeVisible();
    await expect(panel.locator('.ssh-status-metric-value')).toHaveCount(3);
    await expect(panel.getByRole('meter')).toHaveCount(0);
    expect(await ptyWrites(page)).toEqual(writes);
    await page.reload();
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
    const sshButton = page.locator('[data-dock-btn="ssh"]');
    if (!await page.getByTestId('ssh-row-ssh-1').isVisible()) await sshButton.click();
    await page.getByTestId('ssh-row-ssh-1').dblclick();
    await page.getByTestId('ssh-status-toggle').last().click();
    await expect(chart).toBeVisible();
    await expect(panel.getByRole('combobox')).toHaveCount(0);
    await expect(panel.getByTestId('ssh-resource-memory')).toBeVisible();
  });
}

test('resource text stays aligned with mixed percentage widths and larger UI text', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await setupTauriMock(page);
  await page.clock.setFixedTime(new Date('2026-10-17T06:00:00Z'));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/');
  await page.evaluate(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command, args) => {
      const result = await invoke(command, args);
      if (command !== 'ssh_system_status') return result;
      const sample = result as import('../src/features/ssh/services/api').SshSystemStatus;
      return { ...sample, cpuIdle: sample.cpuTotal! * .99, memoryAvailable: sample.memoryTotal! * .88, diskUsed: sample.diskTotal };
    };
  });
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByTestId('ssh-status-toggle').last().click();
  const panel = page.getByTestId('ssh-status-panel');
  await expect(panel.getByTestId('ssh-resource-memory')).toHaveText('12%');
  for (const seconds of [15, 30, 45]) {
    await page.clock.setFixedTime(new Date(Date.parse('2026-10-17T06:00:00Z') + seconds * 1000));
    await panel.getByRole('button', { name: '刷新远端资源' }).click();
    await expect(panel.getByRole('button', { name: '刷新远端资源' })).toBeEnabled();
  }
  await expect(panel.getByTestId('ssh-resource-cpu')).toHaveText('1%');
  await expect(panel.getByTestId('ssh-resource-disk')).toHaveText('100%');
  const summary = panel.locator('.ssh-status-resource-summary');
  for (const fontSize of [14, 18]) {
    await page.evaluate(async uiFontSize => {
      const { useTypographyStore } = await import('/src/config/typography.ts') as typeof import('../src/config/typography');
      useTypographyStore.getState().update({ uiFontSize });
    }, fontSize);
    const separator = page.getByRole('separator', { name: '调整 SSH 状态面板宽度' });
    await separator.focus();
    for (let index = 0; index < (fontSize === 14 ? 3 : 7); index++) await page.keyboard.press(fontSize === 14 ? 'ArrowLeft' : 'ArrowRight');
    const expectedWidth = fontSize === 14 ? 348 : 240;
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(expectedWidth);
    await expectConnectionTitle(panel);
    await panel.locator('header').screenshot({ path: testInfo.outputPath(`connection-title-${fontSize}-${expectedWidth}.png`) });
    const readingEdges = await panel.locator('.ssh-status-metric-value').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().right));
    for (const edge of readingEdges) expect(Math.abs(edge - readingEdges[0])).toBeLessThanOrEqual(1);
    await expect(panel.getByRole('meter')).toHaveCount(0);
    const details = summary.locator('.ssh-status-metric-caption');
    await expect(details).toHaveCount(3);
    await expect(details.first()).toHaveText('99% 空闲');
    for (const detail of await details.all()) expect((await detail.boundingBox())!.height).toBeGreaterThan(0);
    expect(await summary.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(summary.locator('.ssh-resource-chart')).toHaveAttribute('data-window-ms', '60000');
    await expect(panel.locator('.ssh-network-rates .ssh-resource-chart')).toHaveAttribute('data-window-ms', '60000');
    await summary.screenshot({ path: testInfo.outputPath(`aligned-resources-${fontSize}-${expectedWidth}.png`) });
    await panel.locator('.ssh-network-rates').screenshot({ path: testInfo.outputPath(`network-scale-${fontSize}-${expectedWidth}.png`) });
  }
});

test('resource plots append samples automatically and never drift while waiting for data', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.clock.install({ time: new Date('2026-10-17T06:00:00Z') });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByTestId('ssh-status-toggle').last().click();
  const panel = page.getByTestId('ssh-status-panel');
  const calls = () => page.evaluate(() => (window as unknown as Record<string, number>).__SSH_STATUS_CALLS__);
  await page.clock.fastForward(1000);
  await expect(panel.getByTestId('ssh-resource-memory')).toHaveText('26%');
  await expect(panel.getByRole('button', { name: '刷新远端资源' })).toBeEnabled();
  const initialCalls = await calls();
  const chart = panel.getByRole('img', { name: '资源使用率趋势' });
  const frame = chart.locator('xpath=../..');
  const pointCount = () => chart.locator('[data-series]').nth(1).evaluate(element => [...element.querySelectorAll('polyline')].reduce((count, line) => count + line.getAttribute('points')!.split(' ').length, 0));
  await expect(chart.locator('circle')).toHaveCount(0);
  expect(await pointCount()).toBe(0);
  for (const additional of [1, 2, 3]) {
    await page.clock.fastForward(15_000);
    await expect.poll(calls).toBe(initialCalls + additional);
    await expect.poll(pointCount).toBe(1 + additional);
    await expect(panel.getByRole('button', { name: '刷新远端资源' })).toBeEnabled();
  }
  expect((await chart.locator('[data-series="CPU"] polyline').getAttribute('points'))!.split(' ').length).toBeGreaterThanOrEqual(2);
  const end = await frame.getAttribute('data-end-time');
  const points = await chart.locator('[data-series="CPU"] polyline').getAttribute('points');
  await page.clock.fastForward(5_000);
  await expect(frame).toHaveAttribute('data-end-time', end!);
  await expect(chart.locator('[data-series="CPU"] polyline')).toHaveAttribute('points', points!);
  await panel.getByRole('button', { name: '暂停监控', exact: true }).click();
  await page.clock.fastForward(60_000);
  expect(await calls()).toBe(initialCalls + 3);
  await expect(frame).toHaveAttribute('data-end-time', end!);
  await panel.getByRole('button', { name: '恢复监控', exact: true }).click();
  await expect.poll(calls).toBe(initialCalls + 4);
  await page.clock.fastForward(15_000);
  await expect.poll(calls).toBe(initialCalls + 5);
  const download = panel.locator('.ssh-network-rate-readings .ssh-network-rate').first().locator('strong');
  await expect(download).toContainText('KB/s');
  // The installed clock also advances while asynchronous assertions settle.
  await expect.poll(async () => Number.parseFloat(await download.innerText())).toBeGreaterThan(9);
  expect(Number.parseFloat(await download.innerText())).toBeLessThanOrEqual(10);
  await panel.locator('.ssh-status-resource-summary').screenshot({ path: testInfo.outputPath('automatic-samples.png') });
});

test('automatic probes respect pause and visibility and retain actionable failures', async ({ page }, testInfo) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.clock.install();
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByTestId('ssh-status-toggle').last().click();
  const panel = page.getByTestId('ssh-status-panel');
  const result = panel.getByTestId('ssh-network-result');
  await expect(result).toHaveAttribute('data-connectivity', 'reachable');
  const calls = () => page.evaluate(() => (window as unknown as Record<string, number>).__NETWORK_PROBE_CALLS__);
  const initial = await calls();
  await panel.getByRole('button', { name: '暂停监控', exact: true }).click();
  await page.clock.fastForward(65_000);
  expect(await calls()).toBe(initial);
  await panel.getByRole('button', { name: '恢复监控', exact: true }).click();
  await expect.poll(calls).toBeGreaterThan(initial);
  const resumed = await calls();
  await page.clock.fastForward(31_000);
  await expect.poll(calls).toBeGreaterThan(resumed);
  const writes = await ptyWrites(page);
  await panel.getByRole('button', { name: '关闭 SSH 状态' }).click();
  const closed = await calls();
  await page.clock.fastForward(65_000);
  expect(await calls()).toBe(closed);
  await page.getByTestId('ssh-status-toggle').last().click();
  await expect(result).toHaveAttribute('data-connectivity', 'reachable');
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__NETWORK_PROBE_RESULT__ = { dnsMs: 1, attempts: [{ latencyMs: 20, errorKind: null }, { latencyMs: null, errorKind: 'timeout' }] }; });
  await panel.getByRole('button', { name: '重新探测', exact: true }).click();
  await expect(result).toHaveAttribute('data-connectivity', 'partial');
  await expect(result).toContainText('50%');
  await page.evaluate(() => { (window as unknown as Record<string, string>).__NETWORK_PROBE_ERROR__ = 'Address resolution failed'; });
  await panel.getByRole('button', { name: '重新探测', exact: true }).click();
  await expect(panel).toContainText('网络探测失败');
  await expect(result).toContainText('上次探测结果');
  await page.screenshot({ path: testInfo.outputPath('network-error-retains-previous-result.png') });
  expect(await ptyWrites(page)).toEqual(writes);
});
