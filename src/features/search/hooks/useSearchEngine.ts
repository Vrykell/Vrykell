import { canSearchQuery, parseSearchQuery, searchQuerySources } from '../model/searchQuery';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { SearchResult } from '@features/search/types';
import { getSources, getEnabledSourceIds } from '@features/search/services/registry';

interface SourceState {
  loading: boolean;
  results: SearchResult[];
  error?: string;
}

export interface SearchState {
  query: string;
  sources: Record<string, SourceState>;
  allResults: SearchResult[];
  /** 是否正在（任意源）加载 */
  loading: boolean;
}

/** 执行一次全局搜索（函数版本，非 hook） */
export async function globalSearch(query: string): Promise<SearchResult[]> {
  if (!canSearchQuery(query)) return [];

  const sources = getSources();
  const enabled = searchQuerySources(query, getEnabledSourceIds());

  const promises = sources
    .filter((s) => enabled.has(s.id))
    .map((s) =>
      s.search(parseSearchQuery(query).term).catch((err) => {
        console.warn(`Search source "${s.id}" failed:`, err);
        return [] as SearchResult[];
      }),
    );

  const results = await Promise.all(promises);
  return results.flat();
}

/** React hook：带状态管理的全局搜索 */
export function useSearchEngine() {
  const [state, setState] = useState<SearchState>({
    query: '',
    sources: {},
    allResults: [],
    loading: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const search = useCallback((query: string) => {
    // 生成新的请求 ID（用于竞态处理）
    requestIdRef.current += 1;
    const reqId = requestIdRef.current;

    setState({ query, sources: {}, allResults: [], loading: true });

    // 空查询：清空结果
    if (!canSearchQuery(query)) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setState({
        query: '',
        sources: {},
        allResults: [],
        loading: false,
      });
      return;
    }

    // 清除上一次的 debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const sources = getSources();
      const enabled = searchQuerySources(query, getEnabledSourceIds());

      // 初始化每个源的 loading 状态
      const sourceStates: Record<string, SourceState> = {};
      for (const s of sources) {
        if (enabled.has(s.id)) {
          sourceStates[s.id] = { loading: true, results: [] };
        }
      }
      setState((prev) => ({ ...prev, sources: sourceStates }));

      // 并行搜索每个已启用的源
      const promises = sources
        .filter((s) => enabled.has(s.id))
        .map(async (s) => {
          try {
            const results = await s.search(parseSearchQuery(query).term);
            // 竞态检查：如果请求 ID 已变，丢弃结果
            if (reqId !== requestIdRef.current) return;
            setState((prev) => {
              const updated = { ...prev.sources };
              updated[s.id] = { loading: false, results };
              const all = Object.values(updated).flatMap((ss) => ss.results);
              return { ...prev, sources: updated, allResults: all };
            });
          } catch (err) {
            console.warn(`Search source "${s.id}" failed:`, err);
            if (reqId !== requestIdRef.current) return;
            setState((prev) => {
              const updated = { ...prev.sources };
              updated[s.id] = { loading: false, results: [], error: String(err) };
              return { ...prev, sources: updated };
            });
          }
        });

      // 等待所有源完成
      await Promise.allSettled(promises);
      if (reqId !== requestIdRef.current) return;
      setState((prev) => ({ ...prev, loading: false }));
    }, 150);
  }, []);

  // 清理 debounce
  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { state, search };
}
