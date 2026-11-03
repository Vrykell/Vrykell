import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentMeta } from '@features/agent/model/attachments';
import { harnessPromptContent, harnessSupportsImages } from '../services/harnessAttachments';

const readAttachmentDataUrl = vi.hoisted(() => vi.fn());

vi.mock('@features/agent/model/attachments', () => ({ readAttachmentDataUrl }));

const attachment = (overrides: Partial<AttachmentMeta>): AttachmentMeta => ({
  id: 'attachment', kind: 'file', name: 'file.txt', mime: 'text/plain', size: 10, ...overrides,
});

describe('harness attachments', () => {
  beforeEach(() => readAttachmentDataUrl.mockReset());

  it('reads the image capability only when the agent advertised it', () => {
    expect(harnessSupportsImages({ promptCapabilities: { image: true } })).toBe(true);
    expect(harnessSupportsImages({ promptCapabilities: { image: false } })).toBe(false);
    expect(harnessSupportsImages({ promptCapabilities: {} })).toBe(false);
    expect(harnessSupportsImages({})).toBe(false);
    expect(harnessSupportsImages(null)).toBe(false);
  });

  it('merges text attachments into the prompt text', async () => {
    const content = await harnessPromptContent('Question', [
      attachment({ id: 'paste', kind: 'paste', name: 'pasted', textContent: 'inline body' }),
      attachment({ id: 'file', name: 'notes.txt', textContent: 'file body' }),
    ]);
    expect(content.text).toContain('Question');
    expect(content.text).toContain('inline body');
    expect(content.text).toContain('file body');
    expect(content.images).toEqual([]);
    expect(content.unsupported).toEqual([]);
  });

  it('reads images as base64 content blocks', async () => {
    readAttachmentDataUrl.mockResolvedValue('data:image/png;base64,AAAA');
    const content = await harnessPromptContent('Look', [
      attachment({ kind: 'image', name: 'shot.png', mime: 'image/png', blobPath: '/tmp/shot.png' }),
    ]);
    expect(content.images).toEqual([{ mimeType: 'image/png', data: 'AAAA' }]);
    expect(readAttachmentDataUrl).toHaveBeenCalledOnce();
  });

  it('reports binary files and unreadable images instead of dropping them', async () => {
    readAttachmentDataUrl.mockResolvedValue('not-a-data-url');
    const content = await harnessPromptContent('', [
      attachment({ name: 'manual.pdf', mime: 'application/pdf', blobPath: '/tmp/manual.pdf' }),
      attachment({ name: 'broken.png', kind: 'image', mime: 'image/png', blobPath: '/tmp/broken.png' }),
    ]);
    expect(content.text).toBe('');
    expect(content.images).toEqual([]);
    expect(content.unsupported).toEqual(['manual.pdf', 'broken.png']);
  });
});
