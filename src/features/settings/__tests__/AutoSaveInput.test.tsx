import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AutoSaveInput from '../components/AutoSaveInput';
import { NumberInput } from '../components/ui';

describe('AutoSaveInput', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the exact bounded integer that was saved, including unchanged bounds', async () => {
    const commit = vi.fn();
    render(<NumberInput value={100} min={1} max={100} onChange={commit} />);
    const input = screen.getByRole('spinbutton');
    for (const [draft, saved] of [['101', 100], ['0', 1], ['3.6', 4]] as const) {
      fireEvent.change(input, { target: { value: draft } });
      expect(input).toHaveValue(Number(draft));
      await act(() => vi.advanceTimersByTimeAsync(600));
      expect(commit).toHaveBeenLastCalledWith(saved);
      expect(input).toHaveValue(saved);
      expect(screen.getByRole('status')).toHaveTextContent('已保存');
    }
  });

  it('normalizes decimal settings and rejects empty numeric drafts', async () => {
    const commit = vi.fn();
    render(<AutoSaveInput type="number" value="0.7" min={0} max={2} onCommit={commit} />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '3' } });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(commit).toHaveBeenCalledExactlyOnceWith('2');
    expect(input).toHaveValue(2);
    fireEvent.change(input, { target: { value: '' } });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('请输入有效数字');
  });

  it('holds edits during composition and saves after the final text settles', async () => {
    const save = vi.fn();
    render(<AutoSaveInput value="" onCommit={save} placeholder="名称" />);
    const input = screen.getByPlaceholderText('名称');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'zhong' } });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '中文' } });
    fireEvent.compositionEnd(input);
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save).toHaveBeenCalledExactlyOnceWith('中文');
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
  });

  it('flushes on Enter and blur, preserves multiline whitespace and retries failures', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { rerender } = render(<AutoSaveInput value="" onCommit={save} placeholder="名称" />);
    fireEvent.change(screen.getByPlaceholderText('名称'), { target: { value: ' draft ' } });
    fireEvent.keyDown(screen.getByPlaceholderText('名称'), { key: 'Enter' });
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('保存失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await act(async () => {});
    expect(save.mock.calls).toEqual([['draft'], ['draft']]);
    rerender(<AutoSaveInput value="" onCommit={save} placeholder="名称" multiline trim={false} />);
    fireEvent.change(screen.getByPlaceholderText('名称'), { target: { value: '\n text \n' } });
    fireEvent.blur(screen.getByPlaceholderText('名称'));
    await act(async () => {});
    expect(save).toHaveBeenLastCalledWith('\n text \n');
  });

  it('clears secret drafts after saving and cancels pending replacement before clearing', async () => {
    const save = vi.fn();
    const clear = vi.fn().mockResolvedValue(undefined);
    render(<AutoSaveInput value="" type="password" onCommit={save} onClear={clear} clearAfterSave placeholder="密钥" />);
    const input = screen.getByPlaceholderText('密钥');
    fireEvent.change(input, { target: { value: 'test-key' } });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(input).toHaveValue('');
    expect(save).toHaveBeenCalledExactlyOnceWith('test-key');
    fireEvent.change(input, { target: { value: 'replacement-key' } });
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledOnce();
    expect(input).toHaveValue('');
  });
});
