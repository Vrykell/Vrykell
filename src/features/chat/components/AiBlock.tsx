import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { Brain, ChevronRight, Ellipsis, Pencil, RefreshCw, Sparkles, Trash2, Wrench } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import ContextMenu, { type ContextMenuItem } from '@ui/menus/ContextMenu';
import ErrorBox from '@ui/feedback/ErrorBox';
import CopyButton from '@ui/actions/CopyButton';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { writeClipboardText } from '@platform/clipboard';
import { formatMessageTime } from '@utils/formatTime';
import { partsToHistoryText, type MessagePart, type ToolRun } from '@features/agent/model/messageParts';
import { hasLeakedToolCallMarkup, visibleAssistantText } from '../model/providerMarkup';
import { useChatStore } from '../stores/chat';
import { useComposerDrafts } from '../stores/composerDrafts';
import ThreadActions from './ThreadActions';
import { useShallow } from 'zustand/react/shallow';
import { useHarnessStore } from '../stores/harness';
import { threadKey } from '../services/threadOperations';
import { useChildTasks, type Thread } from '../stores/childTasks';
import { SubagentRow } from './SubagentActivity';
import SafeMarkdown from './SafeMarkdown';
import ToolRunCard from './ToolRunCard';
import AttachmentChips from './AttachmentChips';
import TerminalReferences from './TerminalReferences';
import type { ChatExchange } from '../model/exchanges';

function CompletedTools({ tools, renderCard }: { tools: ToolRun[]; renderCard: (tool: ToolRun) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ai-completed-tools">
      <div className="ai-tool-card">
        <button type="button" data-subtle className="ai-tool-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Wrench size={15} aria-hidden="true" />
          <span className="ai-tool-summary-text">
            <span className="ai-tool-label">{t('{{count}} tools completed', { count: tools.length })}</span>
          </span>
          <ChevronRight size={14} aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
        </button>
      </div>
      {open && tools.map(renderCard)}
    </div>
  );
}

function renderParts(
  parts: MessagePart[],
  groupCompleted: (tool: ToolRun) => boolean,
  toolCard: (tool: ToolRun) => ReactNode,
  textBlock: (text: string, index: number) => ReactNode,
) {
  const rows: ReactNode[] = [];
  let completed: ToolRun[] = [];
  const flush = () => {
    if (completed.length === 1) rows.push(toolCard(completed[0]));
    if (completed.length > 1)
      rows.push(<CompletedTools key={`completed-${completed[0].toolCallId}`} tools={completed} renderCard={toolCard} />);
    completed = [];
  };
  parts.forEach((part, index) => {
    if (part.kind === 'text' && !part.text.trim()) return;
    if (part.kind === 'tool' && part.tool.state === 'done' && groupCompleted(part.tool)) {
      completed.push(part.tool);
      return;
    }
    flush();
    rows.push(part.kind === 'tool' ? toolCard(part.tool) : textBlock(part.text, index));
  });
  flush();
  return rows;
}

