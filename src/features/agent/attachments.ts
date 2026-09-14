/**
 * attachments — AI 对话附件（M5）。
 *
 * 三种来源统一成 AttachmentMeta：
 *   image：粘贴/拖入/选择的图片（字节落 ~/.vrykell/attachments/，blobPath）
 *   file ：选择的文件——UTF-8 文本 ≤100KB 内联 textContent，否则落盘 blobPath
 *   paste：超长粘贴文本（>PASTE_FOLD_CHARS 折叠成 chip），始终内联 textContent
 *
 * 模型映射（agentStream 调 toModelParts）：
 *   视觉模型：image → { type:'image', image: dataUrl }（读 blobPath → base64）
 *   文本附件 → 【文件 name】\n内容 段并入 user content
 *   非视觉模型：image 降级为 [图片 name 略] 文本提示
 *
 * 持久化：ChatMessage.attachments 序列化进 DB attachments 列（'' = 无）。
 * textContent 随元数据入库（重开后仍在）；blobPath 指向附件目录文件。
 */

import { invoke } from '@tauri-apps/api/core';
import type { ProviderKind } from '@/features/agent/services/provider';

export interface AttachmentMeta {
  id: string;
  kind: 'image' | 'file' | 'paste';
  name: string;
  mime: string;
  size: number;
  /** 文本内联（≤100KB）；paste 恒有 */
  textContent?: string;
  /** 落盘路径（~/.vrykell/attachments/ 内） */
  blobPath?: string;
}

export const LIMITS = {
  /** 单张图片上限 */
  imageBytes: 5 * 1024 * 1024,
  /** 合计上限（Rust 侧也挡 10MB） */
  totalBytes: 10 * 1024 * 1024,
  /** 粘贴文本折叠成 chip 的阈值 */
  pasteFoldChars: 500,
} as const;

let counter = 0;
export const nextAttachmentId = () => `att-${Date.now()}-${counter++}`;

/** Rust import_attachment/save_attachment 的返回形状 */
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

/** 选择/导入本地文件为附件 */
export async function importFileAsAttachment(path: string): Promise<AttachmentMeta> {
  const r = await invoke<AttachmentImport>('import_attachment', { path });
  return importToMeta(r, r.mime.startsWith('image/') ? 'image' : 'file');
}

/** 保存粘贴/拖入的二进制（File/Blob 已读成 base64）为附件 */
export async function saveBlobAsAttachment(
  name: string,
  mime: string,
  base64: string,
): Promise<AttachmentMeta> {
  const r = await invoke<AttachmentImport>('save_attachment', { name, dataBase64: base64 });
  const meta = importToMeta(r, mime.startsWith('image/') ? 'image' : 'file');
  return { ...meta, mime }; // save 侧 mime 按文件名猜，前端 File.type 更准
}

/** 超长粘贴文本折叠为 paste 附件 */
export function makePasteAttachment(text: string): AttachmentMeta {
  return {
    id: nextAttachmentId(),
    kind: 'paste',
    name: `粘贴的文本（${text.length} 字）`,
    mime: 'text/plain',
    size: text.length,
    textContent: text,
  };
}

/** 读取附件 blob 为 dataUrl（预览与喂模型共用） */
export async function readAttachmentDataUrl(att: AttachmentMeta): Promise<string> {
  if (!att.blobPath) throw new Error('附件没有落盘数据');
  const b64 = await invoke<string>('read_attachment', { path: att.blobPath });
  return `data:${att.mime};base64,${b64}`;
}

// ── 序列化 ──

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

// ── 模型映射 ──

/** 视觉能力判定：anthropic/gemini 原生支持；openai-compatible 按模型名启发式 */
export function supportsVision(provider: ProviderKind, model: string): boolean {
  if (provider === 'anthropic' || provider === 'gemini') return true;
  return /gpt-4o|gpt-4\.1|gpt-5|o1|o3|o4|vision|\bvl\b|qwen.*vl|glm-4v|claude|gemini/i.test(model);
}

/**
 * 附件 → 喂给模型的形态。
 * 视觉模型：图片转 image part（读 blob）；文本/粘贴转文本段。
 * 非视觉：图片降级为占位提示文本。
 * 返回 { text: 并入 user content 的文本段, images: image part 的 dataUrl 列表 }
 */
export async function attachmentsForModel(
  atts: AttachmentMeta[],
  vision: boolean,
): Promise<{ text: string; images: string[] }> {
  const textParts: string[] = [];
  const images: string[] = [];
  for (const att of atts) {
    if (att.textContent !== undefined) {
      const label = att.kind === 'paste' ? '粘贴的文本' : `文件 ${att.name}`;
      textParts.push(`【${label}】\n${att.textContent}`);
    } else if (att.mime.startsWith('image/')) {
      if (vision && att.blobPath) {
        try {
          images.push(await readAttachmentDataUrl(att));
        } catch {
          textParts.push(`【图片 ${att.name}】（读取失败，略）`);
        }
      } else {
        textParts.push(`【图片 ${att.name}】（当前模型不支持图片输入，略）`);
      }
    } else if (att.blobPath) {
      textParts.push(`【文件 ${att.name}】（二进制，略）`);
    }
  }
  return { text: textParts.join('\n\n'), images };
}

/** 附件合计大小 */
export function totalSize(atts: AttachmentMeta[]): number {
  return atts.reduce((s, a) => s + a.size, 0);
}
