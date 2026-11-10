import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const win = vi.hoisted(() => ({
  isMaximized: vi.fn(), isFullscreen: vi.fn(), isResizable: vi.fn(), isMaximizable: vi.fn(), isMinimizable: vi.fn(), isAlwaysOnTop: vi.fn(),
  toggleMaximize: vi.fn(), startDragging: vi.fn(), startResizeDragging: vi.fn(), minimize: vi.fn(), setAlwaysOnTop: vi.fn(), close: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));
vi.mock('@platform/runtime', () => ({ usesCustomWindowControls: true, isMacOS: false }));
import WindowMenu from '../components/WindowMenu';

beforeEach(() => {
  vi.resetAllMocks();
  for (const method of Object.values(win)) method.mockResolvedValue(undefined);
  win.isMaximized.mockResolvedValue(false); win.isFullscreen.mockResolvedValue(false);
  win.isResizable.mockResolvedValue(true); win.isMaximizable.mockResolvedValue(true); win.isMinimizable.mockResolvedValue(true);
  win.isAlwaysOnTop.mockResolvedValue(false);
});
afterEach(() => vi.restoreAllMocks());
function mount() {
  const ref = createRef<HTMLElement>();
  render(<><header ref={ref}><span>Title</span><button onClick={vi.fn()}>Search</button></header><WindowMenu titlebar={ref} /></>);
  return () => fireEvent.contextMenu(screen.getByText('Title'), { clientX: 30, clientY: 20 });
}
it('uses the shared menu and dispatches all window actions through the native owner', async () => {
  const open = mount();
  for (const [label, method] of [['移动窗口', win.startDragging], ['调整窗口大小', win.startResizeDragging], ['最小化窗口', win.minimize], ['最大化窗口', win.toggleMaximize], ['关闭窗口', win.close]] as const) {
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(label) }));
    expect(method).toHaveBeenCalledOnce();
  }
  expect(win.startResizeDragging).toHaveBeenCalledWith('SouthEast');
  open();
  fireEvent.click(await screen.findByRole('menuitemradio', { name: '置于顶层' }));
  expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
});
it('disables unavailable actions, reads pin state and preserves interactive titlebar controls', async () => {
  win.isMaximized.mockResolvedValue(true); win.isAlwaysOnTop.mockResolvedValue(true);
  const open = mount();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Search' }));
  expect(screen.queryByRole('menu')).toBeNull();
  open();
  const restore = await screen.findByRole('menuitem', { name: '还原窗口' });
  expect(screen.getByRole('menu')).toHaveClass('context-menu-surface');
  expect(screen.getByRole('menuitem', { name: '移动窗口' })).toBeDisabled();
  expect(screen.getByRole('menuitem', { name: '调整窗口大小' })).toBeDisabled();
  expect(screen.getByRole('menuitem', { name: '最大化窗口' })).toBeDisabled();
  expect(screen.getByRole('menuitemradio', { name: '置于顶层' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(restore);
  expect(win.toggleMaximize).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});
it('opens when the application capture handler has suppressed the native context menu', async () => {
  const open = mount();
  const preventNative = (event: Event) => event.preventDefault();
  window.addEventListener('contextmenu', preventNative, true);
  try {
    open();
    expect(await screen.findByRole('menu', { name: '窗口操作' })).toBeVisible();
  } finally { window.removeEventListener('contextmenu', preventNative, true); }
});
