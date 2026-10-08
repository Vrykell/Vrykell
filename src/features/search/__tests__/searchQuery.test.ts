import { describe, expect, it, vi } from 'vitest';
import { canSearchQuery, parseSearchQuery, searchQuerySources } from '../model/searchQuery';
import { globalSearch } from '../hooks/useSearchEngine';
import { registerSource, useEnabledSourcesStore } from '../services/registry';
import { Settings, FileText } from '@ui/icons';

const settings = vi.fn(async () => []);
const files = vi.fn(async () => []);
registerSource({ id: 'setting', label: 'Settings', icon: Settings, search: settings });
registerSource({ id: 'file', label: 'Files', icon: FileText, search: files });

describe('search query scopes', () => {
  it('lists settings and actions for bare prefixes but waits for a term for other scopes', () => {
    expect(canSearchQuery('@')).toBe(true);
    expect(canSearchQuery('> ')).toBe(true);
    expect(canSearchQuery('/')).toBe(false);
    expect(canSearchQuery('  ')).toBe(false);
  });
  it.each([
    ['> reload', 'action', 'reload'], ['@字号', 'setting', '字号'], ['/config', 'file', 'config'],
    ['!npm', 'history', 'npm'], ['#error', 'block', 'error'], ['%server', 'session', 'server'],
    [' FILE: readme', 'file', 'readme'], ['setting:font', 'setting', 'font'],
  ])('parses %s without passing the operator to the source', (input, source, term) => {
    expect(parseSearchQuery(input)).toMatchObject({ source, term });
  });
  it('keeps unrecognized operators and URL text literal', () => {
    expect(parseSearchQuery('https://example.com')).toEqual({ term: 'https://example.com' });
    expect(parseSearchQuery('unknown: value')).toEqual({ term: 'unknown: value' });
  });
  it('uses an explicit prefix independently of persistent source toggles', async () => {
    const preferred = new Set<'file'>(['file']);
    useEnabledSourcesStore.getState().setAll(preferred);
    expect([...searchQuerySources('@ font', preferred)]).toEqual(['setting']);
    await globalSearch('@ font');
    expect(settings).toHaveBeenCalledWith('font');
    expect(files).not.toHaveBeenCalled();
    expect([...useEnabledSourcesStore.getState().enabledIds]).toEqual(['file']);
  });
});
