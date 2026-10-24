export const GROUP_COLORS = ['blue', 'green', 'violet', 'amber', 'cyan', 'rose', 'orange', 'coral'] as const;

export type HistoryGroupColor = typeof GROUP_COLORS[number] | 'neutral';

/** Validates stored overrides before they reach the card markup. */
export function isHistoryGroupColor(value: unknown): value is HistoryGroupColor {
  return value === 'neutral' || (typeof value === 'string' && (GROUP_COLORS as readonly string[]).includes(value));
}

const semanticColors = new Map<string, HistoryGroupColor>([
  ['all', 'neutral'],
  ['cwd:unknown', 'neutral'],
  ['cwd:discussion', 'violet'],
  ['type:discussion', 'violet'],
  ['type:local', 'blue'],
  ['type:ssh', 'cyan'],
  ['type:mixed', 'rose'],
  ['terminal:default', 'neutral'],
  ['terminal:ssh', 'cyan'],
  ['terminal:discussion', 'violet'],
  ['terminal:mixed', 'rose'],
  ['cwd:multiple', 'neutral'],
]);

/** A stable key keeps the same group color across sorting, filtering and translated labels. */
export function historyGroupColor(id: string): HistoryGroupColor {
  const semanticColor = semanticColors.get(id);
  if (semanticColor) return semanticColor;
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return GROUP_COLORS[(hash >>> 0) % GROUP_COLORS.length];
}
