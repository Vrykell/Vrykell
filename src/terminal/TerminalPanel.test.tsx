import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const { writeMock, onDataHandlers, invokeMock } = vi.hoisted(() => ({
  writeMock: vi.fn(),
  onDataHandlers: [] as Array<(d: string) => void>,
  invokeMock: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24;
    loadAddon() {}
    open() {}
    write = writeMock;
    dispose() {}
    onData(h: (d: string) => void) { onDataHandlers.push(h); return { dispose() {} }; }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

invokeMock.mockResolvedValue('sess-x');
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// jsdom 无 ResizeObserver
globalThis.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
} as unknown as typeof ResizeObserver;

import TerminalPanel from './TerminalPanel';

describe('TerminalPanel', () => {
  beforeEach(() => { invokeMock.mockClear(); writeMock.mockClear(); onDataHandlers.length = 0; });

  it('挂载后 spawn PTY 并上报 session id', async () => {
    const onReady = vi.fn();
    render(<TerminalPanel onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith('sess-x'));
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', expect.objectContaining({ cols: 80, rows: 24 }));
  });

  it('xterm 输入转发到 pty_write', async () => {
    render(<TerminalPanel onReady={() => {}} />);
    await waitFor(() => expect(onDataHandlers.length).toBe(1));
    onDataHandlers[0]!('ls\n');
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 'sess-x', data: 'ls\n' });
  });
});
