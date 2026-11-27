import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UnifiedStartPage from '../components/UnifiedStartPage';

it('offers the six workspace actions and anchors each picker to its trigger', () => {
  const create = vi.fn();
  const terminal = vi.fn();
  const server = vi.fn();
  const agent = vi.fn();
  const open = vi.fn();
  render(<UnifiedStartPage onNew={create} onTerminal={terminal} onOpen={open} onConnect={server} onAgent={agent} />);
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('聚合工作区');
  expect(screen.getAllByRole('button')).toHaveLength(6);
  fireEvent.click(screen.getByRole('button', { name: '新建文件' }));
  expect(create).toHaveBeenLastCalledWith('document');
  fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(create).toHaveBeenLastCalledWith('conversation');
  for (const [name, action, left] of [
    ['新终端', terminal, 20],
    ['连接服务器', server, 50],
    ['ACP 智能体', agent, 80],
  ] as const) {
    const trigger = screen.getByRole('button', { name });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, 10, 40, 30));
    fireEvent.click(trigger);
    expect(action).toHaveBeenCalledExactlyOnceWith({ x: left, y: 44, align: 'start', below: true });
  }
});
