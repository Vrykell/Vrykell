/**
 * harnessAttachments — turn composer attachments into what an ACP prompt can carry.
 *
 * The protocol accepts text and image content blocks, and an image is only legal when the agent
 * advertised `promptCapabilities.image` during initialization. Text files and folded pasted text
 * become text blocks; images are read from the attachment store as base64; anything else is
 * reported as unsupported so the caller can refuse the send instead of silently dropping it.
 */
import { readAttachmentDataUrl, type AttachmentMeta } from '@features/agent/model/attachments';
import { t } from '@i18n';

export interface HarnessPromptImage {
  mimeType: string;
  data: string;
}

export interface HarnessPromptContent {
  /** The user's text with text attachments appended, ready for one text block. */
  text: string;
  images: HarnessPromptImage[];
  /** Attachment names that no ACP content block can represent. */
  unsupported: string[];
}

/** Whether the agent announced support for image content blocks. Omitted means unsupported. */
export function harnessSupportsImages(agentCapabilities: Record<string, unknown> | null | undefined): boolean {
  const prompt = agentCapabilities?.promptCapabilities;
  return !!prompt && typeof prompt === 'object' && (prompt as { image?: unknown }).image === true;
}

/** Read the composer's attachments once, before the turn starts, so a failure leaves the draft intact. */
export async function harnessPromptContent(text: string, attachments: AttachmentMeta[]): Promise<HarnessPromptContent> {
  const textParts: string[] = [];
  if (text.trim()) textParts.push(text.trim());
  const images: HarnessPromptImage[] = [];
  const unsupported: string[] = [];
  for (const attachment of attachments) {
    if (attachment.textContent !== undefined) {
      const label = attachment.kind === 'paste' ? t('Pasted text') : t('File {{name}}', { name: attachment.name });
      textParts.push(`【${label}】\n${attachment.textContent}`);
      continue;
    }
    if (attachment.mime.startsWith('image/') && attachment.blobPath) {
      try {
        const dataUrl = await readAttachmentDataUrl(attachment);
        const comma = dataUrl.indexOf(',');
        if (comma < 0 || comma === dataUrl.length - 1) throw new Error('missing image data');
        images.push({ mimeType: attachment.mime, data: dataUrl.slice(comma + 1) });
      } catch {
        unsupported.push(attachment.name);
      }
      continue;
    }
    unsupported.push(attachment.name);
  }
  return { text: textParts.join('\n\n'), images, unsupported };
}
