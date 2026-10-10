import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSaveProvider, useSettingsSave } from '../components/SettingsSaveProvider';
import SaveStatus from '../components/SaveStatus';
import AutoSaveInput from '../components/AutoSaveInput';

describe('immediate settings save feedback', () => {
  afterEach(() => vi.useRealTimers());
  it('reports errors, retries the same operation and then reports saved', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    function Example() {
      const { save, status, retry } = useSettingsSave();
      return <><button onClick={() => { void save(operation); }}>修改</button><SaveStatus status={status} onRetry={retry} /></>;
    }
    render(<SettingsSaveProvider><Example /></SettingsSaveProvider>);
    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存失败'));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'));
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('collects text edits into one transient summary instead of permanent field labels', async () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    function Summary() {
      const { status, retry } = useSettingsSave();
      return <SaveStatus status={status} onRetry={retry} />;
    }
    const view = render(<SettingsSaveProvider>
      <Summary />
      <AutoSaveInput value="" placeholder="First field" onCommit={first} />
      <AutoSaveInput value="" placeholder="Second field" onCommit={second} />
    </SettingsSaveProvider>);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('First field'), { target: { value: 'one' } });
    fireEvent.change(screen.getByPlaceholderText('Second field'), { target: { value: 'two' } });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('待保存');
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(first).toHaveBeenCalledWith('one');
    expect(second).toHaveBeenCalledWith('two');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(screen.queryByRole('status')).toBeNull();
    view.unmount();
  });

  it('retains local error feedback while the summary can retry a failed text save', async () => {
    const commit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    function Summary() {
      const { status, retry } = useSettingsSave();
      return <div data-testid="summary"><SaveStatus status={status} onRetry={retry} /></div>;
    }
    render(<SettingsSaveProvider><Summary /><AutoSaveInput value="" placeholder="Draft" onCommit={commit} /></SettingsSaveProvider>);
    fireEvent.change(screen.getByPlaceholderText('Draft'), { target: { value: 'kept' } });
    fireEvent.blur(screen.getByPlaceholderText('Draft'));
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('保存失败'));
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByPlaceholderText('Draft')).toHaveValue('kept');
    fireEvent.click(screen.getByTestId('summary').querySelector('button')!);
    await waitFor(() => {
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.getByRole('status')).toHaveTextContent('已保存');
    });
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
