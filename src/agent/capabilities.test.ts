/**
 * capabilities — 模型能力探测规则测试。
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITY_LABELS, detectCapabilities, hasCapability } from '@/agent/capabilities';

describe('detectCapabilities', () => {
  it('anthropic / gemini：原生视觉与搜索，现代模型有推理', () => {
    const c = detectCapabilities('anthropic', 'claude-sonnet-5');
    expect(c.vision).toBe(true);
    expect(c.search).toBe(true);
    expect(c.reasoning).toBe(true);
    expect(c.tools).toBe(true);
    const g = detectCapabilities('gemini', 'gemini-2.5-flash');
    expect(g.vision).toBe(true);
    expect(g.search).toBe(true);
  });

  it('openai-compatible：按模型名判定视觉/推理，无原生搜索', () => {
    const gpt4o = detectCapabilities('openai-compatible', 'gpt-4o');
    expect(gpt4o.vision).toBe(true);
    expect(gpt4o.reasoning).toBe(false);
    expect(gpt4o.search).toBe(false);
    expect(gpt4o.tools).toBe(true);

    const o1 = detectCapabilities('openai-compatible', 'o1-mini');
    expect(o1.reasoning).toBe(true);
    expect(o1.vision).toBe(true);

    const qwenVl = detectCapabilities('openai-compatible', 'qwen2.5-vl-7b');
    expect(qwenVl.vision).toBe(true);

    const r1 = detectCapabilities('openai-compatible', 'deepseek-r1');
    expect(r1.reasoning).toBe(true);
    expect(r1.vision).toBe(false);
  });

  it('嵌入/转写类模型不支持工具', () => {
    const emb = detectCapabilities('openai-compatible', 'text-embedding-3-small');
    expect(emb.tools).toBe(false);
    const tts = detectCapabilities('openai-compatible', 'tts-1');
    expect(tts.tools).toBe(false);
    // 普通模型默认支持工具
    const plain = detectCapabilities('openai-compatible', 'gpt-3.5-turbo');
    expect(plain.tools).toBe(true);
  });

  it('hasCapability：profile 缺省时按启发式兜底', () => {
    expect(hasCapability(undefined, 'vision', 'anthropic', 'claude-sonnet-5')).toBe(true);
    expect(hasCapability(undefined, 'search', 'openai-compatible', 'gpt-4o')).toBe(false);
    expect(
      hasCapability(
        { vision: false, reasoning: false, tools: true, search: false },
        'vision',
        'anthropic',
        'x',
      ),
    ).toBe(false);
    expect(
      hasCapability(
        { vision: true, reasoning: false, tools: true, search: false },
        'vision',
        'openai-compatible',
        'x',
      ),
    ).toBe(true);
  });

  it('标签文案完整', () => {
    expect(CAPABILITY_LABELS).toEqual({
      vision: '视觉',
      reasoning: '推理',
      tools: '工具',
      search: '搜索',
    });
  });
});
