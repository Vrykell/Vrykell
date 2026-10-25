import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import QueuedMessages from '../components/QueuedMessages';

afterEach(cleanup);
it('shows queued inputs in order and removes only the chosen item', () => {
  const cancel = vi.fn();
  const view = render(<QueuedMessages messages={[{ id: 'first', text: 'Follow up' }, { id: 'second', text: '' }]} onCancel={cancel} />);
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Follow up');
  expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('包含附件的消息');
  fireEvent.click(screen.getAllByRole('button', { name: '取消待发送消息' })[1]);
  expect(cancel).toHaveBeenCalledWith('second');
  view.rerender(<QueuedMessages messages={[]} onCancel={cancel} />);
  expect(screen.queryByRole('list')).toBeNull();
});
