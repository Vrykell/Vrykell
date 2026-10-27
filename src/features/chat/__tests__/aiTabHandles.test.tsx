import { expect, it } from 'vitest';
import type { Conversation } from '../model/conversation';
import { projectAiTabs } from '../model/aiTabHandles';
import type { Tab } from '@features/workspace/stores/workspace';

const conversations: Conversation[] = [
  { id: 'c1', title: 'Investigation', createdAt: 1, updatedAt: 1, environment: null },
  { id: 'c2', title: 'Docked', createdAt: 2, updatedAt: 2, environment: null },
];

const pages: Tab[] = [
  { id: 'usage', title: 'Usage', kind: 'usage' },
  { id: 'history', title: 'History', kind: 'ai-history' },
  { id: 'start-ai', title: 'Assistant', kind: 'start-ai' },
  { id: 'terminal-page', title: 'Not an AI page', kind: 'session', layout: { type: 'leaf', terminal: { id: 'nt#0', kind: 'local' } } },
];

it('projects conversations, agents and system pages in one ordered strip', () => {
  const targets = projectAiTabs({
    nativeTabs: ['c1', 'missing'],
    conversations,
    connections: [{ id: 'agent-1', harness: 'Agent', cwd: '/repo' }],
    systemPages: pages,
    sideSelected: '',
    sideSessions: [],
  });
  expect(targets.map(target => target.handle.id)).toEqual([
    'chat:c1', 'acp:agent-1', 'page:usage', 'page:history', 'page:start-ai',
  ]);
  expect(targets[0]).toMatchObject({ kind: 'conversation', conversationId: 'c1' });
  expect(targets[0]!.handle).toMatchObject({
    label: 'Investigation',
    capabilities: { renameable: true, groupable: false },
  });
  expect(targets[1]).toMatchObject({ kind: 'agent', connectionId: 'agent-1' });
  expect(targets[1]!.handle).toMatchObject({ tip: 'Agent · /repo', capabilities: { renameable: false } });
  expect(targets[2]!.handle).toMatchObject({ surface: 'canvas', dataAttributes: { 'data-tab-kind': 'usage' } });
});

it('removes conversation and agent rows docked to the side or selected for the side surface', () => {
  const targets = projectAiTabs({
    nativeTabs: ['c1', 'c2'],
    conversations,
    connections: [{ id: 'agent-1', harness: 'Agent', cwd: '' }, { id: 'agent-2', harness: 'Other', cwd: '/other' }],
    systemPages: pages,
    sideSelected: 'chat:c1',
    sideSessions: ['acp:agent-1', 'page:usage'],
  });
  expect(targets.map(target => target.handle.id)).toEqual(['chat:c2', 'acp:agent-2', 'page:usage', 'page:history', 'page:start-ai']);
  expect(targets[1]!.handle.tip).toBe('Other · /other');
});

it('keeps an agent without a directory on a single-line tip', () => {
  const [target] = projectAiTabs({
    nativeTabs: [],
    conversations,
    connections: [{ id: 'agent-empty', harness: 'Agent', cwd: '' }],
    systemPages: [],
    sideSelected: '',
    sideSessions: [],
  });
  expect(target?.handle.tip).toBe('Agent');
});

it('presents only supported resource and utility page kinds', () => {
  const targets = projectAiTabs({
    nativeTabs: ['c1'],
    conversations,
    connections: [],
    systemPages: [...pages, { id: 'editor', title: 'Editor', kind: 'editor', files: [], selected: { path: '/repo/a.ts' } }],
    sideSelected: '',
    sideSessions: [],
  });
  expect(targets.map(target => target.handle.id)).toEqual(['chat:c1', 'page:usage', 'page:history', 'page:start-ai']);
  expect(targets.some(target => target.handle.id === 'page:editor')).toBe(false);
});
