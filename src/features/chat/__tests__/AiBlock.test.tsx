import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import AiBlock from '../components/AiBlock';
import { useChatStore } from '../stores/chat';
import type { ChatExchange } from '../model/exchanges';

afterEach(cleanup);
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
