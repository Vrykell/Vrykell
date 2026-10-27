import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ptyWrites, ensureChatSettingsOpen } from './tauri-mock';

test.describe('命令块链路', () => {
  test('bash 代码块显示运行按钮，点击后写入 PTY 并回显', async ({ page }) => {
    await mockAnthropic(page, '试试这个：\n\n```bash\necho hello-e2e\n```');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // 切换到 AI 模式
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    await ensureChatSettingsOpen(page);
    await page.getByRole('combobox', { name: '选择执行终端' }).click();
    await page.getByRole('listbox', { name: '选择执行终端' }).getByRole('option').filter({ hasNotText: '仅讨论' }).first().click();
    await page.keyboard.press('Escape');
    const input = page.getByTestId('ai-surface-side').getByPlaceholder(/自然语言描述/);
    await input.fill('给我个命令');
    await input.press('Enter');

    // 等待内联 AI 区出现运行按钮
    const runBtn = page.getByText('在终端运行');
    await expect(runBtn.first()).toBeVisible({ timeout: 10000 });
    await runBtn.first().click();

    await expect.poll(() => ptyWrites(page)).toContain('echo hello-e2e\n');
    // 新 block UI 中命令与输出均可见（无 $ 前缀）
    await expect(page.getByText('echo hello-e2e').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('hello-e2e').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('exit-code').first()).toHaveText('0', { timeout: 5000 });
  });

  test('python 代码块不显示运行按钮', async ({ page }) => {
    await mockAnthropic(page, '```python\nprint(1)\n```');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.getByTestId('ai-surface-side').getByPlaceholder(/自然语言描述/);
    await input.fill('写代码');
    await input.press('Enter');

    await expect(page.locator('pre code')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('在终端运行')).toHaveCount(0);
  });
});

test('keeps a streamed code block colored instead of flashing to plain text', async ({ page }) => {
  const streamed = ['```ts', ...Array.from({ length: 30 }, (_, index) => `const value${index} = ${index};`), '```'].join('\n');
  await mockAnthropic(page, 'Warm-up:\n\n```ts\nconst warmup = 1;\n```');
  await page.addInitScript(() => {
    (window as unknown as { __AI_CHUNK_DELAY_MS__?: number }).__AI_CHUNK_DELAY_MS__ = 12;
    const frames: { colored: boolean }[] = [];
    (window as unknown as { __CODE_TOKEN_FRAMES__?: { colored: boolean }[] }).__CODE_TOKEN_FRAMES__ = frames;
    const observe = () => {
      new MutationObserver(() => {
        // Only follow the second reply's block; the first one warms up the editor runtime.
        const code = [...document.querySelectorAll('.md-code-block code')].find(node => node.textContent?.includes('const value'));
        if (code) frames.push({ colored: code.querySelector('[data-code-token]') !== null });
      }).observe(document.body, { childList: true, characterData: true, subtree: true });
    };
    if (document.body) observe(); else document.addEventListener('DOMContentLoaded', observe, { once: true });
  });
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

  await page.getByRole('button', { name: '询问 AI', exact: true }).click();
  const input = page.getByTestId('ai-surface-side').getByPlaceholder(/自然语言描述/);
  await input.fill('warm up the highlighter');
  await input.press('Enter');
  await expect(page.locator('.md-code-block [data-code-token="keyword.ts"]').first()).toBeVisible({ timeout: 15_000 });

  await expect(input).toBeEnabled();
  await page.evaluate(reply => { (window as unknown as { __AI_REPLY__?: string }).__AI_REPLY__ = reply; }, streamed);
  await input.fill('show me the code');
  await input.press('Enter');
  const code = page.locator('.md-code-block code').filter({ hasText: 'const value29' });
  await expect(code).toHaveCount(1, { timeout: 15_000 });
  await page.waitForTimeout(250);

  const frames = await page.evaluate(() => (window as unknown as { __CODE_TOKEN_FRAMES__?: { colored: boolean }[] }).__CODE_TOKEN_FRAMES__ ?? []);
  const firstColored = frames.findIndex(frame => frame.colored);
  expect(firstColored).toBeGreaterThanOrEqual(0);
  // After the first coloring pass, every mutation of the streaming block keeps its tokens.
  expect(frames.slice(firstColored + 1).filter(frame => !frame.colored)).toEqual([]);
});

for (const mode of ['dark', 'light'] as const) {
  test(`code and table surfaces share the neutral palette in ${mode}`, async ({ page }, info) => {
    await mockAnthropic(page, '```\n17:32:10  400\n17:32:24  400  interval 14s\n```\n\n| Status | Count |\n| --- | --- |\n| Ready | 2 |');
    await setupTauriMock(page);
    await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), mode);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await page.locator('[data-dock-btn="chat"]').click();
    const composer = page.getByTestId('ai-surface-side').locator('[data-chat-composer]');
    await composer.fill('Show the output');
    await composer.press('Enter');
    const frame = page.locator('.md-code-block').first();
    await expect(frame).toBeVisible();
    const table = page.locator('.md table').first();
    await expect(table).toBeVisible();

    // Custom terminal block colors must not recolor read-only answer content.
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--command-block-bg', '#183C57');
      document.documentElement.style.setProperty('--block', '#183C57');
    });
    for (const width of [1240, 760]) {
      await page.setViewportSize({ width, height: 800 });
      const colors = await frame.evaluate(element => {
        const root = getComputedStyle(document.documentElement);
        const probe = document.createElement('div');
        element.append(probe);
        const resolve = (token: string) => {
          probe.style.backgroundColor = root.getPropertyValue(token);
          return getComputedStyle(probe).backgroundColor;
        };
        const expected = { card: resolve('--surface'), field: resolve('--field-bg'), border: resolve('--border') };
        probe.remove();
        const header = element.querySelector('.md-code-block-header')!;
        const table = element.closest('.md')!.querySelector('table')!;
        return {
          expected,
          body: getComputedStyle(element).backgroundColor,
          header: getComputedStyle(header).backgroundColor,
          table: getComputedStyle(table).backgroundColor,
          tableHeader: getComputedStyle(table.querySelector('th')!).backgroundColor,
          borders: [element, header, table].map(node => getComputedStyle(node).borderBottomColor),
          fits: element.getBoundingClientRect().right <= window.innerWidth,
        };
      });
      expect(colors.body).toBe(colors.expected.card);
      expect(colors.table).toBe(colors.expected.card);
      expect(colors.header).toBe(colors.expected.field);
      expect(colors.tableHeader).toBe(colors.expected.field);
      expect(colors.borders).toEqual(Array(3).fill(colors.expected.border));
      expect(colors.fits).toBe(true);
      await page.screenshot({ path: info.outputPath(`content-surfaces-${mode}-${width}.png`) });
    }
  });
}
