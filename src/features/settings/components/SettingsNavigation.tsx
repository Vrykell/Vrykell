import { useEffect, useRef, type RefObject } from 'react';
import { t } from '@i18n';
import SidebarItem from '@ui/sidebarItem';
import { IconButton } from '@ui/IconButton';
import { X, iconSizes } from '@ui/icons';
import { SETTINGS_GROUPS, type useSettingsNavigation } from '../hooks/useSettingsNavigation';

/** Narrow pages reveal the full directory on demand without reserving a rail. */
export default function SettingsNavigation({ navigation, open, onClose, trigger }: {
  navigation: ReturnType<typeof useSettingsNavigation>;
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && !trigger.current?.contains(event.target)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); onClose(); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [open, onClose, trigger]);

  const select = (page: Parameters<typeof navigation.setSelected>[0]) => {
    navigation.setSelected(page);
    if (open) { onClose(); trigger.current?.focus(); }
  };
  return <aside ref={ref} id="settings-navigation" aria-label={t('Settings navigation')} className="settings-navigation"
    onBlur={event => {
      if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
        && !trigger.current?.contains(event.relatedTarget)) onClose();
    }}>
    <div className="settings-navigation-header">
      <span>{t('Settings navigation')}</span>
      <IconButton compact aria-label={t('Hide settings navigation')} data-tip={t('Hide settings navigation')}
        onClick={() => { onClose(); trigger.current?.focus(); }}><X size={iconSizes.compact} /></IconButton>
    </div>
    <div className="settings-navigation-list scroll-region">
      {SETTINGS_GROUPS.map(group => <div key={group.id} className="settings-nav-group">
        <div className="settings-nav-heading">{group.label}</div>
        {group.items.map(item => <SidebarItem compact key={item.id} icon={<item.icon size={iconSizes.row} />}
          title={item.label} tooltip={item.label} active={navigation.selected === item.id} tabIndex={0}
          style={{ fontSize: 'var(--fs-label)' }}
          dataAttributes={{ role: 'button', 'aria-label': item.label, 'aria-current': navigation.selected === item.id ? 'page' : undefined }}
          onClick={() => select(item.id)} onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(item.id); }
          }} />)}
      </div>)}
    </div>
  </aside>;
}
