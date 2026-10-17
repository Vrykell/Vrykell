import { beforeEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { GROUPING_LIMIT, parseGrouping, suggestGrouping } from '../services/autoGrouping';
vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('../services/provider', () => ({ createChatModel: () => 'model' }));
vi.mock('../stores/aiConfig', () => ({ activeModelProfile: () => ({}), isApiKeyConfigured: () => true }));
beforeEach(() => vi.clearAllMocks());
const items = [{ id: 'build', label: 'Build' }, { id: 'test', label: 'Tests' }];
it('ignores unknown ids, assigns each item once and merges duplicate group names', () => {
  expect(parseGrouping(JSON.stringify({ groups: [{ name: 'Work', itemIds: ['build', 'unknown', 'build'] }, { name: 'work', itemIds: ['build', 'test'] }] }), items))
    .toEqual([{ name: 'Work', itemIds: ['build', 'test'] }]);
  expect(() => parseGrouping('{"groups":[]}', items)).toThrow();
  expect(() => parseGrouping('{"groups":[{"name":"bad","itemIds":null}]}', items)).toThrow();
});
it('bounds model input, passes cancellation and never executes suggested text', async () => {
  vi.mocked(generateText).mockResolvedValue({ text: '{"groups":[{"name":"Work","itemIds":["i1"]}]}' } as Awaited<ReturnType<typeof generateText>>);
  const signal = new AbortController().signal;
  const groups = await suggestGrouping(Array.from({ length: 250 }, (_, id) => ({ id: String(id), label: 'x'.repeat(3000) })), 'commands', signal);
  const request = vi.mocked(generateText).mock.calls[0]![0];
  const input = JSON.parse(request.prompt as string) as { items: { label: string }[] };
  expect(input.items).toHaveLength(GROUPING_LIMIT); expect(input.items[0]!.label).toHaveLength(2048);
  expect((input.items[0] as { id?: string }).id).toBe('i1');
  expect(request.abortSignal).toBe(signal); expect(groups[0]?.itemIds).toEqual(['0']);
});
