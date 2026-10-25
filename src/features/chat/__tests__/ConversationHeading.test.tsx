import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ConversationHeading from '../components/ConversationHeading';

afterEach(cleanup);

it('shows the conversation title with history, settings and new in a stable order', () => {
  const rename = vi.fn(); const create = vi.fn();
  render(<ConversationHeading title="Build investigation" onRename={rename} onHistory={() => {}} onNew={create} settings={<button>Settings</button>} />);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['重命名对话', 'AI 对话历史', 'Settings', '新对话']);
  fireEvent.click(screen.getByRole('button', { name: '重命名对话' }));
  fireEvent.change(screen.getByRole('textbox', { name: '对话标题' }), { target: { value: 'New title' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(rename).toHaveBeenCalledWith('New title');
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(create).toHaveBeenCalledOnce();
});

it('uses the same heading for an agent title without offering an unsupported rename', () => {
  render(<ConversationHeading title="Agent task" onHistory={() => {}} onNew={() => {}} settings={<button>Settings</button>} />);
  expect(screen.getByText('Agent task')).toBeVisible();
  expect(screen.queryByRole('button', { name: '重命名对话' })).toBeNull();
});