/** Shared message content supports conversation flow and terminal block presentation. */
export default function AiBlock({
  exchange,
  conversationId,
  thread,
  toolContextId,
  onAskAboutTool,
  onRetry,
  allowExchangeActions = true,
  presentation = 'block',
  dividerBefore = false,
  suppressPending = false,
  style,
}: {
  exchange: ChatExchange;
  thread?: Thread;
  conversationId?: string;
  toolContextId?: string;
  onAskAboutTool?: (question: string) => void;
  onRetry?: () => void;
  allowExchangeActions?: boolean;
  presentation?: 'block' | 'conversation';
  dividerBefore?: boolean;
  /** Hide the inline working row when the caller renders it after a pending question. */
  suppressPending?: boolean;
  style?: CSSProperties;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [attPreviewId, setAttPreviewId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'edit' | 'delete' | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const draft = useComposerDrafts((state) => state.byTab[conversationId ?? exchange.paneId ?? '']);
  const { question, answer } = exchange;
  const plain = presentation === 'conversation';
  const parentKey = useHarnessStore((state) =>
    plain && thread ? threadKey(thread, thread.driver === 'acp' ? state.byTab[thread.id] : undefined) : undefined,
  );
  const children = useChildTasks(
    useShallow((state) => state.tasks.filter((task) => task.parent === parentKey && task.question === question?.id)),
  );
  const expanded = plain || !collapsed;
  // Only the conversation that owns this exchange decides whether its actions are available.
  const ownerConversation = useChatStore(
    (state) =>
      conversationId ?? Object.entries(state.byTab).find(([, messages]) => messages.some((message) => message.id === exchange.id))?.[0],
  );
  const sending = useChatStore((state) => ownerConversation !== undefined && state.sendingTabs.includes(ownerConversation));
  const executionPane = useChatStore((state) =>
    conversationId
      ? (state.conversations.find((conversation) => conversation.id === conversationId)?.environment?.paneId ?? null)
      : exchange.paneId,
  );
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
  // Structured replies can keep their streamed text only in the ordered parts.
  const lastPart = parts?.[parts.length - 1];
  const streamTail = parts ? (lastPart?.kind === 'text' ? lastPart.text : '') : (answer?.content ?? '');
  const showOutputCursor = Boolean(answer?.pending && visibleAssistantText(streamTail).trim());
  // ACP streams text as ordered parts; the flat content field can stay empty because the parts
  // are the source of truth. Copy the visible text first, then fall back to the tool log for a
  // stopped reply that has not produced any text yet.
  const partsText = parts?.flatMap((part) => (part.kind === 'text' && part.text ? [part.text] : [])).join('\n\n') ?? '';
  const answerCopyText = answer
    ? visibleAssistantText(answer.content).trim() ||
      visibleAssistantText(partsText).trim() ||
      visibleAssistantText(partsToHistoryText(parts)).trim()
    : '';
  const actions: ContextMenuItem[] = [
    ...(allowExchangeActions && !sending && question && answer ? [{ label: t('Regenerate'), onClick: regenerate }] : []),
    ...(allowExchangeActions && !sending && question
      ? [
          { label: t('Edit and resend'), onClick: () => setConfirmation('edit') },
          { label: t('Delete'), danger: true, onClick: () => setConfirmation('delete') },
        ]
      : []),
    { label: t('Copy'), onClick: () => void writeClipboardText(answerCopyText || question?.content || '').catch(() => {}) },
  ];
  const moreButton = (
    <IconButton
      ref={moreTrigger}
      compact
      aria-label={t('More actions')}
      data-tip={t('More actions')}
      aria-haspopup="menu"
      aria-expanded={menu !== null}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.left, y: rect.bottom + 4 });
      }}>
      <Ellipsis size={14} />
    </IconButton>
  );
  return (
    <article
      ref={articleRef}
      className={plain ? 'ai-block chat-exchange' : 'command-block ai-block'}
      data-exchange-id={exchange.id}
      data-divider-before={dividerBefore}
      data-menu-open={menu !== null}
      style={style}>
      {!plain && (
        <div className="command-block-info ai-block-heading">
          <Sparkles size={14} aria-hidden="true" />
          <span>{t('AI chat')}</span>
          {(answer?.environment ?? question?.environment) && (
            <span className="ai-block-environment" data-tip={(answer?.environment ?? question?.environment)?.cwd}>
              {(answer?.environment ?? question?.environment)?.label}
            </span>
          )}
          <span className="command-block-actions ai-block-actions">
            {answer && (
              <IconButton
                compact
                aria-expanded={!collapsed}
                aria-label={t(collapsed ? 'Expand reply' : 'Collapse reply')}
                data-tip={t(collapsed ? 'Expand reply' : 'Collapse reply')}
                onClick={() => setCollapsed(!collapsed)}>
                <ChevronRight size={14} style={{ transform: collapsed ? undefined : 'rotate(90deg)' }} />
              </IconButton>
            )}
            {moreButton}
          </span>
        </div>
      )}
      {!!question?.content.trim() && (
        <div className={plain ? 'ai-block-question' : 'command-block-command ai-block-question'} data-selectable>
          {question.content}
        </div>
      )}
      {expanded && !!question?.attachments?.length && (
        <div className="chat-question-attachments">
          <AttachmentChips
            atts={question.attachments}
            previewId={attPreviewId}
            onPreview={(id) => setAttPreviewId(attPreviewId === id ? null : id)}
          />
        </div>
      )}
      {plain && !!question?.content.trim() && (
        <div className="chat-question-meta">
          <span>{formatMessageTime(question.createdAt)}</span>
          <CopyButton
            className="chat-question-copy"
            testId="chat-question-copy"
            text={question.content}
            label={t('Copy message')}
            style={{ width: 20, height: 20 }}
          />
        </div>
      )}
      {expanded && question?.references?.length ? <TerminalReferences references={question.references} framed={plain} /> : null}
      {answer && expanded && (
        <div className={plain ? 'ai-block-answer' : 'command-block-output ai-block-answer'} data-selectable>
          {answer.reasoning && <ThinkingBlock text={answer.reasoning} streaming={answer.pending ?? false} />}
          {parts ? (
            renderParts(
              parts,
              (tool) => plain && !children.some((child) => child.toolCallId === tool.toolCallId),
              (tool) => {
                const child = children.find((item) => item.toolCallId === tool.toolCallId);
                if (child && thread) return <SubagentRow key={child.id} task={child} parent={thread} />;
                return (
                  <ToolRunCard
                    key={tool.toolCallId}
                    run={tool}
                    paneId={answer.paneId ?? exchange.paneId}
                    framed={plain}
                    conversationId={toolContextId ?? ownerConversation}
                    onAskAboutTool={onAskAboutTool}
                    environment={answer.environment ?? question?.environment ?? undefined}
                  />
                );
              },
              (text, index) => (
                <div key={index} className="md">
                  <SafeMarkdown content={visibleAssistantText(text)} paneId={executionPane} />
                  {showOutputCursor && index === parts.length - 1 && <PendingCursor />}
                </div>
              ),
            )
          ) : answer.content ? (
            <div className="md">
              <SafeMarkdown content={visibleAssistantText(answer.content)} paneId={executionPane} />
              {showOutputCursor && <PendingCursor />}
            </div>
          ) : null}
          {answer.pending && !showOutputCursor && !suppressPending && <WorkingIndicator />}
          {answer.error && (
            <ErrorBox
              placement="inline"
              dismissible={false}
              title={t('The reply could not be completed')}
              details={answer.errorText}
              actions={
                question && !sending && (allowExchangeActions || onRetry) ? (
                  <button type="button" onClick={onRetry ?? regenerate}>
                    {t('Retry')}
                  </button>
                ) : undefined
              }>
              {answer.errorSummary}
            </ErrorBox>
          )}
          {answer.content && hasLeakedToolCallMarkup(answer.content) && (
            <div className="chat-environment-note" data-testid="chat-leaked-tool-call">
              {t(
                'The provider returned a tool call as plain text, so no tool ran. Use an endpoint or model that reports tool calls in the standard format.',
              )}
            </div>
          )}
          {answer.stopped && <div className="chat-environment-note">{t('Reply stopped. Terminal commands may still be running.')}</div>}
        </div>
      )}
      {thread &&
        children
          .filter((child) => !parts?.some((part) => part.kind === 'tool' && part.tool.toolCallId === child.toolCallId))
          .map((child) => <SubagentRow key={child.id} task={child} parent={thread} />)}
      {plain && answer && !answer.pending && (
        <div className="chat-answer-actions">
          {thread && question && <ThreadActions thread={thread} question={question.id} answer={answer.id} />}
          <CopyButton testId="chat-answer-copy" text={answerCopyText} label={t('Copy')} iconSize={16} style={{ width: 24, height: 24 }} />
          {allowExchangeActions && !sending && question && (
            <IconButton
              compact
              style={{ width: 24, height: 24 }}
              aria-label={t('Regenerate')}
              data-tip={t('Regenerate')}
              onClick={regenerate}>
              <RefreshCw size={16} />
            </IconButton>
          )}
          {allowExchangeActions && !sending && question && (
            <IconButton
              compact
              style={{ width: 24, height: 24 }}
              aria-label={t('Edit and resend')}
              data-tip={t('Edit and resend')}
              onClick={() => setConfirmation('edit')}>
              <Pencil size={16} />
            </IconButton>
          )}
          {allowExchangeActions && !sending && question && (
            <IconButton
              compact
              style={{ width: 24, height: 24 }}
              tone="danger"
              aria-label={t('Delete')}
              data-tip={t('Delete')}
              onClick={() => setConfirmation('delete')}>
              <Trash2 size={16} />
            </IconButton>
          )}
        </div>
      )}
      {menu && <ContextMenu anchor={menu} items={actions} onClose={() => setMenu(null)} />}
      {createPortal(
        <ConfirmDialog
          open={confirmation !== null}
          title={t(confirmation === 'delete' ? 'Delete' : 'Edit and resend')}
          confirmLabel={t(confirmation === 'delete' ? 'Delete' : 'Edit and resend')}
          cancelLabel={t('Cancel')}
          danger={confirmation === 'delete'}
          message={
            confirmation === 'delete'
              ? t('Delete this exchange?')
              : `${t('Remove this question and later messages, then restore the question to the composer?')}${draft && (draft.text.trim() || draft.attachments.length || draft.references?.length) ? ` ${t('Your unsent draft and attachments will be replaced.')}` : ''}`
          }
          onCancel={() => {
            setConfirmation(null);
            requestAnimationFrame(() => moreTrigger.current?.focus({ preventScroll: true }));
          }}
          onConfirm={() => {
            setConfirmation(null);
            if (confirmation === 'edit') editResend();
            else removeExchange();
          }}
        />,
        document.body,
      )}
    </article>
  );
}

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && streaming && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open, streaming]);
  return (
    <div className="ai-thinking ai-tool-card" data-open={open}>
      <button type="button" data-subtle className="ai-tool-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Brain size={15} aria-hidden="true" />
        <span className="ai-tool-description">{t('Thinking process')}</span>
        <ChevronRight size={14} aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
      </button>
      {open && (
        <div ref={bodyRef} className="ai-thinking-body md">
          <SafeMarkdown content={text} paneId={null} />
        </div>
      )}
    </div>
  );
}

/** The shared working row, also rendered after a question that blocks the turn. */
export function WorkingIndicator() {
  return (
    <div className="ai-block-working" role="status">
      <PendingCursor />
      {t('Working')}
    </div>
  );
}

function PendingCursor() {
  return (
    <span className="ai-pending-cursor" aria-hidden="true">
      ▍
    </span>
  );
}
