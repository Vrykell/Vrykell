import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import SidebarItem from '@ui/sidebarItem';
import { IconButton } from '@ui/IconButton';
import { TextInput } from '@ui/TextInput';
import { Search, iconSizes } from '@ui/icons';
import { SETTINGS_GROUPS, type useSettingsNavigation, type PageId } from '../hooks/useSettingsNavigation';

/** Settings navigation remains beside the page and folds into an icon rail when space is limited. */
export default function SettingsNavigation({ navigation }: { navigation: ReturnType<typeof useSettingsNavigation> }) {
  const { selected, setSelected, query, setQuery, normalizedQuery, matchingSettings, visibleGroups } = navigation;
  const ref = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pages = SETTINGS_GROUPS.flatMap(group => group.items);
  const select = (page: PageId) => { setSelected(page); setOpen(false); };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  return <aside ref={ref} className="settings-navigation" data-search-open={open} data-searching={Boolean(normalizedQuery)}
    onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.preventDefault(); event.stopPropagation();
        if (trigger.current && getComputedStyle(trigger.current).display !== 'none') trigger.current.focus();
        else search.current?.focus();
        setOpen(false);
      } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && event.target instanceof Element
        && event.target.closest('.settings-search-results')) {
        event.preventDefault(); event.stopPropagation();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.settings-search-results button:not(:disabled)')];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
    <div className="settings-navigation-tools">
      <IconButton ref={trigger} className="settings-search-trigger" aria-label={t('Search settings…')}
        data-tip={t('Search settings…')} aria-expanded={open} onClick={() => {
          setOpen(true); requestAnimationFrame(() => search.current?.focus());
        }}><Search size={iconSizes.control} /></IconButton>
      <div className="settings-navigation-search">
        <Search size={iconSizes.compact} aria-hidden="true" />
        <TextInput ref={search} aria-label={t('Search settings…')} placeholder={t('Search settings…')} value={query}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onChange={event => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' && normalizedQuery) {
              event.preventDefault(); setOpen(true);
              requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('.settings-search-results button')?.focus());
            }
          }} />
      </div>
    </div>
    <div className="settings-search-results scroll-region">
      {matchingSettings.map(setting => <button key={setting.id} className="settings-search-result" onClick={() => {
        setting.onSelect(); setQuery(''); setOpen(false);
      }}>
        <span>{setting.label}</span>
        <small>{pages.find(item => item.id === setting.page)?.label ?? navigation.activeLabel} · {setting.desc}</small>
      </button>)}
      {!matchingSettings.length && visibleGroups.flatMap(group => group.items).map(item =>
        <button key={item.id} className="settings-search-result" onClick={() => select(item.id)}>{item.label}</button>)}
      {!matchingSettings.length && !visibleGroups.length && <div className="settings-search-empty">{t('No matching settings')}</div>}
    </div>
    <div className="settings-navigation-list scroll-region">
      {SETTINGS_GROUPS.map(group => <div key={group.id} className="settings-nav-group">
        <div className="settings-nav-heading">{group.label}</div>
        {group.items.map(item => <SidebarItem compact key={item.id} icon={<item.icon size={iconSizes.row} />}
          title={item.label} tooltip={item.label} active={selected === item.id} tabIndex={0}
          style={{ fontSize: 'var(--fs-label)' }}
          dataAttributes={{ role: 'button', 'aria-label': item.label, 'aria-current': selected === item.id ? 'page' : undefined }}
          onClick={() => select(item.id)} onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(item.id); }
          }} />)}
      </div>)}
    </div>
  </aside>;
}
