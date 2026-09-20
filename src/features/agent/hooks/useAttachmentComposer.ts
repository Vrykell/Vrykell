import { useCallback, useEffect, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useToastStore } from '@ui/Toast';
import {
  LIMITS,
  importFileAsAttachment,
  makePasteAttachment,
  saveBlobAsAttachment,
  totalSize,
  type AttachmentMeta,
} from '@features/agent/model/attachments';

/**
 * 管理附件编辑态：选择、粘贴、拖放、预览、删除和发送前清空。
 * 聊天面板与终端 AI 输入共用这套工作流，避免各自维护不同的校验规则。
 */
export function useAttachmentComposer() {
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const toastError = useCallback((message: string) => {
    useToastStore.getState().addToast(message, 'error');
  }, []);

  const addAttachments = useCallback((list: AttachmentMeta[]) => {
    if (list.length === 0) return;
    setAttachments((current) => {
      const next = [...current, ...list];
      if (totalSize(next) > LIMITS.totalBytes) {
        toastError('附件合计超过 10MB 上限');
        return current;
      }
      return next;
    });
  }, [toastError]);

  const importPaths = useCallback(async (paths: string[]) => {
    const imported: AttachmentMeta[] = [];
    for (const path of paths) {
      try {
        const attachment = await importFileAsAttachment(path);
        if (attachment.kind === 'image' && attachment.size > LIMITS.imageBytes) {
          toastError(`图片 ${attachment.name} 超过 5MB 上限`);
          continue;
        }
        imported.push(attachment);
      } catch (error) {
        toastError(String((error as Error)?.message ?? error));
      }
    }
    addAttachments(imported);
  }, [addAttachments, toastError]);

  const pickFiles = useCallback(async () => {
    try {
      const selected = await openDialog({ multiple: true });
      if (!selected) return;
      await importPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (error) {
      toastError(String((error as Error)?.message ?? error));
    }
  }, [importPaths, toastError]);

  const addBlobs = useCallback(async (files: File[]) => {
    const saved: AttachmentMeta[] = [];
    for (const file of files) {
      if (file.type.startsWith('image/') && file.size > LIMITS.imageBytes) {
        toastError(`图片 ${file.name || '粘贴的图片'} 超过 5MB 上限`);
        continue;
      }
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const name = file.name || `pasted-${Date.now()}.png`;
        saved.push(await saveBlobAsAttachment(name, file.type || 'application/octet-stream', base64));
      } catch (error) {
        toastError(String((error as Error)?.message ?? error));
      }
    }
    addAttachments(saved);
  }, [addAttachments, toastError]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;

    const unlistenRef: { current: (() => void) | undefined } = { current: undefined };
    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return;
        const element = panelRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const { x, y } = event.payload.position;
        if (x / scale < rect.left || x / scale > rect.right || y / scale < rect.top || y / scale > rect.bottom) return;
        void importPaths((event.payload as { paths: string[] }).paths);
      })
      .then((unlisten) => { unlistenRef.current = unlisten; })
      .catch(() => {});

    return () => unlistenRef.current?.();
  }, [importPaths]);

  const addPastedText = useCallback((text: string) => {
    if (text.length <= LIMITS.pasteFoldChars) return false;
    addAttachments([makePasteAttachment(text)]);
    return true;
  }, [addAttachments]);

  const togglePreview = useCallback((id: string) => {
    setPreviewId((current) => (current === id ? null : id));
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setPreviewId((current) => (current === id ? null : current));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setPreviewId(null);
  }, []);

  return {
    attachments,
    previewId,
    panelRef,
    addAttachments,
    addPastedText,
    pickFiles,
    addBlobs,
    togglePreview,
    removeAttachment,
    clearAttachments,
  };
}
