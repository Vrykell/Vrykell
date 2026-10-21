import { useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import HarnessWorkspace from './HarnessWorkspace';
import PanelChat from './PanelChat';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { AiSurfaceContext as SurfaceContext } from './NativeConversationSurface';

type Placement = 'main' | 'side';

/** Only the native conversation moves; connected sessions and their tabs stay in the workspace. */
export function AiWorkspaceProvider({ placement, mainActive, headerActive, sideActive, children }: {
  placement: Placement; mainActive: boolean; headerActive: boolean; sideActive: boolean; children: ReactNode;
}) {
  const [main, setMain] = useState<HTMLDivElement | null>(null);
  const [side, setSide] = useState<HTMLDivElement | null>(null);
  const [native, setNative] = useState<HTMLDivElement | null>(null);
  const [parking, setParking] = useState<HTMLDivElement | null>(null);
  const [host] = useState(() => { const element = document.createElement('div'); element.className = 'ai-workspace-host'; return element; });
  const [conversationHost] = useState(() => { const element = document.createElement('div'); element.className = 'ai-native-surface'; return element; });
  const context = useMemo(() => ({ main: setMain, side: setSide, native: setNative }), []);
  const nativeTabs = useAiWorkspace(state => state.nativeTabs);
  const selected = useAiWorkspace(state => state.selected);
  const nativeSelected = useChatStore(state => state.activeConversationId);
  const [visited, setVisited] = useState(nativeTabs.length > 0 || sideActive);
  useEffect(() => { if (nativeTabs.length || sideActive) setVisited(true); }, [nativeTabs.length, sideActive]);
  useEffect(() => { if (placement === 'side' && sideActive && nativeSelected) useAiWorkspace.getState().ensureNative(nativeSelected); }, [placement, sideActive, nativeSelected]);
  useLayoutEffect(() => {
    const container = main ?? parking;
    if (container) container.appendChild(host);
    return () => { host.remove(); };
  }, [host, main, parking]);
  const target = placement === 'side' ? side : native;
  useLayoutEffect(() => {
    (target ?? parking)?.appendChild(conversationHost);
    return () => { conversationHost.remove(); };
  }, [conversationHost, target, parking]);
  const nativeActive = placement === 'side' ? sideActive : mainActive && selected === `chat:${nativeSelected}`;
  return <SurfaceContext.Provider value={context}>
    {children}
    <div hidden ref={setParking} />
    {createPortal(<HarnessWorkspace active={mainActive} headerActive={headerActive} />, host)}
    {visited && createPortal(<PanelChat active={nativeActive} workspace={placement === 'main'} />, conversationHost)}
  </SurfaceContext.Provider>;
}

export default function AiWorkspaceSurface({ placement }: { placement: Placement }) {
  const context = useContext(SurfaceContext);
  return <div className="ai-workspace-surface" ref={context?.[placement]} data-testid={`ai-surface-${placement}`} />;
}
