import { describe, expect, it } from 'vitest';
import { applyHarnessUpdate } from './harnessTranscript';
import type { ChatMessage } from '@features/chat';

const update = (patch: Record<string, unknown>) => ({ sessionId: 's', update: patch });

describe('applyHarnessUpdate', () => {
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
