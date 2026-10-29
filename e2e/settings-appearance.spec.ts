import { test, expect } from '@playwright/test';
import { setupTauriMock, themeConfig } from './tauri-mock';
import { gotoSetting, selectThemeMode } from './settings';

/** Inject a bare block so the stylesheet contract can be probed without real output. */
async function injectBlock(page: import('@playwright/test').Page, className: string, id: string) {
  await page.evaluate(({ className: name, id: blockId }) => {
    const element = document.createElement('div');
    element.className = name;
    element.id = blockId;
    document.body.appendChild(element);
  }, { className, id });
}

/**
 * Painted background and rail as [r, g, b, a]. `color-mix()` serializes as
 * `color(srgb …)` while plain colours stay `rgb()`, so both are normalized.
 */
const readColors = (page: import('@playwright/test').Page, id: string) => page.evaluate((blockId) => {
  const element = document.getElementById(blockId)!;
  const parse = (value: string): [number, number, number, number] => {
    const numbers = (value.match(/[0-9.]+/g) ?? []).map(Number);
    const channel = (index: number, scale: number) => Math.round((numbers[index] ?? 0) * scale);
    const srgb = value.startsWith('color(');
    return [channel(0, srgb ? 255 : 1), channel(1, srgb ? 255 : 1), channel(2, srgb ? 255 : 1), numbers[3] ?? 1];
  };
  return {
    background: parse(getComputedStyle(element).backgroundColor),
    rail: parse(getComputedStyle(element, '::before').backgroundColor),
  };
}, id);

const blockField = (page: import('@playwright/test').Page, title: string) =>
  page.locator('.settings-field').filter({ hasText: title }).first();

