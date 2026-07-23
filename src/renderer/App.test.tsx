import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useTerminalStore } from './stores/terminal-store';
import { FakeTauriBackend } from '../test/fake-tauri';

vi.mock('@tauri-apps/api/core');
vi.mock('@tauri-apps/api/event');
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ destroy: vi.fn(), close: vi.fn() }),
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
  });

  it('auto-creates first session on mount without exit dialog', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('terminal-tabs')).toBeInTheDocument());
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    expect(screen.queryByText('Close AI Terminal')).not.toBeInTheDocument();
  });

  it('creates new tab when clicking +', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    await userEvent.click(screen.getByTestId('new-tab-btn'));
    await waitFor(() => expect(backend.sessions).toHaveLength(2));
  });

  it('new tab becomes active immediately', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    await userEvent.click(screen.getByTestId('new-tab-btn'));
    await waitFor(() => expect(backend.sessions).toHaveLength(2));
    const sid2 = backend.sessions[1].id;
    // The store should have the new session as active
    expect(useTerminalStore.getState().activeSessionId).toBe(sid2);
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
    await userEvent.click(screen.getByText('Force Close'));
    await waitFor(() => expect(backend.sessions).toHaveLength(0));
    await waitFor(() => expect(screen.getByText('Close AI Terminal')).toBeInTheDocument());
  });

  it('cancels exit → creates a new session', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid = backend.sessions[0].id;
    await userEvent.click(screen.getByTestId(`close-btn-${sid}`));
    await userEvent.click(screen.getByText('Force Close'));
    await waitFor(() => expect(backend.sessions).toHaveLength(0));
    await userEvent.click(screen.getByText('Keep Session'));
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    expect(backend.exitRequested).toBe(false);
  });

  it('confirms exit → calls exit_app', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid = backend.sessions[0].id;
    await userEvent.click(screen.getByTestId(`close-btn-${sid}`));
    await userEvent.click(screen.getByText('Force Close'));
    await waitFor(() => expect(backend.sessions).toHaveLength(0));
    await userEvent.click(screen.getByText('Close App'));
    expect(backend.exitRequested).toBe(true);
  });

  it('preserves session content across tab switches', async () => {
    renderApp();
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid1 = backend.sessions[0].id;

    // Fill session 1 with content
    backend.emit('pty:output', {
      sessionId: sid1,
      events: [{ t: 'txt', p: 's1-content' }],
    });
    await waitFor(() =>
      expect(screen.getByTestId('terminal-view')).toHaveTextContent('s1-content'),
    );

    // Verify activeSessionId matches
    expect(useTerminalStore.getState().activeSessionId).toBe(sid1);

    // Create tab 2
    await userEvent.click(screen.getByTestId('new-tab-btn'));
    await waitFor(() => expect(backend.sessions).toHaveLength(2));
    const sid2 = backend.sessions[1].id;

    // New tab must be the active session
    expect(useTerminalStore.getState().activeSessionId).toBe(sid2);

    // Send content to session 2 — it should appear, not s1's
    backend.emit('pty:output', {
      sessionId: sid2,
      events: [{ t: 'txt', p: 's2-content' }],
    });
    await waitFor(() =>
      expect(screen.getByTestId('terminal-view')).toHaveTextContent('s2-content'),
    );
  });
});
