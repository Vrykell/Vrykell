import { ContextMenuItems } from '@ui/ContextMenu';
import { t } from '@i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampMenuPosition } from '@ui/menuPosition';
import type { BlockMenuAnchor } from '@features/terminal/hooks/useTerminalBlockFlow';
import { copyBlockText, rerunBlockCommand } from '@features/terminal/services/blockActions';
import { useChatStore } from '@features/chat';
import { clearSessionBlocks } from '@features/terminal/hooks/useTerminalSession';
import { fmtDuration } from '@ui/UiBtn';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

interface Props {
  block: TermBlock;
  /** 该块所属 pane（「发给 AI 分析」时作为对话来源，回答内联回本 pane 块流） */
  paneId: string;
  anchor: BlockMenuAnchor;
  onClose: () => void;
  getOutputText: () => string;
}

export default function BlockMenu({ block, paneId, anchor, onClose, getOutputText }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const preferredPosition = anchor.kind === 'pointer'
    ? { left: anchor.x, top: anchor.y }
    : { left: anchor.left, top: anchor.top };
  const [position, setPosition] = useState(preferredPosition);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const menu = ref.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      setPosition(clampMenuPosition(
        preferredPosition,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [preferredPosition.left, preferredPosition.top]);

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
  }, []);

  const rerun = useCallback(() => {
    void rerunBlockCommand(paneId, block.command);
  }, [paneId, block.command]);

  const sendToAI = useCallback(() => {
    const output = getOutputText();
    useChatStore.getState().send(
      `分析这条命令的执行结果：\n\`\`\`\n$ ${block.command}\n${output}\n\`\`\``,
      { paneId },
    );
  }, [block, paneId, getOutputText]);

  const duration = block.endedAt && block.startedAt
    ? fmtDuration(block.endedAt - block.startedAt)
    : '';

  const clearAllBlocks = useCallback(() => {
    clearSessionBlocks(paneId);
  }, [paneId]);

  return createPortal(
    <div
      ref={ref}
      className="workspace-floating"
      role="menu"
      aria-label="命令块操作"
      data-no-drag
      style={{
        position: 'fixed',
        zIndex: 9999,
        top: position.top,
        left: position.left,
        minWidth: 210,
        maxWidth: 'calc(100vw - 16px)',
        boxSizing: 'border-box',
        padding: 4,
        fontSize: 'calc(12px * var(--ui-font-scale))',
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
        fontSize: 'calc(11px * var(--ui-font-scale))',
      }}>
        <code style={{
          fontSize: 'calc(11px * var(--ui-font-scale))',
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
              fontWeight: 'var(--fw-semibold)',
            }}>
              退出码 {block.exitCode}
            </span>
          )}
        </div>
      </div>

      <ContextMenuItems itemRole="menuitem" onClose={onClose} items={[
        { label: t('Rerun command'), onClick: rerun, group: 'primary' },
        { label: t('Send to AI for analysis'), onClick: sendToAI, group: 'primary' },
        { label: t('Copy command'), onClick: () => copy(block.command), group: 'clipboard' },
        { label: t('Copy output'), onClick: () => copy(getOutputText()), group: 'clipboard' },
        { label: t('Clear all blocks'), onClick: clearAllBlocks, danger: true },
      ]} />
    </div>,
    document.body,
  );
}
