import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('Browser error:', error.message));
  await setupTauriMock(page.context(), { launchDirectory: '/home/e2e/project', schedulesSeed: [], terminalDirectories: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '版本控制', exact: true }).click();
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    for (const details of await page.getByRole('button', { name: '技术详情' }).all()) await details.click();
    console.log(await page.locator('body').innerText());
    await page.screenshot({ path: info.outputPath('failure.png') });
  }
});

test('reviews both sides of a partially staged file and preserves the terminal', async ({ page }, info) => {
  const panel = page.getByTestId('git-panel');
  await expect(panel.getByText('main', { exact: true })).toBeVisible();
  await panel.getByTestId('git-unstaged-src/main.ts').click();
  const review = page.getByTestId('git-diff-review');
  await expect(review.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 });
  await expect(review.locator('.folder-path').getByText('暂存区 → 工作文件', { exact: true })).toBeVisible();
  await expect(review.getByTestId('code-diff')).toHaveAttribute('data-layout', 'inline');
  await expect(review.locator('.git-review-toolbar')).toHaveCount(1);
  await expect(review.locator('.code-diff-frame')).toHaveCSS('clip-path', /inset/);
  await expect(review.locator('.decorationsOverviewRuler').first()).not.toBeVisible();
  await expect(review.getByText('暂存区 → 工作文件', { exact: true })).toHaveCount(1);
  await expect(review.locator('.modified .view-lines:not(.line-delete)')).toContainText('working');
  await panel.getByTestId('git-staged-src/main.ts').click();
  await expect(review.locator('.folder-path').getByText('HEAD → 暂存区', { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: '已打开的差异' }).getByRole('tab')).toHaveCount(2);
  await expect(review.locator('.modified .view-lines:not(.line-delete)')).toContainText('staged');
  await expect(review.locator('.char-insert').first()).toBeVisible();
  await review.getByRole('combobox', { name: '差异布局' }).click();
  await page.getByRole('option', { name: '单栏对比' }).click();
  await expect(review.getByRole('combobox', { name: '差异布局' })).toContainText('单栏对比');
  await review.getByRole('combobox', { name: '差异布局' }).click();
  await page.getByRole('option', { name: '左右对比' }).click();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(review.locator('.monaco-diff-editor')).toBeVisible();
    const rect = (await review.boundingBox())!;
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    if (width === 1240) {
      await expect(review.getByTestId('code-diff')).toHaveAttribute('data-layout', 'split');
      const left = (await review.locator('.editor.original').boundingBox())!;
      const right = (await review.locator('.editor.modified').boundingBox())!;
      expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
      expect(left.width).toBeGreaterThan(200); expect(right.width).toBeGreaterThan(200);
      await expect(review.locator('.original .view-lines')).toContainText('base');
      await expect(review.locator('.modified .view-lines')).toContainText('staged');
    } else await expect(review.getByTestId('code-diff')).toHaveAttribute('data-layout', 'inline');
    await page.screenshot({ path: info.outputPath(`git-review-${width}.png`) });
  }
  await review.locator('.modified textarea.inputarea').focus();
  await page.keyboard.press('Control+f');
  await expect(review.getByRole('textbox', { name: '查找', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tablist', { name: '已打开的差异' }).getByRole('tab')).toHaveCount(1);
  await page.keyboard.press('Control+w');
  await expect(review).toHaveCount(0);
  await expect(page.locator('[data-terminal-input]').first()).toBeVisible();
});

test('keeps comparisons as workspace tabs and returns to the running terminal', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  await panel.getByTestId('git-unstaged-src/main.ts').click();
  await page.getByTestId('git-diff-review').getByRole('button', { name: '更多编辑器操作' }).click();
  await page.getByRole('button', { name: '返回终端', exact: true }).click();
  await expect(page.locator('[data-terminal-input]').first()).toBeVisible();
  await panel.getByTestId('git-unstaged-src/main.ts').click();
  await expect(page.getByRole('tablist', { name: '已打开的差异' }).getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭差异 src/main.ts' }).click();
  await expect(page.getByTestId('git-diff-review')).toHaveCount(0);
  await expect(page.locator('[data-terminal-input]').first()).toBeVisible();
});

test('generates an editable commit message and runs commit and remote operations', async ({ page }, info) => {
  const panel = page.getByTestId('git-panel');
  await page.evaluate(() => {
    (window as unknown as Record<string, string>).__AI_REPLY__ = 'feat: add source control';
    localStorage.setItem('mock-git-snapshot', JSON.stringify({ root: '/home/e2e/project', branch: 'main', remotes: ['origin'], upstream: 'origin/main', ahead: 1, behind: 2,
      entries: [{ path: 'src/main.ts', indexStatus: 'M', worktreeStatus: 'M', previousPath: null }] }));
  });
  await panel.getByRole('button', { name: '刷新变更' }).click();
  await panel.getByRole('button', { name: '生成提交信息' }).click();
  const message = panel.getByRole('textbox', { name: '提交信息' });
  await expect(message).toHaveValue('feat: add source control', { timeout: 15000 });
  await message.fill('feat: review source control');
  await message.press('Control+Enter');
  await expect(message).toHaveValue('');
  await expect(panel.getByTestId('git-staged-src/main.ts')).toHaveCount(0);
  await expect(panel.getByTestId('git-unstaged-src/main.ts')).toBeVisible();
  for (const name of ['获取', '拉取', '推送']) {
    await expect(panel.getByRole('button', { name, exact: false })).toHaveCount(0);
    await panel.getByRole('button', { name: '更多版本控制操作' }).click();
    await page.getByRole('button', { name, exact: false }).click();
    await expect(panel.getByText('正在执行版本库操作…')).toHaveCount(0);
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-git-operations') || '[]').map((operation: { operation: string }) => operation.operation))).toEqual(['commit', 'fetch', 'pull', 'push']);
  await panel.getByTestId('git-unstaged-src/main.ts').getByRole('button', { name: '暂存文件' }).click();
  await message.fill('fix: keep this draft');
  await page.evaluate(() => localStorage.setItem('mock-git-operation-error', 'Permission denied'));
  await panel.getByRole('button', { name: '提交', exact: true }).click();
  await expect(panel.getByText('版本库操作失败')).toBeVisible();
  await expect(message).toHaveValue('fix: keep this draft');
  await page.screenshot({ path: info.outputPath('git-commit-error.png') });
});

test('stages and unstages complete files and filters paths', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  await panel.getByTestId('git-untracked-new file.ts').getByRole('button', { name: '暂存文件' }).press('Enter');
  await expect(panel.getByTestId('git-staged-new file.ts')).toBeVisible();
  await panel.getByTestId('git-staged-new file.ts').getByRole('button', { name: '取消暂存' }).click();
  await expect(panel.getByTestId('git-untracked-new file.ts')).toBeVisible();
  await panel.getByRole('textbox', { name: '搜索变更文件' }).fill('new file');
  await expect(panel.getByTestId('git-unstaged-src/main.ts')).toHaveCount(0);
  await expect(panel.getByTestId('git-untracked-new file.ts')).toBeVisible();
});

test('shows binary, conflict, empty and failure states', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  await panel.getByTestId('git-unstaged-image.png').click();
  await expect(page.getByText('二进制文件无法显示文本差异。')).toBeVisible();
  await panel.getByTestId('git-conflicts-conflict.ts').click();
  await expect(page.getByText('请在编辑器或终端中解决冲突；这里展示冲突两侧的内容。')).toBeVisible();
  await expect(page.getByTestId('git-diff-review').locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => localStorage.setItem('mock-git-error', 'Repository unavailable'));
  await panel.getByRole('button', { name: '刷新变更' }).click();
  await expect(panel.getByText('无法读取版本库', { exact: true })).toBeVisible();
  await page.evaluate(() => { localStorage.removeItem('mock-git-error'); localStorage.setItem('mock-git-snapshot', 'null'); });
  await panel.getByRole('button', { name: '刷新变更' }).click();
  await expect(panel.getByText('当前目录不在版本库中。')).toBeVisible();
});

