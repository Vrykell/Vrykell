import { create } from 'zustand';
import type { GitTarget } from '@core/git';

export const gitTargetKey = (target: GitTarget) => JSON.stringify([target.connectionId ?? '', target.cwd]);
export const useGitOperations = create<{
  drafts: Record<string, string>;
  busy: Record<string, string | undefined>;
  errors: Record<string, string | undefined>;
  draft: (key: string, value: string) => void;
  begin: (key: string, operation: string) => boolean;
  finish: (key: string, error?: string) => void;
}>((set, get) => ({
  drafts: {}, busy: {}, errors: {},
  draft: (key, value) => set(state => ({ drafts: { ...state.drafts, [key]: value } })),
  begin: (key, operation) => {
    if (get().busy[key]) return false;
    set(state => ({ busy: { ...state.busy, [key]: operation }, errors: { ...state.errors, [key]: undefined } }));
    return true;
  },
  finish: (key, error) => set(state => ({ busy: { ...state.busy, [key]: undefined }, errors: { ...state.errors, [key]: error } })),
}));
