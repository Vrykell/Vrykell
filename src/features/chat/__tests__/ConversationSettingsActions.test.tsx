import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ConversationSettingsActions from '../components/ConversationSettingsActions';

const mocks = vi.hoisted(() => ({ usage: vi.fn(), settings: vi.fn() }));
vi.mock('@features/workspace', () => ({ useSessionStore: { getState: () => ({ openUsageTab: mocks.usage, openSettings: mocks.settings }) } }));
vi.mock('@features/terminal', () => ({ useTerminalStore: (select: (state: { sessions: Record<string, string> }) => unknown) => select({ sessions: {} }) }));
vi.mock('../stores/chat', () => ({ useChatStore: (select: (state: { conversations: never[] }) => unknown) => select({ conversations: [] }) }));

it('uses shared buttons and closes the menu before performing a selected action', () => {
  const closeMenu = vi.fn(); const closeConversation = vi.fn();
  render(<ConversationSettingsActions onCloseMenu={closeMenu} onCloseConversation={closeConversation} />);
  const usage = screen.getByTestId('chat-usage-entry');
  expect(usage).toHaveClass('outline-button');
  fireEvent.click(usage);
  expect(closeMenu).toHaveBeenCalledOnce();
  expect(mocks.usage).toHaveBeenCalledOnce();
  const close = screen.getByRole('button', { name: '关闭当前对话' });
  expect(close).toHaveTextContent('关闭'); expect(close).toHaveAttribute('data-tone', 'danger');
  fireEvent.click(close);
  expect(closeConversation).toHaveBeenCalledOnce();
});
