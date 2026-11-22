import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDockStore, useSessionStore, useUiStore } from '@features/workspace';

const native = vi.hoisted(() => ({
  macOS: true,
  fullscreen: false,
  resize: undefined as (() => void) | undefined,
  stop: vi.fn(),
  isFullscreen: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('@platform/runtime', () => ({
  get isMacOS() {
    return native.macOS;
  },
  usesCustomWindowControls: false,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: native.isFullscreen,
    onResized: (callback: () => void) => {
      native.resize = callback;
      return Promise.resolve(native.stop);
    },
  }),
}));

import TopDock from '../components/TopDock';
import SshResourcesAction from '../components/SshResourcesAction';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useTerminalStore } from '@features/terminal';
import { useAuxiliarySidebarStore } from '../stores/auxiliarySidebar';

beforeEach(() => {
  native.macOS = true;
  native.fullscreen = false;
  native.resize = undefined;
  native.isFullscreen.mockReset().mockImplementation(() => Promise.resolve(native.fullscreen));
  native.stop.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  useSessionStore.setState({ tabs: [], activeId: undefined });
  useDockStore.setState({ rightZone: ['chat'], rightPanels: [] });
  useUiStore.setState({ globalSearchOpen: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('desktop titlebar', () => {
  it('keeps resources out of the titlebar and opens them from the focused terminal action', () => {
    useWorkspaceNavigation.setState({ area: 'terminal' });
    useUiStore.setState({ settingsOpen: false });
    useSessionStore.getState().addTab({ kind: 'ssh', ssh: { connectionId: 'host', name: 'Host', host: 'test.local', user: 'ops' } });
    const { container } = render(
      <>
        <TopDock />
        <SshResourcesAction />
      </>,
    );
    const control = screen.getByRole('button', { name: 'SSH 资源面板' });
    expect(container.querySelector('.workspace-titlebar')?.contains(control)).toBe(false);
    fireEvent.click(control);
    expect(useAuxiliarySidebarStore.getState().requestedPane).toBeDefined();
    act(() => {
      useSessionStore.getState().addTab({ kind: 'local' });
      useTerminalStore.setState({ focusedPaneId: undefined });
    });
    expect(screen.queryByRole('button', { name: 'SSH 资源面板' })).toBeNull();
  });
  it('never adds a connection-panel action to the titlebar', () => {
    const previous = useWorkspaceNavigation.getState().area;
    useWorkspaceNavigation.setState({ area: 'ssh' });
    render(<TopDock />);
    expect(screen.queryByTestId('ssh-quick-btn')).toBeNull();
    expect(screen.queryByRole('button', { name: '连接面板' })).toBeNull();
    useWorkspaceNavigation.setState({ area: previous });
  });
  it('shows the trail pair only once the session has somewhere to go', () => {
    useWorkspaceNavigation.setState({ area: 'terminal', areaHistory: ['terminal'], areaHistoryIndex: 0 });
    render(<TopDock />);
    expect(screen.queryByTestId('workspace-history-back')).toBeNull();
    expect(screen.queryByTestId('workspace-history-forward')).toBeNull();
    act(() => {
      useWorkspaceNavigation.getState().selectArea('code');
      useWorkspaceNavigation.getState().selectArea('ssh');
    });
    const back = screen.getByTestId('workspace-history-back');
    const forward = screen.getByTestId('workspace-history-forward');
    expect(back).toBeEnabled();
    expect(forward).toBeDisabled();
    act(() => fireEvent.click(back));
    expect(useWorkspaceNavigation.getState().area).toBe('code');
    expect(forward).toBeEnabled();
    act(() => fireEvent.click(forward));
    expect(useWorkspaceNavigation.getState().area).toBe('ssh');
    expect(forward).toBeDisabled();
    act(() =>
      useWorkspaceNavigation.setState({ area: 'terminal', previousArea: 'terminal', areaHistory: ['terminal'], areaHistoryIndex: 0 }),
    );
  });
  it('hosts the tab strip slot in the row for tabbed areas and hides it elsewhere', () => {
    useWorkspaceNavigation.setState({ area: 'terminal', collapsed: false });
    useUiStore.setState({ settingsOpen: false });
    const { container } = render(<TopDock />);
    const slot = container.querySelector('header .workspace-instance-bar') as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.style.display).not.toBe('none');
    act(() => useWorkspaceNavigation.setState({ area: 'ssh' }));
    expect(slot.style.display).toBe('none');
    act(() => useWorkspaceNavigation.setState({ area: 'terminal' }));
    act(() => useUiStore.setState({ settingsOpen: true }));
    expect(slot.style.display).toBe('none');
    act(() => useUiStore.setState({ settingsOpen: false }));
  });
  it('uses the native-control layout and keeps search clickable', async () => {
    useWorkspaceNavigation.setState({ collapsed: false });
    const { container } = render(<TopDock />);
    const header = container.querySelector('header');
    expect(header).toHaveAttribute('data-platform', 'macos');
    expect(header).toHaveAttribute('data-fullscreen', 'false');
    // The area anchor stays out of the row while the sidebar already names the area.
    expect(screen.queryByText('终端会话')).toBeNull();
    act(() => useWorkspaceNavigation.setState({ collapsed: true }));
    expect(screen.getByText('终端会话')).toHaveAttribute('data-tauri-drag-region');
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('global-search-trigger'));
    expect(useUiStore.getState().globalSearchOpen).toBe(true);
    expect(screen.getByTestId('global-search-trigger').getAttribute('data-tip')).toContain('Meta+F');
    await waitFor(() => expect(native.resize).toBeDefined());
  });

  it('releases and restores the native-control reservation when fullscreen changes', async () => {
    const { container, unmount } = render(<TopDock />);
    const header = container.querySelector('header');
    await waitFor(() => expect(native.resize).toBeDefined());
    native.fullscreen = true;
    await act(async () => {
      native.resize?.();
    });
    expect(header).toHaveAttribute('data-fullscreen', 'true');
    native.fullscreen = false;
    await act(async () => {
      native.resize?.();
    });
    expect(header).toHaveAttribute('data-fullscreen', 'false');
    unmount();
    expect(native.stop).toHaveBeenCalledOnce();
  });

  it('keeps the normal layout and keyboard hint on other platforms', () => {
    native.macOS = false;
    const { container } = render(<TopDock />);
    expect(container.querySelector('header')).toHaveAttribute('data-platform', 'other');
    expect(screen.getByTestId('global-search-trigger').getAttribute('data-tip')).toContain('Control+F');
    expect(native.isFullscreen).not.toHaveBeenCalled();
  });

  it('preserves the windowed layout when native state is unavailable', async () => {
    native.isFullscreen.mockRejectedValue(new Error('No native window'));
    const { container } = render(<TopDock />);
    await waitFor(() => expect(native.isFullscreen).toHaveBeenCalledOnce());
    expect(container.querySelector('header')).toHaveAttribute('data-fullscreen', 'false');
  });
});
