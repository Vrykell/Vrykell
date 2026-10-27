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
  /** Whether any source is loading */
  loading: boolean;
}

/** Runs a global search once (function form, not a hook) */
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

/** Hook: global search with state management */
export function useSearchEngine() {
  const [state, setState] = useState<SearchState>({
    query: '',
    sources: {},
    allResults: [],
    loading: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const search = useCallback((query: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    // Generate a new request ID (for race handling)
    requestIdRef.current += 1;
    const reqId = requestIdRef.current;

    setState({ query, sources: {}, allResults: [], loading: true });

    // Empty query: clear results
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

    // Clear the previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const sources = getSources();
      const enabled = searchQuerySources(query, getEnabledSourceIds());

      // Initialize the loading state of each source
      const sourceStates: Record<string, SourceState> = {};
      for (const s of sources) {
        if (enabled.has(s.id)) {
          sourceStates[s.id] = { loading: true, results: [] };
        }
      }
      setState((prev) => ({ ...prev, sources: sourceStates }));

      // Search every enabled source in parallel
      const promises = sources
        .filter((s) => enabled.has(s.id))
        .map(async (s) => {
          try {
            const results = await s.search(parseSearchQuery(query).term, {
              signal: controller.signal,
              onProgress: results => {
                if (reqId !== requestIdRef.current || controller.signal.aborted) return;
                setState(prev => {
                  const updated = { ...prev.sources, [s.id]: { loading: true, results } };
                  return { ...prev, sources: updated, allResults: Object.values(updated).flatMap(source => source.results) };
                });
              },
            });
            // Race check: discard the result if the request ID has changed
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

      // Wait for all sources to settle
      await Promise.allSettled(promises);
      if (reqId !== requestIdRef.current) return;
      setState((prev) => ({ ...prev, loading: false }));
    }, 150);
  }, []);

  // Clean up the debounce
  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { state, search };
}
