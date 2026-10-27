/**
 * agentSettings — agent-related UI settings (persisted in localStorage).
 *
 * Layered design (so settings do not later grow into one flat table):
 *   - global: global defaults (behavior defaults + global preferences)
 *   - overrides: per model id → behavior overrides (only the differences)
 *   - resolve(modelId): merges global with that model's override into the effective value
 *
 * Division of labor with config.json on the backend: this file holds UI/behavior preferences that
 * take effect immediately; connection settings such as key/provider/model stay in the backend (see
 * the mirror store in stores/aiConfig.ts).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ShellType } from '@platform/shells';

/** Context management strategy (agent-style). */
export type ContextStrategy = 'off' | 'window' | 'compact';

/** Behavior settings that can be bound per model (each model may override them; they describe how the model is used). */
export interface ModelBehaviorSettings {
  /** Agent mode: on = register every tool; off = pure chat (no tools). */
  agentMode: boolean;
  /** Deep-thinking switch (passes reasoning_effort / thinking budget through providerOptions). */
  deepThink: boolean;
  /** Thinking effort: low/medium/high (applies when deepThink is on). */
  thinkingLevel: 'low' | 'medium' | 'high';
  /** Maximum number of steps (stepCountIs in the model SDK; 1–100). */
  maxSteps: number;
  /** Context strategy: off = full history; window = token-budget window; compact = budget + automatic summary compression. */
  contextStrategy: ContextStrategy;
  /** Context token budget (estimated); 0 = unlimited. */
  contextMaxTokens: number;
  /** Upper bound for a compact summary (tokens). */
  contextSummaryTokens: number;
  /** Characters kept per tool output before truncation. */
  contextToolChars: number;
  /** Reply token limit; 0 = provider default (raised to 16000 for Anthropic deep thinking). */
  maxOutputTokens: number;
  /** Sampling temperature; null = provider default. */
  temperature: number | null;
  /** Custom system prompt (empty = use the built-in default prompt). */
  systemPrompt: string;
}

/** Global preferences (application-wide, not overridden per model). */
export interface GlobalPrefs {
  /** Automatic title generation switch. */
  autoTitle: boolean;
  /** Model used for titles (empty = reuse the chat model). */
  titleModel: string;
  /** Command autocomplete switch. */
  completeEnabled: boolean;
  /** Model used for completion (empty = reuse the chat model). */
  completeModel: string;
  /** Completion debounce in milliseconds. */
  completeDebounceMs: number;
  /** Default opening mode per shell type (bash/zsh/powershell/...). */
  openModeByShell: Record<ShellType, 'classic' | 'block'>;
  /** Opening mode for SSH connection terminals: block = inject shell integration into the remote host (falls back to classic on failure). */
  sshOpenMode: 'classic' | 'block';
}

/** Effective settings = behavior + global preferences. */
export type AgentSettings = ModelBehaviorSettings & GlobalPrefs;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  agentMode: true,
  deepThink: false,
  thinkingLevel: 'high',
  autoTitle: true,
  titleModel: '',
  completeEnabled: true,
  completeModel: '',
  completeDebounceMs: 200,
  openModeByShell: {
    zsh: 'block',
    bash: 'block',
    powershell: 'block',
    pwsh: 'block',
    cmd: 'classic',
  },
  sshOpenMode: 'classic',
  maxSteps: 50,
  contextStrategy: 'compact',
  contextMaxTokens: 24000,
  contextSummaryTokens: 400,
  contextToolChars: 8192,
  maxOutputTokens: 0,
  temperature: null,
  systemPrompt: '',
};

interface AgentSettingsState {
  global: AgentSettings;
  overrides: Record<string, Partial<ModelBehaviorSettings>>;
  /** Update the global defaults (global preferences and behavior defaults). */
  update: (patch: Partial<AgentSettings>) => void;
  /** Update one model's behavior overrides. */
  updateModel: (modelId: string, patch: Partial<ModelBehaviorSettings>) => void;
  /** Clear one model's behavior overrides (falls back to the global defaults). */
  resetModel: (modelId: string) => void;
  /** Merge global defaults with the model overrides into the effective values; no modelId = global only. */
  resolve: (modelId?: string) => AgentSettings;
}

/** Default opening mode for a local shell; unknown shells fall back to block. SSH is always classic and does not go through here. */
export function defaultOpenModeForShell(shellType?: string): 'classic' | 'block' {
  if (shellType === 'cmd') return 'classic';
  const t = (shellType || 'zsh') as ShellType;
  const map = useAgentSettings.getState().global.openModeByShell;
  return (map && map[t]) || 'block';
}

export const useAgentSettings = create<AgentSettingsState>()(
  persist(
    (set, get) => ({
      global: { ...DEFAULT_AGENT_SETTINGS },
      overrides: {},
      update: (patch) => set((s) => ({ global: { ...s.global, ...patch } })),
      updateModel: (modelId, patch) => {
        if (!modelId) {
          get().update(patch);
          return;
        }
        set((s) => ({
          overrides: { ...s.overrides, [modelId]: { ...s.overrides[modelId], ...patch } },
        }));
      },
      resetModel: (modelId) =>
        set((s) => {
          if (!(modelId in s.overrides)) return s;
          const overrides = { ...s.overrides };
          delete overrides[modelId];
          return { overrides };
        }),
      resolve: (modelId) => {
        const s = get();
        const ov = modelId ? s.overrides[modelId] : undefined;
        return { ...s.global, ...ov };
      },
    }),
    {
      name: 'vrykell-agent-settings',
      version: 8,
      migrate: (persisted: unknown, version: number) => {
        // v0/v1 (flat) → collect into global; v2 (missing new fields) → fill in defaults.
        let state: { global: AgentSettings; overrides: Record<string, Partial<ModelBehaviorSettings>> };
        if (version < 2 && persisted && typeof persisted === 'object' && !(persisted as { global?: unknown }).global) {
          const flat = persisted as Record<string, unknown>;
          const global: AgentSettings = { ...DEFAULT_AGENT_SETTINGS };
          for (const k of Object.keys(DEFAULT_AGENT_SETTINGS) as (keyof AgentSettings)[]) {
            if (k in flat) {
              (global as unknown as Record<string, unknown>)[k] = flat[k];
            }
          }
          state = { global, overrides: {} };
        } else {
          state = persisted as { global: AgentSettings; overrides: Record<string, Partial<ModelBehaviorSettings>> };
        }
        // Any version → fill missing global fields and ensure overrides exists.
        if (state && typeof state === 'object') {
          state.global = { ...DEFAULT_AGENT_SETTINGS, ...(state.global ?? {}) };
          state.overrides = state.overrides ?? {};
        }
        // v7: raise the old tool-call limit default (<50) to 50.
        if (state && typeof state.global.maxSteps === 'number' && state.global.maxSteps < 50) {
          state.global.maxSteps = 50;
        }
        return state;
      },
    },
  ),
);
