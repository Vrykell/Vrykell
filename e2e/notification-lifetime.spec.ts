import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock, waitForWorkbench } from './tauri-mock';

async function notify(page: Page, message: string) {
  await page.evaluate(async message => {
    const path = '/src/ui/feedback/Toast.tsx';
    const { useToastStore } = await import(path) as typeof import('../src/ui/feedback/Toast');
    useToastStore.getState().addToast(message, 'info', 1000);
  }, message);
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await waitForWorkbench(page);
  await page.clock.install({ time: new Date('2026-11-02T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-02T00:00:01Z'));
});

test('hover and keyboard focus independently pause dismissal and Escape restores focus', async ({ page }) => {
  const source = page.getByRole('button', { name: '设置', exact: true });
  await source.focus();
  await notify(page, 'Reading time');
  const toast = page.locator('.notification-toasts').getByRole('status');
  await page.clock.fastForward(300);
  await toast.hover();
  await toast.getByRole('button', { name: '关闭通知' }).focus();
  await page.mouse.move(10, 10);
  await page.clock.fastForward(15000);
  await expect(toast).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(source).toBeFocused();
  await page.clock.fastForward(200);
  await expect(toast).toHaveCount(0);
});

test('background pauses retain the remaining time instead of starting a fresh duration', async ({ page }) => {
  await notify(page, 'Background reading');
  const toast = page.locator('.notification-toasts').getByRole('status');
  await page.clock.fastForward(400);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.fastForward(15000);
  await expect(toast).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.fastForward(599);
  await expect(toast).not.toHaveAttribute('data-leaving');
  await page.clock.fastForward(1);
  await expect(toast).toHaveAttribute('data-leaving', 'true');
  await page.clock.fastForward(200);
  await expect(toast).toHaveCount(0);
});