test('uses one joined button and adapts clean repositories to synchronization and publication', async ({ page }, info) => {
  const panel = page.getByTestId('git-panel');
  const clean = { root: '/home/e2e/project', branch: 'main', entries: [], remotes: ['origin'], upstream: 'origin/main', ahead: 2, behind: 1, hasHead: true };
  await page.evaluate(value => localStorage.setItem('mock-git-snapshot', JSON.stringify(value)), clean);
  await panel.getByRole('button', { name: '刷新变更' }).click();
  const group = panel.getByRole('group', { name: '版本库操作' });
  const primary = group.getByRole('button', { name: '同步更改 ↓1 ↑2' });
  await expect(primary).toBeEnabled();
  const left = (await primary.boundingBox())!;
  const right = (await group.getByRole('button', { name: '提交操作' }).boundingBox())!;
  expect(Math.abs(left.x + left.width - right.x)).toBeLessThan(1);
  expect(left.height).toBe(right.height);
  await primary.click();
  await expect(group.getByRole('button', { name: '已是最新' })).toBeDisabled();
  await page.evaluate(value => localStorage.setItem('mock-git-snapshot', JSON.stringify(value)), { ...clean, upstream: null, ahead: 0, behind: 0 });
  await panel.getByRole('button', { name: '刷新变更' }).click();
  await expect(group.getByRole('button', { name: '发布分支' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('git-publish-wide.png') });
  await page.setViewportSize({ width: 760, height: 800 });
  await page.screenshot({ path: info.outputPath('git-publish-narrow.png') });
});

test('offers hover actions and confirms discards without touching staged changes', async ({ page }, info) => {
  const panel = page.getByTestId('git-panel');
  const row = panel.getByTestId('git-unstaged-src/main.ts');
  await row.hover();
  for (const name of ['打开工作文件', '放弃更改', '暂存文件']) await expect(row.getByRole('button', { name })).toBeVisible();
  await page.screenshot({ path: info.outputPath('git-hover-actions.png') });
  await row.getByRole('button', { name: '放弃更改' }).click();
  await page.getByTestId('confirm-cancel').click();
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole('button', { name: '放弃更改' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(row).toHaveCount(0);
  await expect(panel.getByTestId('git-staged-src/main.ts')).toBeVisible();
  await expect(page.getByTestId('git-diff-review')).toHaveCount(0);
});

test('opens the composer branch menu, switches a clean branch and preserves command drafts', async ({ page }, info) => {
  await page.evaluate(() => localStorage.setItem('mock-git-snapshot', JSON.stringify({ root: '/home/e2e/project', branch: 'main', entries: [], remotes: ['origin'], upstream: 'origin/main', ahead: 0, behind: 0 })));
  const input = page.locator('[data-terminal-input]').first();
  await input.fill('echo keep my draft');
  await page.getByRole('button', { name: 'Git 状态：main', exact: true }).click();
  const switcher = page.getByRole('menuitem', { name: '切换分支', exact: true });
  await expect(switcher).toBeEnabled();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    if (width === 760) {
      await page.getByRole('button', { name: '版本控制', exact: true }).click();
      await page.getByRole('button', { name: 'Git 状态：main', exact: true }).click();
    }
    const menu = page.getByRole('menu', { name: '版本库操作', exact: true });
    await expect(menu).toBeVisible();
    await expect.poll(async () => {
      const popup = (await menu.boundingBox())!; const chip = (await page.getByRole('button', { name: 'Git 状态：main', exact: true }).boundingBox())!;
      return popup.y + popup.height - chip.y;
    }).toBeLessThanOrEqual(-4);
    await page.screenshot({ path: info.outputPath(`composer-menu-above-${width}.png`) });
  }
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.screenshot({ path: info.outputPath('composer-git-menu.png') });
  await switcher.click();
  await page.getByRole('menuitemradio', { name: 'feature/review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Git 状态：feature/review', exact: true })).toBeVisible();
  await expect(input).toHaveValue('echo keep my draft');
  await page.getByRole('button', { name: 'Git 状态：feature/review', exact: true }).click();
  await page.getByRole('button', { name: '打开版本控制', exact: true }).click();
  await expect(page.getByTestId('git-panel').getByText('feature/review', { exact: true })).toBeVisible();
});

test('keeps Git usable in settings and saves a prompt for the remembered workspace', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  await panel.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('button', { name: '版本控制设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '差异页面' })).toBeVisible();
  await expect(panel.getByTestId('git-staged-src/main.ts')).toBeVisible();
  await panel.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('button', { name: '此工作区的 AI 提交提示词…' }).click();
  const dialog = page.getByTestId('git-commit-prompt');
  const promptBounds = (await page.getByRole('dialog', { name: '此工作区的 AI 提交提示词…' }).boundingBox())!;
  expect(Math.abs(promptBounds.x + promptBounds.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2);
  await dialog.getByRole('textbox').fill('Write a concise subject and list the changed behavior.');
  const saveButton = dialog.getByRole('button', { name: '保存', exact: true });
  const cancelButton = dialog.getByRole('button', { name: '取消', exact: true });
  expect(Math.abs((await saveButton.boundingBox())!.height - (await cancelButton.boundingBox())!.height)).toBeLessThan(2);
  const primaryBackground = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.background = 'var(--primary-button-bg)'; document.body.appendChild(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value; });
  expect(await saveButton.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(primaryBackground);
  await saveButton.click();
  await expect(dialog).toHaveCount(0);
  await panel.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('button', { name: '此工作区的 AI 提交提示词…' }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Write a concise subject and list the changed behavior.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-git-preferences')!).state.commitPrompts['["","/home/e2e/project"]'])).toContain('list the changed behavior');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const untracked = panel.getByTestId('git-untracked-new file.ts');
  await untracked.hover(); await untracked.getByRole('button', { name: '暂存文件' }).click();
  await expect(panel.getByTestId('git-staged-new file.ts')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '差异页面' })).toBeVisible();
});

test('switches diff page modes without losing open comparisons', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  await panel.getByTestId('git-unstaged-src/main.ts').click();
  await panel.getByTestId('git-staged-src/main.ts').click();
  await expect(page.getByRole('tablist', { name: '已打开的差异' }).getByRole('tab')).toHaveCount(2);
  await expect(page.locator('[data-tab-row-id]').filter({ hasText: '文件差异' })).toHaveCount(1);
  await panel.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('button', { name: '版本控制设置', exact: true }).click();
  await page.getByRole('combobox', { name: '差异页面' }).click();
  await page.getByRole('option', { name: '多页，不使用差异标签' }).click();
  await expect(page.locator('[data-tab-row-id]').filter({ hasText: 'main.ts' })).toHaveCount(2);
  await panel.getByTestId('git-staged-src/main.ts').click();
  await expect(page.getByTestId('git-diff-review')).toBeVisible();
  await expect(page.getByRole('tablist', { name: '已打开的差异' })).toHaveCount(0);
  await panel.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('button', { name: '版本控制设置', exact: true }).click();
  await page.getByRole('combobox', { name: '差异页面' }).click();
  await page.getByRole('option', { name: '单页，使用差异标签' }).click();
  await panel.getByTestId('git-staged-src/main.ts').click();
  await expect(page.getByRole('tablist', { name: '已打开的差异' }).getByRole('tab')).toHaveCount(2);
});

test('scrolls comparison tabs horizontally with the wheel', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  const paths = Array.from({ length: 6 }, (_, index) => `src/long-comparison-file-${index}.ts`);
  await page.evaluate(paths => localStorage.setItem('mock-git-snapshot', JSON.stringify({ root: '/home/e2e/project', branch: 'main', entries: paths.map(path => ({ path, previousPath: null, indexStatus: ' ', worktreeStatus: 'M' })) })), paths);
  await panel.getByRole('button', { name: '刷新变更' }).click();
  for (const path of paths) await panel.getByTestId(`git-unstaged-${path}`).click();
  const strip = page.getByRole('tablist', { name: '已打开的差异' });
  await strip.evaluate(element => { element.scrollLeft = 0; });
  await strip.hover(); await page.mouse.wheel(0, 240);
  await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});

