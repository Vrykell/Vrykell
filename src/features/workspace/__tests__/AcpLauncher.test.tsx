/**
 * AcpLauncher tests — the sidebar's ACP button opens a panel that starts a session in one click.
 *
 * The panel reads the configured servers from the backend, shows one row per server and reports
 * whether the program is on PATH; picking a row is a workspace action (a tab of its own).
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AcpLauncher from '@features/workspace/components/AcpLauncher';
import { useSessionStore } from '@features/workspace';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useUsageStore } from '@features/agent';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock, diagnostic: vi.fn() }));

const CONFIGURED = [{ name: 'Claude Code', command: 'claude', args: [], env: {}, cwd: '', enabled: true }];

beforeEach(() => {
  useUsageStore.getState().clear();
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
  it('shows actual daily usage and persisted agent turns, including zero usage', async () => {
    const view = render(<AcpLauncher embedded open onClose={() => {}} onNewConversation={() => {}} />);
    expect(screen.getByText('今日请求').nextElementSibling).toHaveTextContent('0');
    expect(screen.getByText('今日 Tokens').nextElementSibling).toHaveTextContent('0');
    view.unmount();
    useUsageStore.getState().recordTurn({ provider: 'provider', model: 'model', inputTokens: 120, outputTokens: 40 });
    useUsageStore.getState().recordTurn({ provider: 'provider', model: 'model', inputTokens: 900, outputTokens: 200, at: Date.now() - 86_400_000 });
    useUsageStore.getState().acpTurn('Claude Code');
    await useUsageStore.persist.rehydrate();
    render(<AcpLauncher embedded open onClose={() => {}} onNewConversation={() => {}} />);
    expect(screen.getByText('今日请求').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('今日 Tokens').nextElementSibling).toHaveTextContent('160');
    expect(await screen.findByTestId('acp-launcher-Claude Code')).toHaveTextContent('1 轮');
  });
  it('separates the native entry from configured agents without losing keyboard launch', async () => {
    const onNewConversation = vi.fn();
    const onPick = vi.fn();
    render(<AcpLauncher embedded open onClose={() => {}} onNewConversation={onNewConversation} onPick={onPick} />);
    const agents = screen.getByRole('region', { name: 'ACP 智能体' });
    const native = screen.getByTestId('ai-start-new-conversation');
    expect(within(agents).queryByTestId('ai-start-new-conversation')).toBeNull();
    expect(native.querySelector('[data-app-mark="true"]')).not.toBeNull();
    await within(agents).findByTestId('acp-launcher-Claude Code');
    fireEvent.keyDown(screen.getByTestId('acp-launcher-search'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('acp-launcher-search'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('Claude Code', undefined);
    fireEvent.click(native);
    expect(onNewConversation).toHaveBeenCalledOnce();
  });

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

  it('passes the project directory to the chosen session instead of silently using the default', async () => {
    const onPick = vi.fn();
    render(<AcpLauncher open cwd="C:/work/initial" onClose={() => {}} onPick={onPick} />);
    await screen.findByTestId('acp-launcher-Claude Code');
    expect(screen.getByRole('textbox', { name: '项目路径' })).toHaveValue('C:/work/initial');
    fireEvent.change(screen.getByRole('textbox', { name: '项目路径' }), { target: { value: 'C:/work/chosen' } });
    fireEvent.click(screen.getByTestId('acp-launcher-Claude Code'));
    expect(onPick).toHaveBeenCalledWith('Claude Code', 'C:/work/chosen');
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