test('appearance offers light, dark and follow system through one sliding control', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '主题');
  const mode = page.getByRole('radiogroup', { name: '主题模式' });
  await expect(mode.getByRole('radio')).toHaveCount(3);
  await expect(mode.getByRole('radio', { name: '始终深色', exact: true })).toHaveAttribute('aria-checked', 'true');
  await selectThemeMode(page, '浅色');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(mode.getByRole('radio', { name: '始终浅色', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radiogroup', { name: '深色配色' })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: '浅色配色' }).getByRole('radio')).toHaveCount(5);
});

test('follow system tracks the operating system appearance', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '主题');
  await page.emulateMedia({ colorScheme: 'dark' });
  await selectThemeMode(page, '跟随系统');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // The choice survives a reload, and the app reopens on the same appearance.
  await page.reload();
  await gotoSetting(page, '主题');
  await expect(page.getByRole('radio', { name: '跟随系统', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('near-black colors persist and original dark remains available', async ({ page }, info) => {
  await setupTauriMock(page); await page.goto('/'); await gotoSetting(page, '主题');
  await page.getByRole('radio', { name: 'Deep Black', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'deep-black');
  await expect.poll(() => themeConfig(page)).toMatchObject({ darkPreset: 'deep-black' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim())).toBe('#1C1C1C');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--xterm-bg').trim())).toBe('#111111');
  for (const width of [760, 1240]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('radio', { name: '默认深色', exact: true })).toBeVisible();
    expect(await page.locator('.settings-content').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`deep-black-${width}.png`), animations: 'disabled' });
  }
  await page.reload(); await gotoSetting(page, '主题');
  await expect(page.getByRole('radio', { name: 'Deep Black', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: '默认深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'default-dark');
});

test('built-in schemes update live colors, survive reload, follow the system and restore original defaults', async ({ page }, info) => {
  test.setTimeout(60_000);
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '主题');
  const original = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim());
  await page.getByRole('radio', { name: 'Dracula', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'dracula');
  await expect.poll(() => themeConfig(page)).toMatchObject({ darkPreset: 'dracula' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--xterm-bg').trim())).toBe('#282A36');
  await page.setViewportSize({ width: 1240, height: 900 });
  await page.screenshot({ path: info.outputPath('schemes-wide.png') });
  await selectThemeMode(page, '浅色');
  await page.getByRole('radio', { name: 'Catppuccin Latte', exact: true }).click();
  await expect.poll(() => themeConfig(page)).toMatchObject({ darkPreset: 'dracula', lightPreset: 'catppuccin-latte' });
  await page.reload();
  await gotoSetting(page, '主题');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'catppuccin-latte');
  await expect(page.getByRole('radiogroup', { name: '深色配色' })).toHaveCount(0);
  await selectThemeMode(page, '跟随系统');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'dracula');
  await expect(page.getByRole('radiogroup', { name: '浅色配色' })).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'catppuccin-latte');
  await page.setViewportSize({ width: 760, height: 800 });
  await page.screenshot({ path: info.outputPath('schemes-narrow.png') });
  expect(await page.locator('.settings-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await selectThemeMode(page, '深色');
  const selected = page.getByRole('radio', { name: 'Dracula', exact: true });
  await selected.focus();
  await selected.press('Home');
  await expect(page.getByRole('radio', { name: '默认深色' })).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'default-dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim())).toBe(original);
});

test('a block colour row shows a swatch and name, matching swatches in the menu, and the switch to its left', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '块外观');
  const field = blockField(page, 'AI 对话块');
  const color = field.getByRole('combobox');
  await expect(color.locator('.ui-select-swatch')).toBeVisible();
  // An untouched block reads as the theme default instead of a raw value.
  await expect(color).toContainText('默认');
  const switchBox = (await field.getByRole('switch').boundingBox())!;
  const colorBox = (await color.boundingBox())!;
  expect(switchBox.x + switchBox.width).toBeLessThanOrEqual(colorBox.x);

  await color.click();
  await expect(page.getByRole('option', { name: /青色/ }).locator('.ui-select-swatch')).toHaveCSS('border-radius', '4px');
  await page.getByRole('option', { name: /青色/ }).click();
  await expect(color).toContainText('青色');
  await expect(color).not.toContainText('#');
});

test('block color choices reuse the shared palette without duplicates in one menu', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '块外观');
  const palettes: string[] = [];
  for (const title of ['AI 对话块', '终端命令块', '失败命令块']) {
    const color = blockField(page, title).getByRole('combobox');
    await color.click();
    const swatches = await page.getByRole('option').evaluateAll(elements =>
      elements.map(element => element.querySelector<HTMLElement>('.ui-select-swatch')?.style.background ?? ''));
    expect(new Set(swatches).size).toBe(swatches.length);
    palettes.push(...swatches);
    await color.press('Escape');
  }
  expect(palettes.length).toBeGreaterThan(0);
  expect(palettes.every(swatch => swatch.length > 0)).toBe(true);
  const shared = await page.evaluate(() => {
    const probe = document.createElement('span'); document.body.append(probe);
    const values = ['--group-blue', '--group-green', '--group-violet', '--group-amber', '--group-cyan',
      '--group-rose', '--group-orange', '--group-coral', '--cmd-flag', '--text-muted', '--text-secondary',
      '--text-caret', '--border-strong', '--error-light'].map(name => {
      probe.style.background = `var(${name})`;
      return getComputedStyle(probe).backgroundColor;
    });
    probe.remove(); return values;
  });
  expect(palettes.every(swatch => shared.includes(swatch))).toBe(true);
});

test('the rail keeps the picked colour while the background stays a tint of it', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '块外观');
  await injectBlock(page, 'command-block ai-block', 'probe-ai-block');
  await injectBlock(page, 'command-block', 'probe-command-block');

  // An untouched command block paints nothing: the reference for "switched off".
  const hidden = await readColors(page, 'probe-command-block');
  expect(hidden.background[3]).toBe(0);

  const field = blockField(page, 'AI 对话块');
  const reset = page.getByRole('button', { name: '恢复默认块外观' });
  await field.getByRole('combobox').click();
  await page.getByRole('option', { name: /青色/ }).click();

  // The shared cyan stays solid on the rail and translucent behind the content.
  await expect.poll(() => readColors(page, 'probe-ai-block').then(colors => colors.rail)).toEqual([0, 207, 165, 1]);
  const painted = await readColors(page, 'probe-ai-block');
  expect(painted.background.slice(0, 3)).toEqual([0, 207, 165]);
  expect(painted.background[3]).toBeGreaterThan(0.15);
  expect(painted.background[3]).toBeLessThan(0.3);

  // The switch gates background and rail together.
  await field.getByRole('switch').click();
  await expect.poll(() => readColors(page, 'probe-ai-block')).toEqual(hidden);

  // The single group-level button restores the theme defaults for every block type.
  await reset.click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--ai-block-bg-enabled').trim())).toBe('1');
  await expect.poll(() => readColors(page, 'probe-ai-block')).not.toEqual(hidden);
});
