import { describe, expect, it } from 'vitest';
import type { Conversation } from '../model/conversation';
import { DEFAULT_CONVERSATION_HISTORY_FILTER, conversationMarkdown, filterConversations, groupConversations, hasConversationHistoryFilter, updateConversationHistoryFilter } from '../model/conversationHistory';
import { parseEnvironment } from '../model/conversation';

function conversation(
  id: string,
  updatedAt: number,
  environment: Conversation['environment'] = null,
): Conversation {
  return { id, title: id, createdAt: updatedAt, updatedAt, environment };
}

describe('conversation history groups', () => {
  const firstDay = new Date(2025, 4, 7, 12).getTime();
  const sameWeek = new Date(2025, 4, 5, 12).getTime();
  const previousWeek = new Date(2025, 4, 4, 12).getTime();
  const local = conversation('local', firstDay, { paneId: 'pane-1', label: 'Project', kind: 'local', cwd: 'C:/project', shellType: 'bash' });
  const localAgain = conversation('local-again', sameWeek, { paneId: 'pane-2', label: 'Project', kind: 'local', cwd: 'C:/project', shellType: 'bash' });
  const ssh = conversation('ssh', previousWeek, { paneId: 'pane-3', label: 'Server', kind: 'ssh', cwd: '/srv/app', ssh: { host: 'server.test', user: 'dev' } });
  const discussion = conversation('discussion', firstDay);

  it('matches group annotations while still enforcing type, date and starred constraints', () => {
    const annotations = new Map([['local', 'Servers'], ['ssh', 'Servers']]);
    expect(filterConversations([local, ssh], { ...DEFAULT_CONVERSATION_HISTORY_FILTER, query: 'servers', type: 'ssh' }, null, annotations)).toEqual([ssh]);
    expect(filterConversations([local, ssh], { ...DEFAULT_CONVERSATION_HISTORY_FILTER, query: 'servers', type: 'ssh', date: 'today' }, null, annotations)).toEqual([]);
    expect(filterConversations([local, ssh], { ...DEFAULT_CONVERSATION_HISTORY_FILTER, query: 'servers' }, new Set(['discussion']), annotations)).toEqual([]);
  });

  it('groups by day, week and month using local calendar boundaries', () => {
    expect(groupConversations([local, discussion, localAgain], 'day').map(group => group.items.length)).toEqual([2, 1]);
    expect(groupConversations([local, localAgain, ssh], 'week').map(group => group.items.length)).toEqual([2, 1]);
    expect(groupConversations([local, localAgain, ssh], 'month')).toHaveLength(1);
  });

  it('groups by working directory and conversation type', () => {
    const directories = groupConversations([local, localAgain, ssh, discussion], 'cwd');
    expect(directories.find(group => group.id === 'cwd:c:/project')?.items).toHaveLength(2);
    expect(directories.find(group => group.title === 'dev@server.test · /srv/app')?.items).toEqual([ssh]);
    expect(directories.find(group => group.id === 'cwd:discussion')?.items).toEqual([discussion]);
    expect(new Set(groupConversations([local, ssh, discussion], 'type').map(group => group.id)))
      .toEqual(new Set(['type:local', 'type:ssh', 'type:discussion']));
    expect(new Set(groupConversations([local, ssh, discussion], 'terminal').map(group => group.id)))
      .toEqual(new Set(['terminal:bash', 'terminal:ssh', 'terminal:discussion']));
  });

  it('keeps all filtered conversations in a single card when grouping is disabled', () => {
    const [group] = groupConversations([local, ssh, discussion], 'none');
    expect(group).toMatchObject({ id: 'all', items: [local, ssh, discussion] });
  });

  it('uses the same time field for date filters, sorting and time cards', () => {
    const now = Date.now();
    const items = [{ ...local, createdAt: now - 40 * 86400000, updatedAt: now }, { ...discussion, createdAt: now, updatedAt: now }];
    const recent = { ...DEFAULT_CONVERSATION_HISTORY_FILTER, date: '7d' as const };
    expect(filterConversations(items, recent)).toHaveLength(2);
    expect(filterConversations(items, updateConversationHistoryFilter(recent, { sort: 'created-desc' }))).toEqual([items[1]]);
    expect(groupConversations(items, 'day', 'created-desc')).toHaveLength(2);
    expect(groupConversations(items, 'day', 'updated-desc')).toHaveLength(1);
  });

  it('sorts records within stable category cards and retains calendar order for title sorting', () => {
    const items = [{ ...local, title: 'Zebra' }, { ...localAgain, title: 'Apple' }, { ...ssh, title: 'Alpha' }];
    const ascending = groupConversations(filterConversations(items, { ...DEFAULT_CONVERSATION_HISTORY_FILTER, sort: 'title-asc' }), 'cwd', 'title-asc');
    const descending = groupConversations(filterConversations(items, { ...DEFAULT_CONVERSATION_HISTORY_FILTER, sort: 'title-desc' }), 'cwd', 'title-desc');
    expect(ascending.map(group => group.id)).toEqual(descending.map(group => group.id));
    expect(ascending.find(group => group.id === 'cwd:c:/project')?.items.map(item => item.title)).toEqual(['Apple', 'Zebra']);
    expect(descending.find(group => group.id === 'cwd:c:/project')?.items.map(item => item.title)).toEqual(['Zebra', 'Apple']);
    const dates = groupConversations(filterConversations(items, { ...DEFAULT_CONVERSATION_HISTORY_FILTER, sort: 'title-asc' }), 'day', 'title-asc');
    expect(dates[0].items[0].title).toBe('Zebra');
  });

  it('retains only non-secret target metadata and supports legacy environments', () => {
    const environment = { paneId: 'remote', kind: 'ssh', label: 'Server', cwd: '/srv', shellType: 'bash', ssh: { host: 'host.test', user: 'dev', port: 2222, password: 'excluded' } };
    const parsed = parseEnvironment(JSON.stringify(environment));
    expect(parsed).toEqual({ ...environment, ssh: { host: 'host.test', user: 'dev', port: 2222 } });
    expect(parseEnvironment(JSON.stringify({ paneId: 'old', kind: 'ssh', label: 'Old server' }))).toMatchObject({ paneId: 'old', kind: 'ssh' });
  });

  it('retains the date basis when title sorting or grouping changes and synchronizes explicit date changes', () => {
    const created = updateConversationHistoryFilter(DEFAULT_CONVERSATION_HISTORY_FILTER, { date: '7d', query: 'project', sort: 'created-asc' });
    const title = updateConversationHistoryFilter(created, { sort: 'title-asc', groupBy: 'cwd' });
    expect(title).toMatchObject({ dateField: 'created', query: 'project', date: '7d', sort: 'title-asc', groupBy: 'cwd' });
    expect(updateConversationHistoryFilter(created, { dateField: 'updated' })).toMatchObject({ sort: 'updated-asc', dateField: 'updated' });
  });

  it('restricts records to starred ids and hoists pinned groups', () => {
    const items = [local, ssh, discussion];
    expect(filterConversations(items, DEFAULT_CONVERSATION_HISTORY_FILTER, new Set(['ssh']))).toEqual([ssh]);
    expect(hasConversationHistoryFilter({ ...DEFAULT_CONVERSATION_HISTORY_FILTER, starredOnly: true })).toBe(true);
    const cards = groupConversations(items, 'type', 'updated-desc', 'updated', new Set(['type:ssh']));
    expect(cards[0].id).toBe('type:ssh');
    expect(new Set(cards.slice(1).map(group => group.id))).toEqual(new Set(['type:local', 'type:discussion']));
  });

  it('exports a conversation as Markdown including its environment and messages', () => {
    const text = conversationMarkdown(local, [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ]);
    expect(text.split('\n')[0]).toBe('# local');
    expect(text).toContain('Environment: Project · C:/project');
    expect(text).toContain('## User');
    expect(text).toContain('question');
    expect(text).toContain('## Assistant');
    expect(text).toContain('answer');
  });
});
