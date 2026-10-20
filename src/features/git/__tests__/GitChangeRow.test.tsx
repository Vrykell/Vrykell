import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import GitChangeRow from '../components/GitChangeRow';

it('reveals file actions on hover without opening a comparison when an action is selected', () => {
  const compare = vi.fn(); const discard = vi.fn(); const open = vi.fn();
  render(<GitChangeRow entry={{ path: 'src/main.ts', previousPath: null, indexStatus: 'M', worktreeStatus: 'M' }} scope="unstaged" active={false} busy={false}
    compare={compare} open={open} discard={discard} stage={() => {}} />);
  expect(screen.getByRole('button', { name: '放弃更改' })).not.toBeVisible();
  fireEvent.mouseEnter(screen.getByTestId('git-unstaged-src/main.ts'));
  expect(screen.getByRole('button', { name: '放弃更改' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
  fireEvent.click(screen.getByRole('button', { name: '打开工作文件' }));
  expect(discard).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce(); expect(compare).not.toHaveBeenCalled();
});
it('provides an explicit resolution action for a conflicted file', () => {
  const resolve = vi.fn();
  render(<GitChangeRow entry={{ path: 'file.ts', previousPath: null, indexStatus: 'U', worktreeStatus: 'U' }} scope="conflicts" active={false} busy={false}
    compare={() => {}} open={() => {}} discard={() => {}} stage={resolve} />);
  fireEvent.mouseEnter(screen.getByTestId('git-conflicts-file.ts'));
  fireEvent.click(screen.getByRole('button', { name: '标记为已解决' }));
  expect(resolve).toHaveBeenCalledOnce(); expect(screen.queryByRole('button', { name: '放弃更改' })).toBeNull();
});
