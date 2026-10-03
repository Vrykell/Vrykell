import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { usesCustomWindowControls } from '@platform/runtime';

const CONTROL_WIDTH = 46;

/** Custom window controls fill the titlebar to keep the top edge clickable. */
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const windowRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!usesCustomWindowControls) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let appWindow: Window;
    try {
      appWindow = getCurrentWindow();
      windowRef.current = appWindow;
    } catch {
      return;
    }

    const syncMaximized = async () => {
      try {
        const value = await appWindow.isMaximized();
        if (!disposed) setMaximized(value);
      } catch {
        // 浏览器预览环境没有窗口状态时保持默认图标。
      }
    };

    void syncMaximized();
    appWindow
      .onResized(() => { void syncMaximized(); })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      windowRef.current = null;
      unlisten?.();
    };
  }, []);

  const withWindow = useCallback((action: (appWindow: Window) => Promise<void>) => {
    let appWindow = windowRef.current;
    if (!appWindow) {
      try {
        appWindow = getCurrentWindow();
        windowRef.current = appWindow;
      } catch {
        return;
      }
    }
    void action(appWindow).catch(() => {});
  }, []);

  const minimize = useCallback(() => {
    withWindow((appWindow) => appWindow.minimize());
  }, [withWindow]);

  const toggleMaximize = useCallback(() => {
    withWindow(async (appWindow) => {
      await appWindow.toggleMaximize();
      try {
        setMaximized(await appWindow.isMaximized());
      } catch {
        // resize 事件会再次同步状态。
      }
    });
  }, [withWindow]);

  const close = useCallback(() => {
    withWindow((appWindow) => appWindow.close());
  }, [withWindow]);

  if (!usesCustomWindowControls) return null;

  const buttonStyle = {
    width: CONTROL_WIDTH,
    height: '100%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: 0,
    cursor: 'pointer',
    flexShrink: 0,
  } as const;

  return (
    <div
      data-testid="window-controls"
      style={{ display: 'flex', alignItems: 'stretch', alignSelf: 'stretch', height: '100%', flexShrink: 0 }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-testid="window-minimize"
        className="window-control-button"
        aria-label="最小化窗口"
        title="最小化"
        style={buttonStyle}
        onClick={minimize}
      >
        <Minus size={14} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        data-testid="window-maximize"
        className="window-control-button"
        aria-label={maximized ? '还原窗口' : '最大化窗口'}
        title={maximized ? '还原' : '最大化'}
        style={buttonStyle}
        onClick={toggleMaximize}
      >
        {maximized ? <Copy size={12} strokeWidth={1.5} /> : <Square size={12} strokeWidth={1.5} />}
      </button>
      <button
        type="button"
        data-testid="window-close"
        className="window-control-button"
        data-danger="true"
        aria-label="关闭窗口"
        title="关闭"
        style={buttonStyle}
        onClick={close}
      >
        <X size={15} strokeWidth={1.6} />
      </button>
    </div>
  );
}
