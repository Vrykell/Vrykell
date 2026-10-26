import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore, sendToChat, setDefaultStream, type StreamFn } from '../stores/chat';
import { useComposerDrafts } from '../stores/composerDrafts';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { useTerminalStore, useBlockStore } from '@features/terminal';
import { leaf } from '@features/workspace/model/windowLayout';
import * as api from '@platform/api/conversation';
import { askAboutTerminal } from '../services/conversationContext';
import type { TerminalReference } from '../model/conversation';
import { useAiWorkspace } from '../stores/aiWorkspace';

vi.mock('@platform/api/conversation', () => ({
  listConversations: vi.fn().mockResolvedValue([]), saveConversation: vi.fn().mockResolvedValue(undefined),
  listConversationMessages: vi.fn().mockResolvedValue([]), appendConversationMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined), deleteConversationMessage: vi.fn().mockResolvedValue(undefined),
}));

const chat = useChatStore.getState();
const workspace = useWorkspaceStore.getState();
const terminal = useTerminalStore.getState();
const drafts = useComposerDrafts.getState();
const blocks = useBlockStore.getState();
const aiWorkspace = useAiWorkspace.getState();
const environment = { paneId: 'a#0', label: 'Build terminal', kind: 'local' as const, cwd: '/project' };
const reference: TerminalReference = { id: 'block-1', paneId: 'a#0', label: 'Source terminal', command: 'npm run build', output: 'Failed to compile', cwd: '/project', exitCode: 1, createdAt: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState(chat, true);
  useAiWorkspace.setState(aiWorkspace, true);
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
  useBlockStore.setState(blocks, true);
  useAiWorkspace.setState(aiWorkspace, true);
});

