import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const {
  writeMock,
  onDataHandlers,
  invokeMock,
  ptyOutputHandlers,
  ptyExitHandlers,
  outputResolvers,
  exitResolvers,
} = vi.hoisted(() => ({
  writeMock: vi.fn(),
  onDataHandlers: [] as Array<(d: string) => void>,
  invokeMock: vi.fn(),
  ptyOutputHandlers: [] as Array<(id: string, events: unknown[]) => void>,
  ptyExitHandlers: [] as Array<(id: string) => void>,
  outputResolvers: [] as Array<(u: () => void) => void>,
  exitResolvers: [] as Array<(u: () => void) => void>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = { fontSize: 13 };
    buffer = { active: { viewportY: 0, baseY: 0, cursorY: 0 } };
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
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

invokeMock.mockResolvedValue('sess-x');
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../lib/pty', () => ({
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
  onPtyExit: vi.fn((cb: (id: string) => void) => {
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

import { useTerminalSession } from '../useTerminalSession';
import { useTerminalStore } from '../../stores/terminal';
import { useBlockStore } from '../../stores/blocks';
import { useWorkspaceStore } from '../../stores/workspace';
import { leaf } from '../../lib/windowLayout';
import { onPtyOutput as mockedOnPtyOutput, ptySpawn as mockedPtySpawn } from '../../lib/pty';

/** 设置一个本地终端 tab，指定打开模式（classic / block） */
function setTab(openMode: 'classic' | 'block') {
  useWorkspaceStore.setState({
    tabs: [{ id: 't1', title: 't', kind: 'session', layout: leaf({ id: 't1', kind: 'local', openMode }) }],
    activeId: 't1',
  });
}

function TestHarness({ tabId, onReady }: { tabId: string; onReady: (sessionId: string) => void }) {
  const ref = useTerminalSession(tabId, tabId, onReady);
  return <div ref={ref} data-testid="term-host" />;
}

describe('useTerminalSession', () => {
  beforeEach(() => {
    writeMock.mockClear();
    invokeMock.mockClear();
    onDataHandlers.length = 0;
    ptyOutputHandlers.length = 0;
    ptyExitHandlers.length = 0;
    outputResolvers.length = 0;
    exitResolvers.length = 0;
    useTerminalStore.setState({
      sessions: {},
      dims: {},
      scenes: {},
      altScreenActive: false,
      keyboardTarget: 'input',
    });
    useBlockStore.setState({ byTab: {} });
    setTab('block');
  });

  it('classic 模式：数据直进主 xterm，不建块', async () => {
    setTab('classic');
    render(<TestHarness tabId="t1" onReady={() => {}} />);
    await waitFor(() => expect(ptyOutputHandlers.length).toBe(1));

    ptyOutputHandlers[0]!('sess-x', [{ kind: 'data', text: 'hello' }]);
    await waitFor(() => expect(writeMock).toHaveBeenCalledWith('hello'));
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
