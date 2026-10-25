import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceHeaderScope } from '@ui/layout/WorkspaceHeader';

interface Placement { target: HTMLElement; visible: boolean; focused: boolean; toolbarTarget?: HTMLElement | null; retainHeader?: boolean }
const ContentContext = createContext<{ slots: Map<string, Placement>; register: (id: string, placement: Placement) => () => void } | null>(null);

export function ResourceContentProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState(new Map<string, Placement>());
  const register = useCallback((id: string, placement: Placement) => {
    setSlots(previous => new Map(previous).set(id, placement));
    return () => setSlots(previous => {
      if (previous.get(id) !== placement) return previous;
      const next = new Map(previous); next.delete(id); return next;
    });
  }, []);
  const context = useMemo(() => ({ slots, register }), [slots, register]);
  return <ContentContext.Provider value={context}>{children}</ContentContext.Provider>;
}

export function ResourceContentSlot({ id, visible, focused, toolbarTarget, retainHeader }: { id: string; visible: boolean; focused: boolean; toolbarTarget?: HTMLElement | null; retainHeader?: boolean }) {
  const register = useContext(ContentContext)?.register;
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!register || !target || !visible) return;
    return register(id, { target, visible, focused, toolbarTarget, retainHeader });
  }, [id, register, target, visible, focused, toolbarTarget, retainHeader]);
  return <div className="resource-content-slot" ref={setTarget} />;
}

/** Move one mounted resource between surfaces without recreating its stateful owner. */
export default function ResourceContent({ id, active, fallbackTarget, children }: {
  id: string; active: boolean; fallbackTarget?: HTMLElement | null;
  children: (state: { visible: boolean; focused: boolean; placed: boolean; header: HTMLElement | null; retainsHeader: boolean }) => ReactNode;
}) {
  const slot = useContext(ContentContext)?.slots.get(id);
  const placed = !!slot?.visible;
  const visible = placed || active;
  const focused = placed ? !!slot?.focused : active;
  const [parking, setParking] = useState<HTMLDivElement | null>(null);
  const header = placed && focused ? slot.toolbarTarget ?? null : null;
  const [host] = useState(() => { const element = document.createElement('div'); element.className = 'resource-content-host'; return element; });
  const target = placed ? slot.target : fallbackTarget ?? parking;
  useLayoutEffect(() => {
    target?.appendChild(host);
    return () => host.remove();
  }, [host, target]);
  useLayoutEffect(() => { host.style.display = visible ? 'flex' : 'none'; host.inert = !visible; }, [host, visible]);
  return <><div className="resource-content-parking" ref={setParking} />{createPortal(<WorkspaceHeaderScope enabled={placed && !slot?.retainHeader} target={header}>
    {children({ visible, focused, placed, header, retainsHeader: placed && !!slot?.retainHeader })}
  </WorkspaceHeaderScope>, host)}</>;
}
