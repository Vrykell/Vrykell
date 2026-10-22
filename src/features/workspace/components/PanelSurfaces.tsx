import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PANEL_DEFS, useDockStore } from '../stores/dock';
import { PanelSurfaceContext } from './PanelSurfaceContext';
import { DockPanel } from './SidePanel';

/** Moving a panel reparents its existing DOM host without recreating feature state. */
export default function PanelSurfaces({ children }: { children: ReactNode }) {
  const [left, setLeft] = useState<HTMLDivElement | null>(null);
  const [right, setRight] = useState<HTMLDivElement | null>(null);
  const [parking, setParking] = useState<HTMLDivElement | null>(null);
  const context = useMemo(() => ({ left: setLeft, right: setRight }), []);
  const leftZone = useDockStore(state => state.leftZone);
  const leftPanels = useDockStore(state => state.leftPanels);
  const rightPanels = useDockStore(state => state.rightPanels);
  const [hosts] = useState(() => Object.fromEntries(Object.keys(PANEL_DEFS).map(id => {
    const host = document.createElement('div'); host.className = 'workspace-panel-host'; return [id, host];
  })));
  const [visited, setVisited] = useState<string[]>([]);
  const mounted = [...new Set([...visited, ...leftPanels, ...rightPanels])];
  useLayoutEffect(() => {
    const added = [...leftPanels, ...rightPanels].filter(id => !visited.includes(id));
    if (added.length) setVisited(previous => [...new Set([...previous, ...added])]);
  }, [leftPanels, rightPanels, visited]);
  useLayoutEffect(() => {
    for (const [id, host] of Object.entries(hosts)) {
      const target = (leftZone.includes(id) ? left : right) ?? parking;
      if (target && host.parentElement !== target) target.appendChild(host);
    }
  }, [hosts, leftZone, left, right, parking]);
  useLayoutEffect(() => () => Object.values(hosts).forEach(host => host.remove()), [hosts]);
  return <PanelSurfaceContext.Provider value={context}>
    {children}
    <div hidden ref={setParking} />
    {mounted.filter(id => hosts[id]).map(id => createPortal(<DockPanel panelId={id} side={leftZone.includes(id) ? 'left' : 'right'}
      visible={leftPanels.includes(id) || rightPanels.includes(id)} />, hosts[id]!, id))}
  </PanelSurfaceContext.Provider>;
}
