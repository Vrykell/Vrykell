import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['dark', 'light']) for (const width of [760, 1280]) {
  test(`resource settings stay compact in ${theme} at ${width}px`, async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
    await setupTauriMock(page); await page.goto('/');
    await gotoSetting(page, '技能');
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.skill-list-row')).toHaveCount(2);
    expect(await page.locator('.skill-open').first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await expect(page.getByRole('textbox', { name: '搜索技能…' })).toHaveClass(/text-input-field/);
    await expect(page.locator('.resource-library-count')).toHaveCount(0);
    await expect(page.locator('.resource-library-toolbar').getByRole('button', { name: '技能市场', exact: true })).toBeVisible();
    const searchInset = await page.locator('.resource-search').evaluate(element => {
      const icon = element.querySelector('svg')!.getBoundingClientRect(); const input = element.querySelector('input')!;
      return input.getBoundingClientRect().left + parseFloat(getComputedStyle(input).paddingLeft) - icon.right;
    });
    expect(searchInset).toBeGreaterThanOrEqual(6);
    await page.locator('.skill-open').first().hover();
    expect(await page.locator('.skill-list-row').first().evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await page.locator('.resource-mark').first().evaluate(element => element.getBoundingClientRect().width - element.querySelector('svg')!.getBoundingClientRect().width)).toBe(8);
    await expect(page.locator('aside').getByRole('button', { name: '联网搜索', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: '搜索技能…' }).fill('写单测');
    await expect(page.locator('.skill-list-row')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`skills-list-${theme}-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '打开 写单测', exact: true }).first().click();
    await expect(page.getByTestId('skill-detail')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`skill-detail-${theme}-${width}.png`), fullPage: true });
    await expect(page.locator('.settings-content h1')).toHaveCount(0);
    await page.getByTestId('skill-detail').getByRole('button', { name: '技能', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '搜索技能…' })).toHaveValue('写单测');
    await gotoSetting(page, '记忆');
    await expect(page.getByTestId('memory-count-total')).toHaveText('1');
    await expect(page.locator('.settings-content h2')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`memory-${theme}-${width}.png`), fullPage: true });
    expect(await page.locator('.memory-overview').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(page.locator('.memory-overview svg')).toHaveCount(0);
    await page.evaluate(() => document.documentElement.style.setProperty('--radius-lg', '23px'));
    await expect(page.locator('.memory-status')).toHaveCSS('border-top-left-radius', '23px');
    await gotoSetting(page, '模型配置');
    await expect(page.locator('.settings-group-panel').first()).toHaveCSS('border-top-left-radius', '23px');
    await page.getByTestId('model-settings').first().click();
    const dialog = page.getByTestId('model-settings-dialog').getByRole('dialog');
    await expect(dialog).toHaveCSS('border-top-left-radius', '23px');
    await expect(dialog.locator('.model-options-title')).toHaveCount(0);
    const overlap = await dialog.locator('.model-option > span, .model-option > div').evaluateAll(nodes => {
      const boxes = nodes.map(node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; });
      for (let first = 0; first < boxes.length; first++) for (let second = first + 1; second < boxes.length; second++) {
        const a = boxes[first]!; const b = boxes[second]!;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) return { first, second };
      }
      return null;
    });
    expect(overlap).toBeNull();
    expect(await dialog.locator('.model-context-settings').boundingBox().then(box => box!.height)).toBeLessThan(240);
    const context = await dialog.locator('.model-context-settings').boundingBox();
    const caps = await dialog.locator('.model-capability-settings').boundingBox();
    expect(caps!.y).toBeGreaterThan(context!.y + context!.height);
    await dialog.getByRole('combobox', { name: '上下文策略', exact: true }).click();
    await expect(page.locator('.ui-select-menu')).toHaveCSS('border-top-left-radius', '10px');
    await page.evaluate(() => document.documentElement.style.setProperty('--radius-md', '17px'));
    await expect(page.locator('.ui-select-menu')).toHaveCSS('border-top-left-radius', '17px');
    await page.keyboard.press('Escape');
    await page.getByTestId('model-settings-done').click();
    await gotoSetting(page, '字体与显示');
    for (const preview of await page.locator('.settings-font-preview').all()) {
      const gap = await preview.evaluate(element => {
        const record = element.parentElement!; const previous = record.previousElementSibling!;
        const control = previous.querySelector('.settings-field-control')!;
        return element.getBoundingClientRect().top - control.getBoundingClientRect().bottom;
      });
      expect(gap).toBeLessThanOrEqual(30);
      await expect(preview).toHaveCSS('border-top-left-radius', '10px');
    }
    await page.screenshot({ path: info.outputPath(`typography-${theme}-${width}.png`), fullPage: true });
  });
}
