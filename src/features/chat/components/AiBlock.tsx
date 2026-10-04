/**
 * AiBlock — 一次 AI 问答交换的渲染（「时间轴 rail」视觉语言）。
 *
 * AI 不是应用里的聊天机器人，而是会话历史里的一种特殊条目：
 *   问题 = 你敲的一行（⚡ prompt + 等宽字体，与命令同级）
 *   回答 = 时间轴：1px 中性细线（rail）常驻——即使没有工具动作、
 *          仅仅回答了问题也有。细线两端是 6px 灰色小节点（起点/终点），
 *          中间穿插 8px 动作节点（执行命令/读取/修改/搜索…）+ 摘要卡片；
 *          出错时末端换成红色错误节点。run_command 节点下可展开命令输出。
 * 节点语义：绿实心=成功 / 红实心=失败 / 暖色描边环脉冲=执行中 /
 *          静态暖色环=等待批准 / 灰环=已拒绝。纯文本不设节点。
 *
 * 行结构：回答容器 position:relative，Rail/EndDot 绝对定位贯穿全容器；
 * 每个 part 包一层行容器（position:relative; paddingLeft:16），ToolNode
 * （ToolRunCard 内）以行容器为包含块压在 rail 上。行容器 flow-root 建立
 * 独立块格式化上下文，阻止子元素 margin 穿透行边界。
 *
 * 同组件服务两个视图：TerminalBlockList（块流内联）与 PanelChat（窗口转录）。
 */

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronRight, Copy, Pencil, RotateCw, Trash2, Zap } from 'lucide-react';
import { ask } from '@tauri-apps/plugin-dialog';
import { useChatStore } from '@features/chat';
import { useSessionStore } from '@features/workspace';
import SafeMarkdown from '@features/chat/components/SafeMarkdown';
import ToolNode from '@features/chat/components/ToolNode';
import ToolRunCard from '@features/chat/components/ToolRunCard';
import AttachmentChips from '@features/chat/components/AttachmentChips';
import type { ChatExchange } from '@features/chat/model/exchanges';
import { TERMINAL_FONT_FAMILY } from '@features/terminal/model/terminalFont';

/** rail 细线：1px，绝对定位贯穿整个回答容器（top 起于首端灰点圆心，
 *  bottom 收于末端节点圆心：完成=灰点 / 出错=红节点 / 流式=延伸至底）。
 *  无论是否有工具动作，只要回答存在细线就存在。 */
function Rail({ bottom }: { bottom: number }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        width: 1,
        transform: 'translateX(-50%)',
        top: 6,
        bottom,
        background: 'var(--border-strong)',
      }}
    />
  );
}

/** rail 端点小灰点（6px，区别于 8px 动作节点）。
 *  top/bottom 均表示「圆心」距顶/距底的距离（与 Rail 的 top/bottom 同语义），
 *  故用 top-3 / bottom-3 定位盒边、只做水平 translateX 居中，圆心精确落在线端点。 */
function EndDot({ top, bottom }: { top?: number; bottom?: number }) {
  const pos = top != null ? { top: top - 3 } : { bottom: (bottom ?? 0) - 3 };
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        ...pos,
        width: 6,
        height: 6,
        borderRadius: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--text-muted)',
      }}
    />
  );
}

/** 行容器：相对定位承载 RailSeg/ToolNode；flow-root 建立独立块格式化上下文，
 *  阻止子元素 margin 穿透行边界 —— 否则 .md 段落（0.4em）与内嵌命令块
 *  （2px/6px）的垂直 margin 会塌陷到行外，而细线只画在行高之内，
 *  每个穿透点都会把线截断一截（「短短续续」的根因）。 */
const ROW: React.CSSProperties = {
  position: 'relative',
  paddingLeft: 16,
  display: 'flow-root',
};

