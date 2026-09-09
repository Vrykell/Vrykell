import { ClipboardPaste, FileText, Image as ImageIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type AttachmentMeta, readAttachmentDataUrl } from '@/features/agent/attachments';
import s from './AttachmentChips.module.css';

export default function AttachmentChips({
  atts,
  previewId,
  onPreview,
  onRemove,
}: {
  atts: AttachmentMeta[];
  previewId: string | null;
  onPreview: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <div className={s.chips}>
      {atts.map((a) => {
        const Icon =
          a.kind === 'image' ? ImageIcon : a.kind === 'paste' ? ClipboardPaste : FileText;
        return (
          <span
            key={a.id}
            className={s.chip}
            style={{
              background: previewId === a.id ? 'var(--button-hover)' : 'var(--bg)',
              maxWidth: 220,
            }}
          >
            <Icon size={11} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
            <span
              title={`${a.name}（点击预览）`}
              onClick={() => onPreview(a.id)}
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {a.name}
            </span>
            {onRemove && (
              <button
                data-subtle
                title="移除附件"
                onClick={() => onRemove(a.id)}
                className={s.removeChip}
              >
                <X size={10} />
              </button>
            )}
          </span>
        );
      })}
      {previewId && <AttachmentPreview att={atts.find((a) => a.id === previewId)!} />}
    </div>
  );
}

function AttachmentPreview({ att }: { att: AttachmentMeta }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const isImage = att.mime.startsWith('image/');
  useEffect(() => {
    let alive = true;
    if (isImage && att.blobPath) {
      readAttachmentDataUrl(att)
        .then((u) => {
          if (alive) setDataUrl(u);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [att, isImage]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        marginBottom: 4,
        zIndex: 20,
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--surface)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        padding: 8,
        maxWidth: 320,
        maxHeight: 240,
        overflow: 'auto',
      }}
    >
      {isImage ? (
        dataUrl ? (
          <img
            src={dataUrl}
            alt={att.name}
            style={{ maxWidth: 300, maxHeight: 220, display: 'block', borderRadius: 4 }}
          />
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>加载中…</span>
        )
      ) : (
        <pre
          style={{
            margin: 0,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {(att.textContent ?? '').slice(0, 2000)}
          {(att.textContent?.length ?? 0) > 2000 ? '\n…（仅预览前 2000 字）' : ''}
        </pre>
      )}
    </div>
  );
}
