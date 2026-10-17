import { t } from '@i18n';
import CopyButton from '@ui/CopyButton';
import { OutlineButton } from '@ui/OutlineButton';
import { IconBtn } from '@ui/UiBtn';
import { ChevronRight, Play, X } from '@ui/icons';
import { TextButton } from '@ui/TextButton';
import type { CommandItem } from '../model/commands';
import { useRef, useState } from 'react';
import ResizeHandle from '@ui/ResizeHandle';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';

const HEIGHT_KEY = 'command-history-detail-height';
const COLLAPSED_KEY = 'command-history-detail-collapsed';

/** A docked inspector preserves the list geometry while browsing execution context. */
export default function CommandDetails({ item, id, running, runLabel, onFill, onRun, onClose }: {
  item: CommandItem; id: string; running: boolean; runLabel: string;
  onFill: () => void; onRun: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(() => { const stored = Number(safeLocalStorageGet(HEIGHT_KEY)); return Number.isFinite(stored) && stored >= 120 ? stored : null; });
  const [collapsed, setCollapsed] = useState(() => safeLocalStorageGet(COLLAPSED_KEY) === 'true');
  const collapseRef = useRef(collapsed);
  const resized = useRef<number | null>(null);
  const toggle = (value: boolean) => { collapseRef.current = value; setCollapsed(value); safeLocalStorageSet(COLLAPSED_KEY, String(value)); };
  const lastRun = item.runCount && item.timestamp ? new Date(item.timestamp).toLocaleString() : t('Not run');
  const status = !item.runCount ? t('Not run') : t(item.status === 'success' ? 'Succeeded' : item.status === 'failed' ? 'Failed' : item.status === 'running' ? 'Running' : 'Unknown');
  return <div ref={ref} id={id} className="command-history-details" role="region" aria-label={t('Command details')}
    data-collapsed={collapsed} style={collapsed ? { height: 36 } : height === null ? undefined : { height, maxHeight: 'max(120px, calc(100% - 180px))' }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <ResizeHandle axis="y" testId="resize-command-details" label={t('Resize command details')} onDelta={delta => {
      const currentHeight = ref.current?.getBoundingClientRect().height ?? 280;
      const maximum = Math.max(120, (ref.current?.parentElement?.clientHeight ?? 700) - 180);
      const next = Math.max(36, Math.min(maximum, (resized.current ?? currentHeight) - delta));
      resized.current = next;
      collapseRef.current = next < 90; setCollapsed(collapseRef.current);
      if (!collapseRef.current) setHeight(Math.max(120, next));
    }} onUp={() => {
      safeLocalStorageSet(COLLAPSED_KEY, String(collapseRef.current));
      if (!collapseRef.current && resized.current !== null) safeLocalStorageSet(HEIGHT_KEY, String(Math.max(120, resized.current)));
      resized.current = null;
    }} onReset={() => { toggle(false); setHeight(null); resized.current = null; safeLocalStorageSet(HEIGHT_KEY, ''); }} />
    <div className="command-history-detail-header"><TextButton className="command-history-detail-toggle" aria-expanded={!collapsed} onClick={() => toggle(!collapsed)}>
      <ChevronRight size={12} style={{ transform: collapsed ? undefined : 'rotate(90deg)' }} />{t('Command details')}</TextButton>
      <CopyButton text={item.command} label={t('Copy command')} style={{ width: 'var(--control-size)', height: 'var(--control-size)' }} />
      <IconBtn title={t('Hide command details')} onClick={onClose}><X size={14} /></IconBtn>
    </div>
    <div className="command-history-detail-content scroll-region" hidden={collapsed}>
      <pre className="command-history-code">{item.command}</pre>
      <dl className="command-history-metadata">
        <div><dt>{t('Execution directory')}</dt><dd>{item.cwd}</dd></div>
        <div><dt>{t('Last execution')}</dt><dd>{lastRun}</dd></div>
        <div><dt>{t('Command shell')}</dt><dd>{item.shell}</dd></div>
        <div><dt>{t('Command status')}</dt><dd>{status}{item.runCount ? ` · ${t('{{count}} runs', { count: item.runCount })}` : ''}</dd></div>
      </dl>
    </div>
    <div className="command-history-detail-actions" hidden={collapsed}>
      <OutlineButton onClick={onFill}>{t('Insert command')}</OutlineButton>
      <OutlineButton aria-label={t('Run command')} data-tip={runLabel} disabled={running} onClick={onRun}><Play size={14} />{t('Run')}</OutlineButton>
    </div>
  </div>;
}
