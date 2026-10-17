import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

const {
  writeMock,
  onDataHandlers,
  invokeMock,
  ptyOutputHandlers,
  ptyExitHandlers,
  outputResolvers,
  exitResolvers,
  terminalInitOptions,
  terminalInstances,
} = vi.hoisted(() => ({
  writeMock: vi.fn(),
  onDataHandlers: [] as Array<(d: string) => void>,
  invokeMock: vi.fn(),
  ptyOutputHandlers: [] as Array<(id: string, events: unknown[]) => void>,
  ptyExitHandlers: [] as Array<(id: string, code?: number | null) => void>,
  outputResolvers: [] as Array<(u: () => void) => void>,
  exitResolvers: [] as Array<(u: () => void) => void>,
  terminalInitOptions: [] as import('@xterm/xterm').ITerminalOptions[],
  terminalInstances: [] as Array<{ options: Record<string, unknown> }>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options: import('@xterm/xterm').ITerminalOptions) {
      terminalInitOptions.push(options);
      terminalInstances.push(this);
    }
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = { fontSize: 13 };
    buffer = { active: { viewportY: 0, baseY: 0, cursorY: 0, getLine: () => undefined, getNullCell: () => ({}) } };
    element = document.createElement('div');
    parser = { registerOscHandler: () => {} };
    loadAddon() {}
    open() {}
    write = writeMock;
    dispose() {}
    reset() {}
    focus() {}
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
    getSelection() { return ''; }
    onData(h: (d: string) => void) {
      onDataHandlers.push(h);
      return { dispose() {} };
    }
    onSelectionChange() {
      return { dispose() {} };
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 80, rows: 24 }; } } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@features/ssh/services/hostTrust', () => ({ prepareSshHost: vi.fn().mockResolvedValue({ known: true, fingerprint: 'SHA256:test', keyType: 'ed25519' }) }));

invokeMock.mockResolvedValue('sess-x');
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@platform/pty', () => ({
  ptySpawn: vi.fn((_cols: number, _rows: number) => Promise.resolve('sess-x')),
  ptyWrite: vi.fn(() => Promise.resolve()),
  ptyResize: vi.fn(() => Promise.resolve()),
  ptyClose: vi.fn(() => Promise.resolve()),
  onPtyOutput: vi.fn((cb: (id: string, events: unknown[]) => void) => {
    ptyOutputHandlers.push(cb);
    return new Promise<() => void>((resolve) => {
      outputResolvers.push(resolve);
    });
  }),
  onPtyExit: vi.fn((cb: (id: string, code?: number | null) => void) => {
    ptyExitHandlers.push(cb);
    return new Promise<() => void>((resolve) => {
      exitResolvers.push(resolve);
    });
  }),
}));

// jsdom 无 ResizeObserver
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { useTerminalSession } from '@features/terminal/hooks/useTerminalSession';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { leaf } from '@features/workspace/model/windowLayout';
import { useTypographyStore } from '@config/typography';
import { onPtyOutput as mockedOnPtyOutput, ptySpawn as mockedPtySpawn, ptyWrite, ptyClose } from '@platform/pty';
import { prepareSshHost } from '@features/ssh/services/hostTrust';

/** 设置一个本地终端 tab，指定打开模式（classic / block） */
function setTab(openMode: 'classic' | 'block') {
  useWorkspaceStore.setState({
    tabs: [{ id: 't1', title: 't', kind: 'session', layout: leaf({ id: 't1', kind: 'local', openMode }) }],
    activeId: 't1',
  });
}

/** Configure an SSH tab with optional automatic reconnect. */
function setSshTab(autoReconnect: boolean) {
  useWorkspaceStore.setState({
    tabs: [{ id: 't1', title: 'ssh', kind: 'session', layout: leaf({ id: 't1', kind: 'ssh', openMode: 'classic', ssh: { name: 'server', host: 'server', autoReconnect } }) }],
    activeId: 't1',
  });
}

function TestHarness({ tabId, onReady }: { tabId: string; onReady: (sessionId: string) => void }) {
  const { ref, closeSession, reconnect, sshAuthenticated, sshLog } = useTerminalSession(tabId, tabId, onReady);
  return <><div ref={ref} data-testid="term-host" /><output data-testid="ssh-auth-state">{sshAuthenticated ? 'authenticated' : 'unconfirmed'}</output><output data-testid="ssh-log">{sshLog.map(entry => entry.text).join(' | ')}</output><button onClick={() => void closeSession()}>关闭连接</button><button onClick={() => void reconnect()}>重连</button></>;
}

