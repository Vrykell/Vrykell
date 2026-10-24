import { t } from '@i18n';
import SidebarItem from '@ui/sidebarItem';
import { iconSizes } from '@ui/icons';
import type { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { useListNavigationMode } from '@ui/hooks/useListNavigationMode';

/** The content-card settings directory stays visible at every supported window size. */
export default function SettingsNavigation({ navigation }: { navigation: ReturnType<typeof useSettingsNavigation> }) {
  const input = useListNavigationMode(true);
  return <aside {...input.props} id="settings-navigation" aria-label={t('Settings navigation')} className="settings-navigation">
    <div className="settings-navigation-title">{t('Settings')}</div>
    <div className="settings-navigation-list scroll-region">
      {navigation.groups.map(group => <div key={group.id} className="settings-nav-group">
        <div className="settings-nav-heading">{group.label}</div>
        {group.items.map(item => <SidebarItem compact key={item.id} icon={<item.icon size={iconSizes.row} />}
          title={item.label} tooltip={item.label} active={navigation.selected === item.id} tabIndex={0}
          style={{ fontSize: 'var(--fs-label)' }}
          dataAttributes={{ role: 'button', 'aria-label': item.label, 'aria-current': navigation.selected === item.id ? 'page' : undefined }}
          onClick={() => navigation.setSelected(item.id)} onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigation.setSelected(item.id); }
          }} />)}
      </div>)}
    </div>
  </aside>;
}
