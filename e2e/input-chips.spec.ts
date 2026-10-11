import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('input chips share the quiet no-border gray style', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  // Typing a matching command reveals the completion chip next to the shell/dir/git chips.
  await input.fill('npm');
  await expect(page.locator('.command-completion-trigger')).toBeVisible();

  const chips = page.locator('.terminal-composer .terminal-chip');
  await expect(chips.first()).toBeVisible();
  const styles = await chips.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return { border: style.borderTopWidth, radius: style.borderTopLeftRadius, bg: style.backgroundColor };
  }));
  expect(styles.length).toBeGreaterThanOrEqual(4);
  for (const style of styles) {
    // Unification: no border, only the shared gray background.
    expect(style.border).toBe('0px');
    expect(style.radius).toBe('5px');
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.bg).toBe(styles[0]!.bg);
  }
});
