/**
 * AcpLauncher tests — the sidebar's ACP button opens a panel that starts a session in one click.
 *
 * The panel reads the configured servers from the backend, shows one row per server and reports
 * whether the program is on PATH; picking a row is a workspace action (a tab of its own).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AcpLauncher from '@features/workspace/components/AcpLauncher';
import { useSessionStore } from '@features/workspace';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock, diagnostic: vi.fn() }));

const CONFIGURED = [{ name: 'Claude Code', command: 'claude', args: [], env: {}, cwd: '', enabled: true }];

beforeEach(() => {
  useSessionStore.setState({ tabs: [], activeId: '' });
  useHarnessWorkspace.setState({ connections: [], selected: '' });
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === 'acp_harnesses') return Promise.resolve(CONFIGURED);
    if (command === 'which_cmd') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

describe('AcpLauncher', () => {
  it('lists the configured servers and marks one ready', async () => {
    render(<AcpLauncher open onClose={() => {}} />);

    expect(await screen.findByTestId('acp-launcher-Claude Code')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('acp-launcher-Claude Code').textContent).toContain('可用'));
  });

  it('opens the server session tab and closes the panel', async () => {
    const onClose = vi.fn();
    render(<AcpLauncher open onClose={onClose} />);
    await screen.findByTestId('acp-launcher-Claude Code');

    fireEvent.click(screen.getByTestId('acp-launcher-Claude Code'));

    const opened = useSessionStore.getState().tabs.filter((tab) => tab.kind === 'harness');
    expect(opened).toHaveLength(1);
    expect(useHarnessWorkspace.getState().connections[0]).toMatchObject({ harness: 'Claude Code' });
    expect(onClose).toHaveBeenCalled();
  });

  it('marks a server whose program is not on PATH as unavailable', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'acp_harnesses') return Promise.resolve(CONFIGURED);
      if (command === 'which_cmd') return Promise.resolve(false);
      return Promise.resolve(undefined);
    });

    render(<AcpLauncher open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('acp-launcher-Claude Code').textContent).toContain('未安装'));
    expect(screen.getByTestId('acp-launcher-Claude Code')).toHaveProperty('disabled', true);
  });
});
