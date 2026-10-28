import { beforeEach, describe, expect, it } from 'vitest';
import { useSearchHistoryStore } from '@features/search/stores/searchHistory';

describe('search history store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSearchHistoryStore.setState({ items: [] });
  });

  it('ignores empty queries, deduplicates and keeps the newest query first', () => {
    const { add } = useSearchHistoryStore.getState();

    add('  ');
    add('alpha');
    add('beta');
    add('alpha');

    expect(useSearchHistoryStore.getState().items).toEqual(['alpha', 'beta']);
  });

  it('keeps at most 20 entries', () => {
    const { add } = useSearchHistoryStore.getState();
    for (let index = 0; index < 25; index += 1) add(`query-${index}`);

    const items = useSearchHistoryStore.getState().items;
    expect(items).toHaveLength(20);
    expect(items[0]).toBe('query-24');
    expect(items[items.length - 1]).toBe('query-5');
  });

  it('removes a single entry and clears the list', () => {
    useSearchHistoryStore.getState().add('alpha');
    useSearchHistoryStore.getState().add('beta');

    useSearchHistoryStore.getState().remove('alpha');
    expect(useSearchHistoryStore.getState().items).toEqual(['beta']);

    useSearchHistoryStore.getState().clear();
    expect(useSearchHistoryStore.getState().items).toEqual([]);
    expect(localStorage.getItem('vrykell-search-history')).toBeNull();
  });
});
