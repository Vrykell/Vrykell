import { iconColorKey, iconColorCss, type IconColors } from '@config/iconColors';
import type { Tab } from './session/store';

export function tabIconKey(tab: Pick<Tab, 'id' | 'kind'>): string {
  return iconColorKey(tab.kind === 'session' ? 'session' : 'page', tab.kind === 'session' ? tab.id : tab.kind);
}

export function tabIconColor(tab: Pick<Tab, 'id' | 'kind'>, colors: IconColors): string | undefined {
  return iconColorCss(colors[tabIconKey(tab)]);
}
