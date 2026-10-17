import { expect, test } from '@playwright/test';
import { setupTauriMock, ptyWrites } from './tauri-mock';

for (const theme of ['dark', 'light'] as const) {
  test(`combined resource history and compact meters stay together at narrow and wide widths in ${theme} mode`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await setupTauriMock(page);
    await page.addInitScript(value => localStorage.setItem('vrykell-ssh-resource-display', value), theme === 'dark' ? 'bars' : 'chart');
    await page.clock.setFixedTime(new Date('2026-10-17T06:00:00Z'));
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
    await page.getByRole('radio', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-row-ssh-1').dblclick();
    await page.getByTestId('ssh-status-toggle').last().click();
    const panel = page.getByTestId('ssh-status-panel');
    await expect(panel.getByRole('meter', { name: '内存使用率' })).toHaveAttribute('aria-valuenow', '26');
    await page.clock.setFixedTime(new Date('2026-10-17T06:00:15Z'));
    await panel.getByRole('button', { name: '刷新远端资源' }).click();
    await expect(panel.getByRole('meter', { name: 'CPU 使用率' })).toHaveAttribute('aria-valuenow', '12');
    const writes = await ptyWrites(page);
    const meter = panel.locator('.ssh-status-meter').first();
    expect((await meter.boundingBox())!.height).toBe(6);
    await expect(meter.locator('i')).toHaveCSS('background-color', await panel.evaluate(element => getComputedStyle(element).getPropertyValue('--chart-blue').trim()).then(async color => page.evaluate(value => {
      const probe = document.createElement('div'); probe.style.color = value; document.body.append(probe);
      const resolved = getComputedStyle(probe).color; probe.remove(); return resolved;
    }, color)));
    const system = panel.locator('.ssh-status-system-section');
    await expect(system).not.toHaveAttribute('open');
    await page.screenshot({ path: testInfo.outputPath(`resources-default-${theme}-300.png`) });
    await system.locator('summary').click();
    await expect(panel.getByText('1 分钟', { exact: true })).toBeVisible();
    await expect(panel.getByText('5 分钟', { exact: true })).toBeVisible();
    await expect(panel.getByText('15 分钟', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, number>).__NETWORK_PROBE_CALLS__ ?? 0)).toBeGreaterThan(0);
    await expect(panel.getByTestId('ssh-network-result')).toHaveAttribute('data-connectivity', 'reachable');
    await expect(panel.getByText('39.0 ms', { exact: true })).toBeVisible();
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
    await expect(panel.getByRole('meter')).toHaveCount(3);
    await expect(panel.getByRole('combobox')).toHaveCount(0);
    const traffic = panel.getByRole('img', { name: '上传与下载趋势' });
    await expect(traffic).toHaveCount(1);
    await expect(traffic.locator('[data-series]')).toHaveCount(2);
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
      const baselines = ['--resource-accent', '--group-violet', '--group-amber', '--group-cyan', '--group-violet'];
      const lines = [...element.querySelectorAll('.ssh-status-resource-summary [data-series]'), ...element.querySelectorAll('.ssh-network-rates [data-series]')];
      const values = lines.map((line, index) => {
        probe.style.color = `var(${baselines[index]})`;
        return { actual: brightness(getComputedStyle(line).color), baseline: brightness(getComputedStyle(probe).color) };
      });
      probe.remove(); return values;
    });
    expect(tones).toHaveLength(5);
    for (const tone of tones) expect(tone.actual).toBeLessThan(tone.baseline);
    for (const plot of [chart, traffic]) {
      const bounds = await plot.evaluate(element => {
        const chart = element.closest('.ssh-resource-chart')!;
        const frame = chart.getBoundingClientRect();
        const svg = element.getBoundingClientRect();
        const axis = chart.querySelector('.ssh-resource-chart-axis')!.getBoundingClientRect();
        const footer = chart.querySelector('.ssh-status-time-axis')!.getBoundingClientRect();
        return { frame: frame.width, plot: svg.width, rightInset: svg.right - axis.right, leftInset: axis.left - svg.left, scaleBottom: axis.bottom, plotTop: svg.top, plotBottom: svg.bottom, footerTop: footer.top };
      });
      expect(Math.abs(bounds.frame - bounds.plot)).toBeLessThanOrEqual(1);
      expect(bounds.rightInset).toBeGreaterThanOrEqual(0);
      expect(bounds.rightInset).toBeLessThanOrEqual(3);
      expect(bounds.leftInset).toBeGreaterThanOrEqual(0);
      expect(bounds.scaleBottom).toBeLessThanOrEqual(bounds.plotTop);
      expect(bounds.footerTop).toBeGreaterThanOrEqual(bounds.plotBottom);
    }
    await page.screenshot({ path: testInfo.outputPath(`resources-chart-${theme}-300.png`) });
    await panel.locator('.ssh-status-resource').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`resources-chart-${theme}-detail.png`) });
    const summary = panel.locator('.ssh-status-resource-summary');
    const summaryBounds = (await summary.boundingBox())!;
    const chartBounds = (await chart.boundingBox())!;
    expect(summaryBounds.height).toBeLessThanOrEqual(300);
    for (const meter of await panel.getByRole('meter').all()) {
      const box = (await meter.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(chartBounds.y + chartBounds.height);
      expect(box.width).toBeLessThan(chartBounds.width * .7);
      expect(box.width).toBeGreaterThan(40);
      expect(box.height).toBe(6);
    }
    await summary.screenshot({ path: testInfo.outputPath(`combined-resources-${theme}-300.png`) });
    await network.screenshot({ path: testInfo.outputPath(`network-full-width-${theme}-300.png`) });
    const separator = page.getByRole('separator', { name: '调整 SSH 状态面板宽度' });
    await separator.focus();
    for (let index = 0; index < 19; index++) await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(604);
    await summary.screenshot({ path: testInfo.outputPath(`combined-resources-${theme}-604.png`) });
    await page.screenshot({ path: testInfo.outputPath(`resources-chart-${theme}-604.png`) });
    for (let index = 0; index < 23; index++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(240);
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await summary.screenshot({ path: testInfo.outputPath(`combined-resources-${theme}-240.png`) });
    await page.screenshot({ path: testInfo.outputPath(`resources-chart-${theme}-240.png`) });
    await panel.getByRole('button', { name: '关闭 SSH 状态' }).click();
    await page.getByTestId('ssh-status-toggle').last().click();
    await expect(chart).toBeVisible();
    await expect(panel.getByRole('meter')).toHaveCount(3);
    expect(await ptyWrites(page)).toEqual(writes);
    await page.reload();
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
    const sshButton = page.locator('[data-dock-btn="ssh"]');
    if (!await page.getByTestId('ssh-row-ssh-1').isVisible()) await sshButton.click();
    await page.getByTestId('ssh-row-ssh-1').dblclick();
    await page.getByTestId('ssh-status-toggle').last().click();
    await expect(chart).toBeVisible();
    await expect(panel.getByRole('combobox')).toHaveCount(0);
    await expect(panel.getByRole('meter', { name: '内存使用率' })).toBeVisible();
  });
}

