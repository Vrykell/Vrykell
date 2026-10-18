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

test('clickable chips clear the gray fill on hover and expose their pressed state', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });

  const status = page.locator('.terminal-input-status:visible').first();
  const directory = status.locator('.directory-picker-trigger');
  await expect(directory).toBeEnabled();
  await expect(directory).toHaveCSS('cursor', 'pointer');
  const resting = await directory.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(resting).not.toBe('rgba(0, 0, 0, 0)');

  // Hovering a clickable chip drops its resting fill; moving away brings it back.
  await directory.hover();
  await expect(directory).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: 'test-results/input-chip-hover.png' });
  await page.mouse.move(0, 0);
  await expect(directory).toHaveCSS('background-color', resting);

  // While its menu is open the chip keeps a visible pressed tint instead of turning transparent.
  const activeBg = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--control-active-bg)';
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
  await directory.click();
  await expect(directory).toHaveAttribute('aria-expanded', 'true');
  await expect(directory).toHaveCSS('background-color', activeBg);
  await page.keyboard.press('Escape');
  await expect(directory).toHaveAttribute('aria-expanded', 'false');

  // Inject a branch and verify that repository actions share the chip interaction.
  await page.evaluate(async () => {
    const path = '/src/features/terminal/stores/blocks.ts';
    const { useBlockStore } = await import(path) as typeof import('../src/features/terminal/stores/blocks');
    const state = useBlockStore.getState();
    for (const [paneId, blocks] of Object.entries(state.byTab)) {
      state.setBlocks(paneId, blocks.map(block => ({ ...block, gitBranch: 'dev' })));
    }
  });
  const branch = status.locator('.terminal-branch');
  await expect(branch).toHaveText('dev');
  const branchResting = await branch.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(branchResting).not.toBe('rgba(0, 0, 0, 0)');
  await branch.hover();
  await expect(branch).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(branch).toHaveCSS('cursor', 'pointer');
  await branch.click(); await expect(branch).toHaveAttribute('aria-expanded', 'true');
  await expect(branch).toHaveCSS('background-color', activeBg);
});
