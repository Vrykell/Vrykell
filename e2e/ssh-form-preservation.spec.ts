import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('host editor keeps its actions reachable at normal and minimum window sizes', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-new-btn').click();
  const editor = page.getByTestId('ssh-host-editor');
  for (const viewport of [{ width: 1240, height: 800 }, { width: 720, height: 480 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', '1.4'));
    const box = (await editor.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    for (const name of ['保存', '取消', '测试认证']) {
      await editor.getByRole('button', { name, exact: true }).scrollIntoViewIfNeeded();
      const button = (await editor.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(button.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(button.y + button.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    await editor.getByTestId('ssh-form-name').click();
    await expect(editor.getByTestId('ssh-form-name')).toHaveCSS('outline-style', 'none');
    await editor.getByRole('radio', { name: '密钥', exact: true }).click();
    const input = editor.getByTestId('ssh-form-identity');
    await input.scrollIntoViewIfNeeded();
    const bounds = (await input.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width + 1);
    await page.screenshot({ path: test.info().outputPath(`host-editor-${viewport.width}.png`) });
  }
});

for (const mode of ['new', 'edit']) test(`host editor preserves drafts until explicit cancellation in ${mode}`, async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  const open = async () => {
    if (mode === 'new') await page.getByTestId('ssh-new-btn').click();
    else { await page.getByTestId('ssh-row-ssh-1').click({ button: 'right' }); await page.getByRole('button', { name: '编辑连接', exact: true }).click(); }
  };
  await open();
  const editor = page.getByTestId('ssh-host-editor');
  await editor.getByTestId('ssh-form-name').fill('Unfinished profile');
  await editor.getByTestId('ssh-form-host').fill('test.invalid');
  await editor.locator('.ssh-form-header').click({ position: { x: 200, y: 10 } });
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('ssh-form-name')).toHaveValue('Unfinished profile');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await open();
  await expect(editor.getByTestId('ssh-form-name')).toHaveValue(mode === 'new' ? '' : '生产服务器');
  await editor.getByRole('button', { name: '返回主机', exact: true }).click();
  await expect(editor).toHaveCount(0);
});
