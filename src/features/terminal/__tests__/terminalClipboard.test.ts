import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const writeTextMock = vi.hoisted(() => vi.fn());
const readTextMock = vi.hoisted(() => vi.fn());
const ptyWriteMock = vi.hoisted(() => vi.fn());
const hasImageMock = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => [] as Array<{ message: string; kind: string }>);

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: writeTextMock,
  readClipboardText: readTextMock,
  hasClipboardImage: hasImageMock,
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
import { termInstances, useTerminalStore } from '@features/terminal/stores/terminal';

function fakeTerm(selection: string): Terminal {
  return { getSelection: () => selection } as unknown as Terminal;
}

function pasteAwareTerm(): { term: Terminal; paste: ReturnType<typeof vi.fn> } {
  const paste = vi.fn();
  return { term: { paste } as unknown as Terminal, paste };
}

describe('terminalClipboard', () => {
  beforeEach(() => {
    writeTextMock.mockReset().mockResolvedValue(undefined);
    readTextMock.mockReset().mockResolvedValue('');
    ptyWriteMock.mockReset().mockResolvedValue(undefined);
    hasImageMock.mockReset().mockResolvedValue(false);
    toasts.length = 0;
    useTerminalStore.setState({ sessions: {}, scenes: {} });
    termInstances.clear();
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

  it('routes the paste through the terminal so bracketed paste mode is honoured', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    const { term, paste } = pasteAwareTerm();
    termInstances.set('p1', term);
    readTextMock.mockResolvedValue('line one\nline two\n');
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(paste).toHaveBeenCalledWith('line one\nline two\n');
    expect(ptyWriteMock).not.toHaveBeenCalled();
  });

  it('uses the running block terminal for paste modes and the main terminal in alternate screen', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' }, scenes: { p1: 'blockList' } });
    const main = pasteAwareTerm();
    const block = pasteAwareTerm();
    termInstances.set('p1', main.term);
    termInstances.set('block:p1', block.term);
    readTextMock.mockResolvedValue('line one\nline two');
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(block.paste).toHaveBeenCalledWith('line one\nline two');
    expect(main.paste).not.toHaveBeenCalled();
    useTerminalStore.setState({ scenes: { p1: 'altScreen' } });
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(main.paste).toHaveBeenCalledWith('line one\nline two');
  });

  it('falls back to a raw PTY write when no terminal instance is registered', async () => {
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

  it('forwards the native image paste key instead of dropping images or pasting alternative text', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    hasImageMock.mockResolvedValue(true);
    readTextMock.mockResolvedValue('alternative image text');
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(ptyWriteMock).toHaveBeenCalledExactlyOnceWith('sess-1', '\x16');
    expect(readTextMock).not.toHaveBeenCalled();
  });
});
