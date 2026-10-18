import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('command coloring is optional, persists and leaves native input editing intact', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await gotoSetting(page, '字体与显示');
  const toggle = page.locator('.settings-field').filter({ has: page.getByText('命令语法高亮', { exact: true }) }).getByRole('switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page.keyboard.press('Meta+1');
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('echo "hello 中文" --flag | cat ./file');
  await expect(input).toHaveCSS('caret-color', 'rgb(77, 163, 255)');
  const overlay = page.locator('.command-input-overlay');
  await expect(overlay.locator('[data-kind="command"]')).toHaveCount(2);
  await expect(overlay.locator('[data-kind="string"]')).toHaveText('"hello 中文"');
  await input.fill('LANG=zh_CN npm run build --timeout 30 ./配置.json | echo "home=$HOME $(pwd)"');
  await expect(overlay.locator('[data-kind="command"]')).toHaveCount(3);
  await expect(overlay.locator('[data-kind="argument"]')).toHaveText(['run', 'build']);
  await expect(overlay.locator('[data-kind="number"]')).toHaveText('30');
  await expect(overlay.locator('[data-kind="variable"]')).toHaveText(['LANG=zh_CN', '$HOME']);
  await expect(overlay.locator('[data-kind="path"]')).toHaveText('./配置.json');
  await expect(overlay.locator('[data-kind="command"]').first()).toHaveCSS('color', 'rgb(179, 245, 109)');
  await input.fill('echo "hello 中文" --flag | cat ./file');
  await input.press('Enter');
  const block = page.locator('.command-block-command').filter({ hasText: 'echo "hello 中文"' });
  await expect(block.locator('[data-kind="command"]')).toHaveCount(2);
  await input.fill('npm');
  await expect(page.locator('.command-completion-suffix')).toHaveText(' run dev');
  const suggestions = page.getByRole('button', { name: '补全快捷键', exact: true });
  await expect(suggestions).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('command-completion.png') });
  await suggestions.click();
  const menu = page.getByRole('menu', { name: '补全快捷键', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(3);
  await menu.getByRole('menuitemcheckbox', { name: 'Shift + 右方向键', exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Shift + 右方向键', exact: true })).toHaveAttribute('aria-checked', 'true');
  const triggerBox = (await suggestions.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThan(triggerBox.y);
  await page.screenshot({ path: test.info().outputPath('completion-shortcut-menu.png') });
  await page.keyboard.press('Escape');
  await expect(input).toBeFocused();
  await input.press('Shift+ArrowRight');
  await expect(input).toHaveValue('npm run dev');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(input).toHaveValue('npm');
  await page.reload();
  await input.fill('echo persisted');
  await expect(page.locator('.command-input-overlay [data-kind="command"]')).toHaveText('echo');
  await gotoSetting(page, '字体与显示');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await page.keyboard.press('Meta+1');
  await input.fill('echo plain');
  await expect(page.locator('.command-input-overlay')).toHaveCount(0);
  await input.press('Enter');
  await expect(page.locator('.command-block-command [data-kind]')).toHaveCount(0);
  await gotoSetting(page, '主题');
  await page.getByRole('radio', { name: '浅色', exact: true }).click();
  await page.keyboard.press('Meta+1');
  await expect(page.getByPlaceholder(/输入命令/)).toHaveCSS('caret-color', 'rgb(0, 111, 219)');
});

test('completion stays anchored while typing and its acceptance keys persist', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('npm');
  const trigger = page.getByRole('button', { name: '补全快捷键', exact: true });
  await expect(trigger).toBeVisible();
  const x = (await trigger.boundingBox())!.x;
  await page.evaluate(() => {
    const positions: number[] = [];
    const observer = new MutationObserver(() => {
      const button = document.querySelector('.command-completion-trigger');
      if (button) positions.push(button.getBoundingClientRect().x);
    });
    observer.observe(document.querySelector('.command-input-overlay')!, { subtree: true, childList: true, characterData: true });
    Object.assign(window, { completionPositions: positions });
  });
  for (const char of ' run de') {
    await input.pressSequentially(char);
    await expect(page.locator('.command-completion-suffix')).toHaveText('npm run dev'.slice((await input.inputValue()).length));
    expect(Math.abs((await trigger.boundingBox())!.x - x)).toBeLessThan(0.5);
  }
  const positions = await page.evaluate(() => (window as unknown as { completionPositions: number[] }).completionPositions);
  expect(positions.length).toBeGreaterThan(5);
  expect(positions.every(value => Math.abs(value - x) < 0.5)).toBe(true);
  await trigger.click();
  const menu = page.getByRole('menu', { name: '补全快捷键', exact: true });
  await menu.getByRole('menuitemcheckbox', { name: 'Tab', exact: true }).click();
  await menu.getByRole('button', { name: '自定义…', exact: true }).click();
  await page.keyboard.press('Control+j');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Control+J', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await input.press('Control+j');
  await expect(input).toHaveValue('npm run dev');
  await input.press('Escape');
  await expect(input).toHaveValue('npm run de');
  await page.reload();
  await input.fill('npm');
  await trigger.click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Tab', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Control+J', exact: true })).toHaveAttribute('aria-checked', 'true');
  await trigger.click();
  await expect(menu).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.evaluate(element => element.setSelectionRange(1, 1));
  await input.press('ArrowRight');
  await expect(input).toHaveValue('npm');
  expect(await input.evaluate(element => element.selectionStart)).toBe(2);
  await input.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
  await input.press('ArrowRight');
  await expect(input).toHaveValue('npm run dev');
});

