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
  get isMacOS() { return native.macOS; },
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

beforeEach(() => {
  native.macOS = true;
  native.fullscreen = false;
  native.resize = undefined;
  native.isFullscreen.mockReset().mockImplementation(() => Promise.resolve(native.fullscreen));
  native.stop.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useSessionStore.setState({ tabs: [], activeId: undefined });
  useDockStore.setState({ rightZone: ['chat'], rightPanels: [] });
  useUiStore.setState({ globalSearchOpen: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('desktop titlebar', () => {
  it('uses the native-control layout and keeps search clickable', async () => {
    const { container } = render(<TopDock />);
    const header = container.querySelector('header');
    expect(header).toHaveAttribute('data-platform', 'macos');
    expect(header).toHaveAttribute('data-fullscreen', 'false');
    expect(screen.getByText('终端工作区')).toHaveAttribute('data-tauri-drag-region');
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('global-search-trigger'));
    expect(useUiStore.getState().globalSearchOpen).toBe(true);
    expect(screen.getByLabelText('Meta+F')).toBeVisible();
    await waitFor(() => expect(native.resize).toBeDefined());
  });

  it('releases and restores the native-control reservation when fullscreen changes', async () => {
    const { container, unmount } = render(<TopDock />);
    const header = container.querySelector('header');
    await waitFor(() => expect(native.resize).toBeDefined());
    native.fullscreen = true;
    await act(async () => { native.resize?.(); });
    expect(header).toHaveAttribute('data-fullscreen', 'true');
    native.fullscreen = false;
    await act(async () => { native.resize?.(); });
    expect(header).toHaveAttribute('data-fullscreen', 'false');
    unmount();
    expect(native.stop).toHaveBeenCalledOnce();
  });

  it('keeps the normal layout and keyboard hint on other platforms', () => {
    native.macOS = false;
    const { container } = render(<TopDock />);
    expect(container.querySelector('header')).toHaveAttribute('data-platform', 'other');
    expect(screen.getByLabelText('Control+F')).toBeVisible();
    expect(native.isFullscreen).not.toHaveBeenCalled();
  });

  it('preserves the windowed layout when native state is unavailable', async () => {
    native.isFullscreen.mockRejectedValue(new Error('No native window'));
    const { container } = render(<TopDock />);
    await waitFor(() => expect(native.isFullscreen).toHaveBeenCalledOnce());
    expect(container.querySelector('header')).toHaveAttribute('data-fullscreen', 'false');
  });
});
