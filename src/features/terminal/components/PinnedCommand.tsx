import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { t } from '@i18n';
import { IconButton } from '@ui/IconButton';
import { ChevronDown, Ellipsis } from '@ui/icons';
import { useTypographyStore } from '@config/typography';
import type { TermBlock } from '../services/pipeline/termBlock';
import { COMMAND_BLOCK_CONTENT_PADDING } from '../model/commandBlockLayout';
import BlockMenu from './BlockMenu';
import type { BlockMenuAnchor } from '../hooks/useTerminalBlockFlow';
import CommandStatus from './CommandStatus';
import CommandSyntax from './CommandSyntax';
import RunningCommandBar from './RunningCommandBar';

/** A viewport title is independent of output expansion and scroll position. */
export default function PinnedCommand({ block, paneId, remaining, insetLeft, insetRight, scrollRef, collapsed, onToggle }: {
  block: TermBlock; paneId: string; remaining: number; insetLeft: number; insetRight: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [anchor, setAnchor] = useState<BlockMenuAnchor | null>(null);
  const closeMenu = useCallback(() => setAnchor(null), []);
  const [height, setHeight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const colored = useTypographyStore(state => state.commandHighlighting);
  const running = block.status === 'executing';
  useLayoutEffect(() => setAnchor(null), [block.id]);
  useEffect(() => {
    const element = ref.current;
    const scroll = scrollRef?.current;
    if (!element || !scroll) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // The scroll host still owns follow-state changes while this title is above it.
      scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: event.deltaY, deltaX: event.deltaX,
        deltaMode: event.deltaMode, cancelable: true }));
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroll.clientHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? parseFloat(getComputedStyle(scroll).lineHeight) || 16 : 1;
      scroll.scrollTop += event.deltaY * unit;
      scroll.scrollLeft += event.deltaX * unit;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [scrollRef]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [block.id, collapsed, running]);
  const duration = block.startedAt === null ? null : (block.endedAt ?? Date.now()) - block.startedAt;
  return <div className="pinned-command-clip">
    <div ref={ref} className="pinned-command command-block" data-testid="pinned-command"
      data-collapsed={collapsed} data-running={running} data-failed={block.exitCode !== null && block.exitCode !== 0}
      data-menu-open={!!anchor} role="region" aria-label={t('Current command')}
      style={{ paddingLeft: insetLeft + COMMAND_BLOCK_CONTENT_PADDING,
        paddingRight: insetRight + COMMAND_BLOCK_CONTENT_PADDING,
        transform: `translateY(${Math.min(0, remaining - height)}px)` }}
      onContextMenu={event => {
        event.preventDefault();
        event.stopPropagation();
        setAnchor({ kind: 'pointer', x: event.clientX, y: event.clientY });
      }}>
      {running ? <RunningCommandBar block={block} paneId={paneId} pinned collapsed={collapsed} /> : !collapsed && <>
        <div data-selectable className="command-block-info">
          {block.cwd && <span className="command-block-cwd" data-tip={block.cwd}>{block.cwd}</span>}
          <CommandStatus exitCode={block.exitCode} duration={duration} agent={block.agent} />
          <span className="command-block-actions">
            <IconButton compact data-subtle aria-label={t('More actions')} data-tip={t('More actions')}
              aria-haspopup="menu" aria-expanded={!!anchor} onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setAnchor({ kind: 'control', left: rect.left, top: rect.bottom + 4 });
              }}><Ellipsis size={16} /></IconButton>
          </span>
        </div>
        <div data-selectable className="command-block-command" data-tip={block.command}>
          {colored ? <CommandSyntax text={block.command} /> : block.command}
        </div>
      </>}
      <div className="pinned-command-toggle-slot">
        <IconButton compact data-subtle className="pinned-command-toggle" aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'Show command header' : 'Hide command header')}
          data-tip={t(collapsed ? 'Show command header' : 'Hide command header')}
          onClick={event => {
            onToggle();
            if (event.detail > 0) event.currentTarget.blur();
          }}>
          <ChevronDown size={14} style={{ transform: collapsed ? undefined : 'rotate(180deg)' }} />
        </IconButton>
      </div>
      {anchor && <BlockMenu block={block} paneId={paneId} anchor={anchor}
        onClose={closeMenu} getOutputText={() => block.outputText} />}
    </div>
  </div>;
}
