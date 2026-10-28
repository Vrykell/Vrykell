/**
 * AiModelPage preset tests — a preset is a head start for the model list.
 *
 * The interesting behaviour is what one click does to the list: it fills a row with the vendor, the
 * endpoint and a model id, and a second click on the same preset lands on that row instead of
 * stacking duplicates.
 */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiModelPage } from '@features/settings/pages/aiModelPage';
import { useAiConfigStore } from '@features/agent';
import { MODEL_PRESETS } from '@config/modelPresets';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock }));

/** The preset under test, read from the data file so refreshing ids never breaks the test. */
const DEEPSEEK = MODEL_PRESETS.find((preset) => preset.name === 'DeepSeek')!;

const SEED = {
  id: 'm0', name: 'Seeded', provider: 'openai-compatible' as const,
  baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
  useAiConfigStore.setState({
    models: [{ ...SEED }], activeModel: 'm0',
    provider: 'openai-compatible', baseUrl: SEED.baseUrl, model: SEED.model,
  });
});

describe('AiModelPage presets', () => {
  it('uses shared sync feedback and suppresses duplicate endpoint requests', async () => {
    let finish!: (models: string[]) => void;
    invokeMock.mockImplementation((command: string) => command === 'provider_fetch_models'
      ? new Promise<string[]>(resolve => { finish = resolve; }) : Promise.resolve({}));
    render(<AiModelPage />);
    const sync = await screen.findByTestId('model-sync');
    fireEvent.click(sync);
    expect(sync).toHaveAttribute('aria-busy', 'true');
    expect(sync).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(sync);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'provider_fetch_models')).toHaveLength(1);
    await act(async () => { finish(['extra-model']); });
    await waitFor(() => expect(useAiConfigStore.getState().models.some(model => model.model === 'extra-model')).toBe(true));
    await waitFor(() => expect(sync).toHaveAttribute('aria-busy', 'false'), { timeout: 2000 });
  });
  it('fills a new model row from the preset and makes it active', async () => {
    render(<AiModelPage />);

    fireEvent.click(await screen.findByTestId('provider-switch'));
    fireEvent.click(await screen.findByTestId('provider-dialog-add'));
    fireEvent.click(await screen.findByTestId('model-preset-DeepSeek'));

    await waitFor(() => {
      const models = useAiConfigStore.getState().models;
      expect(models.some((m) => m.baseUrl === DEEPSEEK.baseUrl && m.model === DEEPSEEK.model)).toBe(true);
    });
    const added = useAiConfigStore.getState().models.find((m) => m.model === DEEPSEEK.model);
    expect(useAiConfigStore.getState().activeModel).toBe(added?.id);
  });

  it('reuses the row a preset already matches', async () => {
    useAiConfigStore.setState({
      models: [{ id: 'mine', name: 'Mine', provider: 'openai-compatible', baseUrl: DEEPSEEK.baseUrl, model: DEEPSEEK.model }],
      activeModel: 'm0',
    });
    render(<AiModelPage />);

    fireEvent.click(await screen.findByTestId('provider-switch'));
    fireEvent.click(await screen.findByTestId('provider-dialog-add'));
    fireEvent.click(await screen.findByTestId('model-preset-DeepSeek'));

    await waitFor(() => expect(useAiConfigStore.getState().activeModel).toBe('mine'));
    expect(useAiConfigStore.getState().models).toHaveLength(1);
  });
});
