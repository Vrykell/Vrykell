import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useTerminalStore } from './stores/terminal-store';
import { FakeTauriBackend } from '../test/fake-tauri';

vi.mock('@tauri-apps/api/core');
vi.mock('@tauri-apps/api/event');

const mockWindowDestroy = vi.fn(() => Promise.resolve());
const mockWindowClose = vi.fn(() => Promise.resolve());
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ destroy: mockWindowDestroy, close: mockWindowClose }),
}));

function renderApp() {
  return render(<App />);
}

describe('App session flow', () => {
  let backend: FakeTauriBackend;

  beforeEach(() => {
    useTerminalStore.setState(useTerminalStore.getInitialState(), true);
    backend = new FakeTauriBackend();
    backend.install();
    mockWindowClose.mockClear();
  });

  it('auto-creates first session on mount', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('terminal-tabs')).toBeInTheDocument());
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
  });

  it('creates new tab when clicking +', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    await userEvent.click(screen.getByTestId('new-tab-btn'));
    await waitFor(() => expect(backend.sessions).toHaveLength(2));
  });

  it('updates tab title on pty:title-change', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid = backend.sessions[0].id;
    backend.emit('pty:title-change', { sessionId: sid, title: 'zsh' });
    await waitFor(() => expect(screen.getByTestId(`session-tab-${sid}`)).toHaveTextContent('zsh'));
  });

  it('shows exit dialog when last tab is closed', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid = backend.sessions[0].id;
    await userEvent.click(screen.getByTestId(`close-btn-${sid}`));
    await waitFor(() => expect(backend.sessions).toHaveLength(0));

    // Exit confirmation dialog should appear
    await waitFor(() => expect(screen.getByText('Close AI Terminal')).toBeInTheDocument());
  });

  it('cancels exit → creates a new session', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid = backend.sessions[0].id;
    await userEvent.click(screen.getByTestId(`close-btn-${sid}`));
    await waitFor(() => expect(backend.sessions).toHaveLength(0));

    // Click "Keep Session" (cancel)
    await userEvent.click(screen.getByText('Keep Session'));
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    expect(mockWindowClose).not.toHaveBeenCalled();
  });

  it('confirms exit → destroys the window', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid = backend.sessions[0].id;
    await userEvent.click(screen.getByTestId(`close-btn-${sid}`));
    await waitFor(() => expect(backend.sessions).toHaveLength(0));

    await userEvent.click(screen.getByText('Close App'));
    expect(mockWindowDestroy).toHaveBeenCalledOnce();
  });
});
