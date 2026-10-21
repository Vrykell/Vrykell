import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import HarnessWorkspace from './HarnessWorkspace';

type Placement = 'main' | 'side';
const SurfaceContext = createContext<{ main: (element: HTMLDivElement | null) => void; side: (element: HTMLDivElement | null) => void } | null>(null);

/** A stable portal host moves between slots without remounting streams or transcript readers. */
export function AiWorkspaceProvider({ placement, mainActive, headerActive, sideActive, children }: {
  placement: Placement; mainActive: boolean; headerActive: boolean; sideActive: boolean; children: ReactNode;
}) {
  const [main, setMain] = useState<HTMLDivElement | null>(null);
  const [side, setSide] = useState<HTMLDivElement | null>(null);
  const [parking, setParking] = useState<HTMLDivElement | null>(null);
  const [host] = useState(() => { const element = document.createElement('div'); element.className = 'ai-workspace-host'; return element; });
  const context = useMemo(() => ({ main: setMain, side: setSide }), []);
  const target = placement === 'main' ? main : side;
  useLayoutEffect(() => {
    const container = target ?? parking;
    if (container) container.appendChild(host);
    return () => { host.remove(); };
  }, [host, target, parking]);
  const active = placement === 'main' ? mainActive : sideActive;
  return <SurfaceContext.Provider value={context}>
    {children}
    <div hidden ref={setParking} />
    {createPortal(<HarnessWorkspace active={active} headerActive={placement === 'main' && headerActive} docked={placement === 'side'} />, host)}
  </SurfaceContext.Provider>;
}

export default function AiWorkspaceSurface({ placement }: { placement: Placement }) {
  const context = useContext(SurfaceContext);
  return <div className="ai-workspace-surface" ref={context?.[placement]} data-testid={`ai-surface-${placement}`} />;
}
