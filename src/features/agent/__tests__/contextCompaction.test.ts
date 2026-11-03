import { expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
const summarize = vi.hoisted(() => vi.fn(async () => ({ text: 'Earlier steps completed.' })));
vi.mock('ai', () => ({ generateText: summarize }));
import { messageTokens, planContext, sizeModelMessages } from '../model/context';

function exchange(id: string, output: string): ModelMessage[] {
  return [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: 'read_file', input: { path: '/project/file' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'read_file', output: { type: 'text', value: output } }] },
  ];
}

for (const strategy of ['window', 'compact'] as const) it(`folds earlier steps of one turn using ${strategy} without losing the request or orphaning results`, async () => {
  const request: ModelMessage = { role: 'user', content: 'Inspect the project and fix the failure.' };
  const newest = exchange('latest', 'Recent evidence');
  const sized = sizeModelMessages([request, ...exchange('earlier', 'old evidence '.repeat(900)), ...newest]);
  const plan = await planContext({ sized, strategy, maxTokens: 1200, summaryTokens: 100, model: {} as never });
  expect(plan.messages).toEqual([request, ...newest]);
  expect(plan.messages.reduce((sum, msg) => sum + messageTokens(msg), 0)).toBeLessThan(1200);
  if (strategy === 'compact') expect(plan.system).toBe('Earlier steps completed.');
});

it('keeps all results from a parallel tool exchange with their shared call message', async () => {
  const first = exchange('first', 'a');
  const second = exchange('second', 'b');
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Inspect both files' },
    { role: 'assistant', content: [...(first[0]!.content as Exclude<ModelMessage['content'], string>), ...(second[0]!.content as Exclude<ModelMessage['content'], string>)] } as ModelMessage,
    first[1]!, second[1]!,
  ];
  const sized = sizeModelMessages(messages);
  expect(sized[1]!.group).toBe(sized[2]!.group);
  expect(sized[2]!.group).toBe(sized[3]!.group);
  expect(sized[0]!.group).toBeUndefined();
});

it('reserves the complete newest exchange before allocating summary space', async () => {
  const request: ModelMessage = { role: 'user', content: 'Keep working' };
  const newest = exchange('latest', 'new result '.repeat(100));
  const maxTokens = [request, ...newest].reduce((sum, msg) => sum + messageTokens(msg), 0);
  const plan = await planContext({ sized: sizeModelMessages([request, ...exchange('old', 'old '.repeat(1000)), ...newest]),
    strategy: 'compact', maxTokens, summaryTokens: 100, model: {} as never });
  expect(plan.messages).toEqual([request, ...newest]);
  expect(plan.system).toBeUndefined();
});
