import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const writeTextMock = vi.hoisted(() => vi.fn());
const readTextMock = vi.hoisted(() => vi.fn());
const ptyWriteMock = vi.hoisted(() => vi.fn());
const hasImageMock = vi.hoisted(() => vi.fn());
const requestConfirmMock = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => [] as Array<{ message: string; kind: string }>);

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: writeTextMock,
  readClipboardText: readTextMock,
  hasClipboardImage: hasImageMock,
}));
vi.mock('@platform/pty', () => ({ ptyWrite: ptyWriteMock }));
vi.mock('@features/terminal/stores/pasteConfirm', () => ({ requestPasteConfirm: requestConfirmMock }));
vi.mock('@ui/Toast', () => ({
  useToastStore: {
    getState: () => ({
      addToast: (message: string, kind: string) => toasts.push({ message, kind }),
    }),
  },
}));

import {
  copyTerminalSelection,
  pasteClipboardIntoTerminal,
  pasteConfirmReason,
  pasteLineCount,
  pasteTextIntoTerminal,
  captureTerminalPaste,
} from '@features/terminal/services/terminalClipboard';
import { termInstances, useTerminalStore } from '@features/terminal/stores/terminal';
import { useInputStore } from '@features/terminal/stores/input';
import { useBlockStore } from '@features/terminal/stores/blocks';

function fakeTerm(selection: string): Terminal {
  return { getSelection: () => selection } as unknown as Terminal;
}

function pasteAwareTerm(bracketedPaste = false): { term: Terminal; paste: ReturnType<typeof vi.fn> } {
  const paste = vi.fn();
  return { term: { paste, modes: { bracketedPasteMode: bracketedPaste } } as unknown as Terminal, paste };
}

/** A representative seven-line paste, including its trailing newline. */
const LONG_PASTE = 'one\ntwo\nthree\nfour\nfive\nsix\n';

