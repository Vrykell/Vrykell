import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SshForwardingEditor from '../components/SshForwardingEditor';

it('uses the same compact add action as environment variables without an empty-state caption', () => {
  const change = vi.fn();
  render(<SshForwardingEditor value={{ local: '', remote: '', dynamic: '' }} onChange={change} />);
  expect(screen.queryByText('暂无转发规则，添加规则以映射端口。')).toBeNull();
  const button = screen.getByTestId('ssh-forward-add');
  expect(button).toHaveClass('text-control', 'ssh-editor-link');
  fireEvent.click(button); expect(screen.getByTestId('ssh-forward-rule-0')).toBeVisible();
  expect(change).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '删除转发规则' })).toHaveAttribute('data-tone', 'danger');
});
