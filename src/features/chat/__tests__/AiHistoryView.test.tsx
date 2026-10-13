import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatStore } from '../stores/chat';
import { useDockStore } from '@features/workspace';
import AiHistoryView from '../components/AiHistoryView';

vi.mock('@platform/api/conversation', () => ({
  listConversations: vi.fn().mockResolvedValue([]), saveConversation: vi.fn().mockResolvedValue(undefined),
  listConversationMessages: vi.fn().mockResolvedValue([]), appendConversationMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined), deleteConversationMessage: vi.fn().mockResolvedValue(undefined),
}));

const initialChat = useChatStore.getState();
const initialDock = useDockStore.getState();
beforeEach(() => {
  useChatStore.setState({ conversationsLoaded: true, activeConversationId: 'first', conversations: [
    { id: 'first', title: 'Build investigation', createdAt: 1, updatedAt: 3, environment: null },
    { id: 'second', title: 'Database question', createdAt: 2, updatedAt: 4, environment: null },
  ], byTab: { first: [], second: [] }, conversationError: null });
});
afterEach(() => {
  cleanup(); useChatStore.setState(initialChat, true); useDockStore.setState(initialDock, true);
});

it('searches independent conversations and opens one in the dock', () => {
  render(<AiHistoryView />);
  expect(screen.getByTestId('ai-history-page')).toHaveTextContent('2 个对话');
  fireEvent.change(screen.getByRole('textbox', { name: '搜索对话' }), { target: { value: 'Build' } });
  expect(screen.getByTestId('conversation-row-first')).toBeInTheDocument();
  expect(screen.queryByTestId('conversation-row-second')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('conversation-row-first'));
  expect(useChatStore.getState().activeConversationId).toBe('first');
  expect(useDockStore.getState().rightPanels).toContain('chat');
});

it('shows new conversations without replacing the history page', () => {
  render(<AiHistoryView />);
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(useChatStore.getState().conversations).toHaveLength(3);
  expect(screen.getByTestId('ai-history-page')).toBeInTheDocument();
  act(() => useChatStore.getState().renameConversation('first', 'Renamed'));
  expect(screen.getByTestId('conversation-row-first')).toHaveTextContent('Renamed');
});
