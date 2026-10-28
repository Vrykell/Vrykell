/**
 * attachments (M5) tests: serialization roundtrip / vision heuristic / model mapping fallback.
 * Note: no beforeEach (a vitest 4 trap in this repository, see the header comment in
 * files.test.ts); each case sets up its own mock implementation.
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

describe('serialization', () => {
  it('roundtrip; empty/dirty data → undefined', () => {
    const raw = serializeAttachments([img, file]);
    expect(deserializeAttachments(raw)).toEqual([img, file]);
    expect(serializeAttachments([])).toBe('');
    expect(serializeAttachments(undefined)).toBe('');
    expect(deserializeAttachments('')).toBeUndefined();
    expect(deserializeAttachments('[]')).toBeUndefined();
    expect(deserializeAttachments('{{{')).toBeUndefined();
  });
});

describe('supportsVision heuristic', () => {
  it('anthropic/gemini support it natively', () => {
    expect(supportsVision('anthropic', 'claude-sonnet-5')).toBe(true);
    expect(supportsVision('gemini', 'gemini-2.5-pro')).toBe(true);
  });
  it('openai-compatible by model name', () => {
    expect(supportsVision('openai-compatible', 'gpt-4o')).toBe(true);
    expect(supportsVision('openai-compatible', 'qwen2.5-vl-72b')).toBe(true);
    expect(supportsVision('openai-compatible', 'deepseek-chat')).toBe(false);
  });
});

describe('attachmentsForModel', () => {
  it('vision model: image reads blob → dataUrl image part', async () => {
    invokeMock.mockResolvedValue('aGVsbG8='); // read_attachment
    const r = await attachmentsForModel([img, file], true);
    expect(r.images).toEqual(['data:image/png;base64,aGVsbG8=']);
    expect(r.text).toContain('【文件 log.txt】');
    expect(r.text).toContain('hello world');
  });

  it('non-vision model: images fall back to a placeholder hint', async () => {
    const r = await attachmentsForModel([img], false);
    expect(r.images).toEqual([]);
    expect(r.text).toContain('不支持图片输入');
  });

  it('blob read failure falls back to a placeholder hint without throwing', async () => {
    invokeMock.mockRejectedValue(new Error('附件不存在'));
    const r = await attachmentsForModel([img], true);
    expect(r.images).toEqual([]);
    expect(r.text).toContain('读取失败');
  });

  it('paste attachment is labelled as pasted text', async () => {
    const p = makePasteAttachment('x'.repeat(600));
    const r = await attachmentsForModel([p], true);
    expect(r.text).toContain('【粘贴的文本】');
    expect(p.name).toContain('600 字');
  });
});

describe('limits', () => {
  it('totalSize accumulates; paste threshold 500', () => {
    expect(totalSize([img, file])).toBe(1245);
    expect(LIMITS.pasteFoldChars).toBe(500);
    expect(LIMITS.imageBytes).toBe(5 * 1024 * 1024);
  });
});
