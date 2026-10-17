import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBlockStore, useTerminalStore } from '@features/terminal';
import type { TermBlock } from '../services/pipeline/termBlock';
import { useRunningCommandActions } from '../hooks/useRunningCommandActions';

const mocks = vi.hoisted(() => ({
  ptyWrite: vi.fn(),
  killForeground: vi.fn(),
  redrawTerminal: vi.fn(),
}));

vi.mock('@platform/pty', () => ({ ptyWrite: mocks.ptyWrite }));
vi.mock('@utils/killForeground', () => ({
  ESCALATE_WINDOW_MS: 3000,
  killForeground: mocks.killForeground,
}));
vi.mock('../services/terminalRepaint', () => ({ redrawTerminal: mocks.redrawTerminal }));

function block(patch: Partial<TermBlock>): TermBlock {
  return {
    id: 'block-1', command: 'npm run dev', status: 'done', exitCode: 0,
    startedAt: 1, endedAt: 2, wasLongRunning: false,
    outputHtml: '', outputText: '', outputRaw: '', linesTruncated: 0,
    ...patch,
  };
}

describe('useRunningCommandActions', () => {
  const terminalSnapshot = useTerminalStore.getState();
  const blockSnapshot = useBlockStore.getState();

  beforeEach(() => {
    mocks.ptyWrite.mockReset().mockResolvedValue(undefined);
    mocks.killForeground.mockReset().mockResolvedValue('term');
    mocks.redrawTerminal.mockReset();
    useTerminalStore.setState({ sessions: { 'pane-1': 'session-1' }, scenes: { 'pane-1': 'blockList' }, altScreenActive: false });
    useBlockStore.setState({ byTab: { 'pane-1': [block({ status: 'executing', cwd: '/work' })] } });
  });

  afterEach(() => {
    useTerminalStore.setState(terminalSnapshot, true);
    useBlockStore.setState(blockSnapshot, true);
  });

  it('mirrors the running toolbar in order, redraws its own pane and raises the fullscreen surface', () => {
    const { result } = renderHook(() => useRunningCommandActions('pane-1', 'block'));

    expect(result.current.map((item) => item.label)).toEqual(['重绘终端', '终止命令', '结束前台应用', '进入全屏交互']);
    expect(result.current[0]!.shortcut).toMatch(/^(Meta|Control)\+Shift\+R$/);

    act(() => result.current[0]!.onClick?.());
    expect(mocks.redrawTerminal).toHaveBeenCalledExactlyOnceWith('pane-1');

    act(() => result.current[3]!.onClick?.());
    expect(useTerminalStore.getState().altScreenActive).toBe(true);
    expect(useTerminalStore.getState().scenes['pane-1']).toBe('altScreen');
  });

  it('interrupts through the write queue and arms the escalation label', async () => {
    const { result } = renderHook(() => useRunningCommandActions('pane-1', 'block'));

    expect(result.current[1]!.shortcut).toBe('Control+C');
    act(() => result.current[1]!.onClick?.());
    expect(mocks.ptyWrite).toHaveBeenCalledWith('session-1', '\x03');

    await act(async () => { result.current[2]!.onClick?.(); });
    expect(mocks.killForeground).toHaveBeenCalledWith('session-1');
    expect(result.current[2]!.label).toBe('强制结束前台应用');
  });

  it('offers the fullscreen exit on the fullscreen surface and leaves it', () => {
    useTerminalStore.setState({ scenes: { 'pane-1': 'altScreen' }, altScreenActive: true });
    const { result } = renderHook(() => useRunningCommandActions('pane-1', 'fullscreen'));

    expect(result.current.map((item) => item.label)).toEqual(['重绘终端', '终止命令', '结束前台应用', '退出全屏']);

    act(() => result.current[3]!.onClick?.());
    expect(useTerminalStore.getState().altScreenActive).toBe(false);
    expect(useTerminalStore.getState().scenes['pane-1']).toBe('blockList');
  });
});
