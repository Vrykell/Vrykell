import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureChatSettingsOpen, ensureTabsOpen, setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

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

async function checkFeedback(page: Page, button: Locator, gray: string) {
  const resting = await themeColor(page, '--action-button-bg');
  await button.evaluate(element => (element as HTMLButtonElement).blur());
  await page.mouse.move(2, 2);
  await expect(button).toHaveCSS('background-color', resting);
  await button.hover();
  await expect(button).toHaveCSS('background-color', gray);
  await page.mouse.move(2, 2);
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('background-color', gray);
  await button.evaluate(element => (element as HTMLButtonElement).blur());
  await expect(button).toHaveCSS('background-color', resting);
}

async function auditOutlinedActions(page: Page, scope: Locator, gray: string) {
  const labels: string[] = [];
  for (const button of await scope.locator('button.outline-button:visible:enabled').all()) {
    await checkFeedback(page, button, gray);
    labels.push((await button.textContent())?.trim() || (await button.getAttribute('aria-label')) || '');
  }
  return labels;
}

for (const theme of ['dark', 'light'] as const) {
  test(`outlined actions share hover and focus feedback in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await setupTauriMock(page, { schedulesSeed: [], sshHost: 'known', sshTrustConfirmed: true });
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click();
    const gray = await themeColor(page, '--action-button-hover-bg');
    const report: Record<string, string[]> = {};
    const body = page.locator('.settings-page-body');
    report['主题'] = await auditOutlinedActions(page, body, gray);
    for (const label of ['块外观', '字体与显示', '主题文件', '子代理', '定时任务', '内存', '技能', 'MCP 服务器', '模型配置', 'Windows 右键菜单', '日志与诊断']) {
      await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
      report[label] = await auditOutlinedActions(page, body, gray);
    }
    expect(Object.values(report).flat().length).toBeGreaterThanOrEqual(20);

    await page.locator('aside').getByRole('button', { name: '子代理', exact: true }).click();
    const add = page.getByRole('button', { name: /添加子代理/ });
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expect(add).toHaveCSS('background-color', gray);
    await add.click();
    await expect(body.getByPlaceholder('名称')).toHaveCount(2);
    await expect(add).toBeFocused();
    await expect(add).toHaveCSS('background-color', gray);
    await add.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`outlined-action-${theme}.png`), animations: 'disabled' });

    await ensureTabsOpen(page);
    await page.getByTestId('tab-row-t1').click();
    await page.locator('[data-dock-btn="chat"]').click();
    await ensureChatSettingsOpen(page);
    await page.getByTestId('pill-name').first().click();
    const picker = page.getByRole('dialog', { name: '选择模型' });
    report['模型筛选'] = await auditOutlinedActions(page, picker, gray);
    expect(report['模型筛选']).toHaveLength(4);
    const tools = picker.getByRole('button', { name: '工具', exact: true });
    await tools.click();
    await expect(tools).toHaveAttribute('aria-pressed', 'true');
    const selected = await tools.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
      return getComputedStyle(element).backgroundColor;
    });
    expect(selected).not.toBe(gray);
    await page.mouse.move(2, 2);
    await tools.focus();
    await expect(tools).toHaveCSS('background-color', selected);
    await picker.getByRole('button', { name: '关闭', exact: true }).click();

    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-import-btn').click();
    const dialog = page.getByRole('dialog', { name: '导入 SSH 连接' });
    await expect(dialog.getByTestId('ssh-import-web')).toBeChecked();
    report['SSH 导入'] = await auditOutlinedActions(page, dialog, gray);
    const primary = dialog.getByTestId('ssh-import-confirm');
    const primaryColor = await primary.evaluate(element => getComputedStyle(element).backgroundColor);
    await primary.focus();
    expect(primaryColor).toBe(await themeColor(page, '--primary-button-bg'));
    await expect(primary).toHaveCSS('background-color', await themeColor(page, '--primary-button-hover-bg'));
    await page.screenshot({ path: testInfo.outputPath(`blue-primary-${theme}.png`), animations: 'disabled' });
    await primary.click();
    await page.getByTestId('ssh-import-btn').click();
    const disabled = dialog.getByTestId('ssh-import-select-all');
    await expect(disabled).toBeDisabled();
    await disabled.hover();
    await expect(disabled).toHaveCSS('background-color', await themeColor(page, '--action-button-bg'));
    await disabled.focus();
    await expect(disabled).not.toBeFocused();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();

    await page.getByText('生产服务器', { exact: true }).dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    await page.getByTestId('remote-file-Documents').click({ button: 'right' });
    await page.getByRole('button', { name: '下载文件夹到本地' }).click();
    await expect(page.getByText(/已下载到/)).toBeVisible();
    // 下载开始后面板自动切到下载管理；行操作为悬停显现的图标按钮，不属于轮廓按钮审计
    await expect(page.getByTestId('download-reveal-Documents')).toHaveCount(1);
    await testInfo.attach('outlined-action-audit', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  });
}
