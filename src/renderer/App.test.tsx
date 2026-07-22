import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useTerminalStore } from './stores/terminal-store';
import { FakeTauriBackend } from '../test/fake-tauri';

vi.mock('@tauri-apps/api/core');
vi.mock('@tauri-apps/api/event');

describe('App session flow', () => {
  let backend: FakeTauriBackend;

  beforeEach(() => {
    // Reset module-level zustand store so tests are isolated
    useTerminalStore.setState(useTerminalStore.getInitialState(), true);
    backend = new FakeTauriBackend();
    backend.install();
  });

  it('auto-creates first session on mount', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('terminal-tabs')).toBeInTheDocument());
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
  });

  it('creates new tab when clicking +', async () => {
    render(<App />);
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    await userEvent.click(screen.getByTestId('new-tab-btn'));
    await waitFor(() => expect(backend.sessions).toHaveLength(2));
  });

  it('updates tab title on pty:title-change', async () => {
    render(<App />);
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid = backend.sessions[0].id;
    backend.emit('pty:title-change', { sessionId: sid, title: 'zsh' });
    await waitFor(() => expect(screen.getByTestId(`session-tab-${sid}`)).toHaveTextContent('zsh'));
  });

  it('closes tab via close button and does not auto-recreate', async () => {
    render(<App />);
    await waitFor(() => expect(backend.sessions).toHaveLength(1));
    const sid = backend.sessions[0].id;
    await userEvent.click(screen.getByTestId(`close-btn-${sid}`));
    await waitFor(() => expect(backend.sessions).toHaveLength(0));
    await waitFor(() =>
      expect(screen.queryByTestId(`session-tab-${sid}`)).not.toBeInTheDocument(),
    );
  });
});
