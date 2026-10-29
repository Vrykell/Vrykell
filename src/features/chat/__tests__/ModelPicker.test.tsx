import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentSettings, useAiConfigStore } from '@features/agent';
import ModelPicker from '../components/ModelPicker';

const initialConfig = useAiConfigStore.getState();
const initialSettings = useAgentSettings.getState();
afterEach(() => {
  useAiConfigStore.setState(initialConfig);
  useAgentSettings.setState(initialSettings);
});

describe('model picker controls', () => {
  it('shows only supported capability badges with accessible labels', () => {
    useAiConfigStore.setState({ activeModel: 'sample', models: [{
      id: 'sample', name: 'Sample', model: 'sample', provider: 'openai-compatible', baseUrl: '',
      capabilities: { reasoning: false, vision: true, tools: true, search: false },
    }] });
    render(<ModelPicker open onClose={vi.fn()} />);
    const row = screen.getByTestId('model-pick-sample');
    expect(within(row).getAllByRole('img')).toHaveLength(2);
    expect(within(row).getByTestId('model-cap-vision')).toHaveAttribute('aria-label', '支持视觉');
    expect(within(row).queryByTestId('model-cap-reasoning')).toBeNull();
    expect(within(row).getByTestId('model-cap-tools')).toHaveAttribute('data-supported', 'true');
    expect(within(row).queryByTestId('model-cap-search')).toBeNull();
  });

  it('uses the themed selector without selecting the model or closing the dialog', () => {
    useAiConfigStore.setState({ activeModel: 'other', models: [{
      id: 'reasoning', name: '推理模型', model: 'reasoning', provider: 'anthropic', baseUrl: '',
      capabilities: { reasoning: true, vision: true, tools: true, search: true },
    }] });
    useAgentSettings.setState({ overrides: {} });
    const close = vi.fn();
    render(<ModelPicker open onClose={close} />);
    const control = screen.getByRole('combobox', { name: '推理模型的思考强度' });
    expect(control.tagName).toBe('BUTTON');
    fireEvent.click(control);
    fireEvent.click(screen.getByRole('option', { name: /^低$/ }));
    expect(control).toHaveTextContent('低');
    expect(useAgentSettings.getState().overrides.reasoning).toEqual({ thinkingLevel: 'low' });
    expect(useAiConfigStore.getState().activeModel).toBe('other');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(control);
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(control).toHaveAttribute('aria-expanded', 'false');
    expect(close).not.toHaveBeenCalled();
  });
});
