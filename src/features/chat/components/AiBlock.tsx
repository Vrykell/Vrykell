import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { Brain, ChevronRight, Ellipsis, Pencil, RefreshCw, Sparkles, Trash2 } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import ContextMenu, { type ContextMenuItem } from '@ui/ContextMenu';
import ErrorBox from '@ui/ErrorBox';
import CopyButton from '@ui/CopyButton';
import ConfirmDialog from '@ui/ConfirmDialog';
import { writeClipboardText } from '@platform/clipboard';
import { formatMessageTime } from '@utils/formatTime';
import { useChatStore } from '../stores/chat';
import { useComposerDrafts } from '../stores/composerDrafts';
import SafeMarkdown from './SafeMarkdown';
import ToolRunCard from './ToolRunCard';
import AttachmentChips from './AttachmentChips';
import TerminalReferences from './TerminalReferences';
import type { ChatExchange } from '../model/exchanges';

/** Shared message content supports conversation flow and terminal block presentation. */
export default function AiBlock({ exchange, conversationId, presentation = 'block', dividerBefore = false, style }: {
  exchange: ChatExchange; conversationId?: string; presentation?: 'block' | 'conversation'; dividerBefore?: boolean; style?: CSSProperties;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [attPreviewId, setAttPreviewId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'edit' | 'delete' | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const draft = useComposerDrafts(state => state.byTab[conversationId ?? exchange.paneId ?? '']);
  const { question, answer } = exchange;
  const plain = presentation === 'conversation';
  const expanded = plain || !collapsed;
  // The store runs one turn at a time, but that turn may belong to a background conversation: only
  // the conversation that owns this exchange decides whether its actions are available.
  const ownerConversation = useChatStore(state => conversationId ?? Object.entries(state.byTab)
    .find(([, messages]) => messages.some(message => message.id === exchange.id))?.[0]);
  const sending = useChatStore(state => ownerConversation !== undefined && state.sendingTab === ownerConversation);
  const executionPane = useChatStore(state => conversationId
    ? state.conversations.find(conversation => conversation.id === conversationId)?.environment?.paneId ?? null
    : exchange.paneId);
  const ownerId = () => ownerConversation;
  const regenerate = () => {
    const id = ownerId();
    if (id && question) void useChatStore.getState().regenerate(id, question.id);
  };
  const editResend = () => {
    const id = ownerId();
    if (!id || !question) return;
    const input = articleRef.current?.closest('.ai-chat-panel')?.querySelector<HTMLTextAreaElement>('[data-chat-composer]');
    useChatStore.getState().editResend(id, question.id);
    requestAnimationFrame(() => input?.focus({ preventScroll: true }));
  };
  const removeExchange = () => {
    const id = ownerId();
    if (!id || !question) return;
    useChatStore.getState().deleteExchange(id, question.id);
  };
  const parts = answer?.parts;
  const actions: ContextMenuItem[] = [
    ...(!sending && question && answer ? [{ label: t('Regenerate'), onClick: regenerate }] : []),
    ...(!sending && question ? [
      { label: t('Edit and resend'), onClick: () => setConfirmation('edit') },
      { label: t('Delete'), danger: true, onClick: () => setConfirmation('delete') },
    ] : []),
    { label: t('Copy'), onClick: () => void writeClipboardText(answer?.content || question?.content || '').catch(() => {}) },
  ];
  const moreButton = <IconButton ref={moreTrigger} compact aria-label={t('More actions')} data-tip={t('More actions')} aria-haspopup="menu" aria-expanded={menu !== null}
    onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4 }); }}>
    <Ellipsis size={14} />
  </IconButton>;
  return <article ref={articleRef} className={plain ? 'ai-block chat-exchange' : 'command-block ai-block'} data-exchange-id={exchange.id} data-divider-before={dividerBefore}
    data-menu-open={menu !== null} style={style}>
    {!plain && <div className="command-block-info ai-block-heading">
      <Sparkles size={14} aria-hidden="true" /><span>{t('AI chat')}</span>
      {(answer?.environment ?? question?.environment) && <span className="ai-block-environment" data-tip={(answer?.environment ?? question?.environment)?.cwd}>
        {(answer?.environment ?? question?.environment)?.label}</span>}
      <span className="command-block-actions ai-block-actions">
        {answer && <IconButton compact aria-expanded={!collapsed} aria-label={t(collapsed ? 'Expand reply' : 'Collapse reply')}
          data-tip={t(collapsed ? 'Expand reply' : 'Collapse reply')} onClick={() => setCollapsed(!collapsed)}>
          <ChevronRight size={14} style={{ transform: collapsed ? undefined : 'rotate(90deg)' }} />
        </IconButton>}
        {moreButton}
      </span>
    </div>}
    {question && <div className={plain ? 'ai-block-question' : 'command-block-command ai-block-question'} data-selectable>{question.content}</div>}
    {plain && question && <div className="chat-question-meta">
      <span>{formatMessageTime(question.createdAt)}</span>
      <CopyButton className="chat-question-copy" testId="chat-question-copy" text={question.content}
        label={t('Copy message')} style={{ width: 20, height: 20 }} />
    </div>}
    {expanded && question?.references?.length ? <TerminalReferences references={question.references} /> : null}
    {expanded && !!question?.attachments?.length && <AttachmentChips atts={question.attachments} previewId={attPreviewId}
      onPreview={id => setAttPreviewId(attPreviewId === id ? null : id)} />}
    {answer && expanded && <div className={plain ? 'ai-block-answer' : 'command-block-output ai-block-answer'} data-selectable>
      {answer.reasoning && <ThinkingBlock text={answer.reasoning} streaming={answer.pending ?? false} />}
      {parts ? parts.map((part, index) => part.kind === 'tool'
        ? <ToolRunCard key={part.tool.toolCallId} run={part.tool} paneId={answer.paneId ?? exchange.paneId} framed={plain} />
        : part.text ? <div key={index} className="md"><SafeMarkdown content={part.text} paneId={executionPane} />
          {answer.pending && index === parts.length - 1 && <PendingCursor />}</div> : null)
        : answer.content ? <div className="md"><SafeMarkdown content={answer.content} paneId={executionPane} />{answer.pending && <PendingCursor />}</div> : null}
      {answer.pending && (!answer.content || parts?.[parts.length - 1]?.kind === 'tool') && <div className="ai-block-working"><PendingCursor />{t('Working')}</div>}
      {answer.error && <ErrorBox compact actions={question && !sending ? <button type="button" onClick={regenerate}>{t('Retry')}</button> : undefined}>
        {answer.errorText || t('The reply could not be completed')}
      </ErrorBox>}
      {answer.stopped && <div className="chat-environment-note">{t('Reply stopped. Terminal commands may still be running.')}</div>}
    </div>}
    {plain && answer && !answer.pending && <div className="chat-answer-actions">
      <CopyButton testId="chat-answer-copy" text={answer.content ?? ''} label={t('Copy')} iconSize={18} style={{ width: 28, height: 28 }} />
      {!sending && question && <IconButton compact aria-label={t('Regenerate')} data-tip={t('Regenerate')} onClick={regenerate}>
        <RefreshCw size={18} />
      </IconButton>}
      {!sending && question && <IconButton compact aria-label={t('Edit and resend')} data-tip={t('Edit and resend')} onClick={() => setConfirmation('edit')}>
        <Pencil size={18} />
      </IconButton>}
      {!sending && question && <IconButton compact tone="danger" aria-label={t('Delete')} data-tip={t('Delete')} onClick={() => setConfirmation('delete')}>
        <Trash2 size={18} />
      </IconButton>}
    </div>}
    {menu && <ContextMenu anchor={menu} items={actions} onClose={() => setMenu(null)} />}
    {createPortal(<ConfirmDialog open={confirmation !== null} title={t(confirmation === 'delete' ? 'Delete' : 'Edit and resend')}
      confirmLabel={t(confirmation === 'delete' ? 'Delete' : 'Edit and resend')} cancelLabel={t('Cancel')} danger={confirmation === 'delete'}
      message={confirmation === 'delete' ? t('Delete this exchange?')
        : `${t('Remove this question and later messages, then restore the question to the composer?')}${draft && (draft.text.trim() || draft.attachments.length || draft.references?.length) ? ` ${t('Your unsent draft and attachments will be replaced.')}` : ''}`}
      onCancel={() => {
        setConfirmation(null); requestAnimationFrame(() => moreTrigger.current?.focus({ preventScroll: true }));
      }} onConfirm={() => {
        setConfirmation(null);
        if (confirmation === 'edit') editResend();
        else removeExchange();
      }} />, document.body)}
  </article>;
}

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const preview = text.split('\n').find(line => line.trim()) ?? '';
  useEffect(() => {
    if (open && streaming && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open, streaming]);
  return <div className="ai-thinking">
    <button type="button" data-subtle aria-expanded={open} onClick={() => setOpen(!open)}>
      <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : undefined }} /><Brain size={12} />
      <span>{t('Thinking process')}</span>{!open && <small>{preview}</small>}
    </button>
    {open && <div ref={bodyRef} className="ai-thinking-body md"><SafeMarkdown content={text} paneId={null} /></div>}
  </div>;
}

function PendingCursor() {
  return <span className="ai-pending-cursor" aria-hidden="true">▍</span>;
}
