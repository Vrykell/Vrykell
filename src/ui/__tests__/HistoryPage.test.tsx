import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import HistoryPage from '../HistoryPage';

function Harness({ change }: { change: (value: string) => void }) {
  const [query, setQuery] = useState('');
  return <HistoryPage pageTestId="history" listLabel="History" icon={null} title="History" count="2"
    query={query} onQueryChange={value => { setQuery(value); change(value); }} searchLabel="Search history" searchPlaceholder="Search…"
    searchTestId="history-search"><div>Rows</div></HistoryPage>;
}

it('uses a compact search action and clears the query when closed', () => {
  const change = vi.fn();
  render(<Harness change={change} />);
  expect(screen.queryByTestId('history-search')).toBeNull();
  const toggle = screen.getByTestId('history-search-toggle');
  fireEvent.click(toggle);
  const input = screen.getByTestId('history-search');
  expect(input.closest('.history-search')?.nextElementSibling).toHaveClass('history-actions');
  fireEvent.change(input, { target: { value: 'Deploy' } });
  expect(change).toHaveBeenLastCalledWith('Deploy');
  fireEvent.blur(input);
  expect(change).toHaveBeenLastCalledWith('Deploy');
  expect(screen.queryByTestId('history-search')).toBeNull();
  fireEvent.click(screen.getByTestId('history-search-toggle'));
  const reopened = screen.getByTestId('history-search');
  expect(reopened).toHaveValue('Deploy');
  fireEvent.keyDown(reopened, { key: 'Escape' });
  expect(change).toHaveBeenLastCalledWith('');
  expect(screen.queryByTestId('history-search')).toBeNull();
});
