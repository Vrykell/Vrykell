import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check } from './icons';
import { useExclusiveMenu } from './hooks/useExclusiveMenu';
import { useFloatingPanelPosition } from './hooks/useFloatingPanelPosition';
import type { MenuAnchor } from './ContextMenu';

export interface HistoryMenuOption {
  label: string;
  active: boolean;
  onSelect: () => void;
}

export interface HistoryMenuSection {
  label?: string;
  options: HistoryMenuOption[];
}

/** Shared single-select menu used by history filters and sort controls. */
export default function HistoryOptionMenu({ anchor, testId, sections, onClose, width = 168, maxHeight = 360, align = 'start', closeOnSelect = false }: {
  anchor: MenuAnchor;
  testId: string;
  sections: HistoryMenuSection[];
  onClose: () => void;
  width?: number;
  maxHeight?: number;
  align?: 'start' | 'end';
  closeOnSelect?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useExclusiveMenu(ref, onClose, anchor.trigger);
  const position = useFloatingPanelPosition(ref, { x: align === 'end' ? anchor.x - width : anchor.x, y: anchor.y });
  useLayoutEffect(() => {
    (ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? ref.current?.querySelector<HTMLButtonElement>('button'))?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); anchor.trigger?.focus(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, anchor.trigger]);

  return createPortal(<div ref={ref} data-testid={testId} className="workspace-floating history-option-menu"
    style={{ ...position, width, maxWidth: 'calc(100vw - 16px)', maxHeight: `min(${maxHeight}px, calc(100vh - 16px))` }}
    onKeyDown={event => {
      if (event.key === 'Tab') { anchor.trigger?.focus(); onClose(); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    {sections.map((section, sectionIndex) => <div className="history-option-section" data-history-option-section={section.label ?? ''}
      key={`${section.label ?? 'section'}-${sectionIndex}`}>
      {section.label && <div className="history-menu-heading">{section.label}</div>}
      {section.options.map(option => <button key={option.label} className="workspace-floating-row history-option-row"
        type="button" aria-pressed={option.active} onClick={event => {
          event.currentTarget.focus(); option.onSelect(); if (closeOnSelect) onClose();
        }}>
        <span>{option.label}</span>
        {option.active && <Check size={12} aria-hidden="true" />}
      </button>)}
    </div>)}
  </div>, document.body);
}
