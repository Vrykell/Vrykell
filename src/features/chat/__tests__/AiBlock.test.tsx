import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { writeClipboardText } from '@platform/clipboard';
import AiBlock from '../components/AiBlock';
import { useChatStore } from '../stores/chat';
import type { ChatExchange } from '../model/exchanges';

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

it('renders panel answers as plain conversation content with message actions', () => {
  useChatStore.setState({ sendingTab: null });
  const { container } = render(<AiBlock exchange={exchange} conversationId="conversation" presentation="conversation" />);
  expect(container.querySelector('.chat-exchange')).not.toBeNull();
  expect(container.querySelector('.command-block')).toBeNull();
  expect(container.querySelector('.ai-block-heading')).toBeNull();
  expect(screen.getByText('configuration')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '收起回答' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  expect(screen.getByText('重新生成')).toBeInTheDocument();
  expect(screen.getByText('编辑重发')).toBeInTheDocument();
});

it('hides regenerate and edit while its own conversation answers', () => {
  useChatStore.setState({ sendingTab: 'conversation' });
  render(<AiBlock exchange={exchange} conversationId="conversation" presentation="conversation" />);
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  expect(screen.queryByText('重新生成')).toBeNull();
  expect(screen.queryByText('编辑重发')).toBeNull();
});

it('shows a terminal tool row as the bare command without a prompt marker', () => {
  render(<AiBlock conversationId="conversation" presentation="conversation"
    exchange={{ ...exchange, answer: { ...exchange.answer!, parts: [commandPart] } }} />);
  // The terminal icon already states the tool type, so no `$` prompt prefix is needed.
  expect(screen.getByText('npm run build')).toHaveClass('ai-tool-description');
  expect(screen.queryByText('$ npm run build')).toBeNull();
});
