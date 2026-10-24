import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { Check } from '@ui/icons';
import { GROUP_COLORS, type HistoryGroupColor } from '@ui/history/historyGroupColor';
import { useExclusiveMenu } from '../hooks/useExclusiveMenu';
import { useListNavigationMode } from '../hooks/useListNavigationMode';
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition';
import type { MenuAnchor } from '@ui/menus/ContextMenu';

const COLOR_LABELS: Record<(typeof GROUP_COLORS)[number], string> = {
  blue: 'Blue',
  green: 'Green',
  violet: 'Violet',
  amber: 'Amber',
  cyan: 'Cyan',
  rose: 'Rose',
  orange: 'Orange',
  coral: 'Coral',
};

/** Floating swatch picker that overrides one history group color. */
export default function HistoryColorPalette({ anchor, value, onSelect, onClose, testId }: {
  anchor: MenuAnchor;
  /** Manual override currently applied, or null while the automatic color is active. */
  value: HistoryGroupColor | null;
  onSelect: (color: HistoryGroupColor | null) => void;
  onClose: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const navigation = useListNavigationMode(true);
  useExclusiveMenu(ref, onClose);
  useLayoutEffect(() => {
    (ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? ref.current?.querySelector<HTMLButtonElement>('button'))?.focus();
  }, []);
  const select = (color: HistoryGroupColor | null) => { anchor.trigger?.focus(); onSelect(color); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { anchor.trigger?.focus(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, anchor.trigger]);

  const width = 208;
  const position = useFloatingPanelPosition(ref, anchor);

  return createPortal(<div {...navigation.props} ref={ref} role="dialog" aria-label={t('Group color')} data-testid={testId} className="workspace-floating history-color-palette" style={{ ...position, width, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}>
    <HistoryColorChoices value={value} onSelect={select} testId={testId} />
  </div>, document.body);
}

/** Shared swatches for the floating picker and the bottom of a group action menu. */
export function HistoryColorChoices({ value, onSelect, testId, menu = false, label = t('Group color') }: {
  value: HistoryGroupColor | null;
  onSelect: (color: HistoryGroupColor | null) => void;
  testId: string;
  menu?: boolean;
  label?: string;
}) {
  const state = (selected: boolean) => menu
    ? { role: 'menuitemradio' as const, 'aria-checked': selected }
    : { 'aria-pressed': selected };
  return <>
    <div className="history-palette-swatches" data-menu={menu ? 'true' : undefined} role="group" aria-label={label}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); event.stopPropagation();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
      {menu && <button type="button" className="history-palette-swatch" data-color="auto"
        {...state(value === null)} aria-label={t('Automatic color')} data-tip={t('Automatic color')}
        data-testid={`${testId}-auto`} onClick={() => onSelect(null)} />}
      {GROUP_COLORS.map(color => <button key={color} type="button" className="history-palette-swatch" data-color={color}
        {...state(value === color)} aria-label={t(COLOR_LABELS[color])} data-tip={t(COLOR_LABELS[color])}
        onClick={() => onSelect(color)} />)}
    </div>
    {!menu && <button type="button" className="workspace-floating-row history-palette-auto" aria-pressed={value === null}
      data-testid={`${testId}-auto`} onClick={() => onSelect(null)}>
      <span>{t('Automatic color')}</span>
      {value === null && <Check size={12} aria-hidden="true" />}
    </button>}
  </>;
}
