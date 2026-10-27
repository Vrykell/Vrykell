import { useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { memoLocalized } from '@ui/hooks/memoLocalized';
import { createPortal } from 'react-dom';
import ResourceContent from '@ui/layout/ResourceContent';
import HarnessWorkspace from './HarnessWorkspace';
import PanelChat from './PanelChat';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { AiSurfaceContext as SurfaceContext } from './NativeConversationSurface';
import AiSidebar from './AiSidebar';
import { SidebarSettingsContext } from './SidebarSettingsContext';

const StableHarnessWorkspace = memoLocalized(HarnessWorkspace);
const StablePanelChat = memoLocalized(PanelChat);

type Placement = 'main' | 'side';

/** Content owners stay mounted while their visible slots move between surfaces. */
export function AiWorkspaceProvider({ mainActive, headerActive, sideActive, children }: {
  mainActive: boolean; headerActive: boolean; sideActive: boolean; children: ReactNode;
}) {
  const [main, setMain] = useState<HTMLDivElement | null>(null);
  const [side, setSide] = useState<HTMLDivElement | null>(null);
  const [native, setNative] = useState<HTMLDivElement | null>(null);
  const [parking, setParking] = useState<HTMLDivElement | null>(null);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [sidebarSettingsTarget, setSidebarSettingsTarget] = useState<HTMLDivElement | null>(null);
  const [settingsSuspended, setSettingsSuspended] = useState(false);
  const [host] = useState(() => { const element = document.createElement('div'); element.className = 'ai-workspace-host'; return element; });
  const context = useMemo(() => ({ main: setMain, side: setSide, native: setNative, toolbar: setToolbar }), []);
  const nativeTabs = useAiWorkspace(state => state.nativeTabs);
  const selected = useAiWorkspace(state => state.selected);
  const sideSelected = useAiWorkspace(state => state.sideSelected);
  const sidebarSettings = useMemo(() => ({ resourceId: sideActive ? sideSelected : '', target: sidebarSettingsTarget, suspend: setSettingsSuspended }), [sideActive, sideSelected, sidebarSettingsTarget]);
  const nativeSelected = useChatStore(state => state.activeConversationId);
  useLayoutEffect(() => {
    const container = main ?? parking;
    if (container) container.appendChild(host);
    return () => { host.remove(); };
  }, [host, main, parking]);
  const target = native;
  const nativeActive = mainActive && selected === `chat:${nativeSelected}`;
  const mountedNativeIds = [...new Set([...nativeTabs, ...(sideSelected.startsWith('chat:') ? [sideSelected.slice(5)] : [])])].sort();
  return <SidebarSettingsContext.Provider value={sidebarSettings}><SurfaceContext.Provider value={context}>
    {children}
    <div hidden ref={setParking} />
    {createPortal(<StableHarnessWorkspace active={mainActive} headerActive={headerActive} />, host)}
    {side && createPortal(<AiSidebar active={sideActive} onSettingsTarget={setSidebarSettingsTarget} settingsSuspended={settingsSuspended} />, side)}
    {mountedNativeIds.map(id => <ResourceContent key={id} id={`chat:${id}`} defer active={nativeActive && id === nativeSelected} fallbackTarget={id === nativeSelected ? target ?? parking : parking}>
      {state => <StablePanelChat conversationId={id} active={state.visible} workspace toolbarTarget={state.placed ? state.header ?? (state.retainsHeader && state.focused ? toolbar : null) : id === nativeSelected ? toolbar : null} />}
    </ResourceContent>)}
  </SurfaceContext.Provider></SidebarSettingsContext.Provider>;
}

export default function AiWorkspaceSurface({ placement }: { placement: Placement }) {
  const context = useContext(SurfaceContext);
  return <div className="ai-workspace-surface" ref={context?.[placement]} data-testid={`ai-surface-${placement}`} />;
}
