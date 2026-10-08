import { t } from '@i18n';
import { TextArea } from '@ui/TextInput';
import KeyHint from '@ui/KeyHint';
import { IconButton } from '@ui/IconButton';
import { PermissionModeButton } from '@features/agent';
/**
 * PanelChat — 全局 AI 对话面板（dock 面板，「会话转录」形态）。
 *
 * 与块流内联块共享同一份数据（chat store）：这里是全窗口视角的转录，
 * 跨 pane 的问答按来源 pane 分段，段首是 mono 标签（shell · cwd）。
 * 底部输入栏与终端 InputEditor 完全同构（prompt 行 + ⚡ 输入行，同度量），
 * 发送目标是当前聚焦 pane。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { iconSizes, ArrowUp, Paperclip, Sparkles, Square, Zap  } from '@ui/icons';
import { useChatStore, useActiveMessages } from '@features/chat';
import { usePermissions, useAttachmentComposer } from '@features/agent';
import ChatModeSelect from '@features/chat/components/ChatModeSelect';
import ModelPill from '@features/chat/components/ModelPill';
import AttachmentChips from '@features/chat/components/AttachmentChips';
import ShellIndicator from '@features/terminal/components/ShellIndicator';
import { CurrentDir } from '@features/terminal/components/InputEditor';
import AiBlock from '@features/chat/components/AiBlock';
import { toExchanges, type ChatExchange } from '@features/chat/model/exchanges';
import ContextRing from '@features/chat/components/ContextRing';
import { useChatComposer } from '@features/chat/hooks/useChatComposer';
import { useChatPaneContext } from '@features/chat/hooks/useChatPaneContext';
import { TERMINAL_FONT_FAMILY } from '@features/terminal/model/terminalFont';
import { EMPTY_COMPOSER_DRAFT, useComposerDrafts } from '@features/chat';
import type { AttachmentMeta } from '@features/agent/model/attachments';


/** 各 provider 的常用模型（快捷下拉；完整自由度在设置页输入） */
export default function PanelChat() {
  const messages = useActiveMessages();
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sendingTab !== null);

  /** 当前 tab 正在流式（发送键变停止键；其它 tab 的发送中只禁用发送） */
  const {
    activeId,
    isSession,
    targetPane,
    targetInfo,
    targetConnected,
    targetFocused,
    paneLabel,
  } = useChatPaneContext();
  const abortStream = useChatStore((s) => s.abortStream);
  const sendingHere = useChatStore((s) => s.sendingTab !== null && s.sendingTab === activeId);

  const scrollRef = useRef<HTMLDivElement>(null);

  const permMode = usePermissions((s) => s.mode);
  const setPermMode = usePermissions((s) => s.setMode);

  const draft = useChatStore((s) => s.draftTabId === activeId ? s.draft : '');
  const setDraft = useChatStore((s) => s.setDraft);
  const composerDraft = useComposerDrafts((s) => s.byTab[activeId] ?? EMPTY_COMPOSER_DRAFT);
  const setComposerText = useCallback((text: string) => {
    useComposerDrafts.getState().setText(activeId, text);
  }, [activeId]);
  const updateComposerAttachments = useCallback((update: (current: AttachmentMeta[]) => AttachmentMeta[]) => {
    useComposerDrafts.getState().updateAttachments(activeId, update);
  }, [activeId]);

  // ── M5 附件：chips 状态 + 三个来源（📎 选择 / 粘贴 / 拖拽） ──
  const {
    attachments: atts,
    previewId,
    panelRef,
    addPastedText,
    pickFiles,
    addBlobs,
    togglePreview,
    removeAttachment,
    clearAttachments,
  } = useAttachmentComposer({
    attachments: composerDraft.attachments,
    updateAttachments: updateComposerAttachments,
    scopeKey: activeId,
  });
  const exchanges = useMemo(() => toExchanges(messages), [messages]);

  // 新内容（条数变化 / 流式增长 / 工具动作增减或状态迁移）时吸底
  const last = messages[messages.length - 1];
  const lastLen = last?.content.length ?? 0;
  const lastToolSig = (last?.parts ?? [])
    .map((p) => (p.kind === 'tool' ? `${p.tool.toolCallId}:${p.tool.state}` : 't'))
    .join('|');
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastLen, lastToolSig]);

  // ── ↑/↓ 翻历史提问（fish 式：以开始翻前的草稿为前缀过滤，最新在前） ──
  const historyQuestions = useMemo(
    () =>
      exchanges
        .map((ex) => ex.question?.content)
        .filter((c): c is string => !!c && c.trim().length > 0)
        .reverse(),
    [exchanges],
  );
  const {
    text,
    inputRef,
    canSend,
    submit,
    handleChange,
    handleKeyDown,
  } = useChatComposer({
    questions: historyQuestions,
    draft,
    setDraft,
    send,
    sending,
    isSession,
    targetPane,
    attachments: atts,
    clearAttachments,
    value: composerDraft.text,
    onTextChange: setComposerText,
    scopeKey: activeId,
  });

  useEffect(() => {
    if (isSession) inputRef.current?.focus();
  }, [isSession, inputRef]);

  // 目标 pane 的显示分量（prompt 行镜像终端输入栏：shell 胶囊 · cwd）
  return (
    <div ref={panelRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, containerType: 'inline-size' }}>
      {/* Model and conversation mode apply to subsequent messages. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '7px 10px 6px',
        flexShrink: 0, userSelect: 'none',
      }}>
        <ChatModeSelect />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
          <ModelPill showThinking={false} />
        </div>
      </div>

      {/* 转录区：按来源 pane 分段 */}
      <div ref={scrollRef} className="scroll-region" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 8px' }}>
        {exchanges.length === 0 ? (
          <EmptyHint isSession={isSession} />
        ) : (
          <Transcript exchanges={exchanges} paneLabel={paneLabel} />
        )}
      </div>

      {/* Match the terminal composer's visual boundary and spacing. */}
      {isSession && (
        <div style={{
          flexShrink: 0,
          margin: 0,
          padding: '10px 12px 12px',
          background: 'transparent',
        }}>
          <div className="terminal-composer" style={{
            padding: '10px 12px 8px',
          }}>
            <div className="terminal-composer-heading"><span>{t('AI chat')}</span><span className="composer-key-hints"><KeyHint shortcut="Enter" />{t('Send')}</span></div>
            {/* 附件 chips 行（预览/删除；随发送清空） */}
            {atts.length > 0 && (
              <AttachmentChips
                atts={atts}
                previewId={previewId}
                onPreview={togglePreview}
                onRemove={removeAttachment}
              />
            )}

            {/* 输入行：⚡ prompt + textarea + 发送/停止（度量同终端输入栏） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                minWidth: iconSizes.row, height: 24, lineHeight: 1,
                color: 'var(--accent-warm)', userSelect: 'none', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Zap size={iconSizes.control} />
              </span>
              <TextArea
                ref={inputRef}
                value={text}
                placeholder="自然语言描述你想做什么…"
                rows={1}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={(e) => {
                  // 图片/文件粘贴优先；长文本（>500 字）折叠为 chip，不糊进输入框
                  const files = Array.from(e.clipboardData.files);
                  if (files.length > 0) {
                    e.preventDefault();
                    void addBlobs(files);
                    return;
                  }
                  const t = e.clipboardData.getData('text/plain');
                  if (t && addPastedText(t)) e.preventDefault();
                }}
                style={{
                  flex: 1, minWidth: 0, resize: 'none',
                  background: 'transparent', border: 'none', padding: '1px 0',
                  fontSize: 'var(--terminal-font-size)', fontFamily: TERMINAL_FONT_FAMILY,
                  color: 'var(--text-primary)', lineHeight: '22px', outline: 'none',
                }}
              />
              <span style={{ marginRight: 6, display: 'inline-flex', alignItems: 'center' }}>
                <ContextRing />
              </span>
              {/* 发送/停止按钮 — 流式中当前 tab 变 ⏹ */}
              {sendingHere ? (
                <IconButton data-subtle tone="accent" data-tip={t('Stop generating')} aria-label={t('Stop generating')} onClick={() => abortStream(activeId)}>
                  <Square size={iconSizes.compact} fill="currentColor" />
                </IconButton>
              ) : (
                <IconButton data-subtle tone="accent" data-tip={t('Send')} data-tip-shortcut="Enter" aria-label={t('Send')} onClick={submit} disabled={!canSend}>
                  <ArrowUp size={iconSizes.control} />
                </IconButton>
              )}
            </div>

            {/* 底部状态栏：目标 pane 上下文 + 权限模式 + 附件（AI 配置已上移到顶栏） */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              minHeight: 22, marginTop: 4, paddingTop: 5,
              fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', userSelect: 'none',
            }}>
              <ShellIndicator connected={targetConnected} focused={targetFocused} label={targetInfo?.shell ?? '本地'} />
              {targetInfo?.cwd && (
                <>
                  <span style={{ color: 'var(--border-strong)', opacity: 0.5, margin: '0 1px' }}>·</span>
                  <CurrentDir dir={targetInfo.cwd} />
                </>
              )}
              <div style={{ flex: 1 }} />
              <PermissionModeButton mode={permMode} onChange={setPermMode} />
              {/* 📎 附件 */}
              <IconButton data-subtle data-tip={t('Add attachment')} aria-label={t('Add attachment')} onClick={() => void pickFiles()}>
                <Paperclip size={iconSizes.control} />
              </IconButton>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}


function Transcript({ exchanges, paneLabel }: {
  exchanges: ChatExchange[];
  paneLabel: (paneId?: string) => string;
}) {
  let lastPane: string | undefined | null = null;
  return (
    <>
      {exchanges.map((ex) => {
        const showTag = ex.paneId !== lastPane;
        lastPane = ex.paneId;
        return (
          <div key={ex.id}>
            {showTag && (
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)',
                padding: '10px 4px 2px', userSelect: 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {paneLabel(ex.paneId)}
              </div>
            )}
            <AiBlock exchange={ex} />
          </div>
        );
      })}
    </>
  );
}

function EmptyHint({ isSession }: { isSession: boolean }) {
  return (
    <div style={{
      height: '100%', minHeight: 140, padding: 16,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
      textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-label)', userSelect: 'none',
    }}>
      <Sparkles size={24} aria-hidden="true" />
      <span>{isSession ? '描述问题，Enter 发送' : '打开一个终端会话开始对话'}</span>
    </div>
  );
}
