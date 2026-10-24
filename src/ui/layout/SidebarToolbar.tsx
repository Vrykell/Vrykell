import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { iconSizes, Search } from '@ui/icons';
import { TextInput } from '@ui/fields/TextInput';

/** Sidebar search and actions share the same spacing and input treatment. */
export default function SidebarToolbar({ search, children }: {
  search: ComponentPropsWithoutRef<'input'> & { [key: `data-${string}`]: string | number | boolean | undefined };
  children?: ReactNode;
}) {
  return <div className="workspace-sidebar-toolbar">
    <div className="workspace-sidebar-search">
      <Search size={iconSizes.compact} />
      <TextInput {...search} />
    </div>
    {children}
  </div>;
}
