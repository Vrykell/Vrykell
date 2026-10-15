import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Storage key shared by the terminal and AI history pages. */
export const HISTORY_META_STORAGE_KEY = 'vrykell-history-meta';

type Flags = Record<string, true>;

export interface HistoryMetaState {
  /** Record keys the user starred, shown by the starred-only filter. */
  starred: Flags;
  /** Free-form note per record key; empty notes are removed. */
  notes: Record<string, string>;
  /** Group keys pinned to the top of their grouping mode. */
  pinnedGroups: Flags;
  /** Manual color override per group key; missing keys keep the automatic color. */
  groupColors: Record<string, string>;
  /** Deletion protection follows each record across all grouping modes. */
  lockedRecords: Flags;
  /** Display aliases leave automatic membership and canonical ordering unchanged. */
  groupTitles: Record<string, string>;
  groupNotes: Record<string, string>;
  /** Each grouping mode remembers its own collapsed cards. */
  collapsedGroups: Flags;
}

export interface HistoryMetaStore extends HistoryMetaState {
  toggleStar: (key: string) => void;
  setNote: (key: string, note: string | null) => void;
  togglePinnedGroup: (key: string) => void;
  setGroupColor: (key: string, color: string | null) => void;
  setStarred: (keys: readonly string[], value: boolean) => void;
  setLocked: (keys: readonly string[], value: boolean) => void;
  setGroupTitle: (key: string, value: string | null) => void;
  setGroupNote: (key: string, value: string | null) => void;
  setGroupsCollapsed: (keys: readonly string[], value: boolean) => void;
  removeRecords: (keys: readonly string[]) => void;
}

/** Namespaced record key; both history pages share one annotation store. */
export function historyRecordKey(scope: 'session' | 'conversation', id: string): string {
  return `${scope}:${id}`;
}

/** Group overrides bind to a single grouping mode, so each mode keeps its own identity. */
export function historyGroupKey(scope: 'session' | 'conversation', groupBy: string, groupId: string): string {
  return `${scope}/${groupBy}/${groupId}`;
}

/** Plain record ids of one scope, used by the starred-only filters. */
export function scopedIds(flags: Flags, scope: 'session' | 'conversation'): Set<string> {
  const prefix = `${scope}:`;
  const ids = new Set<string>();
  for (const key of Object.keys(flags)) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  }
  return ids;
}

/** Plain group ids pinned within one scope and grouping mode. */
export function scopedGroupIds(flags: Flags, scope: 'session' | 'conversation', groupBy: string): Set<string> {
  const prefix = `${scope}/${groupBy}/`;
  const ids = new Set<string>();
  for (const key of Object.keys(flags)) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  }
  return ids;
}

/** Annotation search supplements record text; date, type and starred filters still apply. */
export function historySearchAnnotations(
  scope: 'session' | 'conversation',
  groupBy: string,
  groups: readonly { id: string; title: string; recordIds: readonly string[] }[],
  meta: Pick<HistoryMetaState, 'notes' | 'groupTitles' | 'groupNotes'>,
): Map<string, string> {
  const text = new Map<string, string>();
  for (const group of groups) {
    const key = historyGroupKey(scope, groupBy, group.id);
    for (const id of group.recordIds) {
      text.set(id, [group.title, meta.groupTitles[key], meta.groupNotes[key], meta.notes[historyRecordKey(scope, id)]].filter(Boolean).join(' '));
    }
  }
  return text;
}

function toggleFlag(flags: Flags, key: string): Flags {
  const next = { ...flags };
  if (next[key]) delete next[key];
  else next[key] = true;
  return next;
}

function setString(map: Record<string, string>, key: string, value: string | null): Record<string, string> {
  const next = { ...map };
  const trimmed = value?.trim() ?? '';
  if (trimmed) next[key] = trimmed;
  else delete next[key];
  return next;
}

function setFlags(flags: Flags, keys: readonly string[], value: boolean): Flags {
  const next = { ...flags };
  for (const key of keys) {
    if (value) next[key] = true;
    else delete next[key];
  }
  return next;
}

function omitKeys<T>(values: Record<string, T>, keys: readonly string[]): Record<string, T> {
  const next = { ...values };
  for (const key of keys) delete next[key];
  return next;
}

function flagRecord(value: unknown): Flags {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const next: Flags = {};
  for (const [key, entry] of Object.entries(source)) {
    if (entry === true) next[key] = true;
  }
  return next;
}

function stringRecord(value: unknown): Record<string, string> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === 'string' && entry.trim()) next[key] = entry;
  }
  return next;
}

/** Corrupt or outdated payloads degrade to an empty annotation set instead of failing hydration. */
function sanitize(raw: unknown): HistoryMetaState {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    starred: flagRecord(source.starred),
    notes: stringRecord(source.notes),
    pinnedGroups: flagRecord(source.pinnedGroups),
    groupColors: stringRecord(source.groupColors),
    lockedRecords: flagRecord(source.lockedRecords),
    groupTitles: stringRecord(source.groupTitles),
    groupNotes: stringRecord(source.groupNotes),
    collapsedGroups: flagRecord(source.collapsedGroups),
  };
}

export const useHistoryMetaStore = create<HistoryMetaStore>()(persist(
  (set) => ({
    starred: {},
    notes: {},
    pinnedGroups: {},
    groupColors: {},
    lockedRecords: {},
    groupTitles: {},
    groupNotes: {},
    collapsedGroups: {},
    toggleStar: (key) => set((state) => ({ starred: toggleFlag(state.starred, key) })),
    setNote: (key, note) => set((state) => ({ notes: setString(state.notes, key, note) })),
    togglePinnedGroup: (key) => set((state) => ({ pinnedGroups: toggleFlag(state.pinnedGroups, key) })),
    setGroupColor: (key, color) => set((state) => ({ groupColors: setString(state.groupColors, key, color) })),
    setStarred: (keys, value) => set(state => ({ starred: setFlags(state.starred, keys, value) })),
    setLocked: (keys, value) => set(state => ({ lockedRecords: setFlags(state.lockedRecords, keys, value) })),
    setGroupTitle: (key, value) => set(state => ({ groupTitles: setString(state.groupTitles, key, value) })),
    setGroupNote: (key, value) => set(state => ({ groupNotes: setString(state.groupNotes, key, value) })),
    setGroupsCollapsed: (keys, value) => set(state => ({ collapsedGroups: setFlags(state.collapsedGroups, keys, value) })),
    removeRecords: keys => set(state => ({
      starred: omitKeys(state.starred, keys), notes: omitKeys(state.notes, keys),
      lockedRecords: omitKeys(state.lockedRecords, keys),
    })),
  }),
  {
    name: HISTORY_META_STORAGE_KEY,
    version: 1,
    partialize: (state) => ({
      starred: state.starred,
      notes: state.notes,
      pinnedGroups: state.pinnedGroups,
      groupColors: state.groupColors,
      lockedRecords: state.lockedRecords,
      groupTitles: state.groupTitles,
      groupNotes: state.groupNotes,
      collapsedGroups: state.collapsedGroups,
    }),
    merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
  },
));
