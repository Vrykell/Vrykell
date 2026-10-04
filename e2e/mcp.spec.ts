/**
 * MCP 服务器设置页 e2e：草稿卡片校验 / 保存落库 / 连接断开 / 启用 / 删除。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mcpServers, mcpOps } from './tauri-mock';
import { gotoSetting, fieldOf } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, 'MCP 服务器');
});

test.describe('MCP 设置页', () => {
  test('deleting during an automatic rename waits for the save and removes the renamed server', async ({ page }) => {
    await page.evaluate(() => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const original = bridge.invoke;
      bridge.invoke = async (command, args) => {
        if (command === 'mcp_save_server') await new Promise(resolve => setTimeout(resolve, 400));
        return original(command, args);
      };
    });
    const name = page.getByPlaceholder('服务器名').first();
    const card = name.locator('xpath=../..');
    await name.fill('重命名中的服务器');
    await expect(card.getByRole('status')).toHaveText('保存中…');
    await card.getByTitle('删除服务器').click();
    await expect(page.getByPlaceholder('服务器名')).toHaveCount(0);
    expect(await mcpServers(page)).toEqual([]);
  });
  test('已保存服务器：连接状态徽标与工具数', async ({ page }) => {
    const nameInput = page.locator('section').getByPlaceholder('服务器名').first();
    await expect(nameInput).toHaveValue('文件系统');
    const card = nameInput.locator('xpath=../..');
    await expect(card.getByText('已连接 · 3 工具')).toBeVisible();
    await expect(card.getByRole('button', { name: '断开' })).toBeVisible();
  });

  test('添加服务器：空名校验 / 缺 command 校验 / 保存落库', async ({ page }) => {
    await page.getByRole('button', { name: /添加服务器/ }).click();
    // 草稿卡片出现（服务器名输入变为 2 个）
    const nameInputs = page.locator('section').getByPlaceholder('服务器名');
    await expect(nameInputs).toHaveCount(2);
    const draftCard = nameInputs.nth(1).locator('xpath=../..');
    await nameInputs.nth(1).fill(' ');
    await expect(page.getByText('请填写服务器名')).toBeVisible();

    await nameInputs.nth(1).fill('e2e-mcp');
    await expect(page.getByText('请填写命令或远程地址')).toBeVisible();

    await draftCard.getByPlaceholder('command，如 npx').fill('npx');
    await draftCard.getByPlaceholder('args，空格分隔').fill('-y @scope/server');
    await draftCard.getByPlaceholder(/环境变量/).fill('TOKEN=abc');
    await expect.poll(async () => (await mcpOps(page)).filter(op => op.op === 'save' && op.name === 'e2e-mcp').length).toBe(1);

    const ops = await mcpOps(page);
    const save = ops.find((o) => o.op === 'save' && o.name === 'e2e-mcp');
    expect(save).toBeTruthy();
    const cfg = save!.config as { command: string; args: string[]; env: Record<string, string> };
    expect(cfg.command).toBe('npx');
    expect(cfg.args).toEqual(['-y', '@scope/server']);
    expect(cfg.env).toEqual({ TOKEN: 'abc' });
    // 落库后显示未连接 + 连接按钮
    const servers = await mcpServers(page);
    expect(servers.some((s) => s.name === 'e2e-mcp')).toBe(true);
    const savedCard = page.locator('section').getByPlaceholder('服务器名').nth(1).locator('xpath=../..');
    await expect(page.locator('section').getByPlaceholder('服务器名').nth(1)).toHaveValue('e2e-mcp');
    await expect(savedCard.getByText('未连接')).toBeVisible();
  });

  test('草稿可取消；连接/断开/启停/删除', async ({ page }) => {
    // 取消草稿
    await page.getByRole('button', { name: /添加服务器/ }).click();
    const nameInputs = page.locator('section').getByPlaceholder('服务器名');
    await expect(nameInputs).toHaveCount(2);
    await nameInputs.nth(1).locator('xpath=../..').getByRole('button', { name: '取消' }).click();
    await expect(nameInputs).toHaveCount(1); // 只剩已保存的

    // 连接
    const card = nameInputs.first().locator('xpath=../..');
    await card.getByRole('button', { name: '断开' }).click();
    await expect(card.getByText('未连接')).toBeVisible();
    await card.getByRole('button', { name: '连接' }).click();
    await expect(page.getByText('已连接 文件系统')).toBeVisible();
    await expect(card.getByText(/已连接 · 2 工具/)).toBeVisible();

    // 启用开关（默认开 → 关）
    const toggle = card.getByRole('switch');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const ops = await mcpOps(page);
    expect(ops.some((o) => o.op === 'toggle' && o.name === '文件系统')).toBe(true);

    // 删除
    await card.getByTitle('删除服务器').click();
    await expect(page.getByText('已删除 文件系统')).toBeVisible();
    await expect(nameInputs).toHaveCount(0);
  });
});
