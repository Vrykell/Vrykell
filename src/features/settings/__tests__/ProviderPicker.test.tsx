/**
 * ProviderPicker tests — the bar renders provider chips and reports selection and adds;
 * the owning page keeps the store and the actions on the selected provider.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProviderPicker, { type ProviderPickerEntry } from '@features/settings/components/ProviderPicker';

const ENTRIES: ProviderPickerEntry[] = [
  { id: 'anthropic|https://api.anthropic.com/v1', kind: 'anthropic', name: 'Anthropic', hasKey: false },
  { id: 'openai-compatible|http://127.0.0.1:11434/v1', kind: 'openai-compatible', name: '127.0.0.1:11434', hasKey: true },
];

function renderPicker(selectedId: string | null = ENTRIES[0]!.id) {
  const spies = { onSelect: vi.fn(), onAddPreset: vi.fn() };
  render(<ProviderPicker entries={ENTRIES} selectedId={selectedId} {...spies} />);
  return spies;
}

afterEach(cleanup);

describe('ProviderPicker', () => {
  it('渲染芯片与选中态，点击上报选择', () => {
    const spies = renderPicker();
    const anthropic = screen.getByRole('button', { name: 'Anthropic' });
    expect(anthropic.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: '127.0.0.1:11434' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '127.0.0.1:11434' }));
    expect(spies.onSelect).toHaveBeenCalledWith('openai-compatible|http://127.0.0.1:11434/v1');
  });

  it('密钥状态点：已配置实心、未配置空心', () => {
    renderPicker();
    const dot = screen.getByRole('button', { name: 'Anthropic' }).querySelector('.settings-provider-dot');
    expect(dot?.hasAttribute('data-empty')).toBe(true);
  });

  it('添加服务商展开预设芯片并上报预设', () => {
    const spies = renderPicker();
    expect(screen.queryByTestId('model-presets')).toBeNull();
    fireEvent.click(screen.getByTestId('provider-add'));
    fireEvent.click(screen.getByTestId('model-preset-DeepSeek'));
    expect(spies.onAddPreset).toHaveBeenCalledTimes(1);
    expect((spies.onAddPreset.mock.calls[0]![0] as { name: string }).name).toBe('DeepSeek');
  });
});
