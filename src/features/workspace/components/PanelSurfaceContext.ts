import { createContext } from 'react';

export const PanelSurfaceContext = createContext<Record<'left' | 'right', (element: HTMLDivElement | null) => void> | null>(null);
