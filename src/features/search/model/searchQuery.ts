import type { ResultType } from '../types';

export const SEARCH_PREFIXES: { prefix: string; source: ResultType; alias: string }[] = [
  { prefix: '>', source: 'action', alias: 'action' },
  { prefix: '@', source: 'setting', alias: 'setting' },
  { prefix: '/', source: 'file', alias: 'file' },
  { prefix: '!', source: 'history', alias: 'history' },
  { prefix: '#', source: 'block', alias: 'output' },
  { prefix: '%', source: 'session', alias: 'session' },
];

/** Scope prefixes apply only to this query, leaving source preferences intact. */
export function parseSearchQuery(input: string): { term: string; source?: ResultType; prefix?: string } {
  const trimmed = input.trimStart();
  for (const scope of SEARCH_PREFIXES) {
    if (trimmed.startsWith(scope.prefix)) return { term: trimmed.slice(1).trimStart(), source: scope.source, prefix: scope.prefix };
    const alias = `${scope.alias}:`;
    if (trimmed.toLowerCase().startsWith(alias)) return { term: trimmed.slice(alias.length).trimStart(), source: scope.source, prefix: scope.prefix };
  }
  return { term: input };
}

export function searchQuerySources(input: string, enabled: Set<ResultType>): Set<ResultType> {
  const parsed = parseSearchQuery(input);
  return parsed.source ? new Set([parsed.source]) : enabled;
}

export function canSearchQuery(input: string): boolean {
  const parsed = parseSearchQuery(input);
  return Boolean(parsed.term.trim()) || parsed.source === 'action' || parsed.source === 'setting';
}