test('reorders comparison tabs and moves secondary actions into the compact menu', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  await panel.getByTestId('git-unstaged-src/main.ts').click(); await panel.getByTestId('git-staged-src/main.ts').click();
  const strip = page.getByRole('tablist', { name: '已打开的差异' });
  const source = (await strip.getByRole('tab').nth(1).boundingBox())!; const target = (await strip.getByRole('tab').first().boundingBox())!;
  await page.mouse.move(source.x + 24, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 12 }); await page.mouse.up();
  await expect(strip.getByRole('tab').first()).toContainText('已暂存');
  await expect(strip.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 760, height: 800 }); const review = page.getByTestId('git-diff-review');
  await expect(review.getByRole('combobox', { name: '差异布局' })).not.toBeVisible();
  await review.getByRole('button', { name: '更多编辑器操作' }).click();
  await expect(page.getByRole('menu').getByRole('menuitemradio', { name: '单栏对比', exact: true })).toBeVisible();
  await page.getByRole('menu').getByRole('button', { name: '刷新差异', exact: true }).click();
});

test('shows rounded groups, a collapsible file tree and selectable worktrees', async ({ page }, info) => {
  const panel = page.getByTestId('git-panel');
  expect(await panel.locator('.git-group-heading').first().evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(0);
  expect((await panel.locator('.git-commit-buttons').boundingBox())!.height).toBeLessThanOrEqual(32);
  await panel.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('menuitem', { name: '更改视图' }).click();
  await page.getByRole('menuitemradio', { name: '树形视图' }).click();
  const staged = panel.getByRole('region', { name: '已暂存', exact: true });
  await staged.getByText('src', { exact: true }).click();
  await expect(staged.getByTestId('git-staged-src/main.ts')).toHaveCount(0);
  await staged.getByText('src', { exact: true }).click();
  await expect(staged.getByTestId('git-staged-src/main.ts')).toBeVisible();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await panel.locator('.git-group-heading').nth(1).hover();
    await page.screenshot({ path: info.outputPath(`git-tree-rounded-${width}.png`) });
  }
  await panel.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('button', { name: '关联的工作区', exact: true }).click();
  const trees = panel.getByTestId('git-worktrees');
  await expect(trees.getByText('feature/review', { exact: true })).toBeVisible();
  await expect(trees.getByText('已锁定', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('mock-git-snapshots', JSON.stringify({ '/home/e2e/feature': { root: '/home/e2e/feature', branch: 'feature/review', entries: [], remotes: [] } })));
  await trees.getByText('feature/review', { exact: true }).click();
  await expect(panel.getByText('/home/e2e/feature', { exact: true })).toBeVisible();
  await expect(panel.locator('.git-files').getByText('工作区没有变更', { exact: true })).toBeVisible();
});

test('uses reload feedback and dismisses operation errors from the heading', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  await panel.getByRole('button', { name: '刷新变更' }).click();
  await expect(panel.getByRole('button', { name: '刷新变更' }).locator('svg')).toHaveClass(/reload-spin/);
  await page.evaluate(() => localStorage.setItem('mock-git-operation-error', 'Network unavailable'));
  await panel.getByRole('button', { name: '更多版本控制操作' }).click();
  await page.getByRole('button', { name: '获取', exact: true }).click();
  const error = panel.getByRole('alert');
  await expect(error).toBeVisible();
  await error.getByRole('button', { name: '关闭错误提示' }).click();
  await expect(error).toHaveCount(0);
});

