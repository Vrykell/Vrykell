import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeTauriBackend } from '../../test/fake-tauri';
import { TerminalView } from '../components/terminal/TerminalView';

vi.mock('@tauri-apps/api/core');
vi.mock('@tauri-apps/api/event');

describe('useDomTerminal integration', () => {
  let backend: FakeTauriBackend;

  beforeEach(() => {
    backend = new FakeTauriBackend();
    backend.install();
  });

  function TestApp({ sessionId }: { sessionId: string }) {
    return <TerminalView sessionId={sessionId} />;
  }

  it('types ASCII into PTY via onInput and renders echoed output', async () => {
    render(<TestApp sessionId="s1" />);
    const textarea = screen.getByTestId('terminal-textarea');
    const view = screen.getByTestId('terminal-view');
    await userEvent.type(textarea, 'hi');
    await waitFor(() => expect(view).toHaveTextContent('hi'));
  });

  it('sends Enter as CR through onKeyDown', async () => {
    render(<TestApp sessionId="s1" />);
    const textarea = screen.getByTestId('terminal-textarea');
    const view = screen.getByTestId('terminal-view');
    // Type characters (via onInput) then Enter (via onKeyDown)
    await userEvent.type(textarea, 'abc{Enter}');
    await waitFor(() => expect(view).toHaveTextContent('abc'));
  });

  it('sends Backspace through onKeyDown', async () => {
    // Track what was written to PTY to verify Backspace is \x7f
    let lastWrite = '';
    backend.customInvoke = async (cmd, args) => {
      if (cmd === 'write_pty') {
        lastWrite = (args as any).data as string;
        backend.write(args!.sessionId as string, args!.data as string);
      }
    };
    render(<TestApp sessionId="s1" />);
    const textarea = screen.getByTestId('terminal-textarea');
    await userEvent.type(textarea, 'x{Backspace}');
    // The Backspace should have been the last thing sent
    expect(lastWrite).toBe('\x7f');
  });

  it('ignores printable keys during IME composition', async () => {
    let writeCalls: string[] = [];
    backend.customInvoke = async (cmd, args) => {
      if (cmd === 'write_pty') writeCalls.push((args as any).data as string);
    };
    render(<TestApp sessionId="s1" />);
    const textarea = screen.getByTestId('terminal-textarea');

    // Start IME composition
    fireEvent.compositionStart(textarea);
    // Type pinyin — these should NOT reach PTY
    await userEvent.type(textarea, 'ni');
    // End composition — the browser would fire input with the committed text
    fireEvent.compositionEnd(textarea);
    // Simulate the browser committing the composed character
    fireEvent.input(textarea, { target: { value: '\u{4f60}' } }); // 你

    // 'ni' during composition must NOT appear in writeCalls
    expect(writeCalls.filter(c => c === 'n' || c === 'i')).toEqual([]);
  });

  it('filters output by sessionId', async () => {
    render(<TestApp sessionId="s1" />);
    const view = screen.getByTestId('terminal-view');

    backend.emit('pty:output', { sessionId: 's2', events: [{ t: 'txt', p: 'wrong' }] });
    backend.emit('pty:output', { sessionId: 's1', events: [{ t: 'txt', p: 'right' }] });

    await waitFor(() => expect(view).toHaveTextContent('right'));
    expect(view).not.toHaveTextContent('wrong');
  });

  it('resubscribes when sessionId changes', async () => {
    const { rerender } = render(<TestApp sessionId="s1" />);
    const view = screen.getByTestId('terminal-view');

    backend.emit('pty:output', { sessionId: 's1', events: [{ t: 'txt', p: 'first' }] });
    await waitFor(() => expect(view).toHaveTextContent('first'));

    rerender(<TestApp sessionId="s2" />);
    backend.emit('pty:output', { sessionId: 's1', events: [{ t: 'txt', p: 'old' }] });
    backend.emit('pty:output', { sessionId: 's2', events: [{ t: 'txt', p: 'new' }] });

    await waitFor(() => expect(view).toHaveTextContent('new'));
    expect(view).not.toHaveTextContent('old');
  });

  it('applies each output batch at its tagged dimensions (resize race fix)', async () => {
    // Unique session id → fresh buffer (the module-level buffer cache
    // persists across tests in this file).
    render(<TestApp sessionId="s-tags" />);

    // Batch tagged cols=40: 40 chars must fit on ONE line — even though a
    // narrower resize may already have happened on the window side.
    // (cr+lf moves to a fresh line so the next batch's cx clamp can't
    // overwrite this line's tail — mirroring how a TUI repaints on SIGWINCH.)
    backend.emit('pty:output', {
      sessionId: 's-tags',
      events: [{ t: 'txt', p: 'x'.repeat(40) }, { t: 'cr' }, { t: 'lf' }],
      cols: 40,
      rows: 24,
    });
    // Batch tagged cols=20: the next 40 chars wrap to TWO 20-char lines.
    backend.emit('pty:output', {
      sessionId: 's-tags',
      events: [{ t: 'txt', p: 'y'.repeat(40) }],
      cols: 20,
      rows: 24,
    });

    await waitFor(() => {
      const texts = screen
        .getAllByTestId('terminal-line')
        .map((l) => l.textContent || '')
        .filter((t) => t.includes('x') || t.includes('y'));
      expect(texts).toEqual(['x'.repeat(40), 'y'.repeat(20), 'y'.repeat(20)]);
    });
  });

  it('renders exit message for matching session', async () => {
    render(<TestApp sessionId="s1" />);
    const view = screen.getByTestId('terminal-view');
    backend.emit('pty:exit', { sessionId: 's2', exitCode: 1 });
    backend.emit('pty:exit', { sessionId: 's1', exitCode: 42 });
    await waitFor(() => expect(view).toHaveTextContent('[exit 42]'));
    expect(view).not.toHaveTextContent('[exit 1]');
  });
});
