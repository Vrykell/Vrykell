import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AiStartPage from '../components/AiStartPage';

vi.mock('@features/workspace/components/AgentLauncher', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog" /> : null),
}));

it('closes the start page picker when switching away and keeps the new conversation action', () => {
  const onNewConversation = vi.fn();
  const onPick = vi.fn();
  const view = render(<AiStartPage active onNewConversation={onNewConversation} onPick={onPick} />);
  fireEvent.click(screen.getByTestId('ai-start-new-conversation'));
  expect(onNewConversation).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTestId('ai-start-agents'));
  expect(screen.getByRole('dialog')).toBeVisible();
  view.rerender(<AiStartPage active={false} onNewConversation={onNewConversation} onPick={onPick} />);
  view.rerender(<AiStartPage active onNewConversation={onNewConversation} onPick={onPick} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
