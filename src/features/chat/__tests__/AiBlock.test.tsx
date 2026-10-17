import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { writeClipboardText } from '@platform/clipboard';
import AiBlock from '../components/AiBlock';
import { useChatStore } from '../stores/chat';
import type { ChatExchange } from '../model/exchanges';
import type { ToolRun } from '@features/agent/model/messageParts';

vi.mock('@platform/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

const writeClipboardTextMock = vi.mocked(writeClipboardText);

afterEach(() => {
  cleanup();
  useChatStore.setState({ sendingTab: null });
});
const exchange: ChatExchange = { id: 'question', createdAt: 1,
  question: { id: 'question', role: 'user', content: 'Why did the build fail?', createdAt: 1 },
  answer: { id: 'answer', role: 'assistant', content: 'Check the **configuration**.', createdAt: 2 },
};

it('uses the tool summary treatment for reasoning and keeps its disclosure usable', () => {
  const reasoning = 'Inspect the build configuration first.\n\nThen check the dependencies.';
  const { container } = render(<AiBlock exchange={{ ...exchange, answer: { ...exchange.answer!, reasoning } }}
    presentation="conversation" conversationId="conversation" />);
  const thinking = container.querySelector('.ai-thinking')!;
  expect(thinking).toHaveClass('ai-tool-card');
  const summary = within(thinking as HTMLElement).getByRole('button', { name: /思考过程/ });
  expect(summary).toHaveClass('ai-tool-summary');
  expect(summary.lastElementChild?.tagName.toLowerCase()).toBe('svg');
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(summary);
  expect(summary).toHaveAttribute('aria-expanded', 'true');
  expect(within(thinking as HTMLElement).getByText('Then check the dependencies.')).toBeVisible();
  fireEvent.click(summary);
  expect(container.querySelector('.ai-thinking-body')).toBeNull();
});

it('renders panel answers as plain conversation content with message actions', () => {
  useChatStore.setState({ sendingTab: null });
  const { container } = render(<AiBlock exchange={exchange} conversationId="conversation" presentation="conversation" />);
  expect(container.querySelector('.chat-exchange')).not.toBeNull();
  expect(container.querySelector('.command-block')).toBeNull();
  expect(container.querySelector('.ai-block-heading')).toBeNull();
  expect(screen.getByText('configuration')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '收起回答' })).not.toBeInTheDocument();
  // The reply's actions stay in the open instead of hiding in a menu.
  const actions = container.querySelector('.chat-answer-actions')!;
  expect(within(actions as HTMLElement).getAllByRole('button').map(button => button.getAttribute('aria-label')))
    .toEqual(['复制', '重新生成', '编辑重发', '删除']);
  // The sent message carries its clock time and a copy target.
  expect(container.querySelector('.chat-question-meta')).toHaveTextContent(/\d{1,2}:\d{2}/);
  expect(screen.getByTestId('chat-question-copy')).toBeInTheDocument();
});

it('keeps question selection separate from explicit reply collapse', () => {
  useChatStore.setState({ sendingTab: null });
  render(<AiBlock exchange={exchange} conversationId="conversation" />);
  fireEvent.click(screen.getByText('Why did the build fail?'));
  expect(screen.getByText('configuration')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '收起回答' }));
  expect(screen.queryByText('configuration')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开回答' }));
  expect(screen.getByText('configuration')).toBeInTheDocument();
});

