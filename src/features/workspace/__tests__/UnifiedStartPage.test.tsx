import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import UnifiedStartPage from '../components/UnifiedStartPage';

it('provides a distinct mixed-work landing page with real creation, history and live resource actions', () => {
  const select = vi.fn(); const create = vi.fn(); const history = vi.fn();
  render(<UnifiedStartPage resources={[{ id: 'terminal:one', tabId: 'one', kind: 'terminal', title: 'Work shell' }]} icon={() => null}
    onSelect={select} onNew={create} onOpen={vi.fn()} onConnect={vi.fn()} onHistory={history} />);
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('聚合工作区');
  fireEvent.click(screen.getByRole('button', { name: '新建文件' })); expect(create).toHaveBeenCalledWith('document');
  fireEvent.click(screen.getByRole('button', { name: '全部历史' })); expect(history).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Work shell' })); expect(select).toHaveBeenCalledWith('terminal:one');
});
