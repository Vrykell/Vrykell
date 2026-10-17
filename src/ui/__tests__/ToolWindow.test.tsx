import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ToolWindow from '../ToolWindow';
import { t } from '@i18n';
const api = vi.hoisted(() => ({ minimize: vi.fn(), pin: vi.fn(), drag: vi.fn(), active: vi.fn(), minimized: vi.fn(), stop: vi.fn(), focus: null as null | ((event: { payload: boolean }) => void) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  minimize: api.minimize, setAlwaysOnTop: api.pin, startDragging: api.drag,
  isFocused: api.active, isMinimized: api.minimized,
  onFocusChanged: vi.fn(async (handler: typeof api.focus) => { api.focus = handler; return api.stop; }),
  onCloseRequested: vi.fn(async () => api.stop),
}) }));
beforeEach(() => { vi.clearAllMocks(); api.focus = null; api.active.mockResolvedValue(false); api.minimized.mockResolvedValue(false); api.minimize.mockResolvedValue(undefined); api.pin.mockResolvedValue(undefined); api.drag.mockResolvedValue(undefined); });
it('starts unpinned and minimizes on blur without closing or clearing its editor', async () => {
  const close = vi.fn();
  render(<ToolWindow label="AI tool" onClose={close} footer={<button>Generate</button>}><input aria-label="Draft" defaultValue="Keep this" /></ToolWindow>);
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false');
  expect(screen.getByRole('button', { name: t('Pin window') })).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(api.focus).not.toBeNull());
  act(() => api.focus?.({ payload: false }));
  await waitFor(() => expect(api.minimize).toHaveBeenCalledOnce()); expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toHaveValue('Keep this');
});
it('only keeps the window on top after pinning and resumes blur minimization after unpinning', async () => {
  render(<ToolWindow label="AI tool" onClose={vi.fn()} footer={null}><input /></ToolWindow>);
  const icon = screen.getByRole('button', { name: t('Pin window') }).innerHTML;
  fireEvent.click(screen.getByRole('button', { name: t('Pin window') }));
  await screen.findByRole('button', { name: t('Unpin window') });
  expect(api.pin).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('button', { name: t('Unpin window') }).innerHTML).not.toBe(icon);
  expect(screen.getByRole('button', { name: t('Unpin window') })).toHaveAttribute('data-tone', 'neutral');
  act(() => api.focus?.({ payload: false })); expect(api.minimize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('Unpin window') }));
  await screen.findByRole('button', { name: t('Pin window') });
  act(() => api.focus?.({ payload: false })); await waitFor(() => expect(api.minimize).toHaveBeenCalledOnce());
});
it('does not minimize on a temporary blur during native dragging or send duplicate drag calls', async () => {
  let end!: () => void;
  api.drag.mockImplementation(() => new Promise<void>(resolve => { end = resolve; }));
  render(<ToolWindow label="AI tool" onClose={vi.fn()} footer={<button>Apply</button>}><input aria-label="Draft" defaultValue="Preserved" /></ToolWindow>);
  await waitFor(() => expect(api.focus).not.toBeNull());
  const heading = screen.getByTestId('tool-window-heading');
  fireEvent.mouseDown(heading, { button: 0 }); fireEvent.mouseDown(heading, { button: 0 });
  act(() => api.focus?.({ payload: false }));
  expect(api.drag).toHaveBeenCalledOnce(); expect(api.minimize).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toHaveValue('Preserved');
  await act(async () => end());
  act(() => api.focus?.({ payload: false })); await waitFor(() => expect(api.minimize).toHaveBeenCalledOnce());
});

it('keeps a taskbar-restored window visible through transient blur and stale focus notifications', async () => {
  render(<ToolWindow label="AI tool" onClose={vi.fn()} footer={null}><input defaultValue="Draft" /></ToolWindow>);
  await waitFor(() => expect(api.focus).not.toBeNull());
  act(() => { api.focus?.({ payload: true }); api.focus?.({ payload: false }); api.focus?.({ payload: true }); });
  await new Promise(resolve => setTimeout(resolve, 260));
  expect(api.minimize).not.toHaveBeenCalled();
  api.active.mockResolvedValue(true);
  act(() => api.focus?.({ payload: false }));
  await waitFor(() => expect(api.active).toHaveBeenCalled());
  expect(api.minimize).not.toHaveBeenCalled();
  api.active.mockResolvedValue(false); api.minimized.mockResolvedValue(true);
  act(() => api.focus?.({ payload: false }));
  await waitFor(() => expect(api.minimized).toHaveBeenCalledTimes(2));
  expect(api.minimize).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toHaveValue('Draft');
});

it('cancels a pending blur check on unmount', async () => {
  const { unmount } = render(<ToolWindow label="AI tool" onClose={vi.fn()} footer={null}>Draft</ToolWindow>);
  await waitFor(() => expect(api.focus).not.toBeNull());
  act(() => api.focus?.({ payload: false })); unmount();
  await new Promise(resolve => setTimeout(resolve, 260));
  expect(api.minimize).not.toHaveBeenCalled();
});
