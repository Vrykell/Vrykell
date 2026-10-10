import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useAgentSettings } from '@features/agent';
import { useHistoryStore } from '@features/terminal';
import { useCommandCompletion } from '@features/terminal/hooks/useCommandCompletion';

describe('useCommandCompletion', () => {
  const settingsSnapshot = useAgentSettings.getState();
  const historySnapshot = useHistoryStore.getState();

  afterEach(() => {
    useAgentSettings.setState(settingsSnapshot, true);
    useHistoryStore.setState(historySnapshot, true);
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

  it('selects a specific candidate and retains keyboard cycling and Escape restoration', () => {
    useAgentSettings.setState({ global: { ...settingsSnapshot.global, completeEnabled: true } });
    useHistoryStore.setState({ entries: [
      { command: 'npm list', cwd: '', timestamp: 2, exitCode: 0 },
      { command: 'npm test', cwd: '', timestamp: 1, exitCode: 0 },
    ] });
    const { result } = renderHook(() => {
      const [text, setText] = useState('npm');
      return { text, ...useCommandCompletion({ text, setText, aiMode: false, isFocused: true, visible: true, inputRef: { current: null } }) };
    });
    act(() => { expect(result.current.acceptCompletion(false, ' invalid')).toBe(false); });
    act(() => { expect(result.current.acceptCompletion(false, ' test')).toBe(true); });
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
