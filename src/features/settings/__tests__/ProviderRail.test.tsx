/**
 * ProviderRail tests — the rail renders provider rows and reports actions; the owning page
 * (not this component) owns stores and model edits.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProviderRail, { type ProviderRailEntry } from '@features/settings/components/ProviderRail';

const ENTRIES: ProviderRailEntry[] = [
  { id: 'anthropic|https://api.anthropic.com/v1', kind: 'anthropic', name: 'Anthropic', hasKey: false },
  { id: 'openai-compatible|http://127.0.0.1:11434/v1', kind: 'openai-compatible', name: '127.0.0.1:11434', hasKey: true },
];

function renderRail(overrides: Partial<Parameters<typeof ProviderRail>[0]> = {}) {
  const spies = {
    onSelect: vi.fn(),
    onSetCurrent: vi.fn(),
    onEditKey: vi.fn(),
    onDelete: vi.fn(),
    onAddPreset: vi.fn(),
  };
  render(<ProviderRail entries={ENTRIES} selectedId={ENTRIES[0].id} {...spies} {...overrides} />);
  return spies;
}

afterEach(cleanup);

describe('ProviderRail', () => {
  it('渲染行与选中态，点击行上报选择', () => {
    const props = renderRail();
    expect(screen.getByRole('button', { name: 'Anthropic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '127.0.0.1:11434' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anthropic' }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '127.0.0.1:11434' }));
    expect(props.onSelect).toHaveBeenCalledWith('openai-compatible|http://127.0.0.1:11434/v1');
  });

  it('搜索过滤行，Escape 清空', () => {
    renderRail();
    const search = screen.getByPlaceholderText('搜索服务商…');
    fireEvent.change(search, { target: { value: 'anth' } });
    expect(screen.queryByRole('button', { name: '127.0.0.1:11434' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anthropic' })).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '127.0.0.1:11434' })).toBeTruthy();
  });

  it('无匹配时显示空态', () => {
    renderRail();
    fireEvent.change(screen.getByPlaceholderText('搜索服务商…'), { target: { value: 'zzz' } });
    expect(screen.getByText('无匹配服务商')).toBeTruthy();
  });

  it('⋯ 菜单给出设为当前/编辑密钥/删除，并上报动作', () => {
    const props = renderRail();
    fireEvent.click(screen.getAllByLabelText('更多操作')[1]!);
    fireEvent.click(screen.getByText('设为当前'));
    expect(props.onSetCurrent).toHaveBeenCalledWith('openai-compatible|http://127.0.0.1:11434/v1');
    fireEvent.click(screen.getAllByLabelText('更多操作')[0]!);
    fireEvent.click(screen.getByText('编辑密钥'));
    expect(props.onEditKey).toHaveBeenCalledWith('anthropic|https://api.anthropic.com/v1');
    fireEvent.click(screen.getAllByLabelText('更多操作')[0]!);
    fireEvent.click(screen.getByText('删除服务商'));
    expect(props.onDelete).toHaveBeenCalledWith('anthropic|https://api.anthropic.com/v1');
  });

  it('添加服务商展开预设芯片并上报预设', () => {
    const props = renderRail();
    expect(screen.queryByTestId('model-presets')).toBeNull();
    fireEvent.click(screen.getByTestId('provider-add'));
    fireEvent.click(screen.getByTestId('model-preset-DeepSeek'));
    expect(props.onAddPreset).toHaveBeenCalledTimes(1);
    expect((props.onAddPreset.mock.calls[0]![0] as { name: string }).name).toBe('DeepSeek');
  });
});
