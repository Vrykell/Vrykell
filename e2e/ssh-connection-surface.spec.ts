import { expect, test, type Page } from '@playwright/test';
import { emitPtyOutput, setupTauriMock } from './tauri-mock';

async function openClassicSsh(page: Page) {
  await setupTauriMock(page, { integration: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.waitForTimeout(400);
}

test('the frozen authentication frame follows a pane resize instead of scrolling horizontally', async ({ page }) => {
  await openClassicSsh(page);
  const warning = 'Bad permissions. Try removing permissions for user: LEGITexSandboxUsers (S-1-5-21-1173720163-3126303330-316522627) on file C:/Users/37863/Downloads/default.pem.';
  await emitPtyOutput(page, `${warning}\r\nroot@117.72.127.242's password: `);
  // The masked authentication state freezes the screen into the captured frame.
  const frame = page.getByTestId('ssh-terminal-screen');
  await expect(frame).toHaveAttribute('data-selectable', 'true');
  await page.setViewportSize({ width: 900, height: 800 });
  // The recaptured frame must fit the narrower pane instead of keeping its old capture width.
  await expect.poll(async () => frame.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(16);
  await expect(frame).toContainText("password:");
  // Widening the dock panel narrows the pane without a window resize; the frame follows it too.
  await page.locator('[data-dock-btn="files"]').click();
  const handle = (await page.getByTestId('resize-handle-files').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 120);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 120, handle.y + 120, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => frame.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(16);
  await page.screenshot({ path: 'test-results/ssh-auth-snapshot-resized.png' });
});

test('the authentication row uses a compact reveal toggle and the blue send action', async ({ page }) => {
  await openClassicSsh(page);
  await emitPtyOutput(page, "root@117.72.127.242's password: ");
  const input = page.getByRole('textbox', { name: 'SSH 认证响应' });
  await expect(input).toHaveAttribute('type', 'password');
  const reveal = page.getByTestId('ssh-auth-reveal');
  const openIcon = await reveal.evaluate(element => element.innerHTML);
  await reveal.click();
  await expect(input).toHaveAttribute('type', 'text');
  await expect(reveal).toHaveAttribute('aria-label', '隐藏密码');
  // The toggle swaps its icon instead of painting a pressed fill.
  expect(await reveal.evaluate(element => element.innerHTML)).not.toBe(openIcon);
  await page.mouse.move(0, 0);
  await expect(reveal).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const accentUser = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--primary-button-bg)';
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
  await expect(page.getByRole('button', { name: '发送' })).toHaveCSS('background-color', accentUser);
  await page.screenshot({ path: 'test-results/ssh-auth-row.png', clip: await page.getByTestId('ssh-connection-input').boundingBox() ?? undefined });
});