describe('terminalClipboard', () => {
  beforeEach(() => {
    writeTextMock.mockReset().mockResolvedValue(undefined);
    readTextMock.mockReset().mockResolvedValue('');
    ptyWriteMock.mockReset().mockResolvedValue(undefined);
    hasImageMock.mockReset().mockResolvedValue(false);
    requestConfirmMock.mockReset().mockResolvedValue(true);
    toasts.length = 0;
    useTerminalStore.setState({ sessions: {}, scenes: {}, manualFullscreen: {} });
    termInstances.clear();
    useInputStore.setState({ byPane: {} });
    useBlockStore.setState({ byTab: {} });
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
    expect(requestConfirmMock).toHaveBeenCalledWith({ reason: 'lines', lines: 3, chars: 18 });
  });

  it('uses the running block terminal for paste modes and the main terminal only for a real alternate buffer', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' }, scenes: { p1: 'blockList' }, manualFullscreen: {} });
    const main = pasteAwareTerm();
    const block = pasteAwareTerm();
    termInstances.set('p1', main.term);
    termInstances.set('block:p1', block.term);
    readTextMock.mockResolvedValue('one line');
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(block.paste).toHaveBeenCalledWith('one line');
    expect(main.paste).not.toHaveBeenCalled();

    // A manual fullscreen keeps the running block as the interactive surface.
    useTerminalStore.setState({ scenes: { p1: 'altScreen' }, manualFullscreen: { p1: true } });
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(block.paste).toHaveBeenCalledTimes(2);
    expect(main.paste).not.toHaveBeenCalled();

    // Only a real alternate buffer hands the pane back to the main terminal.
    useTerminalStore.setState({ manualFullscreen: { other: true } });
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(main.paste).toHaveBeenCalledTimes(1);
  });

  it('falls back to a raw PTY write when no terminal instance is registered', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    readTextMock.mockResolvedValue('echo pasted\n');
    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(ptyWriteMock).toHaveBeenCalledWith('sess-1', 'echo pasted\n');
    expect(requestConfirmMock).toHaveBeenCalledWith({ reason: 'lines', lines: 2, chars: 12 });
  });

  it('asks before a multi-line paste when the program did not request bracketed paste', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    const { term, paste } = pasteAwareTerm(false);
    termInstances.set('p1', term);
    readTextMock.mockResolvedValue(LONG_PASTE);
    let answer: ((confirmed: boolean) => void) | undefined;
    requestConfirmMock.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve; }));

    const pasted = pasteClipboardIntoTerminal('p1');
    await vi.waitFor(() => expect(requestConfirmMock).toHaveBeenCalledWith({ reason: 'lines', lines: 7, chars: LONG_PASTE.length }));
    // Nothing reaches the PTY while the question is open.
    expect(paste).not.toHaveBeenCalled();

    answer!(true);
    await expect(pasted).resolves.toBe(true);
    expect(paste).toHaveBeenCalledWith(LONG_PASTE);
  });

  it('drops the paste when the confirmation is declined', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    const { term, paste } = pasteAwareTerm(false);
    termInstances.set('p1', term);
    readTextMock.mockResolvedValue(LONG_PASTE);
    requestConfirmMock.mockResolvedValue(false);

    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(false);
    expect(paste).not.toHaveBeenCalled();
    expect(ptyWriteMock).not.toHaveBeenCalled();
  });

  it('stages a short script at an idle block prompt and retains its trailing newline', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' }, scenes: { p1: 'blockList' } });
    await expect(pasteTextIntoTerminal('p1', 'echo one\r\necho two\r\n')).resolves.toBe(true);
    expect(useInputStore.getState().byPane.p1?.text).toBe('echo one\necho two\n');
    expect(ptyWriteMock).not.toHaveBeenCalled();
    expect(requestConfirmMock).not.toHaveBeenCalled();
  });

  it('drops a confirmed paste if the target session was replaced while the dialog was open', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    requestConfirmMock.mockImplementation(async () => {
      useTerminalStore.setState({ sessions: { p1: 'replacement' } });
      return true;
    });
    await expect(pasteTextIntoTerminal('p1', 'echo one\necho two')).resolves.toBe(false);
    expect(ptyWriteMock).not.toHaveBeenCalled();
  });

  it('captures native paste events before the default handler and removes the capture on cleanup', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    requestConfirmMock.mockResolvedValue(false);
    const element = document.createElement('div');
    const textarea = document.createElement('textarea');
    element.append(textarea);
    const native = vi.fn();
    textarea.addEventListener('paste', native);
    const cleanup = captureTerminalPaste({ element } as unknown as Terminal, 'p1');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => 'one\ntwo' } });
    textarea.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(native).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(requestConfirmMock).toHaveBeenCalled());
    expect(ptyWriteMock).not.toHaveBeenCalled();
    cleanup();
    textarea.dispatchEvent(new Event('paste', { bubbles: true }));
    expect(native).toHaveBeenCalledOnce();
  });

  it('pastes several lines without asking when the program enabled bracketed paste', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    const { term, paste } = pasteAwareTerm(true);
    termInstances.set('p1', term);
    readTextMock.mockResolvedValue(LONG_PASTE);

    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(paste).toHaveBeenCalledWith(LONG_PASTE);
    expect(requestConfirmMock).not.toHaveBeenCalled();
  });

  it('asks before a very large paste even with bracketed paste enabled', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    const { term, paste } = pasteAwareTerm(true);
    termInstances.set('p1', term);
    const large = 'x'.repeat(64 * 1024 + 1);
    readTextMock.mockResolvedValue(large);

    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(requestConfirmMock).toHaveBeenCalledWith({ reason: 'size', lines: 1, chars: large.length });
    expect(paste).toHaveBeenCalledWith(large);
  });

  it('does not confirm an image paste', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    hasImageMock.mockResolvedValue(true);

    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    expect(requestConfirmMock).not.toHaveBeenCalled();
  });

  it('writes the fallback PTY paste in chunks that reassemble to the payload', async () => {
    useTerminalStore.setState({ sessions: { p1: 'sess-1' } });
    const large = 'y'.repeat(16 * 1024 + 4);
    readTextMock.mockResolvedValue(large);

    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);
    // Below the confirmation size: the paste goes out in two chunks, in order.
    expect(requestConfirmMock).not.toHaveBeenCalled();
    const chunks = ptyWriteMock.mock.calls.map((call) => call[1] as string);
    expect(chunks.map((chunk) => chunk.length)).toEqual([16 * 1024, 4]);
    expect(chunks.join('')).toBe(large);
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

  it('sends the image key straight to the PTY so paste transforms cannot wrap it', async () => {
    // The real-app case: a block terminal is registered. term.paste() applies the pasted-text
    // transformations (bracketed-paste wrapping), so the key would arrive as text instead of the
    // native paste key — the image path must bypass the terminal and write the PTY directly.
    useTerminalStore.setState({ sessions: { p1: 'sess-1' }, scenes: { p1: 'blockList' } });
    const block = pasteAwareTerm();
    termInstances.set('block:p1', block.term);
    hasImageMock.mockResolvedValue(true);
    readTextMock.mockResolvedValue('alternative image text');

    await expect(pasteClipboardIntoTerminal('p1')).resolves.toBe(true);

    expect(ptyWriteMock).toHaveBeenCalledExactlyOnceWith('sess-1', '\x16');
    expect(block.paste).not.toHaveBeenCalled();
  });
});

describe('paste confirmation rules', () => {
  it('counts lines the way a text editor shows them', () => {
    expect(pasteLineCount('one line')).toBe(1);
    expect(pasteLineCount('one\ntwo\n')).toBe(3);
    expect(pasteLineCount('one\r\ntwo')).toBe(2);
  });

  it('asks for every embedded or trailing newline without bracketed paste', () => {
    expect(pasteConfirmReason('one', false)).toBeNull();
    expect(pasteConfirmReason('one\ntwo', false)).toBe('lines');
    expect(pasteConfirmReason('one\n', false)).toBe('lines');
    expect(pasteConfirmReason('one\rtwo', false)).toBe('lines');
    expect(pasteConfirmReason('one\ntwo\nthree\nfour', false)).toBe('lines');
    expect(pasteConfirmReason('one\ntwo\nthree\nfour\nfive\n', false)).toBe('lines');
    expect(pasteConfirmReason('one\ntwo\nthree\nfour\nfive\n', true)).toBeNull();
  });

  it('asks for a paste above 64K characters whoever receives it', () => {
    const belowLimit = 'x'.repeat(64 * 1024);
    expect(pasteConfirmReason(belowLimit, true)).toBeNull();
    expect(pasteConfirmReason(`${belowLimit}x`, true)).toBe('size');
    expect(pasteConfirmReason(`${belowLimit}x`, false)).toBe('size');
  });
});
