import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatStore } from '../stores/chat';
import { useDockStore } from '@features/workspace';
import AiHistoryView from '../components/AiHistoryView';
import { useHistoryMetaStore } from '@utils/historyMeta';
import * as conversationApi from '@platform/api/conversation';
import { writeClipboardText } from '@platform/clipboard';

vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn().mockResolvedValue(true) }));
vi.mock('@platform/clipboard', () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@platform/api/conversation', () => ({
  listConversations: vi.fn().mockResolvedValue([]), saveConversation: vi.fn().mockResolvedValue(undefined),
  listConversationMessages: vi.fn().mockResolvedValue([]), appendConversationMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined), deleteConversationMessage: vi.fn().mockResolvedValue(undefined),
}));

const initialChat = useChatStore.getState();
const initialDock = useDockStore.getState();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(conversationApi.deleteConversation).mockResolvedValue(undefined);
  sessionStorage.clear();
  useHistoryMetaStore.setState(useHistoryMetaStore.getInitialState(), true);
  useChatStore.setState({ conversationsLoaded: true, activeConversationId: 'first', conversations: [
    { id: 'first', title: 'Build investigation', createdAt: 1, updatedAt: 3, environment: null },
    { id: 'second', title: 'Database question', createdAt: 2, updatedAt: 4, environment: null },
  ], byTab: { first: [], second: [] }, conversationError: null });
});
afterEach(() => {
  sessionStorage.clear();
  cleanup(); useChatStore.setState(initialChat, true); useDockStore.setState(initialDock, true);
});

it('searches independent conversations and opens one in the dock', () => {
  render(<AiHistoryView />);
  expect(screen.getByTestId('ai-history-page')).toHaveTextContent('2 个对话');
  fireEvent.click(screen.getByTestId('history-search-toggle'));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索对话' }), { target: { value: 'Build' } });
  expect(screen.getByTestId('conversation-row-first')).toBeInTheDocument();
  expect(screen.queryByTestId('conversation-row-second')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('conversation-row-first'));
  expect(useChatStore.getState().activeConversationId).toBe('first');
  expect(useDockStore.getState().rightPanels).toContain('chat');
});

it('shows new conversations without replacing the history page', () => {
  render(<AiHistoryView />);
  fireEvent.click(screen.getByTestId('ai-history-actions-menu-button'));
  fireEvent.click(screen.getByRole('menuitem', { name: '新对话' }));
  expect(useChatStore.getState().conversations).toHaveLength(3);
  expect(screen.getByTestId('ai-history-page')).toBeInTheDocument();
  act(() => useChatStore.getState().renameConversation('first', 'Renamed'));
  expect(screen.getByTestId('conversation-row-first')).toHaveTextContent('Renamed');
});

it('copies the filtered group without including unrelated conversations', async () => {
  render(<AiHistoryView />);
  fireEvent.click(screen.getByTestId('history-search-toggle'));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索对话' }), { target: { value: 'Build' } });
  expect(screen.queryByRole('button', { name: '复制为 Markdown' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分组操作' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '复制为 Markdown' }));
  await waitFor(() => expect(writeClipboardText).toHaveBeenCalled());
  expect(vi.mocked(writeClipboardText).mock.calls[0]![0]).toContain('# Build investigation');
  expect(vi.mocked(writeClipboardText).mock.calls[0]![0]).not.toContain('Database question');
});

it('deletes from the record menu without opening it and protects locked conversations', async () => {
  useHistoryMetaStore.getState().setLocked(['conversation:first'], true);
  render(<AiHistoryView />);
  fireEvent.contextMenu(screen.getByTestId('conversation-row-first'), { clientX: 30, clientY: 50 });
  expect(screen.getByRole('menuitem', { name: '删除对话' })).toBeDisabled();
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.contextMenu(screen.getByTestId('conversation-row-second'), { clientX: 30, clientY: 80 });
  fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }));
  await waitFor(() => expect(conversationApi.deleteConversation).toHaveBeenCalledWith('second'));
  expect(useChatStore.getState().activeConversationId).toBe('first');
});

it('opens record actions on right click without opening group actions', () => {
  render(<AiHistoryView />);
  fireEvent.contextMenu(screen.getByTestId('conversation-row-first'), { clientX: 30, clientY: 50 });
  expect(screen.getByRole('menuitem', { name: '打开对话' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: '收起分组' })).toBeNull();
});

it('shows remote context without hover and opens from the quick action', () => {
  useChatStore.setState(state => ({ conversations: state.conversations.map(item => item.id === 'second'
    ? { ...item, environment: { paneId: 'remote', label: 'Production', kind: 'ssh' as const,
      cwd: '/srv/app', ssh: { host: 'server.test', user: 'dev', port: 2222 } } } : item) }));
  render(<AiHistoryView />);
  const row = screen.getByTestId('conversation-row-second');
  expect(row.querySelector('.sidebar-row-subtitle')).toBeVisible();
  expect(row).toHaveTextContent('dev@server.test:2222 · /srv/app');
  expect(row).toHaveTextContent('更新于');
  fireEvent.click(screen.getByTestId('conversation-open-second'));
  expect(useChatStore.getState().activeConversationId).toBe('second');
  expect(useDockStore.getState().rightPanels).toContain('chat');
});

it('prevents quick deletion of locked or working conversations without activating them', async () => {
  useHistoryMetaStore.getState().setLocked(['conversation:first'], true);
  render(<AiHistoryView />);
  expect(screen.getByTestId('conversation-delete-first')).toBeDisabled();
  act(() => useChatStore.setState({ sendingTab: 'second' }));
  expect(screen.getByTestId('conversation-delete-second')).toBeDisabled();
  act(() => useChatStore.setState({ sendingTab: null }));
  fireEvent.click(screen.getByTestId('conversation-delete-second'));
  await waitFor(() => expect(conversationApi.deleteConversation).toHaveBeenCalledWith('second'));
  expect(useChatStore.getState().activeConversationId).toBe('first');
});

it('keeps locked and failed records while deleting the other records in a group', async () => {
  useChatStore.setState(state => ({ conversations: [...state.conversations,
    { id: 'third', title: 'Successful deletion', createdAt: 3, updatedAt: 5, environment: null }] }));
  useHistoryMetaStore.getState().setLocked(['conversation:first'], true);
  useHistoryMetaStore.getState().setNote('conversation:second', 'Retry later');
  useHistoryMetaStore.getState().setNote('conversation:third', 'Remove with record');
  vi.mocked(conversationApi.deleteConversation).mockImplementation(async id => {
    if (id === 'second') throw new Error('Unavailable');
  });
  render(<AiHistoryView />);
  fireEvent.click(screen.getByRole('button', { name: '分组操作' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '删除 2 个匹配对话…' }));
  await waitFor(() => expect(useChatStore.getState().conversations.map(item => item.id)).toEqual(['first', 'second']));
  expect(conversationApi.deleteConversation).not.toHaveBeenCalledWith('first');
  expect(useHistoryMetaStore.getState().notes['conversation:second']).toBe('Retry later');
  expect(useHistoryMetaStore.getState().notes['conversation:third']).toBeUndefined();
});
