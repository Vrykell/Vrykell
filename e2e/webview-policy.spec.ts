import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('locks page scale and suppresses the native WebView context menu', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

  const policy = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? '';
    const touchAction = getComputedStyle(document.documentElement).touchAction;
    const key = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    const wheel = new WheelEvent('wheel', { ctrlKey: true, bubbles: true, cancelable: true });
    const gesture = new Event('gesturechange', { bubbles: true, cancelable: true });
    const contextTarget = document.createElement('div');
    document.body.append(contextTarget);
    let applicationHandlerReceived = false;
    contextTarget.addEventListener('contextmenu', () => { applicationHandlerReceived = true; });
    const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    window.dispatchEvent(key);
    window.dispatchEvent(wheel);
    window.dispatchEvent(gesture);
    contextTarget.dispatchEvent(context);
    contextTarget.remove();
    return {
      viewport,
      touchAction,
      zoomKeyPrevented: key.defaultPrevented,
      zoomWheelPrevented: wheel.defaultPrevented,
      gesturePrevented: gesture.defaultPrevented,
      contextMenuPrevented: context.defaultPrevented,
      applicationHandlerReceived,
    };
  });

  expect(policy.viewport).toContain('maximum-scale=1');
  expect(policy.viewport).toContain('user-scalable=no');
  expect(policy.touchAction).toBe('pan-x pan-y');
  expect(policy.zoomKeyPrevented).toBe(true);
  expect(policy.zoomWheelPrevented).toBe(true);
  expect(policy.gesturePrevented).toBe(true);
  expect(policy.contextMenuPrevented).toBe(true);
  expect(policy.applicationHandlerReceived).toBe(true);
});
