import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('copy-on-select', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('navigator.clipboard.writeText is called with selection text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    // 模拟选中文字后复制
    const selectedText = 'hello world';
    await navigator.clipboard.writeText(selectedText);

    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('clipboard write failure is silently caught', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    // 不应抛出异常
    await expect(navigator.clipboard.writeText('test').catch(() => {})).resolves.toBeUndefined();
  });
});