it('keeps approval actions and failures visible without timeline nodes', () => {
  const { container } = render(<AiBlock conversationId="conversation" exchange={{ ...exchange, answer: { ...exchange.answer!, parts: [
    { kind: 'tool', tool: { toolCallId: 'approval', toolName: 'run_command', input: { command: 'npm run build' }, state: 'approval-pending', startedAt: 1 } },
    { kind: 'tool', tool: { toolCallId: 'failure', toolName: 'read_file', input: { path: '/project/missing' }, state: 'error', startedAt: 1, error: 'Missing file' } },
  ] } }} />);
  expect(screen.getByRole('button', { name: '允许一次' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Missing file');
  expect(container.querySelectorAll('.ai-tool-card')).toHaveLength(2);
  expect(container.querySelector('[style*="position: absolute"]')).toBeNull();
});

it('collapses a failure through the row toggle after showing it by default', () => {
  const { container } = render(<AiBlock conversationId="conversation" presentation="conversation" exchange={{ ...exchange, answer: { ...exchange.answer!, parts: [
    { kind: 'tool', tool: { toolCallId: 'failure', toolName: 'run_command', input: { command: 'cat /etc/hosts' }, state: 'error', startedAt: 1, error: 'Exit code 2' } },
  ] } }} />);
  // A failure is readable without expanding anything ...
  expect(screen.getByRole('alert')).toHaveTextContent('Exit code 2');
  expect(container.querySelector('.ai-tool-summary')).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(container.querySelector('.ai-tool-summary')!);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(container.querySelector('.ai-tool-summary')).toHaveAttribute('aria-expanded', 'false');
});

it('reopens a failure that arrives after the row was collapsed', () => {
  const running: ToolRun = { toolCallId: 'late', toolName: 'run_command', input: { command: 'npm run build' }, state: 'running', startedAt: 1 };
  const view = (tool: ToolRun) => (
    <AiBlock conversationId="conversation" presentation="conversation"
      exchange={{ ...exchange, answer: { ...exchange.answer!, parts: [{ kind: 'tool', tool }] } }} />
  );
  // The row is collapsed while the command is still running ...
  const { container, rerender } = render(view(running));
  fireEvent.click(container.querySelector('.ai-tool-summary')!);
  expect(screen.queryByRole('alert')).toBeNull();
  // ... and its failure still has to be visible when it arrives.
  rerender(view({ ...running, state: 'error', error: 'Exit code 2' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Exit code 2');
});

const commandPart = { kind: 'tool' as const, tool: {
  toolCallId: 'command', toolName: 'run_command', input: { command: 'npm run build' }, state: 'done' as const,
  startedAt: 1, output: JSON.stringify({ exitCode: 0, output: 'built' }),
} };

function outputSurface(container: HTMLElement): HTMLElement {
  fireEvent.click(container.querySelector('.ai-tool-summary')!);
  return container.querySelector('.ai-tool-output [data-selectable]') as HTMLElement;
}

it('keeps panel tool output inside the shared frame without a second terminal surface or scroll container', () => {
  const { container } = render(<AiBlock conversationId="conversation" presentation="conversation"
    exchange={{ ...exchange, answer: { ...exchange.answer!, parts: [commandPart] } }} />);
  const surface = outputSurface(container);
  expect(surface.style.padding).toBe('0px');
  // The box owns scrolling; the snapshot inside must not cap its own height.
  expect(surface.style.maxHeight).toBe('');
});

it('keeps the terminal surface for inline AI blocks', () => {
  const { container } = render(<AiBlock conversationId="conversation"
    exchange={{ ...exchange, answer: { ...exchange.answer!, parts: [commandPart] } }} />);
  const surface = outputSurface(container);
  expect(surface.style.padding).toBe('2px 8px 8px');
  expect(surface.style.maxHeight).toBe('');
  // The copy target belongs to the panel frame only.
  expect(container.querySelector('[data-testid="tool-output-copy"]')).toBeNull();
});

it('copies the panel tool output from the frame corner', async () => {
  writeClipboardTextMock.mockClear();
  const { container } = render(<AiBlock conversationId="conversation" presentation="conversation"
    exchange={{ ...exchange, answer: { ...exchange.answer!, parts: [commandPart] } }} />);
  outputSurface(container);
  const copy = screen.getByTestId('tool-output-copy');
  expect(copy).toHaveAttribute('data-tip', '复制输出');
  expect(container.querySelector('.ai-tool-frame > .ai-tool-output')).not.toBeNull();

  fireEvent.click(copy);

  await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledWith('built'));
  expect(copy).toHaveAttribute('data-tip', '已复制');
});

it('keeps this exchange actionable while a background conversation answers', () => {
  // The single send slot is taken by a scheduled (background) conversation: this exchange is idle.
  useChatStore.setState({ sendingTab: 'background-conversation' });
  render(<AiBlock exchange={exchange} conversationId="conversation" presentation="conversation" />);
  expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '编辑重发' })).toBeInTheDocument();
});

it('hides regenerate and edit while its own conversation answers', () => {
  useChatStore.setState({ sendingTab: 'conversation' });
  render(<AiBlock exchange={exchange} conversationId="conversation" presentation="conversation" />);
  expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull();
  expect(screen.queryByRole('button', { name: '编辑重发' })).toBeNull();
});

it('shows a terminal tool row as the bare command without a prompt marker', () => {
  render(<AiBlock conversationId="conversation" presentation="conversation"
    exchange={{ ...exchange, answer: { ...exchange.answer!, parts: [commandPart] } }} />);
  // The terminal icon already states the tool type, so no `$` prompt prefix is needed.
  expect(screen.getByText('npm run build')).toHaveClass('ai-tool-description');
  expect(screen.queryByText('$ npm run build')).toBeNull();
});

it('explains a reply whose provider sent its tool call as plain text', () => {
  const leaked = '<\uFF5C\uFF5CDSML\uFF5C\uFF5C calls>\n'
    + '<\uFF5C\uFF5CDSML\uFF5C\uFF5C invoke name="run_command">\ndir\n</\uFF5C\uFF5CDSML\uFF5C\uFF5C calls>';
  const view = (content: string) => (
    <AiBlock conversationId="conversation" presentation="conversation"
      exchange={{ ...exchange, answer: { ...exchange.answer!, content } }} />
  );
  const { container, rerender } = render(view(leaked));
  expect(screen.getByTestId('chat-leaked-tool-call')).toHaveTextContent('本次没有执行任何工具');
  // The raw text stays readable — the note explains it instead of hiding it.
  expect(container.textContent).toContain('DSML');

  rerender(view('I ran `dir` and it lists four files.'));
  expect(screen.queryByTestId('chat-leaked-tool-call')).toBeNull();
});
