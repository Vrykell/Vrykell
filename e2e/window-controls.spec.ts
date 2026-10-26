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

  await expect(page.locator('[data-terminal-input]')).toBeFocused();

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

  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await page.getByTestId('window-close').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(minimize).toBeFocused();
  await page.mouse.move(2, 300);
  await expect(minimize).toHaveCSS('background-color', hoverSurface);
});
