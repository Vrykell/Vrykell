import { expect, test, type Locator } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function expectSurface(button: Locator, token: string) {
  const color = await button.evaluate((element, token) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = `var(${token})`;
    element.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, token);
  await expect(button).toHaveCSS('background-color', color);
}

for (const theme of ['dark', 'light']) test(`connection actions keep compact geometry and emphasis in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page);
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-new-btn').click();
  const editor = page.getByTestId('ssh-host-editor');
  const save = editor.getByTestId('ssh-save-btn');
  const cancel = editor.getByRole('button', { name: '取消', exact: true });
  const testAuthentication = editor.getByTestId('ssh-test-btn');
  const saveAndConnect = editor.getByTestId('ssh-save-connect-btn');
  await editor.getByRole('radio', { name: '密钥', exact: true }).click();
  const browse = editor.getByRole('button', { name: '浏览…', exact: true });

  for (const width of [1240, 640]) {
    await page.setViewportSize({ width, height: 800 });
    for (const button of [save, cancel, testAuthentication, saveAndConnect, browse]) {
      await expect(button).toHaveCSS('border-radius', '10px');
      expect((await button.boundingBox())!.height).toBe(28);
    }
    await page.mouse.move(0, 0);
    await expectSurface(save, '--primary-action');
    await expect(cancel).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expectSurface(testAuthentication, '--action-button-bg');
    await expectSurface(saveAndConnect, '--action-button-bg');
    await expectSurface(browse, '--action-button-bg');
    await save.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`editor-actions-${theme}-${width}.png`), animations: 'disabled' });
  }

  await testAuthentication.hover();
  await expectSurface(testAuthentication, '--action-button-hover-bg');
  const manageProxy = editor.getByRole('button', { name: '管理代理', exact: true });
  await manageProxy.click();
  const proxy = page.getByRole('dialog', { name: '管理代理', exact: true });
  for (const viewport of [{ width: 1240, height: 800 }, { width: 520, height: 480 }]) {
    await page.setViewportSize(viewport);
    await page.mouse.move(0, 0);
    await expectSurface(proxy.getByTestId('proxy-save'), '--primary-action');
    await expect(proxy.getByTestId('proxy-port')).toHaveCSS('appearance', 'textfield');
    const defaultBox = (await proxy.getByRole('combobox', { name: '设备默认', exact: true }).boundingBox())!;
    const profileBox = (await proxy.getByRole('combobox', { name: '代理配置', exact: true }).boundingBox())!;
    expect(profileBox.y).toBe(defaultBox.y);
    expect((await proxy.boundingBox())!.height).toBeLessThan(500);
    const label = proxy.getByRole('combobox', { name: '设备默认', exact: true }).locator('..');
    await expect(label).toHaveCSS('flex-direction', 'column');
    await expect(label).toHaveCSS('row-gap', '6px');
    const hostBox = (await proxy.getByTestId('proxy-host').boundingBox())!;
    const portBox = (await proxy.getByTestId('proxy-port').boundingBox())!;
    expect(hostBox.x).toBe(defaultBox.x);
    expect(hostBox.width).toBe(defaultBox.width);
    expect(portBox.x).toBe(profileBox.x);
    expect(portBox.width).toBe(profileBox.width);
    expect(portBox.x - hostBox.x - hostBox.width).toBeGreaterThanOrEqual(12);
    await proxy.getByRole('combobox', { name: '协议', exact: true }).click();
    await expect(page.getByRole('option', { name: 'HTTP CONNECT', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath(`proxy-actions-${theme}-${viewport.width}.png`), animations: 'disabled' });
    const saveBox = (await proxy.getByTestId('proxy-save').boundingBox())!;
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(viewport.height);
  }
  await proxy.getByTestId('proxy-name').fill('Office proxy');
  await proxy.getByTestId('proxy-host').fill('127.0.0.1');
  await proxy.getByTestId('proxy-password').fill('temporary-secret');
  await proxy.getByTestId('proxy-save').click();
  await expect(proxy.getByTestId('proxy-password')).toHaveValue('');
  await proxy.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 640, height: 800 });
  const addVariable = editor.getByTestId('ssh-env-add');
  await editor.getByText('高级连接选项', { exact: true }).click();
  const addForward = editor.getByTestId('ssh-forward-add');
  for (const button of [manageProxy, addVariable, addForward]) {
    await page.mouse.move(0, 0);
    await expectSurface(button, '--action-button-bg');
    expect((await button.boundingBox())!.height).toBe(28);
    await button.hover();
    await expectSurface(button, '--action-button-hover-bg');
  }
  const keepalive = editor.getByTestId('ssh-form-keepalive');
  await expect(keepalive).toHaveCSS('appearance', 'textfield');
  await keepalive.fill('30');
  await keepalive.press('ArrowUp');
  await expect(keepalive).toHaveValue('31');
  for (const width of [1240, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await keepalive.hover();
    await page.screenshot({ path: info.outputPath(`advanced-actions-${theme}-${width}.png`), animations: 'disabled' });
  }
  await save.focus();
  await expectSurface(save, '--primary-button-hover-bg');
  await cancel.click();
  await page.getByTestId('ssh-host-actions').click();
  await page.getByRole('button', { name: '快速连接', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'SSH 连接', exact: true });
  const connect = quick.getByTestId('ssh-connect-btn');
  const quickCancel = quick.getByRole('button', { name: '取消', exact: true });
  await expect(quick.getByTestId('ssh-form-host')).toBeFocused();

  for (const width of [1240, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await page.mouse.move(0, 0);
    expect((await connect.boundingBox())!.height).toBe(28);
    expect((await quickCancel.boundingBox())!.height).toBe(28);
    await expectSurface(connect, '--primary-action');
    await expect(quickCancel).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: info.outputPath(`quick-actions-${theme}-${width}.png`), animations: 'disabled' });
    await connect.hover();
    await expectSurface(connect, '--primary-button-hover-bg');
    await connect.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(quickCancel).toBeFocused();
    await expectSurface(quickCancel, '--control-hover-bg');
    await quick.getByTestId('ssh-form-host').focus();
  }
  await connect.focus();
  await expectSurface(connect, '--primary-button-hover-bg');
  await page.keyboard.press('Tab');
  await expect(quick.getByTestId('ssh-form-name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(quick).toHaveCount(0);
});
