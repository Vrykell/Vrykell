import { useCallback, useEffect, useRef } from 'react';
import { copyBlockText, rerunBlockCommand } from '@features/terminal/services/blockActions';
import { useChatStore } from '@features/chat';
import { clearSessionBlocks } from '@features/terminal/hooks/useTerminalSession';
import { fmtDuration } from '@ui/UiBtn';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

interface Props {
  block: TermBlock;
  /** 该块所属 pane（「发给 AI 分析」时作为对话来源，回答内联回本 pane 块流） */
  paneId: string;
  anchor: DOMRect;
  onClose: () => void;
  getOutputText: () => string;
}

// ── MenuItem — 菜单项（label · shortcut hint） ──

function MenuItem({ label, shortcut, onClick }: { label: string; shortcut?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{ cursor: 'pointer', display: 'block', width: '100%', border: 'none', background: 'transparent', textAlign: 'left' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <div style={{
        padding: '4px 12px',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        color: 'var(--text-primary)',
        transition: 'background var(--dur-fast) var(--ease)',
      }}>
        <span>{label}</span>
        {shortcut && (
          <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            {shortcut}
          </span>
        )}
      </div>
    </button>
  );
}

export default function BlockMenu({ block, paneId, anchor, onClose, getOutputText }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const frame = requestAnimationFrame(() => document.addEventListener('click', h));
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('click', h);
    };
  }, [onClose]);

  const copy = useCallback((text: string) => {
    void copyBlockText(text);
    onClose();
  }, [onClose]);

  const rerun = useCallback(() => {
    void rerunBlockCommand(paneId, block.command);
    onClose();
  }, [paneId, block.command, onClose]);

  const sendToAI = useCallback(() => {
    const output = getOutputText();
    useChatStore.getState().send(
      `分析这条命令的执行结果：\n\`\`\`\n$ ${block.command}\n${output}\n\`\`\``,
      { paneId },
    );
    onClose();
  }, [block, paneId, getOutputText, onClose]);

  const duration = block.endedAt && block.startedAt
    ? fmtDuration(block.endedAt - block.startedAt)
    : '';

  const top = Math.min(anchor.bottom + 4, window.innerHeight - 260);
  const left = Math.min(anchor.left, window.innerWidth - 220);

  const clearAllBlocks = useCallback(() => {
    clearSessionBlocks(paneId);
    onClose();
  }, [paneId, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="命令块操作"
      data-no-drag
      style={{
        position: 'fixed',
        zIndex: 9999,
        top,
        left,
        minWidth: 210,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        padding: '4px 0',
        fontSize: 12,
        fontFamily: 'var(--font-ui)',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* 块信息头 — 命令摘要 + 退出状态 */}
      <div style={{
        padding: '6px 12px 5px',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text-muted)',
        fontSize: 11,
      }}>
        <code style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--block-cmd-text)',
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          $ {block.command}
        </code>
        <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
          {duration && <span>{duration}</span>}
          {block.exitCode !== null && (
            <span style={{
              color: block.exitCode === 0 ? 'var(--success)' : 'var(--error)',
              fontWeight: 600,
            }}>
              exit {block.exitCode}
            </span>
          )}
        </div>
      </div>

      <MenuItem label="复制命令" onClick={() => copy(block.command)} />
      <MenuItem label="复制输出" onClick={() => copy(getOutputText())} />
      <div style={{ height: 1, background: 'var(--border)', margin: '3px 8px' }} />
      <MenuItem label="重新运行" onClick={rerun} />
      <MenuItem label="发给 AI 分析" onClick={sendToAI} />
      <div style={{ height: 1, background: 'var(--border)', margin: '3px 8px' }} />
      <MenuItem label="清除所有块" onClick={clearAllBlocks} />
    </div>
  );
}
