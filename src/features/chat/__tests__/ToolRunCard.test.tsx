import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ToolRunCard from '../components/ToolRunCard';
import type { ToolRun } from '@features/agent/model/messageParts';
import { gate, usePermissions, denyAllPending, clearSessionGrants, setToolApprover, setToolAuthorizer } from '@features/agent';
import { useComposerDrafts } from '../stores/composerDrafts';

beforeEach(() => {
  // The card's actions answer a gate that would otherwise ask the real backend.
  setToolAuthorizer(async () => ({ decision: 'ask' }));
  setToolApprover(async () => ({ decision: 'allow' }));
});

afterEach(() => {
  cleanup();
  setToolAuthorizer(null);
  setToolApprover(null);
  denyAllPending();
  clearSessionGrants();
});

it('routes a review question to the provided owner instead of a native conversation draft', () => {
  const ask = vi.fn();
  const run: ToolRun = { toolCallId: 'external-review', toolName: 'run_command', state: 'approval-pending', input: { command: 'pwd' }, startedAt: 1 };
  render(<ToolRunCard run={run} onAskAboutTool={ask} />);
  fireEvent.click(screen.getByRole('button', { name: '先问一下' }));
  expect(ask).toHaveBeenCalledWith(expect.stringContaining('pwd'));
});

const command: ToolRun = { toolCallId: 'command', toolName: 'run_command', input: { command: 'npm run build' },
  state: 'done', startedAt: 1, output: JSON.stringify({ exitCode: 0, output: 'Build complete' }) };

it('keeps live and restored tool failures inline, with their actual output and no global notification', () => {
  const failed: ToolRun = { ...command, state: 'error', error: 'Exit code 3', output: JSON.stringify({ exitCode: 3, output: 'service is inactive' }) };
  for (let mount = 0; mount < 2; mount += 1) {
    const view = render(<ToolRunCard run={failed} framed />);
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector('#app-notifications [role="alert"]')).toBeNull();
    expect(screen.getByText('Exit code 3')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '技术详情' }));
    expect(screen.getByText('service is inactive')).toBeVisible();
    view.unmount();
  }
});

it('shows the command label and exit code before disclosing input and output', () => {
  render(<ToolRunCard framed run={command} />);
  const summary = screen.getByRole('button', { name: '运行命令 npm run build 退出码 0' });
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Build complete')).toBeNull();
  fireEvent.click(summary);
  expect(screen.getByText('输入')).toBeVisible();
  expect(screen.getByText('输出')).toBeVisible();
  expect(screen.getByText(/"command": "npm run build"/)).toBeVisible();
  expect(screen.getByText('Build complete')).toBeVisible();
  fireEvent.click(summary);
  expect(screen.queryByText('输入')).toBeNull();
});

it('shows terminal input and a completed badge for non-command tools in both presentations', () => {
  const run: ToolRun = { ...command, toolName: 'terminal_keys', input: { keys: 'curl -I localhost\r', wait_ms: 300 }, output: 'HTTP/1.1 200 OK' };
  const { rerender } = render(<ToolRunCard framed run={run} />);
  const summary = screen.getByRole('button', { name: /向终端输入.*curl -I localhost.*完成/ });
  fireEvent.click(summary);
  expect(screen.getByText(/"wait_ms": 300/)).toBeVisible();
  expect(screen.getByText('HTTP/1.1 200 OK')).toBeVisible();
  rerender(<ToolRunCard run={run} />);
  expect(screen.getByText('HTTP/1.1 200 OK')).toBeVisible();
  expect(summary).toHaveAttribute('aria-expanded', 'true');
});

it('preserves unstructured command results and does not invent an exit code', () => {
  render(<ToolRunCard run={{ ...command, output: '{"message":"No exit code"}' }} />);
  fireEvent.click(screen.getByRole('button', { name: '运行命令 npm run build 完成' }));
  expect(screen.getByText('{"message":"No exit code"}')).toBeVisible();
});

it('reviews the fixed target and approves an edited command only after Run is pressed', async () => {
  usePermissions.setState({ levels: { run_command: 'ask' } });
  const states: string[] = [];
  const pending = gate('run_command', { command: 'npm run build' }, 'command', {
    tabId: 'conversation',
    setToolState: (_id, state) => { states.push(state); },
  });
  render(<ToolRunCard run={{ ...command, state: 'approval-pending' }} paneId="fixed-pane" environment={{ paneId: 'fixed-pane', kind: 'ssh', label: 'Production', ssh: { user: 'deploy', host: 'server.test', port: 2222 } }} />);
  // The gate reaches its approval bridge after the backend answer; clicking earlier would drop the answer.
  await vi.waitFor(() => expect(states).toContain('approval-pending'));
  expect(screen.getByText('Production')).toBeVisible();
  expect(screen.getByText('deploy@server.test:2222')).toBeVisible();
  expect(screen.getByText('超时 120 秒')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByRole('textbox', { name: '要运行的命令' }), { target: { value: '' } });
  expect(screen.getByRole('button', { name: '运行' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '要运行的命令' }), { target: { value: 'npm run check' } });
  fireEvent.click(screen.getByRole('button', { name: '运行' }));
  expect(await pending).toEqual({ proceed: true, command: 'npm run check' });
});

it('rejects the pending action and preserves an existing draft when asking first', async () => {
  usePermissions.setState({ levels: { run_command: 'ask' } });
  useComposerDrafts.getState().setText('owner', 'Existing question');
  const states: string[] = [];
  const pending = gate('run_command', command.input, 'command', {
    tabId: 'owner',
    setToolState: (_id, state) => { states.push(state); },
  });
  render(<ToolRunCard run={{ ...command, state: 'approval-pending' }} conversationId="owner" />);
  await vi.waitFor(() => expect(states).toContain('approval-pending'));
  fireEvent.click(screen.getByRole('button', { name: '先问一下' }));
  expect(await pending).toMatchObject({ proceed: false, result: { denied: true } });
  expect(useComposerDrafts.getState().byTab.owner?.text).toBe('Existing question\n请先解释这个操作的作用，再决定是否运行：npm run build');
});
