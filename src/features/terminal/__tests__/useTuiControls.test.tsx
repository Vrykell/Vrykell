import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBlockStore, useTerminalStore } from '@features/terminal';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { useTuiControls } from '@features/terminal/hooks/useTuiControls';

const ptyMocks = vi.hoisted(() => ({
  ptyWrite: vi.fn(),
  killForeground: vi.fn(),
}));

vi.mock('@platform/pty', () => ({ ptyWrite: ptyMocks.ptyWrite }));
vi.mock('@utils/killForeground', () => ({
  ESCALATE_WINDOW_MS: 3000,
  killForeground: ptyMocks.killForeground,
}));

function block(patch: Partial<TermBlock>): TermBlock {
  return {
    id: 'block-1', command: 'npm run dev', status: 'done', exitCode: 0,
    startedAt: 1, endedAt: 2, wasLongRunning: false,
    outputHtml: '', outputText: '', outputRaw: '', linesTruncated: 0,
    ...patch,
  };
}

describe('useTuiControls', () => {
  const terminalSnapshot = useTerminalStore.getState();
  const blockSnapshot = useBlockStore.getState();

  beforeEach(() => {
    ptyMocks.ptyWrite.mockReset().mockResolvedValue(undefined);
    ptyMocks.killForeground.mockReset().mockResolvedValue('term');
    useTerminalStore.setState({
      sessions: { 'pane-1': 'session-1' },
      scenes: { 'pane-1': 'altScreen' },
      altScreenActive: true,
    });
    useBlockStore.setState({ byTab: { 'pane-1': [block({ status: 'executing', cwd: '/work' })] } });
  });

  afterEach(() => {
    useTerminalStore.setState(terminalSnapshot, true);
    useBlockStore.setState(blockSnapshot, true);
  });

  it('shows the latest running command and sends Ctrl+C to the pane session', () => {
    const { result } = renderHook(() => useTuiControls('pane-1'));

    expect(result.current.runningCommand).toBe('npm run dev');
    // The banner shows the same basic info as a running block: cwd and elapsed start time.
    expect(result.current.runningCwd).toBe('/work');
    expect(result.current.runningStartedAt).toBe(1);
    act(() => result.current.sendCtrlC());

    expect(ptyMocks.ptyWrite).toHaveBeenCalledWith('session-1', '\x03');
  });

  it('arms escalation after termination and exits the alt-screen scene', async () => {
    const { result } = renderHook(() => useTuiControls('pane-1'));

    await act(async () => { result.current.killApp(); });
    expect(ptyMocks.killForeground).toHaveBeenCalledWith('session-1');
    expect(result.current.killArmed).toBe(true);

    act(() => result.current.enterFullScreen());
    expect(useTerminalStore.getState().altScreenActive).toBe(true);
    expect(useTerminalStore.getState().scenes['pane-1']).toBe('altScreen');
    act(() => result.current.exitFullScreen());
    expect(useTerminalStore.getState().altScreenActive).toBe(false);
    expect(useTerminalStore.getState().scenes['pane-1']).toBe('blockList');
  });
});
