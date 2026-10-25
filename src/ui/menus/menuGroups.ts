/** Shared action order: primary actions, clipboard, editing, view, organization, removal. */
export const MENU_GROUPS = ['primary', 'clipboard', 'edit', 'view', 'organize', 'danger'] as const;
export type MenuGroup = typeof MENU_GROUPS[number];

export function flattenSingleSubmenu<Item extends { disabled?: boolean; submenu?: { items: Item[] } }>(items: Item[]): Item[] {
  return items.length === 1 && !items[0]!.disabled && items[0]!.submenu ? items[0]!.submenu.items : items;
}

export function menuGroup(item: { group?: MenuGroup; danger?: boolean }): MenuGroup {
  return item.danger ? 'danger' : item.group ?? 'primary';
}

export function orderMenuItems<T extends { group?: MenuGroup; danger?: boolean; order?: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => MENU_GROUPS.indexOf(menuGroup(left)) - MENU_GROUPS.indexOf(menuGroup(right))
    || (left.order ?? 0) - (right.order ?? 0));
}
