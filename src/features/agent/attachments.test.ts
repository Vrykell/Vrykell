/**
 * attachments（M5）测试：序列化 roundtrip / 视觉启发式 / 模型映射降级。
 * 注意：不用 beforeEach（本仓库 vitest 4 陷阱，见 files.test.ts 头注释），
 * 各用例自设 mock 实现。
 */
import { describe, it, expect, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  serializeAttachments,
  deserializeAttachments,
  supportsVision,
  attachmentsForModel,
  makePasteAttachment,
  totalSize,
  LIMITS,
  type AttachmentMeta,
} from '@features/agent/model/attachments';

const img: AttachmentMeta = {
  id: 'a1', kind: 'image', name: 'shot.png', mime: 'image/png', size: 1234, blobPath: '/atts/x-shot.png',
};
const file: AttachmentMeta = {
  id: 'a2', kind: 'file', name: 'log.txt', mime: 'text/plain', size: 11, textContent: 'hello world',
};

describe('序列化', () => {
  it('roundtrip；空/脏数据 → undefined', () => {
    const raw = serializeAttachments([img, file]);
    expect(deserializeAttachments(raw)).toEqual([img, file]);
    expect(serializeAttachments([])).toBe('');
    expect(serializeAttachments(undefined)).toBe('');
    expect(deserializeAttachments('')).toBeUndefined();
    expect(deserializeAttachments('[]')).toBeUndefined();
    expect(deserializeAttachments('{{{')).toBeUndefined();
  });
});

describe('supportsVision 启发式', () => {
  it('anthropic/gemini 原生支持', () => {
    expect(supportsVision('anthropic', 'claude-sonnet-5')).toBe(true);
    expect(supportsVision('gemini', 'gemini-2.5-pro')).toBe(true);
  });
  it('openai-compatible 按模型名', () => {
    expect(supportsVision('openai-compatible', 'gpt-4o')).toBe(true);
    expect(supportsVision('openai-compatible', 'qwen2.5-vl-72b')).toBe(true);
    expect(supportsVision('openai-compatible', 'deepseek-chat')).toBe(false);
  });
});

describe('attachmentsForModel', () => {
  it('视觉模型：图片读 blob → dataUrl image part', async () => {
    invokeMock.mockResolvedValue('aGVsbG8='); // read_attachment
    const r = await attachmentsForModel([img, file], true);
    expect(r.images).toEqual(['data:image/png;base64,aGVsbG8=']);
    expect(r.text).toContain('【文件 log.txt】');
    expect(r.text).toContain('hello world');
  });

  it('非视觉模型：图片降级为占位提示', async () => {
    const r = await attachmentsForModel([img], false);
    expect(r.images).toEqual([]);
    expect(r.text).toContain('不支持图片输入');
  });

  it('blob 读取失败降级为占位提示而不抛出', async () => {
    invokeMock.mockRejectedValue(new Error('附件不存在'));
    const r = await attachmentsForModel([img], true);
    expect(r.images).toEqual([]);
    expect(r.text).toContain('读取失败');
  });

  it('paste 附件标记为粘贴的文本', async () => {
    const p = makePasteAttachment('x'.repeat(600));
    const r = await attachmentsForModel([p], true);
    expect(r.text).toContain('【粘贴的文本】');
    expect(p.name).toContain('600 字');
  });
});

describe('限额', () => {
  it('totalSize 累加；粘贴阈值 500', () => {
    expect(totalSize([img, file])).toBe(1245);
    expect(LIMITS.pasteFoldChars).toBe(500);
    expect(LIMITS.imageBytes).toBe(5 * 1024 * 1024);
  });
});
