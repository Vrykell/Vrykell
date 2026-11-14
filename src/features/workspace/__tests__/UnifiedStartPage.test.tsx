import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UnifiedStartPage from '../components/UnifiedStartPage';

it('offers the mixed-work creation and connection actions on one simple page', () => {
  const create = vi.fn(); const server = vi.fn(); const agent = vi.fn(); const open = vi.fn();
  render(<UnifiedStartPage onNew={create} onOpen={open} onConnect={server} onAgent={agent} />);
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('聚合工作区');
  fireEvent.click(screen.getByRole('button', { name: '新建文件' })); expect(create).toHaveBeenLastCalledWith('document');
  fireEvent.click(screen.getByRole('button', { name: '打开文件' })); expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' })); expect(server).toHaveBeenCalledOnce(); expect(agent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /ACP/ })); expect(agent).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '新终端' })); expect(create).toHaveBeenLastCalledWith('terminal');
  fireEvent.click(screen.getByRole('button', { name: '新对话' })); expect(create).toHaveBeenLastCalledWith('conversation');
});

it('no longer offers a history destination', () => {
  render(<UnifiedStartPage onNew={vi.fn()} onOpen={vi.fn()} onConnect={vi.fn()} onAgent={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /历史/ })).toBeNull();
});
