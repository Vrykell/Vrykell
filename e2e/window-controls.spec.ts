import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/** Resolve a themed color token to its computed value. */
async function themeColor(page: Page, variable: string) {
  return page.evaluate(variable => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = `var(${variable})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, variable);
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

/** A pointer click focuses the button; the hover surface must not stick to that focus. */
test('window controls drop the hover surface after a pointer click', async ({ page }) => {
  test.skip(await page.getByTestId('window-controls').count() === 0, 'the platform uses native window controls');
  const minimize = page.getByTestId('window-minimize');
  const hoverSurface = await themeColor(page, '--button-hover');

  await minimize.hover();
  await expect(minimize).toHaveCSS('background-color', hoverSurface);

  await minimize.click();
  await page.mouse.move(2, 300);
  await expect(minimize).toBeFocused();
  await expect(minimize).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

/** Keyboard navigation must still surface the focused control. */
test('window controls keep the surface for visible keyboard focus', async ({ page }) => {
  test.skip(await page.getByTestId('window-controls').count() === 0, 'the platform uses native window controls');
  const minimize = page.getByTestId('window-minimize');
  const hoverSurface = await themeColor(page, '--button-hover');

  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press('Tab');
    if (await minimize.evaluate(element => element === document.activeElement)) break;
  }
  await expect(minimize).toBeFocused();
  await page.mouse.move(2, 300);
  await expect(minimize).toHaveCSS('background-color', hoverSurface);
});
