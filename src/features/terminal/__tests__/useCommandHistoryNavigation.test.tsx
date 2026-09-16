import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useHistoryStore } from '@entities/terminal';
import { useCommandHistoryNavigation } from '@features/terminal/hooks/useCommandHistoryNavigation';

describe('useCommandHistoryNavigation', () => {
  const historySnapshot = useHistoryStore.getState();

  afterEach(() => {
    useHistoryStore.setState(historySnapshot, true);
  });

  it('navigates matching commands and restores the original draft', () => {
    useHistoryStore.setState({
      entries: [
        { command: 'git status', cwd: '', timestamp: 2, exitCode: 0 },
        { command: 'git log', cwd: '', timestamp: 1, exitCode: 0 },
        { command: 'npm test', cwd: '', timestamp: 0, exitCode: 0 },
      ],
    });
    const onNavigate = vi.fn();
    const inputRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
    const { result } = renderHook(() => {
      const [text, setText] = useState('git');
      return { text, ...useCommandHistoryNavigation({ text, setText, inputRef, onNavigate }) };
    });

    let moved = false;
    act(() => { moved = result.current.navigate(1); });
    expect(moved).toBe(true);
    expect(result.current.text).toBe('git status');

    act(() => { result.current.navigate(1); });
    expect(result.current.text).toBe('git log');

    act(() => { result.current.navigate(-1); });
    expect(result.current.text).toBe('git status');
    act(() => { result.current.navigate(-1); });
    expect(result.current.text).toBe('git');
    expect(onNavigate).toHaveBeenCalledTimes(4);
  });

  it('returns false when moving beyond available history', () => {
    useHistoryStore.setState({
      entries: [{ command: 'pwd', cwd: '', timestamp: 1, exitCode: 0 }],
    });
    const inputRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
    const { result } = renderHook(() => {
      const [text, setText] = useState('npm');
      return { text, ...useCommandHistoryNavigation({ text, setText, inputRef }) };
    });

    let moved = false;
    act(() => { moved = result.current.navigate(1); });
    expect(moved).toBe(false);
    expect(result.current.text).toBe('npm');
  });
});
