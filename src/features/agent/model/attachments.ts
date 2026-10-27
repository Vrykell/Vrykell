/**
 * attachments — AI conversation attachments.
 *
 * Three sources normalized into AttachmentMeta:
 *   image: pasted/dropped/selected image (bytes stored under ~/.vrykell/attachments/, blobPath)
 *   file : selected file — UTF-8 text ≤100KB inlined into textContent, otherwise stored as blobPath
 *   paste: over-long pasted text (>PASTE_FOLD_CHARS folded into a chip), always inline in textContent
 *
 * Model mapping (agentStream calls attachmentsForModel):
 *   vision model: image → { type:'image', image: dataUrl } (read blobPath → base64)
 *   text attachments → a bracketed "[File name]" header plus its content merged into user content
 *   non-vision model: image downgraded to a bracketed text hint
 *
 * Persistence: ChatMessage.attachments is serialized into the DB attachments column ('' = none).
 * textContent is stored with the metadata (still present after reopening); blobPath points to a
 * file in the attachment directory.
 */

import { t } from '@i18n';
import { invoke } from '@platform/diagnostics';
import type { ProviderKind } from '@features/agent/services/provider';

export interface AttachmentMeta {
  id: string;
  kind: 'image' | 'file' | 'paste';
  name: string;
  mime: string;
  size: number;
  /** Inline text (≤100KB); always present for paste. */
  textContent?: string;
  /** Stored file path (inside ~/.vrykell/attachments/). */
  blobPath?: string;
}

export const LIMITS = {
  /** Per-image limit. */
  imageBytes: 5 * 1024 * 1024,
  /** Combined limit (the backend also enforces 10MB). */
  totalBytes: 10 * 1024 * 1024,
  /** Threshold above which pasted text folds into a chip. */
  pasteFoldChars: 500,
} as const;

let counter = 0;
export const nextAttachmentId = () => `att-${Date.now()}-${counter++}`;

/** Return shape of the backend import_attachment/save_attachment commands. */
export interface AttachmentImport {
  name: string;
  mime: string;
  size: number;
  text: string | null;
  blob_path: string | null;
}

export function importToMeta(r: AttachmentImport, kind: AttachmentMeta['kind']): AttachmentMeta {
  return {
    id: nextAttachmentId(),
    kind,
    name: r.name,
    mime: r.mime,
    size: r.size,
    textContent: r.text ?? undefined,
    blobPath: r.blob_path ?? undefined,
  };
}

/** Select/import a local file as an attachment. The path must come from a system-level user action (picker or drag-and-drop), otherwise the backend rejects it. */
export async function importFileAsAttachment(path: string): Promise<AttachmentMeta> {
  try {
    const r = await invoke<AttachmentImport>('import_attachment', { path });
    return importToMeta(r, r.mime.startsWith('image/') ? 'image' : 'file');
  } catch (error) {
    // The backend returns stable error codes only; the copy is localized here through i18n.
    if (String(error).includes('path-not-granted')) {
      throw new Error(t('This file was not chosen by you. Pick it through the dialog or drop it onto the window.'));
    }
    throw error;
  }
}

/** Save pasted/dropped binary data (File/Blob already read as base64) as an attachment. */
export async function saveBlobAsAttachment(name: string, mime: string, base64: string): Promise<AttachmentMeta> {
  const r = await invoke<AttachmentImport>('save_attachment', { name, dataBase64: base64 });
  const meta = importToMeta(r, mime.startsWith('image/') ? 'image' : 'file');
  return { ...meta, mime }; // The save side guesses the mime from the file name; the frontend File.type is more accurate.
}

/** Fold over-long pasted text into a paste attachment. */
export function makePasteAttachment(text: string): AttachmentMeta {
  return {
    id: nextAttachmentId(),
    kind: 'paste',
    name: t('Pasted text ({{count}} characters)', { count: text.length }),
    mime: 'text/plain',
    size: text.length,
    textContent: text,
  };
}

/** Read an attachment blob as a dataUrl (shared by preview and model input). */
export async function readAttachmentDataUrl(att: AttachmentMeta): Promise<string> {
  if (!att.blobPath) throw new Error(t('Attachment data is missing.'));
  const b64 = await invoke<string>('read_attachment', { path: att.blobPath });
  return `data:${att.mime};base64,${b64}`;
}

// ── serialization ──

export function serializeAttachments(atts?: AttachmentMeta[]): string {
  return atts && atts.length > 0 ? JSON.stringify(atts) : '';
}

export function deserializeAttachments(raw: string): AttachmentMeta[] | undefined {
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v) || v.length === 0) return undefined;
    return v as AttachmentMeta[];
  } catch {
    return undefined;
  }
}

// ── model mapping ──

/** Vision capability: natively supported by anthropic/gemini; heuristic by model name for openai-compatible endpoints. */
export function supportsVision(provider: ProviderKind, model: string): boolean {
  if (provider === 'anthropic' || provider === 'gemini') return true;
  return /gpt-4o|gpt-4\.1|gpt-5|o1|o3|o4|vision|\bvl\b|qwen.*vl|glm-4v|claude|gemini/i.test(model);
}

/**
 * Attachment → the shape fed to the model.
 * Vision model: images become image parts (blob read); text/paste become text segments.
 * Non-vision: images are downgraded to placeholder hint text.
 * Returns { text: the text segment merged into user content, images: dataUrl list for image parts }.
 */
export async function attachmentsForModel(
  atts: AttachmentMeta[],
  vision: boolean,
): Promise<{ text: string; images: string[] }> {
  const textParts: string[] = [];
  const images: string[] = [];
  for (const att of atts) {
    if (att.textContent !== undefined) {
      const label = att.kind === 'paste' ? t('Pasted text') : t('File {{name}}', { name: att.name });
      textParts.push(`【${label}】\n${att.textContent}`);
    } else if (att.mime.startsWith('image/')) {
      if (vision && att.blobPath) {
        try {
          images.push(await readAttachmentDataUrl(att));
        } catch {
          textParts.push(`【${t('Image {{name}} (could not be read; skipped)', { name: att.name })}】`);
        }
      } else {
        textParts.push(`【${t('Image {{name}} (this model does not support image input; skipped)', { name: att.name })}】`);
      }
    } else if (att.blobPath) {
      textParts.push(`【${t('File {{name}} (binary; skipped)', { name: att.name })}】`);
    }
  }
  return { text: textParts.join('\n\n'), images };
}

/** Combined attachment size (used by the frontend limit check). */
export function totalSize(atts: AttachmentMeta[]): number {
  return atts.reduce((s, a) => s + a.size, 0);
}
