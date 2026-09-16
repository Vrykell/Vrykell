import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToastStore } from '@/components/Toast';
import { LIMITS, makePasteAttachment } from '@features/agent/model/attachments';
import { useAttachmentComposer } from '@features/agent/hooks/useAttachmentComposer';

describe('useAttachmentComposer', () => {
  const toastSnapshot = useToastStore.getState();

  afterEach(() => {
    for (const timer of Object.values(useToastStore.getState().timers)) clearTimeout(timer);
    useToastStore.setState(toastSnapshot, true);
  });

  it('manages attachment preview, removal and clearing', () => {
    const attachment = makePasteAttachment('x'.repeat(LIMITS.pasteFoldChars + 1));
    const { result } = renderHook(() => useAttachmentComposer());

    act(() => result.current.addAttachments([attachment]));
    expect(result.current.attachments).toEqual([attachment]);

    act(() => result.current.togglePreview(attachment.id));
    expect(result.current.previewId).toBe(attachment.id);

    act(() => result.current.removeAttachment(attachment.id));
    expect(result.current.attachments).toEqual([]);
    expect(result.current.previewId).toBeNull();

    act(() => result.current.addAttachments([attachment]));
    act(() => result.current.clearAttachments());
    expect(result.current.attachments).toEqual([]);
    expect(result.current.previewId).toBeNull();
  });

  it('folds long pasted text and ignores short text', () => {
    const { result } = renderHook(() => useAttachmentComposer());
    const shortText = 'short';
    const longText = 'x'.repeat(LIMITS.pasteFoldChars + 1);

    let shortAdded = true;
    act(() => { shortAdded = result.current.addPastedText(shortText); });
    expect(shortAdded).toBe(false);
    expect(result.current.attachments).toHaveLength(0);

    let longAdded = false;
    act(() => { longAdded = result.current.addPastedText(longText); });
    expect(longAdded).toBe(true);
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]?.textContent).toBe(longText);
  });

  it('rejects attachments beyond the aggregate size limit', () => {
    const { result } = renderHook(() => useAttachmentComposer());
    const oversized = {
      id: 'oversized',
      kind: 'file' as const,
      name: 'oversized.txt',
      mime: 'text/plain',
      size: LIMITS.totalBytes + 1,
    };

    act(() => result.current.addAttachments([oversized]));

    expect(result.current.attachments).toHaveLength(0);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.message).toBe('附件合计超过 10MB 上限');
  });
});
