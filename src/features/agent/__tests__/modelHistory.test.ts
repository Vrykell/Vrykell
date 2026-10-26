import { expect, it } from 'vitest';
import { deserializeParts, partsToModelMessages, serializeParts, type MessagePart } from '../model/messageParts';

it('persists complete results separately from the display preview and replays matching pairs', () => {
  const full = JSON.stringify({ paths: ['src/one.ts', 'src/two.ts'], detail: 'x'.repeat(20_000) });
  const parts: MessagePart[] = [
    { kind: 'text', text: 'Inspecting files.' },
    { kind: 'tool', tool: { toolCallId: 'call-one', toolName: 'read_file', input: { path: '/project/one.ts' }, state: 'done', startedAt: 1, output: 'preview', modelOutput: full } },
    { kind: 'text', text: 'Finished.' },
  ];
  const messages = partsToModelMessages('Inspecting files.Finished.', deserializeParts(serializeParts(parts)));
  expect(messages.map(message => message.role)).toEqual(['assistant', 'assistant', 'tool', 'assistant']);
  expect(messages[1]!.content).toEqual([{ type: 'tool-call', toolCallId: 'call-one', toolName: 'read_file', input: { path: '/project/one.ts' } }]);
  expect(messages[2]!.content).toEqual([{ type: 'tool-result', toolCallId: 'call-one', toolName: 'read_file', output: { type: 'text', value: full } }]);
});
it('pairs interrupted and legacy calls without inventing a completed result', () => {
  const messages = partsToModelMessages('', [{ kind: 'tool', tool: { toolCallId: 'interrupted', toolName: 'run_command', input: { command: 'build' }, state: 'cancelled', startedAt: 1 } }]);
  expect(JSON.stringify(messages)).toContain('interrupted');
  expect(JSON.stringify(messages)).toContain('No completed result');
  expect(messages).toHaveLength(2);
});
it('falls back to plain history for malformed stored tool records', () => {
  expect(deserializeParts('[{"kind":"tool"}]')).toBeUndefined();
  expect(deserializeParts('[{"kind":"text","text":42}]')).toBeUndefined();
  expect(deserializeParts('[null]')).toBeUndefined();
});
