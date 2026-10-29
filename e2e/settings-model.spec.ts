/**
 * Settings page e2e: model configuration (provider switch button + centered overlay + API key + endpoint + model list).
 *
 * Seed data: m-main (main model, Anthropic endpoint) comes first, m-local (local model,
 * OpenAI-compatible @ 127.0.0.1:11434) comes second and is the active model; the mock only seeds a key for the local endpoint.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, aiKeyCalls, aiModelCalls, clipboardText } from './tauri-mock';
import { openSettings, fieldOf, gotoSetting, selectThemeMode } from './settings';

const LOCAL_ID = 'openai-compatible|http://127.0.0.1:11434/v1';
const ANTHROPIC_ID = 'anthropic|https://api.anthropic.com/v1';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await openSettings(page);
});

test.describe('Model configuration page', () => {
  test('supported capability badges use distinct theme colors', async ({ page }, testInfo) => {
    await page.evaluate(async () => {
      const { setAiModels, useAiConfigStore } = await import('/src/features/agent/stores/aiConfig.ts') as typeof import('../src/features/agent/stores/aiConfig');
      const { models, activeModel } = useAiConfigStore.getState();
      await setAiModels([...models, { ...models[0]!, id: 'main-extra', name: 'Second model' }], activeModel);
    });
    for (const theme of ['深色', '浅色']) {
      await gotoSetting(page, '主题');
      await selectThemeMode(page, theme);
      await gotoSetting(page, '模型配置');
      const badges = page.getByTestId('model-row').first().locator('.model-cap-chip');
      await expect(badges).toHaveCount(4);
      const colors = await badges.evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element);
        return { foreground: style.color, background: style.backgroundColor, radius: style.borderRadius };
      }));
      expect(new Set(colors.map(color => color.foreground)).size).toBe(4);
      for (const color of colors) {
        expect(color.background).not.toBe('rgba(0, 0, 0, 0)');
        expect(color.radius).toBe('999px');
      }
      await page.locator('.settings-model-group').first().screenshot({ path: testInfo.outputPath(`capability-colors-${theme}.png`) });
    }
  });

  test('saves manually declared capabilities and updates the model badges', async ({ page }, testInfo) => {
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    const row = page.getByTestId('model-row').first();
    await row.getByTestId('model-settings').click();
    const dialog = page.getByTestId('model-settings-dialog');
    await expect(dialog.getByText('模型能力', { exact: true })).toHaveCount(0);
    const vision = dialog.getByRole('button', { name: '视觉', exact: true });
    const reasoning = dialog.getByRole('button', { name: '推理', exact: true });
    await expect(vision).toHaveAttribute('aria-pressed', 'false');
    await vision.click(); await reasoning.click();
    await expect(vision).toHaveAttribute('aria-pressed', 'true');
    await expect(reasoning).toHaveAttribute('aria-pressed', 'true');
    await expect(reasoning).toHaveCSS('background-color', await vision.evaluate(element => getComputedStyle(element).backgroundColor));
    const thinking = await dialog.getByText('深度思考', { exact: true }).boundingBox();
    expect((await vision.boundingBox())!.y).toBeGreaterThan(thinking!.y + thinking!.height);
    const thinkingSwitch = dialog.locator('.model-thinking-settings').getByRole('switch');
    await expect(thinkingSwitch).toHaveAttribute('aria-checked', 'false');
    await thinkingSwitch.click();
    await expect(thinkingSwitch).toHaveAttribute('aria-checked', 'true');
    for (const width of [760, 1240]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(dialog.locator('.model-capability-toggle')).toHaveCount(4);
      expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const providerBox = (await dialog.getByRole('combobox', { name: '本地模型 提供方', exact: true }).boundingBox())!;
      const thinkingBox = (await dialog.locator('.model-thinking-settings').boundingBox())!;
      expect(Math.abs(providerBox.y + providerBox.height / 2 - thinkingBox.y - thinkingBox.height / 2)).toBeLessThanOrEqual(1);
      await dialog.screenshot({ path: testInfo.outputPath(`model-capabilities-${width}.png`) });
    }
    await dialog.getByTestId('model-settings-done').click();
    await expect(row.getByTestId('model-cap-vision')).toHaveAttribute('data-supported', 'true');
    await expect(row.getByTestId('model-cap-reasoning')).toHaveAttribute('data-supported', 'true');
    await page.evaluate(async () => {
      const { refreshAiConfig } = await import('/src/features/agent/stores/aiConfig.ts') as typeof import('../src/features/agent/stores/aiConfig');
      await refreshAiConfig();
    });
    await expect(row.getByTestId('model-cap-vision')).toHaveAttribute('data-supported', 'true');
    await row.getByTestId('model-settings').click();
    const reset = dialog.getByRole('button', { name: '重置', exact: true });
    const footer = await dialog.evaluate(element => {
      const done = element.querySelector('[data-testid="model-settings-done"]')!.getBoundingClientRect();
      const reset = element.querySelector('[data-testid="model-capabilities-reset"]')!.getBoundingClientRect();
      return { doneX: done.x, resetX: reset.x, difference: Math.abs(reset.y + reset.height / 2 - done.y - done.height / 2) };
    });
    expect(footer.resetX).toBeLessThan(footer.doneX);
    expect(footer.difference).toBeLessThanOrEqual(1);
    await reset.click();
    await expect(vision).toHaveAttribute('aria-pressed', 'false');
    await expect(reasoning).toHaveAttribute('aria-pressed', 'false');
    await expect(dialog.getByRole('button', { name: '工具', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByTestId('model-settings-done').click();
    await page.evaluate(async () => {
      const { refreshAiConfig } = await import('/src/features/agent/stores/aiConfig.ts') as typeof import('../src/features/agent/stores/aiConfig');
      await refreshAiConfig();
    });
    await expect(row.getByTestId('model-cap-vision')).toHaveCount(0);
    await expect(row.getByTestId('model-cap-reasoning')).toHaveCount(0);
    await expect(row.getByTestId('model-cap-tools')).toBeVisible();
  });

  test('provider button: default selection, centered overlay switching, add action and three ⋯ menu entries', async ({ page }) => {
    const switcher = page.getByTestId('provider-switch');
    await expect(switcher.locator('.provider-switch-name')).toHaveText('Anthropic');
    await switcher.click();
    const dialog = page.getByTestId('provider-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-testid^="provider-option-"]')).toHaveCount(2);
    await expect(page.getByTestId(`provider-option-${ANTHROPIC_ID}`)).toHaveAttribute('aria-current', 'true');
    // Adding a provider lives in the same overlay
    await expect(page.getByTestId('provider-dialog-add')).toBeVisible();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await expect(dialog).toHaveCount(0);
    await expect(switcher.locator('.provider-switch-name')).toHaveText('127.0.0.1:11434');
    // The ⋯ menu in the right-hand detail header
    await page.locator('.settings-content').getByLabel('更多操作').click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('设为当前')).toBeVisible();
    await expect(menu.getByText('编辑密钥')).toBeVisible();
    await expect(menu.getByText('删除服务商')).toBeVisible();
    // Edit key -> centered overlay editor
    await menu.getByText('编辑密钥').click();
    await expect(page.getByTestId('key-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('key-dialog')).toHaveCount(0);
  });

  test('⋯ delete provider: confirm first, remove its model rows and refuse when only one is left', async ({ page }) => {
    const switcher = page.getByTestId('provider-switch');
    await page.locator('.settings-content').getByLabel('更多操作').click();
    await page.getByRole('menu').getByText('删除服务商').click();
    await page.getByTestId('confirm-ok').click();
    await expect(switcher.locator('.provider-switch-name')).toHaveText('127.0.0.1:11434');
    const setModels = await aiModelCalls(page);
    const last = setModels.filter((call) => call.kind === 'set_models').pop();
    expect(last?.models).toHaveLength(1);
    // Guard: the last provider cannot be deleted (no confirmation appears)
    await page.locator('.settings-content').getByLabel('更多操作').click();
    await page.getByRole('menu').getByText('删除服务商').click();
    await expect(page.getByText('至少保留一个模型')).toBeVisible();
    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  });

  test('API key: stored per provider, masked display, reveal/copy/clear and restore after saving', async ({ page }) => {
    // The default first row (Anthropic endpoint) has no key: it shows an Add API key entry and checking is unavailable
    const keyField = fieldOf(page, '服务商 API Key');
    await expect(keyField.getByTestId('provider-key-add')).toBeVisible();
    await expect(keyField.getByTestId('provider-key-add')).toContainText('添加 API 密钥');
    await expect(keyField.getByTestId('provider-check')).toBeDisabled();
    // Add: type in the centered overlay, toggle plain text with the eye button, then save and close
    await keyField.getByTestId('provider-key-add').click();
    const dialog = page.getByTestId('key-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('key-dialog-input').fill('sk-anthropic-key');
    await dialog.getByTestId('key-dialog-reveal').click();
    await expect(dialog.getByTestId('key-dialog-input')).toHaveAttribute('type', 'text');
    await dialog.getByTestId('key-dialog-reveal').click();
    await expect(dialog.getByTestId('key-dialog-input')).toHaveAttribute('type', 'password');
    await dialog.getByTestId('key-dialog-save').click();
    await expect(dialog).toHaveCount(0);
    await expect(keyField.getByTestId('provider-key-value')).toBeVisible();
    const savedKeys = await aiKeyCalls(page);
    expect(savedKeys.some((c) => c.provider === ANTHROPIC_ID && c.key === 'sk-anthropic-key')).toBe(true);
    // Switch to the local endpoint: it has its own key with masking plus reveal/copy
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-********abcd');
    await keyField.getByTestId('provider-key-reveal').click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-test-key-1234abcd');
    await keyField.getByTestId('provider-key-reveal').click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-********abcd');
    await keyField.getByTestId('provider-key-copy').click();
    expect(await clipboardText(page)).toBe('sk-test-key-1234abcd');
    // Clear -> the add entry returns
    await keyField.getByTestId('provider-key-clear').click();
    await expect(keyField.getByTestId('provider-key-add')).toBeVisible();
    const clears = await aiKeyCalls(page);
    expect(clears.some((c) => c.provider === LOCAL_ID && !c.key)).toBe(true);
    // Switch back to Anthropic: its own key is still there
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${ANTHROPIC_ID}`).click();
    await expect(keyField.getByTestId('provider-key-value')).toBeVisible();
  });

  test('endpoint and connection: preview line, check and model sync', async ({ page }) => {
    // The preview line shows the address the request actually reaches
    await expect(page.getByTestId('provider-endpoint-preview')).toContainText('https://api.anthropic.com/v1/messages');
    // The local endpoint has a key: checking issues a model-list request and reports the count
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await page.getByTestId('provider-check').click();
    await expect(page.getByRole('status').filter({ hasText: '连接正常' })).toBeVisible();
    // Sync merges models added at the endpoint into the list
    const before = await page.getByTestId('model-name').count();
    await page.getByTestId('model-sync').click();
    await expect(page.getByRole('status').filter({ hasText: '已新增' })).toBeVisible();
    expect(await page.getByTestId('model-name').count()).toBeGreaterThan(before);
  });

  test('model list: filtered by provider, set as current, add/rename/delete', async ({ page }) => {
    const names = page.getByTestId('model-name');
    // By default (the Anthropic row) only the main model appears
    await expect(names).toHaveCount(1);
    await expect(names.first()).toHaveText('主力模型');
    // The local endpoint row shows the local model, which is the active one
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await expect(names).toHaveCount(1);
    await expect(names.first()).toHaveText('本地模型');
    const localRow = page.getByTestId('model-row').first();
    await expect(localRow.locator('.model-cap-chip')).toHaveCount(1);
    await expect(localRow.getByTestId('model-cap-tools')).toHaveAttribute('data-supported', 'true');
    await expect(localRow.getByTestId('model-cap-vision')).toHaveCount(0);
    await expect(localRow.getByTestId('model-cap-tools')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const capabilities = (await localRow.locator('.model-cap-chip').last().boundingBox())!;
    const settings = (await localRow.getByTestId('model-settings').boundingBox())!;
    const remove = (await localRow.getByTestId('model-remove').boundingBox())!;
    expect(settings.x - (capabilities.x + capabilities.width)).toBeLessThanOrEqual(3);
    expect(remove.x - (settings.x + settings.width)).toBeLessThanOrEqual(3);
    await expect(page.getByTestId('model-row').first().getByText('当前', { exact: true })).toHaveCount(0);
    // Back to the Anthropic row: it has neither Set as current nor a Current badge
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${ANTHROPIC_ID}`).click();
    const mainRow = page.getByTestId('model-row').first();
    await expect(mainRow.getByRole('button', { name: '设为当前' })).toHaveCount(0);
    await expect(mainRow.getByText('当前', { exact: true })).toHaveCount(0);
    // Add a model: fill in the ID (required) and group in the centered form
    await page.getByTestId('model-add').click();
    const addDialog = page.getByTestId('add-model-dialog');
    await expect(addDialog).toBeVisible();
    // Click Add model with an empty ID -> a clear message instead of a disabled button without feedback
    await addDialog.getByTestId('add-model-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: '先填写模型 ID' })).toBeVisible();
    await addDialog.getByTestId('add-model-id').fill('deepseek-chat');
    await addDialog.getByTestId('add-model-group').fill('对话模型');
    await addDialog.getByTestId('add-model-confirm').click();
    await expect(addDialog).toHaveCount(0);
    await expect(names).toHaveCount(2);
    await expect(page.getByTestId('model-group-custom:对话模型')).toBeVisible();
    // The gear opens the centered editor to rename the model
    await page.getByTestId('model-row').nth(1).getByTestId('model-settings').click();
    const dialog = page.getByTestId('model-settings-dialog');
    await expect(dialog).toBeVisible();
    const nameInput = dialog.getByPlaceholder('模型名称');
    await nameInput.fill('新模型');
    await nameInput.press('Enter');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    await dialog.getByTestId('model-settings-done').click();
    await expect(page.getByTestId('model-name').nth(1)).toHaveText('新模型');
    const setModels = await aiModelCalls(page);
    const addCall = setModels.filter((c) => c.kind === 'set_models').pop();
    expect(addCall?.models).toHaveLength(3);
    expect((addCall?.models as { name: string }[])[2]?.name).toBe('新模型');
    // Delete the new model: confirm first -> one row remains
    await page.getByTestId('model-row').nth(1).getByTestId('model-remove').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('model-name')).toHaveCount(1);
  });

  test('add provider: the preset grid opens in the same overlay and the back button returns to the list', async ({ page }) => {
    const switcher = page.getByTestId('provider-switch');
    await switcher.click();
    const dialog = page.getByTestId('provider-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('provider-dialog-add').click();
    // The preset grid appears in the same overlay and the back button returns to the provider list
    await expect(page.getByTestId('model-preset-DeepSeek')).toBeVisible();
    await page.getByTestId('dialog-back').click();
    await expect(page.getByTestId('model-preset-DeepSeek')).toHaveCount(0);
    await expect(page.locator('[data-testid^="provider-option-"]')).toHaveCount(2);
    // Enter again and pick DeepSeek: the list returns with the new provider selected
    await page.getByTestId('provider-dialog-add').click();
    await page.getByTestId('model-preset-DeepSeek').click();
    await expect(page.getByTestId('model-preset-DeepSeek')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-testid^="provider-option-"]')).toHaveCount(3);
    await page.getByTestId('dialog-close').click();
    await expect(dialog).toHaveCount(0);
    await expect(switcher.locator('.provider-switch-name')).toHaveText('DeepSeek');
    await expect(page.getByTestId('model-name')).toHaveCount(1);
    await expect(page.getByTestId('model-name')).toHaveText('DeepSeek');
  });

  test('OpenCode preset: the endpoint preview and request path come from the catalog data', async ({ page }) => {
    await page.getByTestId('provider-switch').click();
    await page.getByTestId('provider-dialog-add').click();
    await page.getByTestId('model-preset-OpenCode Go').click();
    await page.getByTestId('dialog-close').click();
    await expect(page.getByTestId('provider-switch').locator('.provider-switch-name')).toHaveText('OpenCode Go');
    await expect(page.getByTestId('provider-endpoint-preview')).toContainText('https://opencode.ai/zen/go/v1/chat/completions');
  });

  test('the provider selection survives a reload (lastSelectedProvider)', async ({ page }) => {
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await page.reload();
    await openSettings(page);
    await expect(page.getByTestId('provider-switch').locator('.provider-switch-name')).toHaveText('127.0.0.1:11434');
  });
});
