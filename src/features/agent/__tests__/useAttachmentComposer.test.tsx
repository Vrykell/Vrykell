import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import type { EventCallback } from '@tauri-apps/api/event';
import type { DragDropEvent } from '@tauri-apps/api/window';
import { useToastStore } from '@ui/feedback/Toast';
import { LIMITS, makePasteAttachment } from '@features/agent/model/attachments';
import * as attachmentApi from '@features/agent/model/attachments';
import { useAttachmentComposer } from '@features/agent/hooks/useAttachmentComposer';

const mocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onDragDropEvent: mocks.listen }) }));

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

  describe('native file drops', () => {
    let listeners: Set<EventCallback<DragDropEvent>>;
    let subscriptions: (() => void)[];

    const drop = () => act(() => {
      for (const handler of listeners) handler({ event: 'tauri://drag-drop', id: 1,
        payload: { type: 'drop', paths: ['C:\\files\\notes.txt'], position: new PhysicalPosition(40, 40) } });
    });
    const finishSubscriptions = () => act(async () => { subscriptions.forEach(resolve => resolve()); });

    beforeEach(() => {
      vi.stubGlobal('__TAURI_INTERNALS__', {});
      listeners = new Set();
      subscriptions = [];
      mocks.listen.mockReset().mockImplementation((handler: EventCallback<DragDropEvent>) => {
        listeners.add(handler);
        return new Promise<() => void>(resolve => {
          subscriptions.push(() => resolve(() => { listeners.delete(handler); }));
        });
      });
      vi.spyOn(attachmentApi, 'importFileAsAttachment').mockResolvedValue({ id: 'file', kind: 'file', name: 'notes.txt', mime: 'text/plain', size: 10 });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    function panel() {
      const element = document.createElement('div');
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 300));
      return element;
    }

    it('imports an attachment once per drop after effect replay', async () => {
      const view = renderHook(() => useAttachmentComposer(), { wrapper: StrictMode });
      view.result.current.panelRef.current = panel();
      await finishSubscriptions();

      drop();

      await waitFor(() => expect(view.result.current.attachments).toHaveLength(1));
      expect(attachmentApi.importFileAsAttachment).toHaveBeenCalledExactlyOnceWith('C:\\files\\notes.txt');
      expect(listeners.size).toBe(1);
      drop();
      await waitFor(() => expect(view.result.current.attachments).toHaveLength(2));
      expect(attachmentApi.importFileAsAttachment).toHaveBeenCalledTimes(2);
      view.unmount();
      expect(listeners.size).toBe(0);
    });

    it('ignores events after unmount before the native subscription finishes', async () => {
      const view = renderHook(() => useAttachmentComposer());
      view.result.current.panelRef.current = panel();
      view.unmount();

      drop();
      await finishSubscriptions();

      expect(attachmentApi.importFileAsAttachment).not.toHaveBeenCalled();
      expect(listeners.size).toBe(0);
    });

    it('does not retain the previous draft listener after switching sessions', async () => {
      const firstUpdate = vi.fn();
      const secondUpdate = vi.fn();
      const view = renderHook(({ scopeKey, updateAttachments }) => useAttachmentComposer({ attachments: [], scopeKey, updateAttachments }), {
        initialProps: { scopeKey: 'first', updateAttachments: firstUpdate },
      });
      view.result.current.panelRef.current = panel();
      view.rerender({ scopeKey: 'second', updateAttachments: secondUpdate });

      drop();
      await finishSubscriptions();

      await waitFor(() => expect(secondUpdate).toHaveBeenCalledOnce());
      expect(firstUpdate).not.toHaveBeenCalled();
      expect(attachmentApi.importFileAsAttachment).toHaveBeenCalledOnce();
      expect(listeners.size).toBe(1);
    });
  });
});
