import { iconColorKey, iconColorCss, type IconColors } from '@config/iconColors';
import type { Tab } from './session/store';

export function tabIconKey(tab: Pick<Tab, 'id' | 'kind'>): string {
  return iconColorKey('session', tab.id);
}

export function tabIconColor(tab: Pick<Tab, 'id' | 'kind'> & { groupId?: string }, colors: IconColors): string | undefined {
  return tab.kind === 'session' ? iconColorCss(colors[tabIconKey(tab)]) : undefined;
}
