/**
 * HarnessHubView tests — the hub is where a harness is picked and started.
 *
 * The page reads the configured list from the backend, shows one card per harness, and starting one
 * is a workspace action (a tab of its own), so the assertions are about the list rendering and about
 * the workspace receiving the right tab.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HarnessHubView from '@features/chat/components/HarnessHubView';
import { useSessionStore } from '@features/workspace';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock }));

const CONFIGURED = [{ name: 'Claude Code', command: 'claude', args: [], env: {}, cwd: '', enabled: true }];

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === 'acp_harnesses') return Promise.resolve(CONFIGURED);
    if (command === 'which_cmd') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

describe('HarnessHubView', () => {
  it('shows one card per configured harness and reports it as ready', async () => {
    render(<HarnessHubView />);

    expect(await screen.findByTestId('harness-card-0')).toBeTruthy();
    expect(screen.getByTestId('harness-card-0').textContent).toContain('Claude Code');
    await waitFor(() => expect(screen.getByTestId('harness-status-0').textContent).toBe('可用'));
  });

  it('marks a harness whose program is not on PATH', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'acp_harnesses') return Promise.resolve(CONFIGURED);
      if (command === 'which_cmd') return Promise.resolve(false);
      return Promise.resolve(undefined);
    });

    render(<HarnessHubView />);

    await waitFor(() => expect(screen.getByTestId('harness-status-0').textContent).toBe('未安装'));
  });

  it('opens a session tab for the harness the connect button belongs to', async () => {
    render(<HarnessHubView />);
    await screen.findByTestId('harness-card-0');

    fireEvent.click(screen.getByTestId('harness-connect-0'));

    const opened = useSessionStore.getState().tabs.filter((tab) => tab.kind === 'harness');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ harness: 'Claude Code' });
  });

  it('adds a preset to the list in one click and saves the edited list', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'acp_harnesses') return Promise.resolve([]);
      if (command === 'which_cmd') return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    render(<HarnessHubView />);
    await screen.findByTestId('harness-presets');

    fireEvent.click(screen.getByTestId('harness-preset-Claude Code'));

    await waitFor(() => expect(screen.getByTestId('harness-card-0')).toBeTruthy());
    // The list on screen is the list on disk: the hub saves as it is edited.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('acp_harness_save', expect.anything()), { timeout: 2000 });
  });
});
