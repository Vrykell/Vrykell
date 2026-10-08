import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites, ptySignals, expectAnyTermContains } from './tauri-mock';

test.describe('命令块（OSC 133）', () => {
  test('终端运行命令后 block UI 可见', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    // 初始 prompt 触发 blockList 场景
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });

    await input.fill('echo e2e-block-test');
    await input.press('Enter');

    // block 中应显示命令文本（无 $ 前缀、加粗）和输出文本
    await expect(page.getByText('echo e2e-block-test').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('e2e-block-test').first()).toBeVisible({ timeout: 5000 });
    // 上下文行：退出码 0
    await expect(page.getByTestId('exit-code').first()).toHaveText('0', { timeout: 5000 });
  });

  test('无 OSC 133 时：块模式暂存输出；经典打开模式直出 xterm', async ({ page }) => {
    // 关闭 shell integration：默认打开模式是块模式，输出暂存进 pending 块（不可见）
    await setupTauriMock(page, { integration: false });
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await emitPtyOutput(page, 'echo classic-mode\r\nclassic-mode-output\r\n');
    await page.waitForTimeout(600);
    // 无 OSC 133 标记 → 无退出码上下文，输出不渲染
    await expect(page.getByTestId('exit-code')).toHaveCount(0);
    await expect(page.getByText('classic-mode-output')).toHaveCount(0);

    // 打开方式设经典模式（zsh）→ 新页面经典终端直出
    await page.addInitScript(() => {
      localStorage.setItem('vrykell-agent-settings', JSON.stringify({
        state: { global: { openModeByShell: { zsh: 'classic' } }, overrides: {} },
        version: 8,
      }));
    });
    await page.reload();
    // classic 场景：无底部输入栏，xterm 可见
    await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder(/输入命令/)).toHaveCount(0);
    await emitPtyOutput(page, 'echo classic-mode\r\nclassic-mode-output\r\n');
    // WebGL renderer：终端输出画进 canvas 不进 DOM，断言改读 xterm buffer
    await expectAnyTermContains(page, 'classic-mode-output', 5000);
  });

  test('进出 altScreen 显示 TUI banner', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });

    // Wait for the shell startup prompt before injecting a sustained command.
    await page.waitForFunction(async () => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      return Object.values(useTerminalStore.getState().startupStates).includes('ready');
    });
    // 通过 PTY 输出直接注入 altScreen 序列
    await emitPtyOutput(
      page,
      '\x1b]133;A\x07' +
        '\x1b]133;E;dm0=\x07' + // base64('vim')
        '\x1b]133;C\x07' +
        '\x1b[?1049h' +
        'VIM BUFFER',
    );

    await expect(page.getByText('TUI')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button.tui-control[data-tip="终止命令"]')).toBeVisible();
    // 真实 alt-buffer 应用不提供「退出全屏」（输出只写主 xterm，强制回 blockList 会画面失联）；
    // esc 仅手动全屏（块卡片进入全屏交互）才有 —— 见 running-term.spec.ts
    await expect(page.locator('[data-tip="退出全屏"]')).toHaveCount(0);

    // 真实 alt buffer 应用的内容必须进入主 xterm buffer（WebGL 下 canvas 渲染，读 buffer 断言）
    // —— 回归：manualTui 误判曾把 vim 画面盖住，用户看到冻结的块内容。
    await expectAnyTermContains(page, 'VIM BUFFER', 5000);

    // 键盘必须可达 TUI：altScreen 场景焦点路由到主 xterm，onData → PTY
    // （回归：Esc 曾被全局快捷键劫持、焦点落在不可见块终端，"无法输入"）
    // 注意放在按钮点击之前 —— 点击横幅按钮会把焦点从 xterm 抢走
    const writesBefore = (await ptyWrites(page)).length;
    await page.keyboard.press('q');
    await page.keyboard.press('Escape');
    await expect(async () => {
      const writes = await ptyWrites(page);
      expect(writes.length).toBeGreaterThan(writesBefore);
      expect(writes.slice(writesBefore).join('')).toContain('q');
    }).toPass({ timeout: 5000 });

    // 升级式结束按钮：首击 SIGTERM → 窗口内再击 SIGKILL
    const bannerEnd = page.locator('button.tui-control[data-tip="结束前台应用"]');
    await expect(bannerEnd).toBeVisible();
    await bannerEnd.click();
    await expect(async () => {
      expect(await ptySignals(page)).toEqual([{ id: 'e2e-session', sig: 15 }]);
    }).toPass({ timeout: 5000 });
    await page.locator('button.tui-control[data-tip="结束前台应用"]').click();
    await expect(async () => {
      expect(await ptySignals(page)).toEqual([
        { id: 'e2e-session', sig: 15 },
        { id: 'e2e-session', sig: 9 },
      ]);
    }).toPass({ timeout: 5000 });

    // 退出 altScreen
    await emitPtyOutput(page, '\x1b[?1049l\x1b]133;D;0\x07\x1b]133;A\x07');

    await expect(page.getByText('TUI')).not.toBeVisible({ timeout: 5000 });
    // 恢复 block 列表后输入栏应重新出现
    await expect(input).toBeVisible({ timeout: 5000 });
    await page.mouse.move(0, 0);
    // 全屏 TUI 画面不进块历史（alt 内容只在主 xterm 实时呈现），
    // 历史只留 teardown 后的 shell 噪音 —— 全屏应用不应污染命令历史
    await page.locator('[data-testid^="command-block-"]').last().hover();
    await expect(page.getByTestId('exit-code')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('VIM BUFFER')).toHaveCount(0);
  });

  test('altScreen 中滚轮降级为方向键发给 PTY', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // 进入 altScreen（应用未开鼠标上报：滚轮应降级为方向键）
    await emitPtyOutput(
      page,
      '\x1b]133;A\x07' +
        '\x1b]133;E;dm0=\x07' +
        '\x1b]133;C\x07' +
        '\x1b[?1049h' +
        'TUI APP',
    );
    await expect(page.getByText('TUI')).toBeVisible({ timeout: 5000 });
    await expectAnyTermContains(page, 'TUI APP', 5000);

    // 在可见主 xterm 的中央滚轮（DOM 里还有隐藏的块内 xterm，需 :visible 过滤；
    // 顶部 29px 是 TUI banner 条，滚轮落在上面不会进 xterm，避开）
    const box = await page.locator('.xterm:visible').boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const before = (await ptyWrites(page)).length;
    await page.mouse.wheel(0, 200);
    await expect(async () => {
      const writes = (await ptyWrites(page)).slice(before).join('');
      expect(writes).toContain('\x1b[B');
    }).toPass({ timeout: 5000 });

    const beforeUp = (await ptyWrites(page)).length;
    await page.mouse.wheel(0, -200);
    await expect(async () => {
      const writes = (await ptyWrites(page)).slice(beforeUp).join('');
      expect(writes).toContain('\x1b[A');
    }).toPass({ timeout: 5000 });
  });

  test('全局搜索 Cmd+F 打开居中弹窗并聚焦', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    // TopDock 搜索触发器可见（不再是常驻输入框）
    const trigger = page.getByTestId('global-search-trigger');
    await expect(trigger).toBeVisible({ timeout: 3000 });
    // Cmd+F 打开居中搜索窗并聚焦搜索栏
    await page.keyboard.press('Meta+f');
    const searchInput = page.getByPlaceholder(/搜索文件/);
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    await expect(searchInput).toBeFocused();
    // Escape 关闭弹窗
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();
  });

  test('全局搜索筛选面板点击不崩溃', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+f');
    const searchInput = page.getByPlaceholder(/搜索文件/);
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    // 点击筛选按钮 → 打开筛选面板（此前这里条件 hook 导致崩溃）
    await page.getByTestId('search-filter-button').click();
    await expect(page.getByText('搜索范围')).toBeVisible({ timeout: 3000 });
    // 切换一个源后不崩溃，搜索框仍可交互
    await page.getByText('命令历史').first().click();
    await expect(searchInput).toBeVisible();
  });

  test('底部命令输入栏可见', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const cmdInput = page.getByPlaceholder(/输入命令/);
    await expect(cmdInput).toBeVisible({ timeout: 5000 });
  });

  test('Cmd+P 打开命令面板', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+p');
    await expect(page.getByPlaceholder('搜索命令…')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('搜索命令…')).not.toBeVisible();
  });

  test('Cmd+W 打开命令面板不冲突（p 和 w 区分）', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    // Cmd+P 打开面板
    await page.keyboard.press('Meta+p');
    await expect(page.getByPlaceholder('搜索命令…')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    // Cmd+W 不应打开面板
    await page.keyboard.press('Meta+w');
    await expect(page.getByPlaceholder('搜索命令…')).not.toBeVisible();
  });
});
