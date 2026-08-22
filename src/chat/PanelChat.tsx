/**
 * PanelChat — 全局 AI 对话面板（dock 面板，「会话转录」形态）。
 *
 * 与块流内联块共享同一份数据（chat store）：这里是全窗口视角的转录，
 * 跨 pane 的问答按来源 pane 分段，段首是 mono 标签（shell · cwd）。
 * 底部输入栏与终端 InputEditor 完全同构（prompt 行 + ⚡ 输入行，同度量），
 * 发送目标是当前聚焦 pane。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bot, Brain, Globe, Paperclip, Square, Zap } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useChatStore, useActiveMessages } from '../stores/chat';
import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import { useTerminalStore } from '../stores/terminal';
import { useToastStore } from '../components/Toast';
import { useAgentSettings } from '../agent/agentSettings';
import { setAiModel, useAiConfigStore } from '../lib/ai';
import ContextMenu from '../components/ContextMenu';
import {
  LIMITS,
  importFileAsAttachment,
  makePasteAttachment,
  saveBlobAsAttachment,
  totalSize,
  type AttachmentMeta,
} from '../agent/attachments';
import AttachmentChips from './AttachmentChips';
import { leaves as layoutLeaves, firstLeaf } from '../lib/windowLayout';
import { shellTypeLabel } from '../lib/shells';
import ShellIndicator from '../terminal/ShellIndicator';
import { CurrentDir } from '../terminal/InputEditor';
import AiBlock from './AiBlock';
import { toExchanges, type ChatExchange } from './exchanges';

/** 各 provider 的常用模型（快捷下拉；完整自由度在设置页输入） */
const MODEL_PRESETS: Record<string, string[]> = {
  'openai-compatible': [
    'gpt-4o-mini', 'gpt-4o', 'deepseek-chat', 'deepseek-reasoner',
    'qwen-plus', 'glm-4-plus', 'moonshot-v1-8k',
  ],
  anthropic: ['claude-sonnet-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
};

export default function PanelChat() {
  const messages = useActiveMessages();
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sendingTab !== null);

  const activeTab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const activeId = useWorkspaceStore((s) => s.activeId);
  const abortStream = useChatStore((s) => s.abortStream);
  /** 当前 tab 正在流式（发送键变停止键；其它 tab 的发送中只禁用发送） */
  const sendingHere = useChatStore((s) => s.sendingTab !== null && s.sendingTab === activeId);
  const cwds = useWorkspaceStore((s) => s.terminalCwds);
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const isSession = !!activeTab && isSessionTab(activeTab);

  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // M6 快捷设置：模型下拉 + 联网/深思/Agent 开关（agentSettings 即时生效，
  // 下一条消息起用；模型名写 Rust config）
  const agentSettings = useAgentSettings();
  const aiCfg = useAiConfigStore();
  const [modelMenu, setModelMenu] = useState<{ x: number; y: number } | null>(null);
  const searchAvailable = aiCfg.provider !== 'openai-compatible' || aiCfg.hasTavilyKey;
  const toggleSearch = () => {
    if (!agentSettings.webSearch && !searchAvailable) {
      toastErr('当前服务商无原生搜索，请先在「设置 → 网络搜索」配置 Tavily Key');
      return;
    }
    agentSettings.update({ webSearch: !agentSettings.webSearch });
  };

  // 编辑重发：chat store 的 draft 是单次投递——灌入输入框后立即清掉
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  useEffect(() => {
    if (!draft) return;
    setText(draft);
    setDraft('');
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [draft, setDraft]);

  // ── M5 附件：chips 状态 + 三个来源（📎 选择 / 粘贴 / 拖拽） ──
  const [atts, setAtts] = useState<AttachmentMeta[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toastErr = (m: string) => useToastStore.getState().addToast(m, 'error');

  const addAtts = (list: AttachmentMeta[]) => {
    if (list.length === 0) return;
    setAtts((cur) => {
      const next = [...cur, ...list];
      if (totalSize(next) > LIMITS.totalBytes) {
        toastErr('附件合计超过 10MB 上限');
        return cur;
      }
      return next;
    });
  };

  /** 📎 选择文件（plugin-dialog 多选 → Rust 导入） */
  const pickFiles = async () => {
    try {
      const sel = await openDialog({ multiple: true });
      if (!sel) return;
      const out: AttachmentMeta[] = [];
      for (const p of Array.isArray(sel) ? sel : [sel]) {
        try {
          const m = await importFileAsAttachment(p);
          if (m.kind === 'image' && m.size > LIMITS.imageBytes) {
            toastErr(`图片 ${m.name} 超过 5MB 上限`);
            continue;
          }
          out.push(m);
        } catch (e) {
          toastErr(String((e as Error)?.message ?? e));
        }
      }
      addAtts(out);
    } catch (e) {
      toastErr(String((e as Error)?.message ?? e));
    }
  };

  /** 粘贴/拖入的二进制（File）→ base64 → Rust 落盘 */
  const addBlobs = async (files: File[]) => {
    const out: AttachmentMeta[] = [];
    for (const f of files) {
      if (f.type.startsWith('image/') && f.size > LIMITS.imageBytes) {
        toastErr(`图片 ${f.name || '粘贴的图片'} 超过 5MB 上限`);
        continue;
      }
      try {
        const b64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
          r.onerror = () => reject(r.error);
          r.readAsDataURL(f);
        });
        const name = f.name || `pasted-${Date.now()}.png`;
        out.push(await saveBlobAsAttachment(name, f.type || 'application/octet-stream', b64));
      } catch (e) {
        toastErr(String((e as Error)?.message ?? e));
      }
    }
    addAtts(out);
  };

  // 拖拽：Tauri 默认拦截 OS 拖放，走窗口事件；按坐标限定在面板内才接
  // （纯浏览器环境——harness 页——无 Tauri internals，直接跳过）
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onDragDropEvent((e) => {
        if (e.payload.type !== 'drop') return;
        const el = panelRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const { x, y } = e.payload.position;
        if (x / scale < r.left || x / scale > r.right || y / scale < r.top || y / scale > r.bottom) return;
        void (async () => {
          const out: AttachmentMeta[] = [];
          for (const p of (e.payload as { paths: string[] }).paths) {
            try {
              out.push(await importFileAsAttachment(p));
            } catch (err) {
              toastErr(String((err as Error)?.message ?? err));
            }
          }
          addAtts(out);
        })();
      })
      .then((u) => { unlisten = u; })
      .catch(() => {});
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const submit = () => {
    const q = text.trim();
    if ((!q && atts.length === 0) || sending || !isSession) return;
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    const payload = atts.length > 0 ? atts : undefined;
    setAtts([]);
    setPreviewId(null);
    send(q, { paneId: targetPane, attachments: payload });
  };

  // 目标 pane 的显示分量（prompt 行镜像终端输入栏：shell 胶囊 · cwd）
  const targetInfo = paneInfo(targetPane);
  const targetConnected = targetPane ? !!sessions[targetPane] : false;
  const targetFocused = !!targetPane && targetPane === focusedPaneId;
  const canSend = (!!text.trim() || atts.length > 0) && !sending && isSession;

  return (
    <div ref={panelRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 转录区：按来源 pane 分段（无独立顶栏，面板身份由 dock 按钮承担） */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 8px' }}>
        {exchanges.length === 0 ? (
          <EmptyHint isSession={isSession} />
        ) : (
          <Transcript exchanges={exchanges} paneLabel={paneLabel} />
        )}
      </div>

      {/* 输入栏：与终端 InputEditor 同结构同度量（prompt 行 + ⚡ 输入行） */}
      {isSession && (
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '6px 16px 8px',
        }}>
          {/* prompt_elements 行：目标 pane 上下文（镜像终端输入栏：shell 胶囊 · cwd | AI 标记） */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            minHeight: 22, fontSize: 11, color: 'var(--text-muted)', userSelect: 'none',
          }}>
            <ShellIndicator connected={targetConnected} focused={targetFocused} label={targetInfo?.shell ?? '本地'} />
            {targetInfo?.cwd && (
              <>
                <span style={{ color: 'var(--border-strong)', opacity: 0.5, margin: '0 1px' }}>·</span>
                <CurrentDir dir={targetInfo.cwd} />
              </>
            )}
            <div style={{ flex: 1 }} />
            {/* M6 快捷设置：模型下拉 + 联网/深思/Agent */}
            <button
              data-subtle
              title="切换模型（更多在设置页配置）"
              onClick={(e) => setModelMenu({ x: e.clientX, y: e.clientY })}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4,
                background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
                lineHeight: '16px', maxWidth: 110,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {aiCfg.model || '模型'}
            </button>
            <QuickToggle
              icon={Globe}
              on={agentSettings.webSearch}
              title={searchAvailable ? '联网搜索' : '联网搜索（需先配置 Tavily Key）'}
              onClick={toggleSearch}
            />
            <QuickToggle
              icon={Brain}
              on={agentSettings.deepThink}
              title="深度思考（reasoning effort）"
              onClick={() => agentSettings.update({ deepThink: !agentSettings.deepThink })}
            />
            <QuickToggle
              icon={Bot}
              on={agentSettings.agentMode}
              title={agentSettings.agentMode ? 'Agent 模式（可使用工具）' : '纯聊天（工具已关闭）'}
              onClick={() => agentSettings.update({ agentMode: !agentSettings.agentMode })}
            />
            {/* 📎 附件（位置对应终端输入栏的操作按钮） */}
            <button
              data-subtle
              title="添加附件（图片 / 文件，也可直接粘贴或拖入）"
              onClick={() => void pickFiles()}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, padding: 0, border: 'none', borderRadius: 3,
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
              <Paperclip size={12} />
            </button>
            {/* 静态 AI 标记 — 位置对应终端输入栏的 cmd/AI 模式 pill */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 500,
              padding: '1px 8px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--accent-warm-dim)',
              color: 'var(--accent-warm)',
              lineHeight: '16px',
            }}>
              AI
            </span>
          </div>

          {/* 附件 chips 行（预览/删除；随发送清空） */}
          {atts.length > 0 && (
            <AttachmentChips
              atts={atts}
              previewId={previewId}
              onPreview={(id) => setPreviewId((cur) => (cur === id ? null : id))}
              onRemove={(id) => {
                setAtts((cur) => cur.filter((a) => a.id !== id));
                setPreviewId((cur) => (cur === id ? null : cur));
              }}
            />
          )}

          {/* 输入行：⚡ prompt + textarea + 发送按钮（度量同 InputEditor） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <span style={{
              minWidth: 16, textAlign: 'center', lineHeight: '24px',
              color: 'var(--accent-warm)', userSelect: 'none', flexShrink: 0,
              display: 'inline-flex', justifyContent: 'center',
            }}>
              <Zap size={13} />
            </span>
            <textarea
              ref={inputRef}
              value={text}
              placeholder="自然语言描述你想做什么…"
              rows={1}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape') setText('');
              }}
              onPaste={(e) => {
                // 图片/文件粘贴优先；长文本（>500 字）折叠为 chip，不糊进输入框
                const files = Array.from(e.clipboardData.files);
                if (files.length > 0) {
                  e.preventDefault();
                  void addBlobs(files);
                  return;
                }
                const t = e.clipboardData.getData('text/plain');
                if (t && t.length > LIMITS.pasteFoldChars) {
                  e.preventDefault();
                  addAtts([makePasteAttachment(t)]);
                }
              }}
              style={{
                flex: 1, minWidth: 0, resize: 'none',
                background: 'transparent', border: 'none', padding: '1px 0',
                fontSize: 13, fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)', lineHeight: '22px', outline: 'none',
              }}
            />
            {/* 发送/停止按钮 — 流式中当前 tab 变 ⏹（位置/尺寸对应终端输入栏操作按钮） */}
            {sendingHere ? (
              <button
                data-subtle
                title="停止生成"
                onClick={() => abortStream(activeId)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  padding: 0,
                  border: 'none',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'var(--accent-warm)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--button-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
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
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                padding: 0,
                border: 'none',
                borderRadius: 4,
                background: 'transparent',
                color: canSend ? 'var(--accent-warm)' : 'var(--text-muted)',
                cursor: canSend ? 'pointer' : 'default',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!canSend) return;
                e.currentTarget.style.background = 'var(--button-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <ArrowUp size={13} />
            </button>
            )}
          </div>
        </div>
      )}

      {/* 模型快捷下拉（ContextMenu 复用，选中即写 Rust config） */}
      {modelMenu && (
        <ContextMenu
          anchor={modelMenu}
          items={(MODEL_PRESETS[aiCfg.provider] ?? []).map((m) => ({
            label: m === aiCfg.model ? `✓ ${m}` : m,
            onClick: () => void setAiModel(m),
          }))}
          onClose={() => setModelMenu(null)}
        />
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
        width: 20, height: 20, padding: 0, border: 'none', borderRadius: 3,
        background: on ? 'var(--accent-warm-dim)' : 'transparent',
        color: on ? 'var(--accent-warm)' : 'var(--text-muted)', cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--button-hover)';
        e.currentTarget.style.color = on ? 'var(--accent-warm)' : 'var(--text-secondary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = on ? 'var(--accent-warm-dim)' : 'transparent';
        e.currentTarget.style.color = on ? 'var(--accent-warm)' : 'var(--text-muted)';
      }}
    >
      <Icon size={12} />
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

