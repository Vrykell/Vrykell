import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GitTarget } from '@core/git';

export const DEFAULT_COMMIT_PROMPT = 'Write a concise English commit message for the staged changes. Use an imperative subject with a conventional prefix (feat:, fix:, refactor:, docs:, test:, chore:). Add a short body only when useful. Return only the message, without markdown fences or quotes.';
export const gitWorkspaceKey = (target: GitTarget) => JSON.stringify([target.connectionId ?? '', target.cwd]);
export type GitDiffMode = 'single' | 'multiple';
interface GitPreferences {
  diffMode: GitDiffMode;
  changesView: 'list' | 'tree';
  commitPrompts: Record<string, string>;
  setDiffMode: (mode: GitDiffMode) => void;
  setChangesView: (view: 'list' | 'tree') => void;
  setCommitPrompt: (target: GitTarget, prompt: string) => void;
}
export const useGitPreferences = create<GitPreferences>()(persist(set => ({
  diffMode: 'single', changesView: 'list', commitPrompts: {},
  setDiffMode: diffMode => set({ diffMode }),
  setChangesView: changesView => set({ changesView }),
  setCommitPrompt: (target, prompt) => set(state => {
    const commitPrompts = { ...state.commitPrompts };
    const key = gitWorkspaceKey(target);
    if (prompt.trim()) commitPrompts[key] = prompt.trim(); else delete commitPrompts[key];
    return { commitPrompts };
  }),
}), {
  name: 'vrykell-git-preferences',
  merge: (saved, current) => {
    const value = saved as Partial<GitPreferences> | null;
    const prompts = value?.commitPrompts;
    return { ...current, diffMode: value?.diffMode === 'multiple' ? 'multiple' : 'single',
      changesView: value?.changesView === 'tree' ? 'tree' : 'list',
      commitPrompts: prompts && typeof prompts === 'object' ? Object.fromEntries(Object.entries(prompts).filter(([key, prompt]) => key.startsWith('[') && typeof prompt === 'string')) : {},
    };
  },
}));
export const gitCommitPrompt = (target: GitTarget) => useGitPreferences.getState().commitPrompts[gitWorkspaceKey(target)] || DEFAULT_COMMIT_PROMPT;
