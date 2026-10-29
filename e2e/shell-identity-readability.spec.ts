import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting, selectThemeMode } from './settings';

test('shell identity colors stay fixed across built-in schemes', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/'); await gotoSetting(page, '主题');
  const marks = page.locator('.settings-navigation');
  const colors = async () => marks.locator('[data-shell-mark]').evaluateAll(elements => elements.map(element => ({
    mark: element.getAttribute('data-shell-mark'),
    fills: [...element.querySelectorAll('[fill]')].map(path => getComputedStyle(path).fill),
    strokes: [...element.querySelectorAll('[stroke]')].map(path => getComputedStyle(path).stroke),
  })));
  const original = await colors();
  await expect(marks.locator('[data-shell-mark="powershell"]').first()).toHaveCSS('color', 'rgb(82, 172, 255)');
  for (const mode of ['深色', '浅色']) {
    await selectThemeMode(page, mode);
    const schemes = page.getByRole('radiogroup', { name: `${mode}配色` }).getByRole('radio');
    for (let index = 0; index < await schemes.count(); index++) {
      await schemes.nth(index).click();
      expect(await colors()).toEqual(original);
    }
  }
});

for (const theme of ['dark', 'light'] as const) for (const density of [1, 1.25, 2]) {
  test(`colored shell identities at ${density}x in ${theme}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 800 }, deviceScaleFactor: density });
    const page = await context.newPage();
    await setupTauriMock(page, {});
    await page.addInitScript(theme => {
      localStorage.setItem('vrykell-theme-mode', theme);
      localStorage.setItem('vrykell-startup-mode', 'empty');
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const original = runtime.invoke;
      runtime.invoke = (command, args) => command === 'list_shells' ? Promise.resolve([
        { id: 'zsh', label: 'Zsh', default: true },
        { id: 'bash', label: 'Bash', default: false },
        { id: 'powershell', label: 'Windows PowerShell', default: false },
      ]) : original(command, args);
    }, theme);
    await page.goto('/');
    await page.getByTestId('tab-new-btn').click();
    for (const shell of ['zsh', 'bash', 'powershell']) {
      const mark = page.getByTestId(`new-tab-option-shell:${shell}`).locator(`[data-shell-mark="${shell}"]`);
      await expect(mark).toHaveAttribute('width', '20');
      await expect(mark).toHaveAttribute('height', '20');
      await expect(mark).toHaveCSS('filter', 'none');
    }
    const powerShell = page.getByTestId('new-tab-option-shell:powershell');
    const powerShellMark = powerShell.locator('[data-shell-mark="powershell"]');
    await expect(powerShellMark).toHaveAttribute('viewBox', '0 0 24 24');
    await expect(powerShell.locator('linearGradient')).toHaveCount(0);
    const powerShellGeometry = await powerShellMark.evaluate(element => {
      const mark = element as SVGSVGElement;
      return { width: mark.getBBox().width / mark.viewBox.baseVal.width, height: mark.getBBox().height / mark.viewBox.baseVal.height };
    });
    expect(powerShellGeometry.width).toBeCloseTo(22 / 24, 2);
    expect(powerShellGeometry.height).toBeCloseTo(17 / 24, 2);
    await page.screenshot({ path: info.outputPath(`shell-menu-${theme}-${density}.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 700, height: 800 });
    await page.screenshot({ path: info.outputPath(`shell-menu-narrow-${theme}-${density}.png`), animations: 'disabled' });
    await powerShell.click();
    const tabMark = page.locator('[data-tab-row-id]').last().locator('[data-shell-mark="powershell"]');
    await expect(tabMark).toHaveAttribute('width', '18');
    await expect(tabMark).toHaveAttribute('height', '18');
    await page.screenshot({ path: info.outputPath(`shell-tab-${theme}-${density}.png`), animations: 'disabled' });
    await context.close();
  });
}
