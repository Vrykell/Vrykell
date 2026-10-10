import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useAgentSettings } from '@features/agent';
import { useHistoryStore } from '@features/terminal';
import { useCommandCompletion } from '@features/terminal/hooks/useCommandCompletion';
import * as completionService from '@features/agent/services/complete';

describe('useCommandCompletion', () => {
  const settingsSnapshot = useAgentSettings.getState();
  const historySnapshot = useHistoryStore.getState();

  afterEach(() => {
    vi.useRealTimers(); vi.restoreAllMocks();
    useAgentSettings.setState(settingsSnapshot, true);
    useHistoryStore.setState(historySnapshot, true);
  });

  it('never attaches an old suffix to a newly typed prefix, including the first render', () => {
    useHistoryStore.setState({ entries: [{ command: 'npm list', cwd: '', timestamp: 1, exitCode: 0 }] });
    const rendered: string[] = [];
    const { result } = renderHook(() => {
      const [text, setText] = useState('npm');
      const completion = useCommandCompletion({ text, setText, aiMode: false, isFocused: true, visible: true, inputRef: { current: null } });
      rendered.push(text + completion.ghost);
      return { ...completion, setText };
    });
    rendered.length = 0;
    for (const prefix of ['npm ', 'npm l', 'npm li', 'npm lis', 'npm list']) act(() => result.current.setText(prefix));
    expect(rendered.length).toBeGreaterThan(5);
    expect(rendered.every(value => value === 'npm list')).toBe(true);
  });

  it('keeps a matching asynchronous suggestion during the next debounce and ignores cancelled results', async () => {
    vi.useFakeTimers();
    useHistoryStore.setState({ entries: [] });
    const pending: ((suffix: string) => void)[] = [];
    vi.spyOn(completionService, 'completeCommand').mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const { result } = renderHook(() => {
      const [text, setText] = useState('npm');
      return { setText, ...useCommandCompletion({ text, setText, aiMode: false, isFocused: true, visible: true, inputRef: { current: null } }) };
    });
    await act(() => vi.advanceTimersByTimeAsync(200));
    await act(async () => pending[0]!(' list'));
    act(() => result.current.setText('npm l'));
    expect(result.current.ghost).toBe('ist');
    await act(() => vi.advanceTimersByTimeAsync(200));
    act(() => result.current.setText('git'));
    expect(result.current.ghost).toBe('');
    await act(async () => pending[1]!('ong stale suggestion'));
    expect(result.current.ghost).toBe('');
  });

  it('shows local candidates and cycles through them with Tab', () => {
    useAgentSettings.setState({
      global: { ...settingsSnapshot.global, completeEnabled: true, completeDebounceMs: 0 },
    });
    useHistoryStore.setState({
      entries: [
        { command: 'git status', cwd: '', timestamp: 2, exitCode: 0 },
        { command: 'git log', cwd: '', timestamp: 1, exitCode: 0 },
      ],
    });
    const inputRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
    const { result } = renderHook(() => {
      const [text, setText] = useState('git');
      return {
        text,
        ...useCommandCompletion({
          text,
          aiMode: false,
          isFocused: true,
          visible: true,
          inputRef,
          setText,
        }),
      };
    });

    expect(result.current.ghost).toBe(' status');
    expect(result.current.ghostCandidates).toEqual([' status', ' log']);

    let accepted = false;
    act(() => { accepted = result.current.acceptCompletion(false); });
    expect(accepted).toBe(true);
    expect(result.current.text).toBe('git status');
    expect(result.current.ghost).toBe('');

    act(() => { result.current.acceptCompletion(false); });
    expect(result.current.text).toBe('git log');
    act(() => { result.current.restoreCompletion(); });
    expect(result.current.text).toBe('git');
    act(() => { result.current.clearGhost(); });
  });

  it('cycles backward without losing the original prefix for Escape restoration', () => {
    useAgentSettings.setState({ global: { ...settingsSnapshot.global, completeEnabled: true } });
    useHistoryStore.setState({ entries: [
      { command: 'npm list', cwd: '', timestamp: 2, exitCode: 0 },
      { command: 'npm test', cwd: '', timestamp: 1, exitCode: 0 },
    ] });
    const { result } = renderHook(() => {
      const [text, setText] = useState('npm');
      return { text, ...useCommandCompletion({ text, setText, aiMode: false, isFocused: true, visible: true, inputRef: { current: null } }) };
    });
    act(() => { expect(result.current.acceptCompletion(false)).toBe(true); });
    expect(result.current.text).toBe('npm list');
    act(() => { result.current.acceptCompletion(false); });
    expect(result.current.text).toBe('npm test');
    act(() => { result.current.acceptCompletion(true); });
    expect(result.current.text).toBe('npm list');
    act(() => { result.current.restoreCompletion(); });
    expect(result.current.text).toBe('npm');
  });

  it('restores the original prefix after completion cycling', () => {
    useAgentSettings.setState({
      global: { ...settingsSnapshot.global, completeEnabled: true, completeDebounceMs: 0 },
    });
    useHistoryStore.setState({
      entries: [{ command: 'npm test', cwd: '', timestamp: 1, exitCode: 0 }],
    });
    const inputRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
    const { result } = renderHook(() => {
      const [text, setText] = useState('npm');
      return {
        text,
        ...useCommandCompletion({
          text,
          aiMode: false,
          isFocused: true,
          visible: true,
          inputRef,
          setText,
        }),
      };
    });

    act(() => { result.current.acceptCompletion(false); });
    expect(result.current.text).toBe('npm test');
    let restored = false;
    act(() => { restored = result.current.restoreCompletion(); });
    expect(restored).toBe(true);
    expect(result.current.text).toBe('npm');
    expect(result.current.ghost).toBe('');
  });
});
