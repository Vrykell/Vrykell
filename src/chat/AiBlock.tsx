/**
 * AiBlock — 一次 AI 问答交换的渲染（「时间轴 rail」视觉语言）。
 *
 * AI 不是应用里的聊天机器人，而是会话历史里的一种特殊条目：
 *   问题 = 你敲的一行（⚡ prompt + 等宽字体，与命令同级）
 *   回答 = 时间轴：每个动作（执行命令/读取/修改/搜索…）挂一个 8px 状态
 *          节点 + 摘要卡片；1px 中性细线（rail）从首个动作节点的圆心
 *          出发，连续穿过其后所有内容，末端收在一个终点上 —— 完成时
 *          是 6px 灰色终点节点，出错时是红色错误节点，流式中随内容延伸。
 *          首个动作之前的文本段无线。run_command 节点下内嵌命令输出块。
 * 节点语义：绿实心=成功 / 红实心=失败 / 暖色描边环脉冲=执行中 /
 *          静态暖色环=等待批准 / 灰环=已拒绝。纯文本不设节点（也无细线）。
 *
 * 行结构：回答区每个 part 包一层行容器（position:relative; paddingLeft:16），
 * 行容器左缘即 rail x 坐标；RailSeg（本文件）与 ToolNode（ToolRunCard 内）
 * 都以它为包含块。错误行是合成的末节点（红实心 +「出错了」）。
 *
 * 同组件服务两个视图：TerminalBlockList（块流内联）与 PanelChat（窗口转录）。
 */

import { useState } from 'react';
import { Copy, Pencil, RotateCw, Trash2, Zap } from 'lucide-react';
import { ask } from '@tauri-apps/plugin-dialog';
import { useChatStore } from '../stores/chat';
import { useWorkspaceStore } from '../stores/workspace';
import SafeMarkdown from './SafeMarkdown';
import ToolNode from './ToolNode';
import ToolRunCard from './ToolRunCard';
import AttachmentChips from './AttachmentChips';
import type { ChatExchange } from './exchanges';

/** rail 线段：1px 细线，位于行容器左缘。up/down 控制是否向行首/行尾延伸，
 *  都不延伸时线段收在节点圆心处（即不渲染）。nodeTop = 节点圆心的行内偏移。 */
function RailSeg({ up, down, nodeTop = 12 }: { up: boolean; down: boolean; nodeTop?: number }) {
  if (!up && !down) return null;
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        width: 1,
        transform: 'translateX(-50%)',
        top: up ? 0 : nodeTop,
        bottom: down ? 0 : nodeTop,
        background: 'var(--border-strong)',
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
    useChatStore.getState().regenerate(useWorkspaceStore.getState().activeId, question.id);
  };
  // 编辑重发：删该条及之后全部消息，问题灌回输入框
  const editResend = async () => {
    if (!question) return;
    const ok = await ask('将删除这条问题及之后的所有对话，把问题填回输入框。', {
      title: '编辑重发',
      kind: 'warning',
    });
    if (ok) useChatStore.getState().editResend(useWorkspaceStore.getState().activeId, question.id);
  };
  // 删除整个交换（问题 + 回答）
  const removeExchange = async () => {
    if (!question) return;
    const ok = await ask('删除这条问答？', { title: '删除', kind: 'warning' });
    if (ok) useChatStore.getState().deleteExchange(useWorkspaceStore.getState().activeId, question.id);
  };

  // 首个动作节点的 part 下标：细线从它的圆心出发，连续穿到回答末尾
  const parts = answer?.parts;
  const firstNode = (parts ?? []).findIndex((p) => p.kind === 'tool');

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
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
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

      {/* 回答 — 时间轴：节点间细线 + 文本段 + 动作卡片（含内嵌命令块） */}
      {answer && !collapsed && (
        <div
          style={{
            marginLeft: 6,
            marginTop: 2,
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text-primary)',
          }}
        >
          {parts
            ? parts.map((p, i) => {
                if (p.kind === 'tool') {
                  // 首节点上方无线（线的起点 = 首节点圆心），此后细线连续
                  // 穿过每一行直到终点节点
                  return (
                    <div key={p.tool.toolCallId} style={ROW}>
                      <RailSeg up={i > firstNode} down={firstNode >= 0} />
                      <ToolRunCard run={p.tool} paneId={exchange.paneId} />
                    </div>
                  );
                }
                if (!p.text) return null;
                const isLast = i === parts.length - 1;
                // 首节点之后的文本段细线全高穿过；首节点之前的文本无线
                const onLine = firstNode >= 0 && i > firstNode;
                return (
                  <div key={i} style={ROW}>
                    <RailSeg up={onLine} down={onLine} />
                    <div className="md">
                      <SafeMarkdown content={p.text} />
                      {/* pending 光标落在最后一个 text part 末尾 */}
                      {isLast && answer.pending && <PendingCursor />}
                    </div>
                  </div>
                );
              })
            : // legacy 渲染（纯文本/旧持久化消息）：无节点无细线，行为零变化
              answer.content && (
                <div style={{ paddingLeft: 16 }} className="md">
                  <SafeMarkdown content={answer.content} />
                  {answer.pending && <PendingCursor />}
                </div>
              )}
          {/* 末 part 是 tool 时，pending 光标挂在尾部独立一行，细线继续延伸 */}
          {parts && answer.pending && parts[parts.length - 1]?.kind === 'tool' && (
            <div style={ROW}>
              <RailSeg up={firstNode >= 0} down={firstNode >= 0} />
              <PendingCursor />
            </div>
          )}
          {/* 文本错误 = 红色终点节点（细线向上续到它，不再向下） */}
          {answer.error && (
            <div
              style={{
                position: 'relative',
                paddingLeft: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingTop: 3,
                paddingBottom: 3,
                lineHeight: '18px',
              }}
            >
              <RailSeg up={firstNode >= 0} down={false} />
              <ToolNode state="error" top={12} />
              <span style={{ fontSize: 12, color: 'var(--error)' }}>出错了</span>
            </div>
          )}
          {/* 回答完成 = 时间轴终点节点（6px 灰点，区别于 8px 动作节点） */}
          {parts && firstNode >= 0 && !answer.pending && !answer.error && (
            <div style={{ position: 'relative', height: 8 }}>
              <RailSeg up down={false} nodeTop={4} />
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 4,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  background: 'var(--text-muted)',
                }}
              />
            </div>
          )}
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
