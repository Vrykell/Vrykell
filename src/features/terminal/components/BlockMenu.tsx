import { ContextMenuItems } from '@ui/ContextMenu';
import { t } from '@i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampMenuPosition } from '@ui/menuPosition';
import { useExclusiveMenu } from '@ui/hooks/useExclusiveMenu';
import type { BlockMenuAnchor } from '@features/terminal/hooks/useTerminalBlockFlow';
import { copyBlockText, rerunBlockCommand } from '@features/terminal/services/blockActions';
import { askAboutTerminal } from '@features/chat/services/conversationContext';
import { clearSessionBlocks } from '@features/terminal/hooks/useTerminalSession';
import { fmtDuration } from '@ui/UiBtn';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

interface Props {
  block: TermBlock;
  /** Route the analysis reply to the command's owning pane. */
  paneId: string;
  anchor: BlockMenuAnchor;
  onClose: () => void;
  getOutputText: () => string;
}

export default function BlockMenu({ block, paneId, anchor, onClose, getOutputText }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useExclusiveMenu(ref, onClose);
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
    const trigger = document.activeElement;
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!items.length || !ref.current?.contains(document.activeElement)) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key === 'Tab') { onClose(); return; }
      else return;
      event.preventDefault();
      event.stopPropagation();
      items[next]?.focus();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKey, true);
      if (trigger instanceof HTMLElement && trigger.isConnected &&
          (document.activeElement === document.body || ref.current?.contains(document.activeElement))) {
        trigger.focus({ preventScroll: true });
      }
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
    askAboutTerminal(paneId, {
      id: block.id, paneId, label: t('Terminal output'), command: block.command, output,
      cwd: block.cwd, exitCode: block.exitCode, createdAt: block.startedAt ?? Date.now(),
    }, t('Help me analyze this command result.'));
  }, [block, paneId, getOutputText]);

  const duration = block.endedAt !== null && block.startedAt !== null
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
      aria-label={t('Command block actions')}
      data-no-drag
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
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
      {/* Summarize the command without taking space from its output. */}
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
          // Long commands ellipsize here; without a cap their unbroken line would
          // stretch the whole menu up to the viewport limit.
          maxWidth: 340,
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
              {t('Exit code {{code}}', { code: block.exitCode })}
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
