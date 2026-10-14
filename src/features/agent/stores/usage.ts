/**
 * usage — persisted token accounting for AI turns (the usage panel's data source).
 *
 * One record per assistant turn, written from the token counts the provider reports.
 * Records are capped so the store cannot grow without bound; the panel filters the
 * kept records by time range.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UsageRecord } from '@features/agent/model/usageStats';

/** Newest records kept; older turns fall out of the panel. */
export const MAX_USAGE_RECORDS = 500;

export interface TurnUsageInput {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  /** Completed model steps of the turn. */
  steps?: number;
  /** Tool calls issued across those steps. */
  toolCalls?: number;
  /** Timestamp override for tests; defaults to the moment the record is written. */
  at?: number;
}

interface UsageState {
  records: UsageRecord[];
  recordTurn: (input: TurnUsageInput) => void;
  clear: () => void;
}

/** Ids are React keys only; a counter keeps them unique without touching crypto. */
let sequence = 0;

function count(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : 0;
}

export const useUsageStore = create<UsageState>()(
  persist(
    (set) => ({
      records: [],

      recordTurn: (input) =>
        set((state) => {
          const inputTokens = count(input.inputTokens);
          const outputTokens = count(input.outputTokens);
          const cachedInputTokens = count(input.cachedInputTokens);
          // Nothing reported (aborted before the provider answered) → no row.
          if (inputTokens + outputTokens + cachedInputTokens === 0) return state;
          const at = input.at ?? Date.now();
          const record: UsageRecord = {
            id: `u${at}-${sequence++}`,
            at,
            provider: input.provider,
            model: input.model,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            reasoningTokens: count(input.reasoningTokens),
            steps: count(input.steps),
            toolCalls: count(input.toolCalls),
          };
          const records = [...state.records, record];
          return { records: records.length > MAX_USAGE_RECORDS ? records.slice(-MAX_USAGE_RECORDS) : records };
        }),

      clear: () => set({ records: [] }),
    }),
    {
      name: 'vrykell-usage',
      version: 1,
      // A damaged payload must not leave the panel holding unknown records.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as { records?: unknown };
        return { ...current, records: Array.isArray(saved.records) ? (saved.records as UsageRecord[]) : [] };
      },
    },
  ),
);
