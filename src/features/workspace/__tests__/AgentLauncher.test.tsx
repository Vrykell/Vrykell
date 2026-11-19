import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentLauncher from '@features/workspace/components/AgentLauncher';
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
    if (command === 'acp_workspace_root') return Promise.resolve('C:/Users/test/AppData/Local/com.vrykell.app/acp-workspace');
    if (command === 'which_cmd') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

describe('AgentLauncher', () => {
  it('launches built-in and configured agents from the same keyboard list', async () => {
    const onPick = vi.fn();
    render(<AgentLauncher open onClose={() => {}} onPick={onPick} />);
    const agents = screen.getByRole('dialog', { name: '选择智能体' });
    const native = screen.getByTestId('agent-launcher-builtin');
    expect(within(agents).getByTestId('agent-launcher-builtin')).toBe(native);
    await within(agents).findByTestId('acp-launcher-Claude Code');
    fireEvent.keyDown(screen.getByTestId('acp-launcher-search'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('acp-launcher-search'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ driver: 'acp', name: 'Claude Code' }, undefined);
    fireEvent.click(native);
    expect(onPick).toHaveBeenCalledWith({ driver: 'builtin' }, undefined);
  });

  it('lists the configured servers and marks one ready', async () => {
    render(<AgentLauncher open onClose={() => {}} />);

    expect(await screen.findByTestId('acp-launcher-Claude Code')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('acp-launcher-Claude Code').textContent).toContain('可用'));
  });

  it('opens the server session tab and closes the panel', async () => {
    const onClose = vi.fn();
    render(<AgentLauncher open onClose={onClose} />);
    await screen.findByTestId('acp-launcher-Claude Code');

    fireEvent.click(screen.getByTestId('acp-launcher-Claude Code'));

    const opened = useSessionStore.getState().tabs.filter((tab) => tab.kind === 'harness');
    expect(opened).toHaveLength(1);
    expect(useHarnessWorkspace.getState().connections[0]).toMatchObject({ harness: 'Claude Code' });
    expect(onClose).toHaveBeenCalled();
  });

  it('passes the project directory to the chosen session instead of silently using the default', async () => {
    const onPick = vi.fn();
    render(<AgentLauncher open cwd="C:/work/initial" onClose={() => {}} onPick={onPick} />);
    await screen.findByTestId('acp-launcher-Claude Code');
    expect(screen.getByRole('textbox', { name: '项目路径' })).toHaveValue('C:/work/initial');
    fireEvent.change(screen.getByRole('textbox', { name: '项目路径' }), { target: { value: 'C:/work/chosen' } });
    fireEvent.click(screen.getByTestId('acp-launcher-Claude Code'));
    expect(onPick).toHaveBeenCalledWith({ driver: 'acp', name: 'Claude Code' }, 'C:/work/chosen');
  });

  it('shows the default workspace used when no project folder is chosen', async () => {
    render(<AgentLauncher open onClose={() => {}} />);
    await screen.findByTestId('acp-launcher-Claude Code');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '项目路径' })).toHaveAttribute(
        'data-tip',
        '在 C:/Users/test/AppData/Local/com.vrykell.app/acp-workspace 下新建文件夹',
      ),
    );
  });

  it('marks a server whose program is not on PATH as unavailable', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'acp_harnesses') return Promise.resolve(CONFIGURED);
      if (command === 'which_cmd') return Promise.resolve(false);
      return Promise.resolve(undefined);
    });

    render(<AgentLauncher open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('acp-launcher-Claude Code').textContent).toContain('未安装'));
    expect(screen.getByTestId('acp-launcher-Claude Code')).toHaveProperty('disabled', true);
  });
});
