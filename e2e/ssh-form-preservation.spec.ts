import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('连接表单保持适中尺寸，最小窗口下按钮依然完整可见', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-new-btn').click();
  const dialog = page.getByRole('dialog', { name: 'SSH 连接' });

  /** 表单与操作按钮都必须完整落在弹窗和窗口内 */
  const checkFits = async (viewport: { width: number; height: number }) => {
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(520);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    for (const name of ['保存', '取消', '测试连接']) {
      const button = (await dialog.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(button.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(button.y + button.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    return box;
  };

  const box = await checkFits(page.viewportSize()!);
  expect(box.height).toBeLessThanOrEqual(620);
  await page.screenshot({ path: '.cache-usability.local/ssh-form-compact.png' });

  // 整宽输入框的焦点描边（1px + 2px offset）必须完全落在滚动正文区内，不被 overflow 裁切
  const checkFocusRing = async (testId: string) => {
    const field = dialog.getByTestId(testId);
    await field.click();
    const gaps = await field.evaluate((el) => {
      const input = el.getBoundingClientRect();
      const scroller = el.closest('[data-testid="ssh-form-body"]')!.getBoundingClientRect();
      return [input.left - scroller.left, scroller.right - input.right, input.top - scroller.top, scroller.bottom - input.bottom];
    });
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(3);
  };
  await checkFocusRing('ssh-form-name');
  await checkFocusRing('ssh-form-password');

  // Key authentication keeps its input row inside the dialog as well.
  await dialog.getByRole('button', { name: '密钥', exact: true }).click();
  const identity = (await dialog.getByTestId('ssh-form-identity').boundingBox())!;
  expect(identity.x + identity.width).toBeLessThanOrEqual(box.x + box.width + 1);
  await dialog.getByRole('button', { name: '密码', exact: true }).click();

  // Smallest supported window plus the largest UI font size must keep the actions reachable.
  await page.setViewportSize({ width: 720, height: 480 });
  await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', '1.4'));
  await checkFits({ width: 720, height: 480 });
  await page.screenshot({ path: '.cache-usability.local/ssh-form-min-window.png' });
});

for (const mode of ['新建', '编辑'] as const) {
  test(`${mode} SSH 连接时点击遮罩关闭表单，取消按钮仍可关闭`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.locator('[data-dock-btn="ssh"]').click();
    if (mode === '新建') await page.getByTestId('ssh-new-btn').click();
    else await page.getByTestId('ssh-row-ssh-1').getByRole('button', { name: '编辑「生产服务器」', exact: true }).click();
    const name = page.getByTestId('ssh-form-name');
    await name.fill('未完成的连接');
    await page.getByTestId('ssh-form-host').fill('test.invalid');
    const dialog = page.getByRole('dialog', { name: 'SSH 连接' });
    await dialog.locator('..').click({ position: { x: 4, y: 100 } });
    await expect(dialog).toHaveCount(0);
    if (mode === '新建') await page.getByTestId('ssh-new-btn').click();
    else await page.getByTestId('ssh-row-ssh-1').getByRole('button', { name: '编辑「生产服务器」', exact: true }).click();
    await expect(name).toHaveValue(mode === '新建' ? '' : '生产服务器');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