export default function AiBlock({ exchange }: { exchange: ChatExchange }) {
  const [collapsed, setCollapsed] = useState(false);
  const [attPreviewId, setAttPreviewId] = useState<string | null>(null);
  const { question, answer } = exchange;
  // 流式中隐藏改写类动作（store 侧也有 sendingTab 守卫，双保险）
  const sending = useChatStore((s) => s.sendingTab !== null);

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});
  // 重新生成：删旧回答、原地起新流（不再追加一轮新交换）
  const regenerate = () => {
    if (!question) return;
    useChatStore.getState().regenerate(useSessionStore.getState().activeId, question.id);
  };
  // 编辑重发：删该条及之后全部消息，问题灌回输入框
  const editResend = async () => {
    if (!question) return;
    const ok = await ask('将删除这条问题及之后的所有对话，把问题填回输入框。', {
      title: '编辑重发',
      kind: 'warning',
    });
    if (ok) useChatStore.getState().editResend(useSessionStore.getState().activeId, question.id);
  };
  // 删除整个交换（问题 + 回答）
  const removeExchange = async () => {
    if (!question) return;
    const ok = await ask('删除这条问答？', { title: '删除', kind: 'warning' });
    if (ok) useChatStore.getState().deleteExchange(useSessionStore.getState().activeId, question.id);
  };

  // 回答 parts（tool part 渲染为 rail 上的动作节点）
  const parts = answer?.parts;

  return (
    <div className="ai-block" style={{ padding: '4px 0 2px' }}>
      {/* 问题行 — ⚡ prompt + mono，点击折叠/展开回答 */}
      {question && (
        <div
          onClick={() => answer && setCollapsed((c) => !c)}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            padding: '2px 0',
            cursor: answer ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          <Zap size={12} style={{ color: 'var(--accent-warm)', flexShrink: 0, transform: 'translateY(1px)' }} />
          <span
            data-selectable
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: TERMINAL_FONT_FAMILY,
              fontSize: 'var(--terminal-font-size)',
              color: 'var(--text-primary)',
              lineHeight: '20px',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
          >
            {question.content}
          </span>
          {/* hover 动作：重新生成 / 编辑重发 / 删除 / 复制（ai-block:hover 控制显隐） */}
          <span className="ai-block-actions" style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            {question && !sending && answer && (
              <ActionBtn title="重新生成" onClick={regenerate}><RotateCw size={11} /></ActionBtn>
            )}
            {question && !sending && (
              <ActionBtn title="编辑重发" onClick={() => void editResend()}><Pencil size={11} /></ActionBtn>
            )}
            {question && !sending && (
              <ActionBtn title="删除" onClick={() => void removeExchange()}><Trash2 size={11} /></ActionBtn>
            )}
            <ActionBtn title="复制" onClick={() => copy(answer?.content || question.content)}><Copy size={11} /></ActionBtn>
          </span>
        </div>
      )}

      {/* 问题附件（M5）：只读 chips，点击预览 */}
      {question?.attachments && question.attachments.length > 0 && !collapsed && (
        <div style={{ marginLeft: 22, marginTop: 2 }}>
          <AttachmentChips
            atts={question.attachments}
            previewId={attPreviewId}
            onPreview={(id) => setAttPreviewId((cur) => (cur === id ? null : id))}
          />
        </div>
      )}

      {/* 回答 — 时间轴：rail 常驻（无工具也有细线），两端灰节点，动作节点穿插中间 */}
      {answer && !collapsed && (
        <div
          data-selectable
          style={{
            position: 'relative',
            marginLeft: 6,
            marginTop: 2,
            paddingTop: 6,
            paddingBottom: !answer.pending && !answer.error ? 8 : 0,
            fontFamily: 'var(--font-ui)',
            fontSize: 'calc(12px * var(--ui-font-scale))',
            lineHeight: 1.6,
            color: 'var(--text-primary)',
          }}
        >
          {/* rail 贯穿：起点=首端灰点圆心(6px)，终点=末端节点圆心（完成 4 / 出错 12 / 流式到底） */}
          <Rail bottom={answer.error ? 12 : answer.pending ? 0 : 4} />
          <EndDot top={6} />
          {answer.reasoning && (
            <ThinkingBlock text={answer.reasoning} streaming={answer.pending ?? false} />
          )}
          {parts
            ? parts.map((p, i) => {
                if (p.kind === 'tool') {
                  return (
                    <div key={p.tool.toolCallId} style={ROW}>
                      <ToolRunCard run={p.tool} paneId={exchange.paneId} />
                    </div>
                  );
                }
                if (!p.text) return null;
                const isLast = i === parts.length - 1;
                return (
                  <div key={i} style={ROW}>
                    <div className="md">
                      <SafeMarkdown content={p.text} />
                      {/* pending 光标落在最后一个 text part 末尾 */}
                      {isLast && answer.pending && <PendingCursor />}
                    </div>
                  </div>
                );
              })
            : // legacy 渲染（纯文本/旧持久化消息）：行为零变化
              answer.content && (
                <div style={ROW} className="md">
                  <SafeMarkdown content={answer.content} />
                  {answer.pending && <PendingCursor />}
                </div>
              )}
          {/* 末 part 是 tool 时，pending 光标挂在尾部独立一行 */}
          {parts && answer.pending && parts[parts.length - 1]?.kind === 'tool' && (
            <div style={ROW}>
              <PendingCursor />
            </div>
          )}
          {/* 文本错误 = 红色终点节点 */}
          {answer.error && (
            <div
              style={{
                position: 'relative',
                paddingLeft: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 24,
                lineHeight: '18px',
              }}
            >
              <ToolNode state="error" top={12} />
              <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--error)' }}>出错了</span>
            </div>
          )}
          {/* 回答完成 = 末端灰点（6px，圆心距容器底 4px，与 Rail bottom 对齐） */}
          {!answer.pending && !answer.error && <EndDot bottom={4} />}
        </div>
      )}
    </div>
  );
}

