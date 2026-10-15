import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { t } from '@i18n';
import { useTerminalStore } from '@features/terminal';
import TerminalReferences from '../components/TerminalReferences';
import ToolRunCard from '../components/ToolRunCard';
import { showExecutionTerminal } from '../services/conversationContext';
import type { TerminalReference } from '../model/conversation';

vi.mock('../services/conversationContext', () => ({ showExecutionTerminal: vi.fn() }));
const terminal = useTerminalStore.getState();
const reference: TerminalReference = { id: 'one', paneId: 'pane', label: 'Build terminal', command: 'npm run build',
  cwd: '/project', output: 'Built successfully', exitCode: 0, createdAt: 1 };
afterEach(() => { cleanup(); vi.clearAllMocks(); useTerminalStore.setState(terminal, true); });

it('opens all references independently, including newly added snapshots', () => {
  const second = { ...reference, id: 'two', command: 'pwd', output: '/project' };
  const { rerender } = render(<TerminalReferences references={[reference, second]} />);
  expect(screen.getByText('Built successfully')).toBeVisible();
  expect(screen.getByRole('button', { name: 'pwd' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'npm run build' }));
  expect(screen.queryByText('Built successfully')).toBeNull();
  expect(screen.getByRole('button', { name: 'pwd' })).toHaveAttribute('aria-expanded', 'true');
  rerender(<TerminalReferences references={[reference, second, { ...reference, id: 'three', command: 'whoami' }]} />);
  expect(screen.getByRole('button', { name: 'whoami' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'npm run build' })).toHaveAttribute('aria-expanded', 'false');
});

it('shares command glyphs and output framing with tool calls', () => {
  const { container } = render(<><TerminalReferences references={[reference]} />
    <ToolRunCard framed run={{ toolCallId: 'call', toolName: 'run_command', input: { command: 'pwd' }, state: 'done', startedAt: 1 }} /></>);
  const headers = container.querySelectorAll('.ai-tool-summary');
  expect(headers).toHaveLength(2);
  expect(headers[0].querySelector('svg')!.innerHTML).toBe(headers[1].querySelector('svg')!.innerHTML);
  expect(container.querySelector('.chat-reference .ai-tool-frame')).toHaveAttribute('data-framed', 'true');
  expect(container.querySelector('.chat-reference .ai-tool-output')).toHaveTextContent('Built successfully');
  expect(screen.getByText('退出码：0')).toBeVisible();
  expect(screen.getByTestId('reference-output-copy-one')).toBeInTheDocument();
});

it('retains removal and live terminal navigation without changing expansion', () => {
  useTerminalStore.setState({ sessions: { pane: 'pty' } });
  const remove = vi.fn();
  render(<TerminalReferences references={[{ ...reference, output: '' }]} onRemove={remove} />);
  expect(screen.getByText(t('No output'))).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '查看终端' }));
  expect(showExecutionTerminal).toHaveBeenCalledWith('pane');
  fireEvent.click(screen.getByRole('button', { name: '移除引用' }));
  expect(remove).toHaveBeenCalledWith('one');
  expect(screen.getByRole('button', { name: 'npm run build' })).toHaveAttribute('aria-expanded', 'true');
});
