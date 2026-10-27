/**
 * AttachmentChips — attachment chip row plus a preview popover.
 *
 * Reused in two places: the PanelChat composer (removable, onRemove provided) and the
 * AiBlock question row (read-only persisted attachments, onRemove omitted). The preview
 * is a popover above the chip: images render from their data URL, text shows the first
 * 2000 characters.
 */

import { useEffect, useState } from 'react';
import { ClipboardPaste, FileText, Image as ImageIcon, X } from '@ui/icons';
import { t } from '@i18n';
import { readAttachmentDataUrl, type AttachmentMeta } from '@features/agent/model/attachments';

export default function AttachmentChips({ atts, previewId, onPreview, onRemove }: {
  atts: AttachmentMeta[];
  previewId: string | null;
  onPreview: (id: string) => void;
  /** Omitted = read-only (AiBlock history messages) */
  onRemove?: (id: string) => void;
}) {
  return (
    <div className="chat-attachments">
      {atts.map((a) => {
        const Icon = a.kind === 'image' ? ImageIcon : a.kind === 'paste' ? ClipboardPaste : FileText;
        return (
          <span key={a.id} className="search-scope-chip chat-attachment-chip" data-preview={previewId === a.id}>
            <Icon size={13} />
            <button type="button" className="chat-attachment-name" data-tip={t('Preview attachment: {{name}}', { name: a.name })}
              onClick={() => onPreview(a.id)}>{a.name}</button>
            {onRemove && (
              <button type="button" data-subtle data-tip={t('Remove attachment')} aria-label={t('Remove attachment')}
                onClick={() => onRemove(a.id)}><X size={12} /></button>
            )}
          </span>
        );
      })}
      {atts.find(a => a.id === previewId) && <AttachmentPreview att={atts.find(a => a.id === previewId)!} />}
    </div>
  );
}

/** Preview popover above the chip row: images from their data URL, text limited to the first 2000 chars */
function AttachmentPreview({ att }: { att: AttachmentMeta }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const isImage = att.mime.startsWith('image/');
  useEffect(() => {
    let alive = true;
    if (isImage && att.blobPath) {
      readAttachmentDataUrl(att)
        .then((u) => { if (alive) setDataUrl(u); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [att, isImage]);

  return (
    <div className="workspace-floating"
      style={{
        position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, zIndex: 20,
        padding: 8, maxWidth: 320, maxHeight: 240, overflow: 'auto',
      }}
    >
      {isImage ? (
        dataUrl ? (
          <img src={dataUrl} alt={att.name} style={{ maxWidth: 300, maxHeight: 220, display: 'block', borderRadius: 4 }} />
        ) : (
          <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>{t('Loading…')}</span>
        )
      ) : (
        <pre style={{
          margin: 0, fontSize: 'calc(11px * var(--ui-font-scale))', fontFamily: 'var(--font-mono)', lineHeight: 1.5,
          color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {(att.textContent ?? '').slice(0, 2000)}
          {(att.textContent?.length ?? 0) > 2000 ? `\n${t('Preview limited to the first 2,000 characters')}` : ''}
        </pre>
      )}
    </div>
  );
}
