/**
 * AttachmentChips — 附件 chips 行 + 预览浮层（M5）。
 *
 * 两处复用：PanelChat 输入栏（可删除，onRemove 存在）与 AiBlock 问题行
 * （只读展示持久化附件，onRemove 缺省）。预览 = chip 上方浮层：
 * 图片读 dataUrl 显示，文本显示头部 2000 字。
 */

import { useEffect, useState } from 'react';
import { ClipboardPaste, FileText, Image as ImageIcon, X } from 'lucide-react';
import { readAttachmentDataUrl, type AttachmentMeta } from '@features/agent/model/attachments';

export default function AttachmentChips({ atts, previewId, onPreview, onRemove }: {
  atts: AttachmentMeta[];
  previewId: string | null;
  onPreview: (id: string) => void;
  /** 缺省 = 只读（AiBlock 历史消息） */
  onRemove?: (id: string) => void;
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {atts.map((a) => {
        const Icon = a.kind === 'image' ? ImageIcon : a.kind === 'paste' ? ClipboardPaste : FileText;
        return (
          <span
            key={a.id}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontFamily: 'var(--font-mono)',
              padding: '1px 4px 1px 6px',
              border: '1px solid var(--border)', borderRadius: 4,
              background: previewId === a.id ? 'var(--button-hover)' : 'var(--bg)',
              color: 'var(--text-secondary)',
              maxWidth: 220, userSelect: 'none',
            }}
          >
            <Icon size={11} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
            <span
              title={`${a.name}（点击预览）`}
              onClick={() => onPreview(a.id)}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
            >
              {a.name}
            </span>
            {onRemove && (
              <button
                data-subtle
                title="移除附件"
                onClick={() => onRemove(a.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 14, height: 14, padding: 0, border: 'none', borderRadius: 2,
                  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0,
                }}
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

/** 预览浮层（chips 行上方）：图片读 dataUrl 显示，文本显示头部 2000 字 */
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
    <div
      style={{
        position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, zIndex: 20,
        border: '1px solid var(--border)', borderRadius: 6,
        background: 'var(--surface)', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        padding: 8, maxWidth: 320, maxHeight: 240, overflow: 'auto',
      }}
    >
      {isImage ? (
        dataUrl ? (
          <img src={dataUrl} alt={att.name} style={{ maxWidth: 300, maxHeight: 220, display: 'block', borderRadius: 4 }} />
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>加载中…</span>
        )
      ) : (
        <pre style={{
          margin: 0, fontSize: 11, fontFamily: 'var(--font-mono)', lineHeight: 1.5,
          color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {(att.textContent ?? '').slice(0, 2000)}
          {(att.textContent?.length ?? 0) > 2000 ? '\n…（仅预览前 2000 字）' : ''}
        </pre>
      )}
    </div>
  );
}
