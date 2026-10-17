import { beforeEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { generateStructured, parseGeneratedObject } from '../services/structuredGeneration';
import { t } from '@i18n';
vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('../services/provider', () => ({ createChatModel: () => 'model' }));
vi.mock('../stores/aiConfig', () => ({ activeModelProfile: () => ({}) }));
vi.mock('@platform/diagnostics', () => ({ diagnostic: vi.fn() }));
const reply = (text: string, finishReason = 'stop') => ({ text, finishReason, usage: { outputTokens: 100 } }) as Awaited<ReturnType<typeof generateText>>;
beforeEach(() => vi.clearAllMocks());
const options = () => ({ task: 'grouping' as const, system: 'Return JSON', prompt: 'Items', signal: new AbortController().signal, parse: parseGeneratedObject });

it('reads complete objects in prose or fences, including braces and escaped quotes inside strings', () => {
  const value = { name: 'Use { braces } and "quotes"', nested: { ids: ['one'] } };
  expect(parseGeneratedObject(`Here is the plan:\n\u0060\u0060\u0060json\n${JSON.stringify(value)}\n\u0060\u0060\u0060`)).toEqual(value);
  expect(() => parseGeneratedObject('{"groups":[{"name":"unfinished"}')).toThrow();
  expect(() => parseGeneratedObject('')).toThrow();
});
it('retries truncated replies with a larger budget and returns only a complete result', async () => {
  vi.mocked(generateText).mockResolvedValueOnce(reply('{"groups":[', 'length')).mockResolvedValueOnce(reply('{"groups":[]}'));
  expect(await generateStructured(options())).toEqual({ groups: [] });
  const calls = vi.mocked(generateText).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1]![0].maxOutputTokens).toBeGreaterThan(calls[0]![0].maxOutputTokens!);
});
it.each(['', '{"groups":[', 'not JSON'])('bounds unsuccessful retries and never exposes a raw syntax error for %j', async text => {
  vi.mocked(generateText).mockResolvedValue(reply(text));
  await expect(generateStructured(options())).rejects.toThrow(t(text ? 'The model returned an invalid result after retrying. Try again or choose another model.' : 'The model returned no result. Try again or choose another model.'));
  expect(generateText).toHaveBeenCalledTimes(2);
});
it('retries schema failures and retains caller messages for command revision', async () => {
  vi.mocked(generateText).mockResolvedValueOnce(reply('{}')).mockResolvedValueOnce(reply('{"command":"echo ok"}'));
  const messages = [{ role: 'user' as const, content: 'Revise command' }];
  const result = await generateStructured({ task: 'command', system: 'Command', messages, signal: new AbortController().signal, parse: text => {
    const parsed = parseGeneratedObject(text) as { command?: string }; if (!parsed.command) throw new Error('Missing command'); return parsed.command;
  } });
  expect(result).toBe('echo ok');
  expect(vi.mocked(generateText).mock.calls[1]![0].messages).toEqual(messages);
});
it('does not retry canceled or network failures', async () => {
  vi.mocked(generateText).mockRejectedValue(new Error('Network offline'));
  await expect(generateStructured(options())).rejects.toThrow('Network offline');
  expect(generateText).toHaveBeenCalledOnce();
  vi.clearAllMocks(); const controller = new AbortController(); controller.abort();
  await expect(generateStructured({ ...options(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(generateText).not.toHaveBeenCalled();
});
it('converts truncated transport JSON failures into a bounded retry and readable error', async () => {
  vi.mocked(generateText).mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));
  await expect(generateStructured(options())).rejects.toThrow(t('The model returned an invalid result after retrying. Try again or choose another model.'));
  expect(generateText).toHaveBeenCalledTimes(2);
});
