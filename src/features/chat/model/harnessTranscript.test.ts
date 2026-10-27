import { describe, expect, it } from 'vitest';
import { applyHarnessUpdate, groupHarnessMessages, upsertHarnessTool } from './harnessTranscript';
import { toExchanges } from './exchanges';
import type { ChatMessage } from '@features/chat';

const update = (patch: Record<string, unknown>) => ({ sessionId: 's', update: patch });

describe('applyHarnessUpdate', () => {
  it('keeps failure text when consecutive assistant fragments are grouped', () => {
    const messages: ChatMessage[] = [
      { id: 'partial', role: 'assistant', content: 'Partial output', createdAt: 1 },
      { id: 'error', role: 'assistant', content: '', error: true, errorSummary: 'Service unavailable', errorText: 'Provider diagnostics', createdAt: 2 },
    ];
    expect(groupHarnessMessages(messages)[0]).toMatchObject({ error: true, errorSummary: 'Service unavailable', errorText: 'Provider diagnostics', parts: [{ kind: 'text', text: 'Partial output' }] });
  });

  it('groups thoughts, multiple tools and final text into one answer per user turn', () => {
    let messages: ChatMessage[] = [{ id: 'question', role: 'user', content: 'Inspect', createdAt: 1 }];
    for (const event of [
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking' } },
      { sessionUpdate: 'tool_call', toolCallId: 'first', title: 'Inspect', status: 'pending' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'First result. ' } },
      { sessionUpdate: 'tool_call', toolCallId: 'second', title: 'Verify', status: 'pending' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'first', status: 'completed' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } },
    ]) messages = applyHarnessUpdate(messages, update(event));
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]!.parts?.map(part => part.kind)).toEqual(['tool', 'text', 'tool', 'text']);
    expect(toExchanges(messages)).toHaveLength(1);
    messages = applyHarnessUpdate(messages, update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Next task' } }));
    messages = upsertHarnessTool(messages, { toolCallId: 'third', toolName: 'read_file', input: {}, state: 'running', startedAt: 1 });
    expect(toExchanges(messages)).toHaveLength(2);
    expect(messages[1]!.parts).toHaveLength(4);
  });

  it('groups previously fragmented replay messages without mutating them or merging user turns', () => {
    const old: ChatMessage[] = [
      { id: 'q', role: 'user', content: 'Inspect', createdAt: 1 },
      { id: 'thought', role: 'assistant', content: '', reasoning: 'Checking', createdAt: 2 },
      { id: 'tool', role: 'assistant', content: '', parts: [{ kind: 'tool', tool: { toolCallId: 'one', toolName: 'read_file', state: 'done', input: {}, startedAt: 2 } }], createdAt: 3 },
      { id: 'text', role: 'assistant', content: 'Done', createdAt: 4 },
      { id: 'next', role: 'user', content: 'Next task', createdAt: 5 },
    ];
    const grouped = groupHarnessMessages(old);
    expect(grouped.map(message => message.id)).toEqual(['q', 'thought', 'next']);
    expect(grouped[1]!.parts?.map(part => part.kind)).toEqual(['tool', 'text']);
    expect(old).toHaveLength(5);
    expect(old[1]!.parts).toBeUndefined();
  });
  it('appends message chunks to one answer and keeps thoughts apart', () => {
    let messages: ChatMessage[] = [];
    messages = applyHarnessUpdate(messages, update({
      sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'weighing options' },
    }));
    messages = applyHarnessUpdate(messages, update({
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' },
    }));
    messages = applyHarnessUpdate(messages, update({
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' },
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('assistant');
    expect(messages[0]!.reasoning).toBe('weighing options');
    expect(messages[0]!.parts).toEqual([{ kind: 'text', text: 'Hello world' }]);
  });

  it('keeps the user turn separate from the answer', () => {
    let messages: ChatMessage[] = [];
    messages = applyHarnessUpdate(messages, update({
      sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'run the tests' },
    }));
    messages = applyHarnessUpdate(messages, update({
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'on it' },
    }));
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0]!.content).toBe('run the tests');
  });

  it('does not repeat the prompt the agent echoes back, and groups chunks by message id', () => {
    // The prompt we showed locally, then the same text coming back as a chunk: one question, not two.
    const local: ChatMessage[] = [{ id: 'q1', role: 'user', content: 'run the tests', createdAt: 1 }];
    const echoed = applyHarnessUpdate(local, update({
      sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'run the tests' },
    }));
    expect(echoed).toHaveLength(1);

    // A longer echo replaces ours rather than being appended to it.
    const longer = applyHarnessUpdate(local, update({
      sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'run the tests and report' },
    }));
    expect(longer).toHaveLength(1);
    expect(longer[0]!.content).toBe('run the tests and report');

    // Chunks of one message (same id) continue it; a different id opens a new bubble.
    let replay: ChatMessage[] = [];
    replay = applyHarnessUpdate(replay, update({
      sessionUpdate: 'user_message_chunk', messageId: 'm1', content: { type: 'text', text: 'first ' },
    }));
    replay = applyHarnessUpdate(replay, update({
      sessionUpdate: 'user_message_chunk', messageId: 'm1', content: { type: 'text', text: 'question' },
    }));
    expect(replay).toHaveLength(1);
    expect(replay[0]!.content).toBe('first question');

    const two = applyHarnessUpdate(replay, update({
      sessionUpdate: 'user_message_chunk', messageId: 'm2', content: { type: 'text', text: 'second' },
    }));
    expect(two).toHaveLength(2);
  });

  it('upserts a tool row and lets an update keep what it does not mention', () => {
    let messages: ChatMessage[] = [];
    const call = update({
      sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'Run the tests', kind: 'execute', status: 'pending',
    });
    messages = applyHarnessUpdate(messages, call);
    messages = applyHarnessUpdate(messages, update({
      sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '4 passed' } }],
    }));

    const parts = messages[0]!.parts ?? [];
    expect(parts).toHaveLength(1);
    const tool = parts[0]!.kind === 'tool' ? parts[0]!.tool : null;
    expect(tool?.toolCallId).toBe('call_1');
    expect(tool?.state).toBe('done');
    expect(tool?.toolName).toBe('execute');
    // The title from the first report survives the later update, and the body arrives with it.
    expect(tool?.input.title).toBe('Run the tests');
    expect(tool?.output).toBe('4 passed');
  });

  it('reports a failed tool with its error text and ignores unknown updates', () => {
    let messages = applyHarnessUpdate([], update({
      sessionUpdate: 'tool_call', toolCallId: 'call_2', title: 'Deploy', kind: 'other', status: 'in_progress',
    }));
    messages = applyHarnessUpdate(messages, update({
      sessionUpdate: 'tool_call_update', toolCallId: 'call_2', status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'permission denied' } }],
    }));
    const part = messages[0]!.parts?.[0];
    expect(part?.kind === 'tool' && part.tool.state).toBe('error');
    expect(part?.kind === 'tool' && part.tool.error).toBe('permission denied');

    // A variant this client does not know (a newer agent) leaves the transcript untouched.
    const after = applyHarnessUpdate(messages, update({ sessionUpdate: 'session_info_update', title: 'x' }));
    expect(after).toEqual(messages);
    const plan = applyHarnessUpdate(messages, update({ sessionUpdate: 'plan', entries: [] }));
    expect(plan).toEqual(messages);
  });
});
