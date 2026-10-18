import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useBlockStore } from '@features/terminal';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { useCommandHistoryNavigation } from '@features/terminal/hooks/useCommandHistoryNavigation';

const block = (id: string, command: string): TermBlock => ({
  id, command, status: 'done', exitCode: 0, startedAt: 0, endedAt: 1, wasLongRunning: false,
  outputHtml: '', outputText: '', outputRaw: '', linesTruncated: 0,
});

describe('useCommandHistoryNavigation', () => {
  const blocksSnapshot = useBlockStore.getState();

  afterEach(() => {
    useBlockStore.setState(blocksSnapshot, true);
  });

  it('navigates matching commands of the pane and restores the original draft', () => {
    useBlockStore.setState({
      byTab: {
        'pane-1': [block('b1', 'npm test'), block('b2', 'git log'), block('b3', 'git status')],
      },
    });
    const onNavigate = vi.fn();
    const inputRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
    const { result } = renderHook(() => {
      const [text, setText] = useState('git');
      return { text, ...useCommandHistoryNavigation({ paneId: 'pane-1', text, setText, inputRef, onNavigate }) };
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

  it('keeps duplicates out and never crosses into other panes', () => {
    useBlockStore.setState({
      byTab: {
        'pane-1': [block('b1', 'ls -la'), block('b2', 'pwd'), block('b3', 'pwd'), block('b4', '')],
        'pane-2': [block('c1', 'npm test')],
      },
    });
    const inputRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
    const { result } = renderHook(() => {
      const [text, setText] = useState('');
      return { text, ...useCommandHistoryNavigation({ paneId: 'pane-1', text, setText, inputRef }) };
    });

    let moved = false;
    act(() => { moved = result.current.navigate(1); });
    expect(moved).toBe(true);
    expect(result.current.text).toBe('pwd');

    act(() => { result.current.navigate(1); });
    expect(result.current.text).toBe('ls -la');

    act(() => { moved = result.current.navigate(1); });
    expect(moved).toBe(false);
    expect(result.current.text).toBe('ls -la');
  });

  it('returns false when the pane has no matching history', () => {
    useBlockStore.setState({ byTab: { 'pane-1': [block('b1', 'pwd')] } });
    const inputRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
    const { result } = renderHook(() => {
      const [text, setText] = useState('npm');
      return { text, ...useCommandHistoryNavigation({ paneId: 'pane-1', text, setText, inputRef }) };
    });

    let moved = false;
    act(() => { moved = result.current.navigate(1); });
    expect(moved).toBe(false);
    expect(result.current.text).toBe('npm');
  });
});
