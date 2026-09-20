import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBlockStore } from '@features/terminal';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { useTerminalBlockFlow } from '@features/terminal/hooks/useTerminalBlockFlow';

function block(partial: Partial<TermBlock>): TermBlock {
  return {
    id: 'block-1',
    command: 'echo ok',
    status: 'done',
    exitCode: 0,
    startedAt: 1,
    endedAt: 2,
    wasLongRunning: false,
    outputHtml: '',
    outputText: 'ok',
    outputRaw: 'ok',
    linesTruncated: 0,
    ...partial,
  };
}

describe('useTerminalBlockFlow', () => {
  const blockSnapshot = useBlockStore.getState();

  afterEach(() => {
    useBlockStore.setState(blockSnapshot, true);
  });

  it('separates completed and running blocks and builds the render flow', () => {
    const tabId = 'pane-1';
    const completed = block({ id: 'completed' });
    const running = block({ id: 'running', status: 'executing', outputText: '' });
    const empty = block({ id: 'empty', command: '', outputText: '', outputRaw: '' });
    act(() => useBlockStore.setState({ byTab: { [tabId]: [completed, running, empty] } }));

    const { result } = renderHook(() => useTerminalBlockFlow(tabId));

    expect(result.current.completed.map((item) => item.id)).toEqual(['completed']);
    expect(result.current.running.map((item) => item.id)).toEqual(['running']);
    expect(result.current.flow).toHaveLength(1);
    expect(result.current.flow[0]?.type).toBe('block');
  });

  it('owns block menu state and exposes stable open/close actions', () => {
    const tabId = 'pane-2';
    const target = block({ id: 'target' });
    act(() => useBlockStore.setState({ byTab: { [tabId]: [target] } }));
    const { result } = renderHook(() => useTerminalBlockFlow(tabId));
    const rect = document.createElement('div').getBoundingClientRect();

    act(() => result.current.openMenu(target, rect));
    expect(result.current.menuBlock?.block.id).toBe('target');
    expect(result.current.menuBlock?.rect).toBe(rect);

    act(() => result.current.closeMenu());
    expect(result.current.menuBlock).toBeNull();
  });
});
