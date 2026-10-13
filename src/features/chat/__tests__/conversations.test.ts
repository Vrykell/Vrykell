import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore, sendToChat, setDefaultStream, type StreamFn } from '../stores/chat';
import { useComposerDrafts } from '../stores/composerDrafts';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaf } from '@features/workspace/model/windowLayout';
import * as api from '@platform/api/conversation';
import { askAboutTerminal } from '../services/conversationContext';
import type { TerminalReference } from '../model/conversation';

vi.mock('@platform/api/conversation', () => ({
  listConversations: vi.fn().mockResolvedValue([]), saveConversation: vi.fn().mockResolvedValue(undefined),
  listConversationMessages: vi.fn().mockResolvedValue([]), appendConversationMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined), deleteConversationMessage: vi.fn().mockResolvedValue(undefined),
}));

const chat = useChatStore.getState();
const workspace = useWorkspaceStore.getState();
const terminal = useTerminalStore.getState();
const drafts = useComposerDrafts.getState();
const environment = { paneId: 'a#0', label: 'Build terminal', kind: 'local' as const, cwd: '/project' };
const reference: TerminalReference = { id: 'block-1', paneId: 'a#0', label: 'Source terminal', command: 'npm run build', output: 'Failed to compile', cwd: '/project', exitCode: 1, createdAt: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState(chat, true);
  useChatStore.setState({ conversationsLoaded: true });
  useComposerDrafts.setState(drafts, true);
  useWorkspaceStore.setState({ tabs: [
    { id: 'a', kind: 'session', title: 'Build', layout: leaf({ id: 'a#0', kind: 'local', cwd: '/project' }) },
    { id: 'b', kind: 'session', title: 'Other', layout: leaf({ id: 'b#0', kind: 'local' }) },
  ], activeId: 'a' });
  useTerminalStore.setState({ sessions: { 'a#0': 'pty-a', 'b#0': 'pty-b' }, focusedPaneId: 'a#0' });
});
afterEach(() => {
  useChatStore.setState(chat, true); useWorkspaceStore.setState(workspace, true);
  useTerminalStore.setState(terminal, true); useComposerDrafts.setState(drafts, true);
});

