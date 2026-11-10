import { useEffect, useRef, useState, type RefObject } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { usesCustomWindowControls } from '@platform/runtime';
import { diagnostic } from '@platform/diagnostics';
import { t } from '@i18n';

interface WindowState {
  anchor: MenuAnchor;
  maximized: boolean;
  fullscreen: boolean;
  resizable: boolean;
  maximizable: boolean;
  minimizable: boolean;
  pinned: boolean;
}

/** Titlebar actions share the same menu surface as workspace actions. */
export default function WindowMenu({ titlebar }: { titlebar: RefObject<HTMLElement | null> }) {
  const [state, setState] = useState<WindowState | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const element = titlebar.current;
    if (!element || !usesCustomWindowControls) return;
    const open = (event: MouseEvent) => {
      if (!(event.target instanceof Element)
        || event.target.closest('button, input, textarea, a, [role="menu"]')) return;
      event.preventDefault();
      const version = ++generation.current;
      const anchor = { x: event.clientX, y: event.clientY };
      let win: ReturnType<typeof getCurrentWindow>;
      try { win = getCurrentWindow(); } catch { return; }
      void Promise.all([win.isMaximized(), win.isFullscreen(), win.isResizable(), win.isMaximizable(), win.isMinimizable(), win.isAlwaysOnTop()])
        .then(([maximized, fullscreen, resizable, maximizable, minimizable, pinned]) => {
          if (generation.current === version) setState({ anchor, maximized, fullscreen, resizable, maximizable, minimizable, pinned });
        }).catch(error => diagnostic('window-menu-state-error', { error }, 'warn'));
    };
    element.addEventListener('contextmenu', open);
    return () => { generation.current++; element.removeEventListener('contextmenu', open); };
  }, [titlebar]);
  if (!state) return null;
  const act = (action: () => Promise<void>) => {
    void action().catch(error => diagnostic('window-menu-action-error', { error }, 'warn'));
  };
  const win = getCurrentWindow();
  return <ContextMenu anchor={state.anchor} itemRole="menuitem" label={t('Window actions')} onClose={() => { generation.current++; setState(null); }} items={[
    { label: t('Restore window'), disabled: !state.maximized || state.fullscreen, onClick: () => act(() => win.toggleMaximize()) },
    { label: t('Move window'), disabled: state.maximized || state.fullscreen, onClick: () => act(() => win.startDragging()) },
    { label: t('Resize window'), disabled: !state.resizable || state.maximized || state.fullscreen, onClick: () => act(() => win.startResizeDragging('SouthEast')) },
    { label: t('Minimize window'), disabled: !state.minimizable, onClick: () => act(() => win.minimize()) },
    { label: t('Maximize window'), disabled: !state.maximizable || state.maximized || state.fullscreen, onClick: () => act(() => win.toggleMaximize()) },
    { label: t('Always on top'), group: 'view', checked: state.pinned, onClick: () => act(() => win.setAlwaysOnTop(!state.pinned)) },
    { label: t('Close window'), group: 'danger', shortcut: 'Alt+F4', onClick: () => act(() => win.close()) },
  ]} />;
}