test('resource tracks stay aligned with mixed percentage widths and larger UI text', async ({ page }, testInfo) => {
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
  await expect(panel.getByRole('meter', { name: '内存使用率' })).toHaveAttribute('aria-valuenow', '12');
  for (const seconds of [15, 30, 45]) {
    await page.clock.setFixedTime(new Date(Date.parse('2026-10-17T06:00:00Z') + seconds * 1000));
    await panel.getByRole('button', { name: '刷新远端资源' }).click();
    await expect(panel.getByRole('button', { name: '刷新远端资源' })).toBeEnabled();
  }
  await expect(panel.getByRole('meter', { name: 'CPU 使用率' })).toHaveAttribute('aria-valuenow', '1');
  await expect(panel.getByRole('meter', { name: '根分区使用率' })).toHaveAttribute('aria-valuenow', '100');
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
    const tracks = await panel.getByRole('meter').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      const reading = element.nextElementSibling!.getBoundingClientRect();
      return { x: box.x, width: box.width, readingRight: reading.right };
    }));
    for (const track of tracks) {
      expect(Math.abs(track.x - tracks[0].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(track.width - tracks[0].width)).toBeLessThanOrEqual(1);
      expect(Math.abs(track.readingRight - tracks[0].readingRight)).toBeLessThanOrEqual(1);
    }
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
