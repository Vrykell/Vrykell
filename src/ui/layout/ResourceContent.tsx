import { createContext, useCallback, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceHeaderScope } from '@ui/layout/WorkspaceHeader';
import { createResourcePlacements } from './resourcePlacements';

const ContentContext = createContext<ReturnType<typeof createResourcePlacements> | null>(null);
const emptySnapshot = () => undefined;
const emptySubscription = () => () => {};

export function ResourceContentProvider({ children }: { children: ReactNode }) {
  const [placements] = useState(createResourcePlacements);
  return <ContentContext.Provider value={placements}>{children}</ContentContext.Provider>;
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
export default function ResourceContent({ id, active, fallbackTarget, defer = false, children }: {
  id: string; active: boolean; fallbackTarget?: HTMLElement | null; defer?: boolean;
  children: (state: { visible: boolean; focused: boolean; placed: boolean; header: HTMLElement | null; retainsHeader: boolean }) => ReactNode;
}) {
  const placements = useContext(ContentContext);
  const subscribe = useCallback((listener: () => void) => placements ? placements.subscribe(id, listener) : emptySubscription(), [placements, id]);
  const getSnapshot = useCallback(() => placements?.get(id), [placements, id]);
  const slot = useSyncExternalStore(subscribe, getSnapshot, emptySnapshot);
  const placed = !!slot?.visible;
  const visible = placed || active;
  const [visited, setVisited] = useState(false);
  useLayoutEffect(() => { if (visible) setVisited(true); }, [visible]);
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
    {(!defer || visible || visited) && children({ visible, focused, placed, header, retainsHeader: placed && !!slot?.retainHeader })}
  </WorkspaceHeaderScope>, host)}</>;
}
