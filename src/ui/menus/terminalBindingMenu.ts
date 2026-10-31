import { t } from '@i18n';
import type { ContextMenuItem } from './ContextMenu';

export interface TerminalBindingOption {
  /** Pane id of a live terminal. */
  id: string;
  label: string;
  description?: string;
  live: boolean;
}

export interface TerminalBindingMenu {
  /** The bound pane, or null when the panel follows the focused terminal. */
  value: string | null;
  options: TerminalBindingOption[];
  onSelect: (paneId: string | null) => void;
}

/** Shared submenu for panels that can follow one terminal instead of the focused pane. */
export function terminalBindingMenuItem(menu: TerminalBindingMenu): ContextMenuItem {
  const live = menu.options.filter(option => option.live);
  return {
    label: t('Bind terminal'),
    group: 'view',
    submenu: {
      items: [
        {
          label: t('Follow the focused terminal'),
          checked: menu.value === null,
          onClick: () => menu.onSelect(null),
        },
        ...(live.length
          ? live.map(option => ({
            label: option.label,
            tip: option.description,
            checked: menu.value === option.id,
            onClick: () => menu.onSelect(option.id),
          }))
          : [{ label: t('No active terminals'), disabled: true }]),
      ],
    },
  };
}