describe('useTerminalSession', () => {
  beforeEach(() => {
    terminalInitOptions.length = 0;
    terminalInstances.length = 0;
    vi.mocked(mockedPtySpawn).mockClear();
    vi.mocked(ptyClose).mockClear();
    vi.mocked(ptyWrite).mockClear();
    vi.mocked(prepareSshHost).mockClear();
    writeMock.mockClear();
    invokeMock.mockClear();
    onDataHandlers.length = 0;
    ptyOutputHandlers.length = 0;
    ptyExitHandlers.length = 0;
    outputResolvers.length = 0;
    exitResolvers.length = 0;
    useTerminalStore.setState({
      sessions: {},
      startupStates: {},
      pendingCommands: {},
      dims: {},
      scenes: {},
      altScreenActive: false,
      keyboardTarget: 'input',
    });
    useBlockStore.setState({ byTab: {} });
    setTab('block');
  });

  it('configures a 10px native scrollbar so fitting uses the same width', () => {
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    expect(terminalInitOptions[0]?.overviewRuler).toEqual({ width: 10, showTopBorder: false, showBottomBorder: false });
  });

  it('re-applies the settled font options so a late-loaded face re-measures the terminal grid', async () => {
    let resolveReady!: () => void;
    Object.defineProperty(document, 'fonts', { value: { ready: new Promise<void>(resolve => { resolveReady = resolve; }) }, configurable: true });
    try {
      render(<TestHarness tabId="t1" onReady={() => {}} />);
      const term = terminalInstances[terminalInstances.length - 1]!;
      // The terminal was created with pre-load options, as a fallback face measured at creation.
      expect(term.options.fontSize).toBe(13);
      await act(async () => { resolveReady(); await Promise.resolve(); });
      expect(term.options.fontSize).toBe(useTypographyStore.getState().terminalFontSize);
      expect(term.options.letterSpacing).toBeTypeOf('number');
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('keeps the shared block cursor for SSH sessions', () => {
    setSshTab(false);
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    // An SSH session renders through the same terminal setup, so the cursor stays the
    // default blinking block instead of switching to a thin insertion bar.
    expect(terminalInitOptions[terminalInitOptions.length - 1]?.cursorStyle).toBeUndefined();
    expect(terminalInstances[terminalInstances.length - 1]?.options.cursorStyle).toBeUndefined();
  });

  it('confirms SSH authentication only after a remote prompt marker and resets on reconnect', async () => {
    setSshTab(false);
    const view = render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    expect(view.getByTestId('ssh-auth-state')).toHaveTextContent('unconfirmed');
    vi.useFakeTimers();
    try {
      await act(async () => {
        ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'Password:' }]);
        await vi.advanceTimersByTimeAsync(2600);
      });
      expect(useTerminalStore.getState().startupStates.t1).toBe('ready');
      expect(view.getByTestId('ssh-auth-state')).toHaveTextContent('unconfirmed');
      await act(async () => { ptyOutputHandlers[0]!('sess-x', [{ kind: 'osc', code: '133;B', payload: '', raw: '\x1b]133;B\x07' }]); });
      expect(view.getByTestId('ssh-auth-state')).toHaveTextContent('authenticated');
      await act(async () => { fireEvent.click(view.getByText('重连')); });
      expect(view.getByTestId('ssh-auth-state')).toHaveTextContent('unconfirmed');
    } finally { vi.useRealTimers(); }
  });

  it('logs real client output, shell readiness and the exit code', async () => {
    setSshTab(false);
    const view = render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    const log = () => view.getByTestId('ssh-log').textContent ?? '';
    await act(async () => { ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'private-shell-output-before-any-marker\r\n' }]); });
    expect(log()).not.toContain('private-shell-output-before-any-marker');
    await act(async () => { ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: '\x1b[31mWarning: Permanently added server to the list of known hosts.\x1b[0m\r\n' }]); });
    expect(log()).toContain('Warning: Permanently added server');
    await act(async () => { ptyOutputHandlers[0]!('sess-x', [{ kind: 'osc', code: '133;B', payload: '', raw: '\x1b]133;B\x07' }]); });
    expect(log()).toContain('远端 Shell 就绪');
    await act(async () => { ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'deploy@server$ ls\r\n' }]); });
    expect(log()).not.toContain('deploy@server$ ls');
    await act(async () => { ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'Connection to server closed.\r\n' }]); });
    expect(log()).toContain('Connection to server closed.');
    await act(async () => { ptyExitHandlers[0]!('sess-x', 0); });
    expect(log()).toContain('连接结束（退出码 0）');
  });

  it('keeps startup pending until the shell emits its prompt-end marker', async () => {
    render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));

    ptyOutputHandlers[0]!('sess-x', [
      { kind: 'osc', code: '133;A', payload: '', raw: '\x1b]133;A\x07' },
      { kind: 'data', text: '~/project $ ' },
    ]);
    expect(useTerminalStore.getState().startupStates.t1).toBe('starting');

    ptyOutputHandlers[0]!('sess-x', [{ kind: 'osc', code: '133;B', payload: '', raw: '\x1b]133;B\x07' }]);
    await waitFor(() => expect(useTerminalStore.getState().startupStates.t1).toBe('ready'));
  });

  it('marks input ready after quiet output even without a ready marker', async () => {
    vi.useFakeTimers();
    try {
      render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
      await vi.advanceTimersByTimeAsync(1);
      expect(useTerminalStore.getState().sessions.t1).toBe('sess-x');

      ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'PS C:\\Users\\e2e> ' }]);
      expect(useTerminalStore.getState().startupStates.t1).toBe('starting');

      await vi.advanceTimersByTimeAsync(2400);
      expect(useTerminalStore.getState().startupStates.t1).toBe('starting');
      await vi.advanceTimersByTimeAsync(200);
      expect(useTerminalStore.getState().startupStates.t1).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores legacy CMD block sessions into an interactive classic scene', async () => {
    useWorkspaceStore.setState({ tabs: [{ id: 't1', title: 'CMD', kind: 'session', layout: leaf({ id: 't1', kind: 'local', shellType: 'cmd', openMode: 'block' }) }] });
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(mockedPtySpawn).toHaveBeenCalled());
    expect(vi.mocked(mockedPtySpawn).mock.calls[0]?.[3]).toMatchObject({ shell: 'cmd', openMode: 'classic' });
    expect(useTerminalStore.getState().scenes.t1).toBe('classic');
    ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'CMD command output' }]);
    expect(writeMock).toHaveBeenCalledWith('CMD command output', expect.any(Function));
  });

  it('hands the surface back when a real alternate screen starts under a manual fullscreen', async () => {
    render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    // The user fullscreened the running block terminal; the foreground program then switches to
    // the alternate buffer, whose live screen is drawn by the main xterm.
    useTerminalStore.getState().setScene('t1', 'altScreen');
    useTerminalStore.getState().setAltScreenActive(true);

    ptyOutputHandlers[0]!('sess-x', [{ kind: 'altEnter', raw: '\x1b[?1049h' }]);

    expect(useTerminalStore.getState().scenes.t1).toBe('altScreen');
    expect(useTerminalStore.getState().altScreenActive).toBe(false);
  });

  it('keeps SSH block authentication interactive until the remote prompt arrives', async () => {
    useWorkspaceStore.setState({ tabs: [{ id: 't1', title: 'ssh', kind: 'session', layout: leaf({ id: 't1', kind: 'ssh', openMode: 'block', ssh: { name: 'server', host: 'server', user: 'user' } }) }], activeId: 't1' });
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(mockedPtySpawn).toHaveBeenCalled());
    expect(prepareSshHost).toHaveBeenCalledWith('server', undefined, expect.any(AbortSignal));
    expect(mockedPtySpawn).toHaveBeenCalledWith(80, 24, undefined, expect.objectContaining({ ssh: expect.objectContaining({ hostKeyType: 'ed25519' }), openMode: 'block' }));
    expect(useTerminalStore.getState().scenes.t1).toBe('classic');
    ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'Password: ' }]);
    expect(writeMock).toHaveBeenCalledWith('Password: ', expect.any(Function));
    onDataHandlers[0]!('response\r');
    expect(ptyWrite).toHaveBeenCalledWith('sess-x', 'response\r');
    ptyOutputHandlers[0]!('sess-x', [{ kind: 'osc', code: '133;A', payload: '', raw: '\x1b]133;A\x07' }]);
    await waitFor(() => expect(useTerminalStore.getState().scenes.t1).toBe('blockList'));
  });

  it('keeps a working ssh available when the fingerprint preflight cannot run', async () => {
    // 老服务器可能与预检库协商失败：此时改由 ssh 自己校验，不能因此连不上。
    vi.mocked(prepareSshHost).mockRejectedValueOnce(new Error('SSH 握手失败：[Session(-5)] Unable to exchange encryption keys'));
    useWorkspaceStore.setState({ tabs: [{ id: 't1', title: 'ssh', kind: 'session', layout: leaf({ id: 't1', kind: 'ssh', openMode: 'block', ssh: { name: 'server', host: 'server', user: 'user' } }) }], activeId: 't1' });
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(mockedPtySpawn).toHaveBeenCalled());
    expect(mockedPtySpawn).toHaveBeenCalledWith(80, 24, undefined, expect.objectContaining({
      ssh: expect.objectContaining({ hostKeyPolicy: 'ask' }),
    }));
    expect(vi.mocked(mockedPtySpawn).mock.calls[0]?.[3]).not.toHaveProperty('ssh.hostKeyType');
  });

  it('stops before spawning when the recorded host key changed', async () => {
    vi.mocked(prepareSshHost).mockRejectedValueOnce(new Error('主机密钥不匹配（可能存在中间人攻击）：server'));
    useWorkspaceStore.setState({ tabs: [{ id: 't1', title: 'ssh', kind: 'session', layout: leaf({ id: 't1', kind: 'ssh', openMode: 'block', ssh: { name: 'server', host: 'server', user: 'user' } }) }], activeId: 't1' });
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(writeMock).toHaveBeenCalledWith(expect.stringContaining('SSH 连接失败'), expect.any(Function)));
    expect(mockedPtySpawn).not.toHaveBeenCalled();
  });

  it('classic 模式：数据直进主 xterm，不建块', async () => {
    setTab('classic');
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(ptyOutputHandlers.length).toBe(1));

    ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'hello' }]);
    await waitFor(() => expect(writeMock).toHaveBeenCalledWith('hello', expect.any(Function)));
  });

  it('closes the PTY and ignores output and keyboard input after cancellation', async () => {
    const { getByText } = render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    fireEvent.click(getByText('关闭连接'));
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBeUndefined());
    expect(ptyClose).toHaveBeenCalledWith('sess-x');
    writeMock.mockClear();
    ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'late password prompt' }]);
    onDataHandlers[0]!('secret\r');
    expect(writeMock).not.toHaveBeenCalled();
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it('closes a late spawn without publishing a session after cancellation', async () => {
    let finish!: (id: string) => void;
    vi.mocked(mockedPtySpawn).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const onReady = vi.fn();
    const { getByText } = render(<TestHarness tabId="t1" onReady={onReady} />);
    await waitFor(() => expect(mockedPtySpawn).toHaveBeenCalled());
    fireEvent.click(getByText('关闭连接'));
    finish('late-session');
    await waitFor(() => expect(ptyClose).toHaveBeenCalledWith('late-session'));
    expect(onReady).not.toHaveBeenCalled();
  });

  it('removes the session mapping when its process exits', async () => {
    render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    ptyExitHandlers[0]!('sess-x');
    expect(useTerminalStore.getState().sessions.t1).toBeUndefined();
  });

  it('reopens an interrupted SSH session automatically and leaves a clean exit alone', async () => {
    setSshTab(true);
    render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    expect(mockedPtySpawn).toHaveBeenCalledTimes(1);

    // A drop (the client exits non-zero) reopens the session after the first backoff step.
    ptyExitHandlers[0]!('sess-x', 255);
    await waitFor(() => expect(mockedPtySpawn).toHaveBeenCalledTimes(2), { timeout: 4000 });

    // A clean exit (the remote shell ended on purpose) leaves the session closed.
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    await act(async () => { ptyExitHandlers[1]!('sess-x', 0); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1500)); });
    expect(mockedPtySpawn).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending automatic retry when the user disconnects', async () => {
    setSshTab(true);
    const { getByText } = render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    await act(async () => { ptyExitHandlers[0]!('sess-x', 255); });
    fireEvent.click(getByText('关闭连接'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1500)); });
    expect(mockedPtySpawn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a remote command that exits with a nonzero status', async () => {
    setSshTab(true);
    render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    await act(async () => { ptyExitHandlers[0]!('sess-x', 1); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1500)); });
    expect(mockedPtySpawn).toHaveBeenCalledTimes(1);
  });

  it('keeps the retry budget bounded across quiet authentication prompts and renews it on manual retry', async () => {
    setSshTab(true);
    const { getByText } = render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));
    vi.useFakeTimers();
    try {
      for (let retry = 0; retry < 6; retry += 1) {
        await act(async () => {
          ptyOutputHandlers[ptyOutputHandlers.length - 1]!('sess-x', [{ kind: 'data', text: 'Password:' }]);
          await vi.advanceTimersByTimeAsync(2600);
        });
        await act(async () => {
          ptyExitHandlers[ptyExitHandlers.length - 1]!('sess-x', 255);
          await vi.advanceTimersByTimeAsync(16000);
        });
        expect(mockedPtySpawn).toHaveBeenCalledTimes(1 + Math.min(retry + 1, 5));
      }
      await act(async () => { fireEvent.click(getByText('重连')); });
      expect(mockedPtySpawn).toHaveBeenCalledTimes(7);
      await act(async () => {
        ptyExitHandlers[ptyExitHandlers.length - 1]!('sess-x', 255);
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mockedPtySpawn).toHaveBeenCalledTimes(8);
      await act(async () => {
        ptyOutputHandlers[ptyOutputHandlers.length - 1]!('sess-x', [{ kind: 'data', text: 'Password:' }]);
        await vi.advanceTimersByTimeAsync(2600);
        ptyOutputHandlers[ptyOutputHandlers.length - 1]!('sess-x', [{ kind: 'osc', code: '133;B', payload: '', raw: '\x1b]133;B\x07' }]);
        await vi.advanceTimersByTimeAsync(200);
        ptyExitHandlers[ptyExitHandlers.length - 1]!('sess-x', 255);
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mockedPtySpawn).toHaveBeenCalledTimes(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preflights a profile with an explicitly disabled jump host', async () => {
    useWorkspaceStore.setState({
      tabs: [{ id: 't1', title: 'ssh', kind: 'session', layout: leaf({ id: 't1', kind: 'ssh', openMode: 'classic', ssh: { name: 'direct', host: 'direct', jumpHost: 'none' } }) }], activeId: 't1',
    });
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(mockedPtySpawn).toHaveBeenCalled());
    expect(prepareSshHost).toHaveBeenCalledWith('direct', undefined, expect.any(AbortSignal));
  });

  it('does not reopen an interrupted session when the connection has no automatic reconnect', async () => {
    setSshTab(false);
    render(<TestHarness tabId="t1" onReady={id => useTerminalStore.getState().setSession('t1', id)} />);
    await waitFor(() => expect(useTerminalStore.getState().sessions.t1).toBe('sess-x'));

    await act(async () => { ptyExitHandlers[0]!('sess-x', 255); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1500)); });
    expect(mockedPtySpawn).toHaveBeenCalledTimes(1);
  });

  it('block 模式：初始即 blockList，OSC 133;A 建立 block', async () => {
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(ptyOutputHandlers.length).toBe(1));

    // 初始场景已为 blockList（打开模式 block）
    expect(useTerminalStore.getState().scenes['t1']).toBe('blockList');

    ptyOutputHandlers[0]!('sess-x', [{ kind: 'osc', code: '133;A', payload: '', raw: '\x1b]133;A\x07' }]);
    await waitFor(() => expect(useBlockStore.getState().byTab['t1']?.length).toBe(1));
  });

  it('block 模式：block 结构变化同步到 blockStore', async () => {
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(ptyOutputHandlers.length).toBe(1));

    ptyOutputHandlers[0]!('sess-x', [{ kind: 'osc', code: '133;A', payload: '', raw: '\x1b]133;A\x07' }]);
    await waitFor(() => expect(useBlockStore.getState().byTab['t1']?.length).toBe(1));
  });

  it('onPtyOutput 在 ptySpawn 之前注册，防止 spawn 瞬间 OSC 标记丢失', async () => {
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(mockedOnPtyOutput).toHaveBeenCalled());

    const outputOrder = vi.mocked(mockedOnPtyOutput).mock.invocationCallOrder[0] ?? Infinity;
    const spawnOrder = vi.mocked(mockedPtySpawn).mock.invocationCallOrder[0] ?? Infinity;
    expect(outputOrder).toBeLessThan(spawnOrder);
  });

  it('提前卸载后迟到的 listener 解析不会写入已销毁终端', async () => {
    const { unmount } = render(<TestHarness tabId="t1" onReady={() => {}} />);
    unmount();

    // 模拟 listener 承诺在清理之后才解析
    outputResolvers.forEach((resolve) => resolve(() => {}));
    exitResolvers.forEach((resolve) => resolve(() => {}));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 触发迟到的输出事件：不应再写入已 dispose 的 term
    ptyOutputHandlers.forEach((h) => h('sess-x', [{ kind: 'data', text: 'late' }]));
    expect(writeMock).not.toHaveBeenCalled();
  });
});