describe('independent conversations', () => {
  it('keeps automated work in a separate background conversation', async () => {
    const selected = useChatStore.getState().createConversation();
    sendToChat('Scheduled task');
    expect(useChatStore.getState().activeConversationId).toBe(selected);
    expect(useChatStore.getState().conversations).toHaveLength(2);
    expect(useChatStore.getState().sendingTab).not.toBe(selected);
    useChatStore.getState().abortStream(useChatStore.getState().sendingTab!);
    await vi.waitFor(() => expect(useChatStore.getState().sendingTab).toBeNull());
  });
  it('keeps the request target fixed while the user changes tabs and closes its terminal', async () => {
    const id = useChatStore.getState().createConversation(environment);
    const stream: StreamFn = async (_messages, onChunk, context) => {
      useWorkspaceStore.getState().activate('b');
      useTerminalStore.getState().setFocusedPane('b#0');
      useChatStore.getState().dropTab('a');
      expect(context?.paneId).toBe('a#0');
      expect(context?.environment?.cwd).toBe('/project');
      onChunk('The build issue is fixed.');
    };
    await useChatStore.getState().send('Fix the build', { conversationId: id, streamFn: stream });
    expect(useChatStore.getState().activeConversationId).toBe(id);
    expect(useChatStore.getState().byTab[id]?.[1].content).toBe('The build issue is fixed.');
    expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === 'a')?.title).toBe('Build');
    expect(api.appendConversationMessage).toHaveBeenCalledTimes(2);
  });

  it('does not grant terminal access when a command snapshot is added', async () => {
    const id = askAboutTerminal('a#0', reference, 'Explain this error');
    expect(useChatStore.getState().conversations.find(item => item.id === id)?.environment).toBeNull();
    expect(useComposerDrafts.getState().byTab[id]?.references?.[0].output).toBe('Failed to compile');
    expect(useChatStore.getState().byTab[id]).toEqual([]);
    const stream: StreamFn = async (messages, _onChunk, context) => {
      expect(context?.paneId).toBeNull();
      expect(messages[0].content).toContain('Failed to compile');
      expect(messages[0].content).toContain('Exit code: 1');
    };
    await useChatStore.getState().send('Explain this error', { conversationId: id, references: [reference], streamFn: stream });
  });

  it('isolates drafts and restores references when a question is edited', async () => {
    const first = useChatStore.getState().createConversation();
    await useChatStore.getState().send('Explain', { conversationId: first, references: [reference], streamFn: async () => {} });
    const question = useChatStore.getState().byTab[first][0];
    const second = useChatStore.getState().createConversation();
    useComposerDrafts.getState().setText(second, 'Second draft');
    useChatStore.getState().editResend(first, question.id);
    expect(useComposerDrafts.getState().byTab[first]?.references).toEqual([reference]);
    expect(useComposerDrafts.getState().byTab[second]?.text).toBe('Second draft');
  });

  it('updates an earlier reply in its persisted position even when timestamps match', async () => {
    const id = useChatStore.getState().createConversation();
    const messages = [
      { id: 'q1', role: 'user' as const, content: 'First question', createdAt: 1 },
      { id: 'a1', role: 'assistant' as const, content: 'Old reply', createdAt: 1 },
      { id: 'q2', role: 'user' as const, content: 'Second question', createdAt: 1 },
      { id: 'a2', role: 'assistant' as const, content: 'Second reply', createdAt: 1 },
    ];
    useChatStore.setState({ byTab: { [id]: messages } });
    setDefaultStream(async (history, onChunk) => {
      expect(history.map(message => message.content)).toEqual(['First question']); onChunk('Replacement');
    });
    await useChatStore.getState().regenerate(id, 'q1');
    expect(useChatStore.getState().byTab[id].map(message => message.content)).toEqual(['First question', 'Replacement', 'Second question', 'Second reply']);
    expect(api.deleteConversationMessage).not.toHaveBeenCalled();
    expect(api.appendConversationMessage).toHaveBeenLastCalledWith('a1', id, 'assistant', 'Replacement', 1, '', '', null, expect.any(String));
  });

  it('removes a persisted regeneration placeholder when stopped before any content', async () => {
    const id = useChatStore.getState().createConversation();
    useChatStore.setState({ byTab: { [id]: [
      { id: 'q', role: 'user', content: 'Question', createdAt: 1 },
      { id: 'a', role: 'assistant', content: 'Old reply', createdAt: 2 },
    ] } });
    setDefaultStream(async () => { useChatStore.getState().abortStream(id); });
    await useChatStore.getState().regenerate(id, 'q');
    expect(useChatStore.getState().byTab[id].map(message => message.id)).toEqual(['q']);
    expect(api.deleteConversationMessage).toHaveBeenCalledWith('a');
  });

  it('restores independent history without requiring a terminal tab', async () => {
    useChatStore.setState({ conversationsLoaded: false });
    vi.mocked(api.listConversations).mockResolvedValueOnce([{ id: 'saved', title: 'Build issue', created_at: 1, updated_at: 2, environment: JSON.stringify(environment) }]);
    vi.mocked(api.listConversationMessages).mockResolvedValueOnce([{ id: 'question', role: 'user', content: 'Help', created_at: 1, parts: '', attachments: '', pane_id: 'a#0', context: JSON.stringify({ references: [reference] }) }]);
    useWorkspaceStore.setState({ tabs: [], activeId: '' });
    await useChatStore.getState().loadConversations();
    expect(useChatStore.getState().activeConversationId).toBe('saved');
    expect(useChatStore.getState().byTab.saved[0].references).toEqual([reference]);
  });

  it('records a persistence failure and allows saving the retained messages again', async () => {
    vi.mocked(api.saveConversation).mockRejectedValueOnce(new Error('Disk is full'));
    const id = useChatStore.getState().createConversation();
    await useChatStore.getState().send('Help', { conversationId: id, streamFn: async () => {} });
    expect(useChatStore.getState().persistenceError).toBe('Disk is full');
    await useChatStore.getState().retryPersistence();
    expect(useChatStore.getState().persistenceError).toBeNull();
  });

  it('restores a failed reply as an error instead of an empty successful answer', async () => {
    const id = useChatStore.getState().createConversation();
    await useChatStore.getState().send('Help', { conversationId: id, streamFn: async () => { throw new Error('Provider unavailable'); } });
    expect(useChatStore.getState().byTab[id][1].error).toBe(true);
    const saved = [...vi.mocked(api.appendConversationMessage).mock.calls].reverse().find(call => call[2] === 'assistant');
    expect(saved).toBeDefined();
    const context = JSON.parse(saved![8]);
    expect(context.error).toBe(true);
    expect(context.errorText).toContain('Provider unavailable');
    useChatStore.setState({ conversationsLoaded: false, conversations: [], byTab: {}, activeConversationId: '' });
    vi.mocked(api.listConversations).mockResolvedValueOnce([{ id, title: 'Help', created_at: 1, updated_at: 2, environment: 'null' }]);
    vi.mocked(api.listConversationMessages).mockResolvedValueOnce([{ id: saved![0], role: 'assistant', content: saved![3],
      created_at: saved![4], parts: saved![5], attachments: saved![6], pane_id: saved![7], context: saved![8] }]);
    await useChatStore.getState().loadConversations();
    expect(useChatStore.getState().byTab[id][0]).toMatchObject({ error: true, errorText: 'Provider unavailable' });
  });

  it('does not recreate a conversation while deletion and save retry overlap', async () => {
    const id = useChatStore.getState().createConversation();
    await vi.waitFor(() => expect(api.saveConversation).toHaveBeenCalledTimes(1));
    let finishDelete: (() => void) | undefined;
    vi.mocked(api.deleteConversation).mockImplementationOnce(() => new Promise<void>(resolve => { finishDelete = resolve; }));
    const deletion = useChatStore.getState().deleteConversation(id);
    await vi.waitFor(() => expect(api.deleteConversation).toHaveBeenCalledTimes(1));
    await useChatStore.getState().retryPersistence();
    finishDelete?.();
    await deletion;
    expect(api.saveConversation).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().conversations.some(item => item.id === id)).toBe(false);
  });
});
