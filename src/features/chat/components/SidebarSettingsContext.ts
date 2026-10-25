import { createContext } from 'react';

export const SidebarSettingsContext = createContext<{
  resourceId: string; target: HTMLElement | null; suspend: (suspended: boolean) => void;
} | null>(null);
