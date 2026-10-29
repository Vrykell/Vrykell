import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('directory chips center their icon and label at narrow widths and larger UI sizes', async ({ page }, testInfo) => {
  await setupTauriMock(page);
  await page.goto('/');
  const chip = page.getByRole('button', { name: '切换工作目录' });
  await expect(chip).toBeVisible();
  for (const fontSize of [13, 18]) {
    await page.evaluate(async size => {
      const { useTypographyStore } = await import('/src/config/typography.ts') as typeof import('../src/config/typography');
      useTypographyStore.getState().update({ uiFontSize: size });
    }, fontSize);
    for (const width of [1240, 680]) {
      await page.setViewportSize({ width, height: 800 });
      const geometry = await chip.evaluate(element => {
        const box = element.getBoundingClientRect();
        const icon = element.querySelector('svg')!.getBoundingClientRect();
        const label = element.querySelector('span')!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { iconY: icon.y + icon.height / 2, labelY: label.y + label.height / 2, centerY: box.y + box.height / 2,
          groupX: (icon.left + label.right) / 2, centerX: box.x + box.width / 2, iconWidth: icon.width,
          extraWidth: box.width - (label.right - icon.left) - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          overflow: element.scrollHeight - element.clientHeight };
      });
      expect(Math.abs(geometry.iconY - geometry.centerY)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.labelY - geometry.centerY)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.groupX - geometry.centerX)).toBeLessThanOrEqual(1);
      expect(geometry.iconWidth).toBe(16);
      expect(Math.abs(geometry.extraWidth)).toBeLessThanOrEqual(1);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`directory-chip-${fontSize}-${width}.png`) });
    }
  }
});
