import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';

/** Stored command history layout: folded section ids and group ids, kept across launches. */
export const COMMAND_COLLAPSE_KEY = 'command-history-collapsed';

/** Corrupt or outdated payloads degrade to an expanded panel instead of failing hydration. */
export function readCommandCollapse(): Set<string> {
  const raw = safeLocalStorageGet(COMMAND_COLLAPSE_KEY);
  const parsed = raw ? safeJsonParse<unknown>(raw) : null;
  return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && !!id) : []);
}

export function writeCommandCollapse(collapsed: ReadonlySet<string>): void {
  safeLocalStorageSet(COMMAND_COLLAPSE_KEY, JSON.stringify([...collapsed]));
}
