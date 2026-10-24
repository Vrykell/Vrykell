import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import HistoryPage from '@ui/history/HistoryPage';

it('requests only one page per bottom boundary and waits for composition before searching', () => {
  const onLoadMore = vi.fn(); const onQueryChange = vi.fn();
  const props = { pageTestId: 'history', listLabel: 'History', icon: null, title: 'History', count: '', query: 'a', onQueryChange, searchLabel: 'Search', searchPlaceholder: '', searchTestId: 'search', onLoadMore, children: null };
  render(<HistoryPage {...props} />);
  const list = screen.getByLabelText('History');
  Object.defineProperties(list, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 500 }, scrollTop: { configurable: true, value: 500 } });
  fireEvent.scroll(list); fireEvent.scroll(list); expect(onLoadMore).toHaveBeenCalledTimes(1);
  Object.defineProperties(list, { scrollHeight: { configurable: true, value: 1500 }, scrollTop: { configurable: true, value: 1000 } });
  fireEvent.scroll(list); expect(onLoadMore).toHaveBeenCalledTimes(2);
  const input = screen.getByTestId('search');
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: 'word' } });
  expect(onQueryChange).not.toHaveBeenCalled(); expect(input).toHaveValue('word');
  fireEvent.compositionEnd(input, { data: 'word' }); expect(onQueryChange).toHaveBeenCalledWith('word');
  fireEvent.click(screen.getByRole('button', { name: '清空搜索' })); expect(onQueryChange).toHaveBeenLastCalledWith('');
});
