import { beforeEach, describe, expect, it } from 'vitest';
import { useSearchHistoryStore } from '@features/search/stores/searchHistory';

describe('search history store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSearchHistoryStore.setState({ items: [] });
  });

  it('忽略空查询并去重，最新查询排最前', () => {
    const { add } = useSearchHistoryStore.getState();

    add('  ');
    add('alpha');
    add('beta');
    add('alpha');

    expect(useSearchHistoryStore.getState().items).toEqual(['alpha', 'beta']);
  });

  it('最多保留 20 条记录', () => {
    const { add } = useSearchHistoryStore.getState();
    for (let index = 0; index < 25; index += 1) add(`query-${index}`);

    const items = useSearchHistoryStore.getState().items;
    expect(items).toHaveLength(20);
    expect(items[0]).toBe('query-24');
    expect(items[items.length - 1]).toBe('query-5');
  });

  it('支持删除单条和清空', () => {
    useSearchHistoryStore.getState().add('alpha');
    useSearchHistoryStore.getState().add('beta');

    useSearchHistoryStore.getState().remove('alpha');
    expect(useSearchHistoryStore.getState().items).toEqual(['beta']);

    useSearchHistoryStore.getState().clear();
    expect(useSearchHistoryStore.getState().items).toEqual([]);
    expect(localStorage.getItem('vrykell-search-history')).toBeNull();
  });
});
