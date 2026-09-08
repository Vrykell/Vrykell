import { ask } from '@tauri-apps/plugin-dialog';
import { Brain, ChevronRight, Copy, Pencil, RotateCw, Trash2, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import AttachmentChips from '@/features/chat/AttachmentChips';
import type { ChatExchange } from '@/features/chat/exchanges';
import SafeMarkdown from '@/features/chat/SafeMarkdown';
import ToolNode from '@/features/chat/ToolNode';
import ToolRunCard from '@/features/chat/ToolRunCard';
import { cx } from '@/shared/utils/cx';
import { useChatStore } from '@/store/chat';
import { useWorkspaceStore } from '@/store/workspace';
import s from './AiBlock.module.css';

function Rail({ bottom }: { bottom: number }) {
  return <span aria-hidden className={s.rail} style={{ bottom }} />;
}

function EndDot({ top, bottom }: { top?: number; bottom?: number }) {
  const pos = top != null ? { top: top - 3 } : { bottom: (bottom ?? 0) - 3 };
  return <span aria-hidden className={s.endDot} style={pos} />;
}

export default function AiBlock({ exchange }: { exchange: ChatExchange }) {
  const [collapsed, setCollapsed] = useState(false);
  const [attPreviewId, setAttPreviewId] = useState<string | null>(null);
  const { question, answer } = exchange;
  const sending = useChatStore((s) => s.sendingTab !== null);

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});
  const regenerate = () => {
    if (!question) return;
    useChatStore.getState().regenerate(useWorkspaceStore.getState().activeId, question.id);
  };
  const editResend = async () => {
    if (!question) return;
    const ok = await ask('将删除这条问题及之后的所有对话，把问题填回输入框。', {
      title: '编辑重发',
      kind: 'warning',
    });
    if (ok) useChatStore.getState().editResend(useWorkspaceStore.getState().activeId, question.id);
  };
  const removeExchange = async () => {
    if (!question) return;
    const ok = await ask('删除这条问答？', { title: '删除', kind: 'warning' });
    if (ok)
      useChatStore.getState().deleteExchange(useWorkspaceStore.getState().activeId, question.id);
  };

  const parts = answer?.parts;

  return (
    <div className={cx('ai-block', s.container)}>
      {question && (
        <div
          onClick={() => answer && setCollapsed((c) => !c)}
          className={s.questionRow}
          style={{ cursor: answer ? 'pointer' : 'default' }}
        >
          <Zap size={12} className={s.questionIcon} />
          <span data-selectable className={s.questionText}>
            {question.content}
          </span>
          <span className={cx('ai-block-actions', s.questionActions)}>
            {question && !sending && answer && (
              <ActionBtn title="重新生成" onClick={regenerate}>
                <RotateCw size={11} />
              </ActionBtn>
            )}
            {question && !sending && (
              <ActionBtn title="编辑重发" onClick={() => void editResend()}>
                <Pencil size={11} />
              </ActionBtn>
            )}
            {question && !sending && (
              <ActionBtn title="删除" onClick={() => void removeExchange()}>
                <Trash2 size={11} />
              </ActionBtn>
            )}
            <ActionBtn title="复制" onClick={() => copy(answer?.content || question.content)}>
              <Copy size={11} />
            </ActionBtn>
          </span>
        </div>
      )}

      {question?.attachments && question.attachments.length > 0 && !collapsed && (
        <div className={s.attachmentRow}>
          <AttachmentChips
            atts={question.attachments}
            previewId={attPreviewId}
            onPreview={(id) => setAttPreviewId((cur) => (cur === id ? null : id))}
          />
        </div>
      )}

      {answer && !collapsed && (
        <div
          data-selectable
          className={s.answerContainer}
          style={{ paddingBottom: !answer.pending && !answer.error ? 8 : 0 }}
        >
          <Rail bottom={answer.error ? 12 : answer.pending ? 0 : 4} />
          <EndDot top={6} />
          {answer.reasoning && (
            <ThinkingBlock text={answer.reasoning} streaming={answer.pending ?? false} />
          )}
          {parts
            ? parts.map((p, i) => {
                if (p.kind === 'tool') {
                  return (
                    <div key={p.tool.toolCallId} className={s.row}>
                      <ToolRunCard run={p.tool} paneId={exchange.paneId} />
                    </div>
                  );
                }
                if (!p.text) return null;
                const isLast = i === parts.length - 1;
                return (
                  <div key={i} className={s.row}>
                    <div className="md">
                      <SafeMarkdown content={p.text} />
                      {isLast && answer.pending && <PendingCursor />}
                    </div>
                  </div>
                );
              })
            : answer.content && (
                <div className={cx(s.row, 'md')}>
                  <SafeMarkdown content={answer.content} />
                  {answer.pending && <PendingCursor />}
                </div>
              )}
          {parts && answer.pending && parts[parts.length - 1]?.kind === 'tool' && (
            <div className={s.row}>
              <PendingCursor />
            </div>
          )}
          {answer.error && (
            <div className={s.errorRow}>
              <ToolNode state="error" top={12} />
              <span className={s.errorText}>出错了</span>
            </div>
          )}
          {!answer.pending && !answer.error && <EndDot bottom={4} />}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const preview = text.split('\n').find((l) => l.trim()) ?? '';
  useEffect(() => {
    if (open && streaming && bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open, streaming]);
  return (
    <div className={s.row}>
      <button
        data-subtle
        onClick={() => setOpen((o) => !o)}
        title={open ? '收起思考过程' : '展开思考过程'}
        className={s.thinkBtn}
      >
        <ChevronRight size={11} className={cx(s.thinkChevron, open && s.thinkOpen)} />
        <Brain size={11} style={{ flexShrink: 0 }} />
        <span style={{ flexShrink: 0 }}>思考过程</span>
        {!open && preview && <span className={s.thinkPreview}>{preview}</span>}
      </button>
      {open && (
        <div ref={bodyRef} className={s.thinkBody}>
          <div className="md">
            <SafeMarkdown content={text} />
          </div>
        </div>
      )}
    </div>
  );
}

function PendingCursor() {
  return <span className={s.pendingCursor}>▍</span>;
}

function ActionBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-subtle
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={s.actionBtn}
    >
      {children}
    </button>
  );
}