test('the colored input mirror stays aligned while multiline content overflows the capped height', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await gotoSetting(page, '字体与显示');
  const toggle = page.locator('.settings-field').filter({ has: page.getByText('命令语法高亮', { exact: true }) }).getByRole('switch');
  await toggle.click();
  await page.keyboard.press('Meta+1');
  const input = page.getByPlaceholder(/输入命令/);
  await input.focus();
  for (let index = 0; index < 6; index += 1) await page.keyboard.press('Shift+Enter');
  const geometry = () => input.evaluate(node => {
    const textarea = node as HTMLTextAreaElement;
    const overlay = textarea.parentElement!.querySelector<HTMLElement>('.command-input-overlay')!;
    return { offset: textarea.scrollTop, mirrorOffset: overlay.scrollTop, height: textarea.scrollHeight, mirrorHeight: overlay.scrollHeight };
  });
  // The caret line overflows the cap: both layers must share the scroll geometry, including the
  // reserved caret line the trailing newline needs in the mirror.
  const scrolled = await geometry();
  expect(scrolled.offset).toBeGreaterThan(0);
  expect(scrolled.mirrorOffset).toBe(scrolled.offset);
  expect(scrolled.mirrorHeight).toBe(scrolled.height);
  // Typing must paint on that caret line instead of leaving the mirror parked above it. The probe
  // avoids the caret column so only the glyphs decide whether the band changed.
  const box = (await input.boundingBox())!;
  const probe = { x: box.x + 2, y: box.y + box.height - 21, width: 40, height: 19 };
  const empty = await page.screenshot({ clip: probe, animations: 'disabled' });
  await page.keyboard.type('typing');
  await expect(input).toHaveValue('\n\n\n\n\n\ntyping');
  expect(await page.screenshot({ clip: probe, animations: 'disabled' })).not.toEqual(empty);
  const typed = await geometry();
  expect(typed.mirrorOffset).toBe(typed.offset);
});

test('a long completion suffix cannot push the typed word out of the visible mirror line', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/config/typography.ts';
    const { useTypographyStore } = await import(path) as typeof import('../src/config/typography');
    useTypographyStore.getState().update({ commandHighlighting: true, terminalFontSize: 15 });
  });
  const input = page.getByPlaceholder(/输入命令/);
  // A long history path matching the typed prefix glues an unbreakable word to the last character.
  await page.evaluate(async () => {
    const path = '/src/features/terminal/stores/history.ts';
    const { useHistoryStore } = await import(path) as typeof import('../src/features/terminal/stores/history');
    useHistoryStore.setState({ entries: [{
      command: 'cd C:\\Users\\37863\\.local\\share\\opencode\\worktree\\ac4358\\integration-verify-chip-panel',
      cwd: '/home/e2e/project', timestamp: 1, exitCode: 0,
    }] });
  });
  await page.setViewportSize({ width: 900, height: 800 });
  await input.focus();
  await page.keyboard.type('cd ');
  await expect(page.locator('.command-completion-suffix')).toContainText('integration-verify-chip-panel');
  await page.keyboard.type('C');
  await expect(input).toHaveValue('cd C');
  // The typed character must stay inside the capped mirror box instead of wrapping below it.
  const geometry = await input.evaluate(node => {
    const textarea = node as HTMLTextAreaElement;
    const overlay = textarea.parentElement!.querySelector<HTMLElement>('.command-input-overlay')!;
    const token = overlay.querySelector<HTMLElement>('.command-token[data-kind="argument"]')!;
    const inputRect = textarea.getBoundingClientRect();
    const tokenRect = token.getBoundingClientRect();
    return {
      tokenInsideInput: tokenRect.y + tokenRect.height <= inputRect.y + inputRect.height + 1,
      offset: textarea.scrollTop, mirrorOffset: overlay.scrollTop,
    };
  });
  expect(geometry.tokenInsideInput).toBe(true);
  expect(geometry.mirrorOffset).toBe(geometry.offset);
});
