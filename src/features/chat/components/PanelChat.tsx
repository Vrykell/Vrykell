/**
 * PanelChat — 全局 AI 对话面板（dock 面板，「会话转录」形态）。
 *
 * 与块流内联块共享同一份数据（chat store）：这里是全窗口视角的转录，
 * 跨 pane 的问答按来源 pane 分段，段首是 mono 标签（shell · cwd）。
 * 底部输入栏与终端 InputEditor 完全同构（prompt 行 + ⚡ 输入行，同度量），
 * 发送目标是当前聚焦 pane。
 */

import { useEffect, useMemo, useRef } from 'react';
import { ArrowUp, Bot, Brain, Globe, Paperclip, ShieldAlert, ShieldCheck, ShieldOff, Square, Zap } from 'lucide-react';
import { useChatStore, useActiveMessages } from '@entities/chat';
import { isSessionTab } from '@entities/session';
import { useAgentSettings, usePermissions, useAiConfigStore, useAttachmentComposer } from '@entities/agent';
import ModelPill from '@features/chat/components/ModelPill';
import AttachmentChips from '@features/chat/components/AttachmentChips';
import { leaves as layoutLeaves, firstLeaf } from '@features/workspace/model/windowLayout';
import { shellTypeLabel } from '@/platform/shells';
import ShellIndicator from '@features/terminal/components/ShellIndicator';
import { CurrentDir } from '@features/terminal/components/InputEditor';
import AiBlock from '@features/chat/components/AiBlock';
import { toExchanges, type ChatExchange } from '@features/chat/model/exchanges';
import ContextRing from '@/components/ContextRing';
import { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';
import { useChatComposer } from '@features/chat/hooks/useChatComposer';

/** 权限模式循环（状态栏 Shield chip）：图标 + 颜色双通道辨识（勾=标准逐工具 / 叹号=严格逐次问 / 斜线=放行直放）
 *  标准=逐工具级别；严格=全部逐次问；放行=全部直放行（危险命令仍逐次问） */
const PERM_MODES = [
  { id: 'standard', label: '标准', icon: ShieldCheck, color: 'var(--text-muted)', title: '标准权限：按设置页逐工具级别判定（点击切换）' },
  { id: 'strict', label: '严格', icon: ShieldAlert, color: 'var(--accent-warm)', title: '严格权限：所有工具操作逐次询问（点击切换）' },
  { id: 'relaxed', label: '放行', icon: ShieldOff, color: 'var(--error-light)', title: '放行模式：全部工具直接放行，危险命令仍会逐次询问（点击切换）' },
] as const;

/** 各 provider 的常用模型（快捷下拉；完整自由度在设置页输入） */
export default function PanelChat() {
  const messages = useActiveMessages();
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sendingTab !== null);

  /** 当前 tab 正在流式（发送键变停止键；其它 tab 的发送中只禁用发送） */
  const {
    activeId,
    activeTab,
    focusedPaneId,
    terminalCwds: cwds,
    sessions,
  } = useActiveWorkspace();
  const abortStream = useChatStore((s) => s.abortStream);
  const sendingHere = useChatStore((s) => s.sendingTab !== null && s.sendingTab === activeId);
  const isSession = !!activeTab && isSessionTab(activeTab);

  const scrollRef = useRef<HTMLDivElement>(null);

  // M6 快捷设置：模型下拉 + 联网/深思/Agent 开关（agentSettings 即时生效，
  // 下一条消息起用；模型名写 Rust config）
  const agentSettings = useAgentSettings();
  const activeModel = useAiConfigStore((s) => s.activeModel);
  const permMode = usePermissions((s) => s.mode);
  const setPermMode = usePermissions((s) => s.setMode);
  // 快捷开关作用于「当前模型」的行为覆盖（绑定模型，不污染全局）
  const eff = agentSettings.resolve(activeModel);

  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);

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
  } = useAttachmentComposer();
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

  /** pane → shell/cwd 分量（prompt 行用）；无 paneId 的旧消息返回 null（归「本窗口」） */
  const paneInfo = (paneId?: string): { shell: string; cwd?: string } | null => {
    if (!paneId || !activeTab || !isSessionTab(activeTab)) return null;
    const spec = layoutLeaves(activeTab.layout).find((t) => t.id === paneId);
    if (!spec) return null;
    const shell = spec.kind === 'ssh'
      ? spec.ssh?.name || spec.ssh?.host || 'SSH'
      : spec.shellType ? shellTypeLabel(spec.shellType) : '本地';
    return { shell, cwd: cwds[paneId] ?? spec.cwd };
  };

  /** pane → 分段标签（shell · cwd），无 paneId 的旧消息归入「本窗口」 */
  const paneLabel = (paneId?: string): string => {
    const info = paneInfo(paneId);
    if (!info) return '本窗口';
    const dir = info.cwd
      ? info.cwd.startsWith('/') && info.cwd.length > 20
        ? '…' + info.cwd.slice(-19)
        : info.cwd.slice(1)
      : '';
    return dir ? `${info.shell} · ${dir}` : info.shell;
  };

  // 发送目标 = 当前聚焦 pane（回退到布局第一个 pane）
  const targetPane = isSession && activeTab && isSessionTab(activeTab)
    ? (focusedPaneId && layoutLeaves(activeTab.layout).some((t) => t.id === focusedPaneId)
        ? focusedPaneId
        : firstLeaf(activeTab.layout).id)
    : undefined;

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
  });

  // 目标 pane 的显示分量（prompt 行镜像终端输入栏：shell 胶囊 · cwd）
  const targetInfo = paneInfo(targetPane);
  const targetConnected = targetPane ? !!sessions[targetPane] : false;
  const targetFocused = !!targetPane && targetPane === focusedPaneId;
  return (
    <div ref={panelRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 顶栏：会话级 AI 配置（模型 · 联网 · 深思 · Agent），低频、影响后续所有消息，从输入卡抽离避免拥挤 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '7px 10px 6px',
        flexShrink: 0, userSelect: 'none',
      }}>
        <ModelPill />
        <div style={{ flex: 1 }} />
        <QuickToggle
          icon={Brain}
          on={eff.deepThink}
          title="深度思考（reasoning effort）"
          onClick={() => agentSettings.updateModel(activeModel, { deepThink: !eff.deepThink })}
        />
        <QuickToggle
          icon={Bot}
          on={eff.agentMode}
          title={eff.agentMode ? 'Agent 模式（可使用工具）' : '纯聊天（工具已关闭）'}
          onClick={() => agentSettings.updateModel(activeModel, { agentMode: !eff.agentMode })}
        />
      </div>

      {/* 转录区：按来源 pane 分段 */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 8px' }}>
        {exchanges.length === 0 ? (
          <EmptyHint isSession={isSession} />
        ) : (
          <Transcript exchanges={exchanges} paneLabel={paneLabel} />
        )}
      </div>

      {/* 输入卡片：外边距与命令块一致（0.45em 0），左右 8px 对齐消息区与终端命令块 */}
      {isSession && (
        <div style={{ flexShrink: 0, margin: '0.45em 0', padding: '0 8px' }}>
          <div style={{
            background: 'var(--block)',
            borderRadius: 12,
            padding: '8px 12px 5px',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.22)',
          }}>
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
                minWidth: 16, height: 24, lineHeight: 1,
                color: 'var(--accent-warm)', userSelect: 'none', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Zap size={13} />
              </span>
              <textarea
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
                  fontSize: 13, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)', lineHeight: '22px', outline: 'none',
                }}
              />
              <span style={{ marginRight: 6, display: 'inline-flex', alignItems: 'center' }}>
                <ContextRing />
              </span>
              {/* 发送/停止按钮 — 流式中当前 tab 变 ⏹ */}
              {sendingHere ? (
                <button
                  data-subtle
                  title="停止生成"
                  onClick={() => abortStream(activeId)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
                    background: 'transparent', color: 'var(--accent-warm)', cursor: 'pointer', flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--button-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Square size={11} fill="currentColor" />
                </button>
              ) : (
                <button
                  data-subtle
                  title="发送 (Enter)"
                  onClick={submit}
                  disabled={!canSend}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
                    background: 'transparent',
                    color: canSend ? 'var(--accent-warm)' : 'var(--text-muted)',
                    cursor: canSend ? 'pointer' : 'default', flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { if (canSend) e.currentTarget.style.background = 'var(--button-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <ArrowUp size={13} />
                </button>
              )}
            </div>

            {/* 底部状态栏：目标 pane 上下文 + 权限模式 + 附件（AI 配置已上移到顶栏） */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              minHeight: 22, marginTop: 4, paddingTop: 5,
              fontSize: 11, color: 'var(--text-muted)', userSelect: 'none',
            }}>
              <ShellIndicator connected={targetConnected} focused={targetFocused} label={targetInfo?.shell ?? '本地'} />
              {targetInfo?.cwd && (
                <>
                  <span style={{ color: 'var(--border-strong)', opacity: 0.5, margin: '0 1px' }}>·</span>
                  <CurrentDir dir={targetInfo.cwd} />
                </>
              )}
              <div style={{ flex: 1 }} />
              {/* 权限模式切换（点击循环 标准→严格→放行）：纯图标 + 三色，与 📎 同尺寸同风格对齐 */}
              {(() => {
                const idx = PERM_MODES.findIndex((m) => m.id === permMode);
                const cur = PERM_MODES[idx] ?? PERM_MODES[0]!;
                const next = PERM_MODES[(idx + 1) % PERM_MODES.length]!;
                const CurIcon = cur.icon;
                return (
                  <button
                    data-subtle
                    title={cur.title}
                    onClick={() => setPermMode(next.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
                      background: 'transparent', color: cur.color, cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--button-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <CurIcon size={13} />
                  </button>
                );
              })()}
              {/* 📎 附件 */}
              <button
                data-subtle
                title="添加附件（图片 / 文件，也可直接粘贴或拖入）"
                onClick={() => void pickFiles()}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
                  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--button-hover)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                <Paperclip size={13} />
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

/** 快捷开关小按钮（prompt 行用，与 📎 同尺寸；开 = 暖色） */
function QuickToggle({ icon: Icon, on, title, onClick }: {
  icon: typeof Globe;
  on: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      data-subtle
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, padding: 0, border: 'none', borderRadius: 4,
        background: 'transparent',
        color: on ? 'var(--accent-warm)' : 'var(--text-muted)', cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--button-hover)';
        e.currentTarget.style.color = on ? 'var(--accent-warm)' : 'var(--text-secondary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = on ? 'var(--accent-warm)' : 'var(--text-muted)';
      }}
    >
      <Icon size={13} />
    </button>
  );
}

/** 转录：连续同 pane 的交换归一段，段首 mono 标签（样式同面板分组标签） */
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
                fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)',
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
    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, userSelect: 'none' }}>
      {isSession ? '描述问题，Enter 发送' : '打开一个终端会话开始对话'}
    </div>
  );
}