/** 可折叠的「思考」块（默认折叠，点击展开；展开时流式自动滚底 + Markdown 渲染）。 */
function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const preview = text.split('\n').find((l) => l.trim()) ?? '';
  useEffect(() => {
    if (open && streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open, streaming]);
  return (
    <div style={ROW}>
      <button
        data-subtle
        onClick={() => setOpen((o) => !o)}
        title={open ? '收起思考过程' : '展开思考过程'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontFamily: 'var(--font-ui)', fontSize: 'calc(11px * var(--ui-font-scale))',
          padding: '2px 6px', border: 'none', borderRadius: 4,
          background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
          maxWidth: '100%',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        <ChevronRight
          size={11}
          style={{ color: 'var(--text-muted)', flexShrink: 0, transition: 'transform 0.12s ease', transform: open ? 'rotate(90deg)' : 'none' }}
        />
        <Brain size={11} style={{ flexShrink: 0 }} />
        <span style={{ flexShrink: 0 }}>思考过程</span>
        {!open && preview && (
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)', opacity: 0.6, minWidth: 0,
          }}>
            {preview}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={bodyRef}
          style={{
            marginTop: 4, marginLeft: 1, padding: '2px 0 2px 12px',
            borderLeft: '2px solid var(--border-strong)',
            fontSize: 'calc(11px * var(--ui-font-scale))', lineHeight: 1.6, color: 'var(--text-secondary)',
            wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto',
          }}
        >
          <div className="md">
            <SafeMarkdown content={text} />
          </div>
        </div>
      )}
    </div>
  );
}

/** 流式 pending 光标（暖色 ▍ 脉冲） */
function PendingCursor() {
  return (
    <span
      style={{
        display: 'inline-block',
        color: 'var(--accent-warm)',
        animation: 'pulse 1s infinite',
      }}
    >
      ▍
    </span>
  );
}

function ActionBtn({ title, onClick, children }: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-subtle
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        padding: 0,
        border: 'none',
        borderRadius: 3,
        background: 'transparent',
        color: 'var(--text-muted)',
        cursor: 'pointer',
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
      {children}
    </button>
  );
}