test('manages branches and tags and exposes conflict recovery', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  await page.evaluate(() => localStorage.setItem('mock-git-snapshot', JSON.stringify({ root: '/home/e2e/project', branch: 'main', entries: [], remotes: ['origin'], hasHead: true })));
  await panel.getByRole('button', { name: '刷新变更' }).click();
  const open = async (group: string, action: string) => {
    await panel.getByRole('button', { name: '更多版本控制操作' }).click();
    await page.getByRole('menuitem', { name: group, exact: true }).click();
    await page.getByRole('button', { name: action, exact: true }).click();
    return page.getByRole('dialog', { name: action, exact: true });
  };
  const create = await open('分支', '创建分支');
  await create.getByRole('textbox', { name: '新名称' }).fill('feature/new');
  await create.getByRole('button', { name: '创建分支', exact: true }).click();
  await expect(create).toHaveCount(0);
  const tag = await open('标签', '创建标签');
  const nameField = tag.getByRole('textbox', { name: '新名称' });
  const startPoint = tag.getByRole('combobox', { name: '起始提交或引用' });
  const fieldRadius = await startPoint.evaluate(element => getComputedStyle(element).borderTopLeftRadius);
  expect(fieldRadius).not.toBe('0px');
  expect(await nameField.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe(fieldRadius);
  const messageField = tag.getByRole('textbox', { name: '标签说明（可选）' });
  expect(await messageField.evaluate(element => getComputedStyle(element.closest('.config-text-area')!).borderTopLeftRadius)).toBe(fieldRadius);
  const primaryAction = tag.getByRole('button', { name: '创建标签', exact: true });
  const primaryBackground = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.background = 'var(--primary-button-bg)'; document.body.appendChild(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value; });
  expect(await primaryAction.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(primaryBackground);
  await nameField.fill('v2.0');
  await messageField.fill('Release notes');
  await primaryAction.click();
  await expect(tag).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('mock-git-ref-error', 'Conflict in file.ts'));
  const merge = await open('分支', '合并分支');
  await merge.getByRole('button', { name: '合并分支', exact: true }).click();
  await expect(merge.getByRole('alert')).toBeVisible();
  await merge.getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel.getByText('合并进行中', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('mock-git-ref-error'));
  await panel.getByRole('button', { name: '中止操作' }).click();
  await page.getByRole('dialog', { name: '中止合并' }).getByRole('button', { name: '中止合并', exact: true }).click();
  await expect(panel.getByText('合并进行中', { exact: true })).toHaveCount(0);
  const actions = await page.evaluate(() => JSON.parse(localStorage.getItem('mock-git-ref-operations')!) as { action: string; name: string }[]);
  expect(actions.map(item => item.action)).toEqual(['createBranch', 'createTag', 'merge', 'abortMerge']);
  expect(actions[0]!.name).toBe('feature/new'); expect(actions[1]!.name).toBe('v2.0');
});

test('stages a reviewed conflict resolution only after confirmation', async ({ page }) => {
  const panel = page.getByTestId('git-panel');
  const row = panel.getByTestId('git-conflicts-conflict.ts');
  await row.hover(); await row.getByRole('button', { name: '标记为已解决' }).click();
  await page.getByTestId('confirm-cancel').click(); await expect(row).toBeVisible();
  await row.hover(); await row.getByRole('button', { name: '标记为已解决' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(row).toHaveCount(0); await expect(panel.getByTestId('git-staged-conflict.ts')).toBeVisible();
});
