import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const HeaderTarget = createContext<HTMLElement | null | undefined>(undefined);

/** Feature headers keep their existing actions while occupying one shared instance strip. */
export function WorkspaceHeaderProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return <HeaderTarget.Provider value={target}>
    <div className="workspace-instance-bar" data-testid="workspace-instance-bar" ref={setTarget} />
    {children}
  </HeaderTarget.Provider>;
}

export default function WorkspaceHeader({ active = true, children }: { active?: boolean; children: ReactNode }) {
  const target = useContext(HeaderTarget);
  const [parking, setParking] = useState<HTMLDivElement | null>(null);
  const [host] = useState(() => { const element = document.createElement('div'); element.className = 'workspace-header-surface'; return element; });
  useLayoutEffect(() => {
    if (target === undefined) return;
    const container = active && target ? target : parking;
    if (container) container.appendChild(host);
    return () => { host.remove(); };
  }, [active, host, parking, target]);
  if (target === undefined) return children;
  return <><div hidden ref={setParking} />{createPortal(children, host)}</>;
}
