import { describe, expect, it } from 'vitest';
import { editorFileKey } from '@core/editor';
import { parseGroupWindowHandoff, parseWindowHandoff } from '../model/windowHandoff';

const file = { path: 'Untitled.txt', draftId: 'draft' };
const document = { file, kind: 'text', text: '', value: 'Unsaved content', revision: 'new', error: '' };
const layout = { type: 'pane', id: 'pane', resourceId: `file:${editorFileKey(file)}` };
const payload = { version: 1, id: 'tab', scope: 'code', title: 'Notes', layout, focused: 'pane', documents: [document] };

describe('workspace handoff data', () => {
  it('keeps the unsaved text and layout identity', () => {
    expect(parseWindowHandoff(payload)).toEqual(payload);
  });
  it('rejects unsupported resources, duplicate buffers, and missing focus', () => {
    expect(parseWindowHandoff({ ...payload, layout: { ...layout, resourceId: 'terminal:running' } })).toBeNull();
    expect(parseWindowHandoff({ ...payload, documents: [document, document] })).toBeNull();
    expect(parseWindowHandoff({ ...payload, focused: 'absent' })).toBeNull();
  });
});

describe('terminal handoff data', () => {
  const terminal = { paneId: 'pane-a', sessionId: 'pty-alive', inputEpoch: 3, cwd: '/work', blocks: [] };
  const payload = {
    version: 1,
    scope: 'terminal',
    id: 'tab-a',
    title: 'Shell',
    titleSource: 'command',
    focused: 'pane-a',
    terminals: [terminal],
    layout: { type: 'leaf', terminal: { kind: 'local', id: 'pane-a', shellType: 'bash' } },
  };

  it('retains the live session identity and input epoch', () => {
    expect(parseWindowHandoff(payload)).toEqual(payload);
  });
  it('rejects a terminal that does not match an existing layout leaf', () => {
    expect(parseWindowHandoff({ ...payload, terminals: [{ ...terminal, paneId: 'pane-b' }] })).toBeNull();
  });
});

describe('group handoff data', () => {
  const secondFile = { path: 'Second.txt', draftId: 'second' };
  const packet = {
    version: 1,
    group: { id: 'group', scope: 'code', title: 'Review', collapsed: false },
    selected: 'second',
    color: 'blue',
    tabs: [
      payload,
      {
        ...payload,
        id: 'second',
        documents: [{ ...document, file: secondFile }],
        layout: { ...layout, resourceId: `file:${editorFileKey(secondFile)}` },
      },
    ],
  };
  it('preserves group identity, tab order, and selection', () => {
    expect(parseGroupWindowHandoff(packet)).toEqual(packet);
  });
  it('rejects duplicate tabs and a selection outside the group', () => {
    expect(parseGroupWindowHandoff({ ...packet, tabs: [payload, payload] })).toBeNull();
    expect(parseGroupWindowHandoff({ ...packet, selected: 'missing' })).toBeNull();
  });
});

describe('mixed workspace handoff data', () => {
  const terminal = {
    version: 1,
    scope: 'terminal',
    id: 'native',
    focused: 'shell',
    title: 'Shell',
    terminals: [{ paneId: 'shell', sessionId: 'pty-alive', inputEpoch: 3, blocks: [] }],
    layout: { type: 'leaf', terminal: { kind: 'local', id: 'shell' } },
  };
  const conversation = {
    id: 'ai',
    title: 'Chat',
    createdAt: 12,
    updatedAt: 13,
    environment: null,
    draft: { text: 'Unsent question', attachments: [] },
  };
  const mixed = {
    version: 1,
    id: 'mixed',
    scope: 'unified',
    focused: 'chat-pane',
    layout: {
      type: 'split',
      direction: 'row',
      ratio: 0.4,
      first: { type: 'pane', id: 'terminal-pane', resourceId: 'terminal:shell' },
      second: { type: 'pane', id: 'chat-pane', resourceId: 'chat:ai' },
    },
    documents: [],
    terminals: [terminal],
    conversations: [conversation],
  };
  it('keeps the terminal owner, conversation draft, focus and split ratio together', () => {
    expect(parseWindowHandoff(mixed)).toEqual(mixed);
  });
  it('rejects cross-scope or missing resources', () => {
    expect(parseWindowHandoff({ ...mixed, scope: 'ai' })).toBeNull();
    expect(parseWindowHandoff({ ...mixed, conversations: [] })).toBeNull();
  });
});
