import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const writeTextMock = vi.hoisted(() => vi.fn());
const readTextMock = vi.hoisted(() => vi.fn());
const ptyWriteMock = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => [] as Array<{ message: string; kind: string }>);

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: writeTextMock,
  readClipboardText: readTextMock,
}));
vi.mock('@platform/pty', () => ({ ptyWrite: ptyWriteMock }));
vi.mock('@ui/Toast', () => ({
  useToastStore: {
    getState: () => ({
      addToast: (message: string, kind: string) => toasts.push({ message, kind }),
    }),
  },
}));

import { copyTerminalSelection, pasteClipboardIntoTerminal } from '@features/terminal/services/terminalClipboard';
import { useTerminalStore } from '@features/terminal/stores/terminal';

function fakeTerm(selection: string): Terminal {
  return { getSelection: () => selection } as unknown as Terminal;
}

describe('terminalClipboard', () => {
  beforeEach(() => {
    writeTextMock.mockReset().mockResolvedValue(undefined);
    readTextMock.mockReset().mockResolvedValue('');
    ptyWriteMock.mockReset().mockResolvedValue(undefined);
    toasts.length = 0;
    useTerminalStore.setState({ sessions: {} });
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
  });

  it('copies the xterm selection to the clipboard', async () => {
    await expect(copyTerminalSelection(fakeTerm('hello world'))).resolves.toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('hello world');
  });

  it('falls back to the DOM selection when the terminal has none', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'dom text' } as unknown as Selection);
    await expect(copyTerminalSelection(fakeTerm(''))).resolves.toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('dom text');
  });

  it('reports an empty selection instead of writing an empty clipboard', async () => {
    await expect(copyTerminalSelection(fakeTerm(''))).resolves.toBe(false);
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(toasts[toasts.length - 1]).toEqual({ message: '没有选中内容', kind: 'info' });
  });

  it('surfaces a clipboard failure', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('denied'));
    await expect(copyTerminalSelection(fakeTerm('x'))).resolves.toBe(false);
    expect(toasts[toasts.length - 1]).toEqual({ message: '复制失败', kind: 'error' });
  });

  it('writes the clipboard text into the pane PTY', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    readTextMock.mockResolvedValue('echo pasted\n');
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(ptyWriteMock).toHaveBeenCalledWith('sess-1', 'echo pasted\n');
  });

  it('refuses to paste before the terminal has a session', async () => {
    await expect(pasteClipboardIntoTerminal('missing')).resolves.toBe(false);
    expect(ptyWriteMock).not.toHaveBeenCalled();
    expect(toasts[toasts.length - 1]).toEqual({ message: '终端尚未连接，无法粘贴', kind: 'error' });
  });

  it('does nothing when the clipboard is empty', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    readTextMock.mockResolvedValue('');
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(false);
    expect(ptyWriteMock).not.toHaveBeenCalled();
  });
});
