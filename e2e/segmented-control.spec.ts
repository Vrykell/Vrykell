import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';
import { contrast } from '../src/config/theme/presets';

for (const mode of ['dark', 'light'] as const) for (const width of [1240, 760]) {
  test(`shared sliding control keeps contrast and label insets at ${width}px in ${mode}`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await setupTauriMock(page);
    await page.addInitScript(mode => localStorage.setItem('vrykell-theme-mode', mode), mode);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/'); await gotoSetting(page, '主题');
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', '1.35'));
    const control = page.getByRole('radiogroup', { name: '主题模式' });
    await expect(control.getByRole('radio')).toHaveText(['始终深色', '始终浅色', '跟随系统']);
    const appearance = await control.evaluate(element => {
      const thumb = element.querySelector<HTMLElement>('.segmented-selection')!;
      const selected = element.querySelector<HTMLElement>('[aria-checked="true"]')!;
      const hex = (color: string) => '#' + (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('');
      const labels = [...element.querySelectorAll('button')].map(button => {
        const range = document.createRange(); range.selectNodeContents(button.querySelector('span')!);
        const text = range.getBoundingClientRect(); const bounds = button.getBoundingClientRect();
        return { left: text.left - bounds.left, right: bounds.right - text.right, clipped: button.scrollWidth > button.clientWidth };
      });
      return { track: hex(getComputedStyle(element).backgroundColor), thumb: hex(getComputedStyle(thumb).backgroundColor),
        text: hex(getComputedStyle(selected).color), labels, overflow: element.scrollWidth > element.clientWidth };
    });
    expect(contrast(appearance.track, appearance.thumb)).toBeGreaterThanOrEqual(1.45);
    expect(contrast(appearance.text, appearance.thumb)).toBeGreaterThanOrEqual(4.5);
    expect(appearance.labels.every(label => label.left >= 13 && label.right >= 13 && !label.clipped)).toBe(true);
    expect(appearance.overflow).toBe(false);
    await control.getByRole('radio', { name: '跟随系统' }).click();
    await expect(control.getByRole('radio', { name: '跟随系统' })).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: info.outputPath(`sliding-${mode}-${width}.png`) });
    await control.getByRole('radio', { name: '跟随系统' }).focus();
    await page.keyboard.press('Home');
    await expect(control.getByRole('radio', { name: '始终深色' })).toBeFocused();
  });
}
