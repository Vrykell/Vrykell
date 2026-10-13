import { useAgentSettings, useAiConfigStore, usePermissions } from '@features/agent';
import { PERMISSION_MODES } from '@features/agent/components/PermissionModeButton';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { iconSizes, Check, ChevronDown, Sparkles } from '@ui/icons';
import { t } from '@i18n';

const MODES = [
  { id: 'chat', label: 'Chat only', description: 'Reply without using tools.', icon: Sparkles, tone: 'neutral' },
  ...PERMISSION_MODES,
] as const;

export default function ChatModeSelect({ compact = false }: { compact?: boolean }) {
  const activeModel = useAiConfigStore(state => state.activeModel);
  const settings = useAgentSettings();
  const agentMode = settings.resolve(activeModel).agentMode;
  const permission = usePermissions(state => state.mode);
  const setPermission = usePermissions(state => state.setMode);
  const selectedId = agentMode ? permission : 'chat';
  const selectedIndex = MODES.findIndex(mode => mode.id === selectedId);
  const current = MODES[selectedIndex];
  const Icon = current.icon;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, selectedIndex));
    options.current[selectedIndex]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, selectedIndex]);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(248, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom > rect.top;
      setPosition({ position: 'fixed', left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
        width, maxHeight: Math.max(80, (below ? window.innerHeight - rect.bottom : rect.top) - 18), overflowY: 'auto' });
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); };
  }, [open]);
  useEffect(() => { setOpen(false); }, [activeModel]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div ref={root} style={{ position: 'relative', flexShrink: 0 }}>
    <button ref={trigger} type="button" data-subtle className={compact ? 'icon-button chat-mode-trigger' : 'chat-mode-trigger'} data-compact={compact} data-testid="chat-approval-select"
      data-mode={selectedId} data-tone={current.tone} aria-label={t('Chat and approval mode')} data-tip={t(current.label)} data-tip-description={t(current.description)} aria-haspopup="listbox" aria-expanded={open}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 4, height: compact ? 'var(--control-size-compact)' : 30, borderRadius: 8,
        border: 'none', color: current.tone !== 'neutral' ? 'var(--accent-warm)' : 'var(--text-secondary)',
        fontSize: 'calc(12px * var(--ui-font-scale))', cursor: 'pointer' }}>
      <Icon size={compact ? iconSizes.control : iconSizes.compact} />
      {!compact && <><span className="chat-mode-label">{t(current.label)}</span><ChevronDown size={iconSizes.compact} /></>}
    </button>
    {open && createPortal(<div ref={menu} role="listbox" aria-label={t('Chat and approval mode')} className="workspace-floating"
      style={{ ...position, zIndex: 10000, padding: 4, borderRadius: 10 }}>
      {MODES.map((mode, index) => {
        const selected = selectedId === mode.id;
        const OptionIcon = mode.icon;
        return <button key={mode.id} ref={element => { options.current[index] = element; }} type="button" data-subtle role="option"
          aria-selected={selected} className="workspace-floating-row chat-mode-option" data-selected={selected}
          data-active={index === active}
          onPointerMove={() => setActive(index)}
          onFocus={() => setActive(index)}
          onClick={() => {
            if (mode.id !== 'chat') setPermission(mode.id);
            settings.updateModel(activeModel, { agentMode: mode.id !== 'chat' });
            close();
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? MODES.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + MODES.length) % MODES.length;
              options.current[next]?.focus();
            } else if (event.key === 'Tab') setOpen(false);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            padding: '6px 8px', borderRadius: 6, textAlign: 'left', cursor: 'pointer', color: mode.tone === 'danger' ? 'var(--accent-warm)' : 'var(--text-primary)' }}>
          <OptionIcon size={iconSizes.control} />
          <span className="chat-approval-option-copy">
            <span>{t(mode.label)}</span>
            <small>{t(mode.description)}</small>
          </span>
          {selected && <Check size={iconSizes.compact} />}
        </button>;
      })}
    </div>, document.body)}
  </div>;
}
