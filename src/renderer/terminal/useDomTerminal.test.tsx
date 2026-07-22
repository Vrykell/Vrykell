import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('types into PTY and renders echoed output', async () => {
    render(<TestApp sessionId="s1" />);
    const view = screen.getByTestId('terminal-view');
    await userEvent.type(view, 'hi');
    expect(backend.sessions).toHaveLength(0); // createSession not called; writeToPTY uses sid
    // wait for async invoke/write
    await waitFor(() => expect(view).toHaveTextContent('hi'));
  });

  it('filters output by sessionId', async () => {
    render(<TestApp sessionId="s1" />);
    const view = screen.getByTestId('terminal-view');

    backend.emit('pty:output', { sessionId: 's2', data: 'wrong' });
    backend.emit('pty:output', { sessionId: 's1', data: 'right' });

    await waitFor(() => expect(view).toHaveTextContent('right'));
    expect(view).not.toHaveTextContent('wrong');
  });

  it('resubscribes when sessionId changes', async () => {
    const { rerender } = render(<TestApp sessionId="s1" />);
    const view = screen.getByTestId('terminal-view');

    backend.emit('pty:output', { sessionId: 's1', data: 'first' });
    await waitFor(() => expect(view).toHaveTextContent('first'));

    rerender(<TestApp sessionId="s2" />);
    backend.emit('pty:output', { sessionId: 's1', data: 'old' });
    backend.emit('pty:output', { sessionId: 's2', data: 'new' });

    await waitFor(() => expect(view).toHaveTextContent('new'));
    expect(view).not.toHaveTextContent('old');
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