describe('independent conversations', () => {
  it('streams three owners concurrently and drains each queue without waiting for other owners', async () => {
    const ids = Array.from({ length: 3 }, () => useChatStore.getState().createConversation());
    const releases = new Map<string, () => void>();
    const stream: StreamFn = async (_messages, chunk, context) => {
      const id = context!.tabId!;
      chunk(`Reply for ${id}`);
      await new Promise<void>(resolve => { releases.set(id, resolve); });
    };
    const running = ids.map(conversationId => useChatStore.getState().send('First', { conversationId, streamFn: stream }));
    await vi.waitFor(() => expect(releases.size).toBe(3));
    expect(useChatStore.getState().sendingTabs).toEqual(ids);
    const followup = vi.fn(async (_messages, chunk: (text: string) => void) => { chunk('Second reply'); });
    await useChatStore.getState().send('Second', { conversationId: ids[0], streamFn: followup });
    await useChatStore.getState().send('Third', { conversationId: ids[0], streamFn: followup });
    releases.get(ids[0])!();
    await running[0];
    await vi.waitFor(() => expect(followup).toHaveBeenCalledTimes(2));
    expect(useChatStore.getState().sendingTabs).toEqual(ids.slice(1));
    expect(useChatStore.getState().byTab[ids[0]].filter(message => message.role === 'user').map(message => message.content)).toEqual(['First', 'Second', 'Third']);
    for (const id of ids.slice(1)) expect(useChatStore.getState().byTab[id][1].pending).toBe(true);
    for (const id of ids.slice(1)) releases.get(id)!();
    await Promise.all(running);
    expect(useChatStore.getState().sendingTabs).toEqual([]);
    for (const id of ids) expect(useChatStore.getState().byTab[id][1].content).toBe(`Reply for ${id}`);
  });

  it('stopping or failing an owner leaves another owner and its queued turn running', async () => {
    const first = useChatStore.getState().createConversation();
    const second = useChatStore.getState().createConversation();
    let fail!: (error: Error) => void;
    let finish!: () => void;
    const failing = useChatStore.getState().send('First', { conversationId: first, streamFn: () => new Promise((_resolve, reject) => { fail = reject; }) });
    const continuing = useChatStore.getState().send('Second', { conversationId: second, streamFn: () => new Promise(resolve => { finish = resolve; }) });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const queued = vi.fn(async () => {});
    await useChatStore.getState().send('Queued for second', { conversationId: second, streamFn: queued });
    fail(new Error('Connection unavailable')); await failing;
    expect(useChatStore.getState().sendingTabs).toEqual([second]);
    expect(useChatStore.getState().byTab[first][1].error).toBe(true);
    useChatStore.getState().abortStream(first);
    expect(useChatStore.getState().queuedSends).toHaveLength(1);
    expect(useChatStore.getState().byTab[second][1].pending).toBe(true);
    finish(); await continuing;
    await vi.waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  });

  it('keeps an unanswered tool cancelled immediately and after its stopped stream settles', async () => {
    const id = useChatStore.getState().createConversation();
    let finish!: () => void;
    const pending = useChatStore.getState().send('Ask a question', { conversationId: id, streamFn: async (_messages, _chunk, ctx) => {
      ctx?.handlers?.onToolEvent?.({ toolCallId: 'question', toolName: 'ask_user', state: 'input-pending', input: { question: 'Which target?' }, startedAt: 1 });
      await new Promise<void>(resolve => { finish = resolve; });
    } });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    useChatStore.getState().abortStream(id);
    const state = () => useChatStore.getState().byTab[id]?.[1]?.parts?.find(part => part.kind === 'tool');
    expect(state()).toMatchObject({ tool: { state: 'cancelled' } });
    finish(); await pending;
    expect(state()).toMatchObject({ tool: { state: 'cancelled' } });
  });
  it('reserves scheduled work without blocking a different manual conversation', async () => {
    const manual = useChatStore.getState().createConversation();
    let release!: () => void;
    const recording = new Promise<void>(resolve => { release = resolve; });
    const started = sendToChat('Scheduled task', () => recording);
    const reserved = useChatStore.getState().sendingTabs[0];
    expect(reserved).toBeTruthy();
    const stream = vi.fn(async () => {});
    await useChatStore.getState().send('Manual task', { conversationId: manual, streamFn: stream });
    expect(useChatStore.getState().queuedSends).toEqual([]);
    expect(stream).toHaveBeenCalledTimes(1);
    release();
    await expect(started).resolves.toBe(true);
    expect(useChatStore.getState().byTab[reserved!]?.[0].content).toBe('Scheduled task');
    useChatStore.getState().abortStream(reserved!);
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(useChatStore.getState().sendingTabs).toEqual([]));
  });

  it('removes an unstarted automated conversation when run persistence fails', async () => {
    const recording = vi.fn().mockRejectedValue(new Error('Database unavailable'));
    await expect(sendToChat('Scheduled task', recording)).rejects.toThrow('Database unavailable');
    expect(useChatStore.getState().sendingTabs).toEqual([]);
    expect(useChatStore.getState().conversations).toEqual([]);
    expect(Object.keys(useChatStore.getState().byTab)).toEqual([]);
  });
  it('keeps empty conversations in memory without writing history', async () => {
    const id = useChatStore.getState().createConversation();
    useChatStore.getState().renameConversation(id, 'Draft');
    useChatStore.getState().setEnvironment(id, environment);
    await useChatStore.getState().retryPersistence();
    expect(api.saveConversation).not.toHaveBeenCalled();
    expect(api.appendConversationMessage).not.toHaveBeenCalled();
    await useChatStore.getState().send('First message', { conversationId: id, streamFn: async () => {} });
    expect(api.saveConversation).toHaveBeenCalled();
    expect(api.appendConversationMessage).toHaveBeenCalledWith(expect.any(String), id, 'user', 'First message', expect.any(Number), '', '', 'a#0', expect.any(String));
  });

  it('removes empty history after deleting the final exchange and can save new content later', async () => {
    const id = useChatStore.getState().createConversation();
    await useChatStore.getState().send('First message', { conversationId: id, streamFn: async (_messages, chunk) => chunk('Reply') });
    useChatStore.getState().deleteExchange(id, useChatStore.getState().byTab[id][0].id);
    await vi.waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(id));
    expect(useChatStore.getState().byTab[id]).toEqual([]);
    expect(useChatStore.getState().conversations.some(item => item.id === id)).toBe(true);
    await useChatStore.getState().send('New content', { conversationId: id, streamFn: async () => {} });
    expect(api.saveConversation).toHaveBeenLastCalledWith(id, expect.any(String), expect.any(Number), expect.any(Number), expect.any(String));
  });

  it('queues messages in order and retains their owner when navigation changes', async () => {
    const id = useChatStore.getState().createConversation();
    let finish!: () => void;
    const running = useChatStore.getState().send('First', { conversationId: id, streamFn: () => new Promise(resolve => { finish = resolve; }) });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const stream = vi.fn(async () => {});
    await useChatStore.getState().send('Second', { conversationId: id, streamFn: stream });
    await useChatStore.getState().send('Third', { conversationId: id, streamFn: stream });
    useChatStore.getState().createConversation();
    expect(useChatStore.getState().queuedSends.map(item => item.text)).toEqual(['Second', 'Third']);
    finish(); await running;
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(useChatStore.getState().byTab[id].filter(message => message.role === 'user').map(message => message.content)).toEqual(['First', 'Second', 'Third']);
  });

  it('stops a noncooperative stream immediately and fences its late callbacks and finalizer', async () => {
    const id = useChatStore.getState().createConversation();
    let finishOld!: () => void; let oldChunk!: (text: string) => void;
    const old = useChatStore.getState().send('First', { conversationId: id, streamFn: async (_messages, chunk) => {
      oldChunk = chunk; chunk('Partial'); await new Promise<void>(resolve => { finishOld = resolve; });
    } });
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    await useChatStore.getState().send('Queued', { conversationId: id });
    useChatStore.getState().abortStream(id);
    expect(useChatStore.getState().sendingTabs).toEqual([]);
    expect(useChatStore.getState().queuedSends).toEqual([]);
    expect(useChatStore.getState().byTab[id][1]).toMatchObject({ content: 'Partial', stopped: true, pending: false });
    let finishNew!: () => void;
    const next = useChatStore.getState().send('Next', { conversationId: id, streamFn: () => new Promise(resolve => { finishNew = resolve; }) });
    await vi.waitFor(() => expect(finishNew).toBeTypeOf('function'));
    oldChunk('Late'); finishOld(); await old;
    expect(useChatStore.getState().sendingTabs).toContain(id);
    expect(useChatStore.getState().byTab[id][1].content).toBe('Partial');
    finishNew(); await next;
  });

  it('does not resurrect a stopped request when persistence finishes later', async () => {
    const id = useChatStore.getState().createConversation();
    let finishSave!: () => void;
    vi.mocked(api.saveConversation).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    const stream = vi.fn(async () => {});
    const sending = useChatStore.getState().send('First', { conversationId: id, streamFn: stream });
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'));
    useChatStore.getState().dropTab(id);
    finishSave(); await sending;
    expect(stream).not.toHaveBeenCalled();
    expect(useChatStore.getState().sendingTabs).toEqual([]);
    expect(useChatStore.getState().byTab[id]).toBeUndefined();
  });
  it('keeps the full current command result in both the reference and submitted history', async () => {
    const command = `printf ${'argument '.repeat(400)}END_COMMAND`;
    const output = `BEGIN_OUTPUT:${'line 😀\n'.repeat(900)}:FINAL_ERROR`;
    useBlockStore.setState({ byTab: { 'a#0': [{ id: 'full', command, outputText: output, outputHtml: '', outputRaw: output,
      status: 'done', exitCode: 1, startedAt: 1, endedAt: 2, wasLongRunning: false, linesTruncated: 0 }] } });
    const id = askAboutTerminal('a#0');
    const references = useComposerDrafts.getState().byTab[id]?.references ?? [];
    expect(references[0]).toMatchObject({ command, output });
    const stream: StreamFn = async messages => {
      expect(messages[0].content).toContain(command);
      expect(messages[0].content).toContain(output);
    };
    await useChatStore.getState().send('Analyze the full result', { conversationId: id, references, streamFn: stream });
  });
  it('keeps automated work in a separate background conversation', async () => {
    const selected = useChatStore.getState().createConversation();
    sendToChat('Scheduled task');
    expect(useChatStore.getState().activeConversationId).toBe(selected);
    expect(useChatStore.getState().conversations).toHaveLength(2);
    expect(useChatStore.getState().sendingTabs).not.toContain(selected);
    useChatStore.getState().abortStream(useChatStore.getState().sendingTabs[0]);
    await vi.waitFor(() => expect(useChatStore.getState().sendingTabs).toEqual([]));
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
    const main = useChatStore.getState().createConversation();
    useAiWorkspace.getState().openNative(main);
    const id = askAboutTerminal('a#0', reference, 'Explain this error');
    expect(id).not.toBe(main);
    expect(useAiWorkspace.getState().selected).toBe(`chat:${main}`);
    expect(useAiWorkspace.getState().sideSelected).toBe(`chat:${id}`);
    expect(useChatStore.getState().activeConversationId).toBe(main);
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

  it('stages terminal analysis in the existing compatible sidebar without moving its owner', () => {
    const main = useChatStore.getState().createConversation();
    useAiWorkspace.getState().openNative(main);
    const side = useChatStore.getState().createConversation(null, { activate: false });
    useAiWorkspace.getState().selectSide(`chat:${side}`);
    useComposerDrafts.getState().setText(side, 'Existing note');
    expect(askAboutTerminal('a#0', reference, 'Explain this error')).toBe(side);
    expect(useComposerDrafts.getState().byTab[side]?.text).toBe('Existing note\nExplain this error');
    expect(useAiWorkspace.getState().selected).toBe(`chat:${main}`);
    expect(useAiWorkspace.getState().sideSelected).toBe(`chat:${side}`);
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
    await useChatStore.getState().send('Saved question', { conversationId: id, streamFn: async () => {} });
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
