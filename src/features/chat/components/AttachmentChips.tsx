/**
 * AttachmentChips — attachment chip row plus a preview popover.
 *
 * Reused in two places: the PanelChat composer (removable, onRemove provided) and the
 * AiBlock question row (read-only persisted attachments, onRemove omitted). The preview
 * is a viewport-bounded popover: images render from their data URL, text shows the first
 * 2000 characters.
 */

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanelPosition } from '@ui/hooks/useFloatingPanelPosition';
import { ClipboardPaste, FileText, Image as ImageIcon, X } from '@ui/icons';
import { t } from '@i18n';
import { readAttachmentDataUrl, type AttachmentMeta } from '@features/agent/model/attachments';

export default function AttachmentChips({ atts, previewId, onPreview, onRemove }: {
  atts: AttachmentMeta[];
  previewId: string | null;
  onPreview: (id: string | null) => void;
  /** Omitted = read-only (AiBlock history messages) */
  onRemove?: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previewElementId = useId();
  useEffect(() => {
    if (!previewId) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target) && !preview.current?.contains(event.target)) onPreview(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); onPreview(null);
      root.current?.querySelector<HTMLButtonElement>('[data-preview="true"] .chat-attachment-name')?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [previewId, onPreview]);
  return (
    <div className="chat-attachments" ref={root}>
      {atts.map((a) => {
        const Icon = a.kind === 'image' ? ImageIcon : a.kind === 'paste' ? ClipboardPaste : FileText;
        return (
          <span key={a.id} className="search-scope-chip chat-attachment-chip" data-preview={previewId === a.id}>
            <Icon size={13} />
            <button type="button" className="chat-attachment-name" data-tip={t('Preview attachment: {{name}}', { name: a.name })}
              aria-expanded={previewId === a.id} aria-controls={previewId === a.id ? previewElementId : undefined}
              onClick={event => { trigger.current = event.currentTarget; onPreview(a.id); }}>{a.name}</button>
            {onRemove && (
              <button type="button" data-subtle data-tip={t('Remove attachment')} aria-label={t('Remove attachment')}
                onClick={() => onRemove(a.id)}><X size={12} /></button>
            )}
          </span>
        );
      })}
      {atts.find(a => a.id === previewId) && <AttachmentPreview panelRef={preview} trigger={trigger.current} id={previewElementId} att={atts.find(a => a.id === previewId)!} />}
    </div>
  );
}

/** Place the preview beside its chip without clipping it inside a transcript scroller. */
function AttachmentPreview({ att, id, trigger, panelRef }: { att: AttachmentMeta; id: string; trigger: HTMLButtonElement | null; panelRef: RefObject<HTMLDivElement | null> }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const isImage = att.mime.startsWith('image/');
  const bounds = trigger?.getBoundingClientRect();
  const above = bounds && window.innerHeight - bounds.bottom < 248 && bounds.top > window.innerHeight - bounds.bottom;
  const position = useFloatingPanelPosition(panelRef, { x: bounds?.left ?? 8, y: (bounds?.bottom ?? 8) + 4, aboveY: above ? bounds.top : undefined });
  useEffect(() => {
    let alive = true;
    if (isImage && att.blobPath) {
      readAttachmentDataUrl(att)
        .then((u) => { if (alive) setDataUrl(u); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [att, isImage]);

  return createPortal(
    <div ref={panelRef} id={id} role="dialog" aria-label={t('Preview attachment: {{name}}', { name: att.name })} className="workspace-floating"
      style={{
        ...position, position: 'fixed', zIndex: 9999,
        padding: 8, boxSizing: 'border-box', maxWidth: 'min(320px, calc(100vw - 16px))', maxHeight: Math.min(position.maxHeight ?? 240, 240), overflow: 'auto',
      }}
    >
      {isImage ? (
        dataUrl ? (
          <img src={dataUrl} alt={att.name} style={{ maxWidth: '100%', maxHeight: 220, display: 'block', borderRadius: 4 }} />
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
    </div>, document.body
  );
}
