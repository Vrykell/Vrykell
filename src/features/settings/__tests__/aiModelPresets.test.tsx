/**
 * AiModelPage preset tests — a preset is a head start for the model list.
 *
 * The interesting behaviour is what one click does to the list: it fills a row with the vendor, the
 * endpoint and a model id, and a second click on the same preset lands on that row instead of
 * stacking duplicates.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiModelPage } from '@features/settings/pages/aiModelPage';
import { useAiConfigStore } from '@features/agent';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock }));

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
  it('fills a new model row from the preset and makes it active', async () => {
    render(<AiModelPage />);

    fireEvent.click(await screen.findByTestId('provider-add'));
    fireEvent.click(await screen.findByTestId('model-preset-DeepSeek'));

    await waitFor(() => {
      const models = useAiConfigStore.getState().models;
      expect(models.some((m) => m.baseUrl === 'https://api.deepseek.com/v1' && m.model === 'deepseek-chat')).toBe(true);
    });
    const added = useAiConfigStore.getState().models.find((m) => m.model === 'deepseek-chat');
    expect(useAiConfigStore.getState().activeModel).toBe(added?.id);
  });

  it('reuses the row a preset already matches', async () => {
    useAiConfigStore.setState({
      models: [{ id: 'mine', name: 'Mine', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }],
      activeModel: 'm0',
    });
    render(<AiModelPage />);

    fireEvent.click(await screen.findByTestId('provider-add'));
    fireEvent.click(await screen.findByTestId('model-preset-DeepSeek'));

    await waitFor(() => expect(useAiConfigStore.getState().activeModel).toBe('mine'));
    expect(useAiConfigStore.getState().models).toHaveLength(1);
  });
});
