import { create } from 'zustand';
import type { SearchSource, ResultType } from '@features/search/types';

const sources = new Map<ResultType, SearchSource>();

/** 注册搜索源（各 source 文件 import 时自动调用） */
export function registerSource(source: SearchSource) {
  if (!sources.has(source.id)) {
    sources.set(source.id, source);
  }
}

/** 获取所有已注册的源 */
export function getSources(): SearchSource[] {
  return Array.from(sources.values());
}

/** 获取指定 ID 的源 */
export function getSource(id: ResultType): SearchSource | undefined {
  return sources.get(id);
}

/** 获取所有源 ID */
export function getSourceIds(): ResultType[] {
  return Array.from(sources.keys());
}

// ── 过滤器 — 已启用源 ID 集合（zustand store，保证切换后结果/UI 响应式刷新） ──

const DEFAULT_ENABLED: ResultType[] = ['history', 'block', 'file', 'setting', 'action', 'session'];

interface EnabledSourcesState {
  enabledIds: Set<ResultType>;
  toggle: (id: ResultType, enabled: boolean) => void;
  setAll: (ids: Set<ResultType>) => void;
}

export const useEnabledSourcesStore = create<EnabledSourcesState>((set, get) => ({
  enabledIds: new Set(DEFAULT_ENABLED),
  toggle: (id, enabled) => {
    const next = new Set(get().enabledIds);
    if (enabled) next.add(id);
    else next.delete(id);
    set({ enabledIds: next });
  },
  setAll: (ids) => set({ enabledIds: ids }),
}));

/** 获取已启用的源 ID（非响应式，供 engine 等非组件代码读取） */
export function getEnabledSourceIds(): Set<ResultType> {
  return useEnabledSourcesStore.getState().enabledIds;
}

/** 切换某个源的启用状态（向后兼容的同步封装） */
export function toggleSource(id: ResultType, enabled: boolean) {
  useEnabledSourcesStore.getState().toggle(id, enabled);
}
