/**
 * usage — persisted token accounting for AI turns (the usage panel's data source).
 *
 * One record per assistant turn, written from the token counts the provider reports.
 * Records are capped so the store cannot grow without bound; the panel filters the
 * kept records by time range.
 *
 * ACP servers are accounted separately: the protocol reports the context window in use and the
 * cumulative cost per session, not per-turn token counts, so those records never pretend to have
 * an input/output split. One record per server, updated as its sessions run.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_USAGE_SOURCE, type AcpUsageRecord, type UsageRecord } from '@features/agent/model/usageStats';

/** Newest records kept; older turns fall out of the panel. */
export const MAX_USAGE_RECORDS = 500;

export interface TurnUsageInput {
  provider: string;
  model: string;
  /** Reporting agent; defaults to this app. */
  source?: string;
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

export interface AcpUsageUpdate {
  used?: number;
  size?: number;
  cost?: number;
  currency?: string;
}

interface UsageState {
  records: UsageRecord[];
  /** Per ACP server, keyed by its name. */
  acp: Record<string, AcpUsageRecord>;
  recordTurn: (input: TurnUsageInput) => void;
  /** A prompt turn finished on this server. */
  acpTurn: (source: string) => void;
  /** The server reported a tool call. */
  acpToolCall: (source: string) => void;
  /** The server reported context use and/or cost. */
  acpUsage: (source: string, update: AcpUsageUpdate) => void;
  clear: () => void;
}

/** Ids are React keys only; a counter keeps them unique without touching crypto. */
let sequence = 0;

function count(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : 0;
}

const freshAcp = (source: string): AcpUsageRecord => ({
  source, at: Date.now(), turns: 0, toolCalls: 0, contextUsed: 0, contextSize: 0, cost: null, currency: '',
});

export const useUsageStore = create<UsageState>()(
  persist(
    (set) => ({
      records: [],
      acp: {},

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
            source: input.source ?? DEFAULT_USAGE_SOURCE,
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

      acpTurn: (source) =>
        set((state) => {
          const current = state.acp[source] ?? freshAcp(source);
          return { acp: { ...state.acp, [source]: { ...current, turns: current.turns + 1, at: Date.now() } } };
        }),

      acpToolCall: (source) =>
        set((state) => {
          const current = state.acp[source] ?? freshAcp(source);
          return { acp: { ...state.acp, [source]: { ...current, toolCalls: current.toolCalls + 1, at: Date.now() } } };
        }),

      acpUsage: (source, update) =>
        set((state) => {
          const current = state.acp[source] ?? freshAcp(source);
          return {
            acp: {
              ...state.acp,
              [source]: {
                ...current,
                at: Date.now(),
                contextUsed: count(update.used ?? current.contextUsed),
                contextSize: count(update.size ?? current.contextSize),
                cost: Number.isFinite(update.cost) ? (update.cost as number) : current.cost,
                currency: update.currency ?? current.currency,
              },
            },
          };
        }),

      clear: () => set({ records: [], acp: {} }),
    }),
    {
      name: 'vrykell-usage',
      version: 3,
      // A payload written by an older build is passed through; the merge below fills what it lacks.
      migrate: (persisted) => persisted as { records?: unknown; acp?: unknown },
      // A damaged payload must not leave the panel holding unknown records; rows written by an
      // older build simply lack the newer fields (the source among them) and are filled in here.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as { records?: unknown; acp?: unknown };
        return {
          ...current,
          records: Array.isArray(saved.records)
            ? (saved.records as UsageRecord[]).map((record) => ({
                ...record,
                source: record.source || DEFAULT_USAGE_SOURCE,
              }))
            : [],
          acp: saved.acp && typeof saved.acp === 'object' ? (saved.acp as Record<string, AcpUsageRecord>) : {},
        };
      },
    },
  ),
);
