import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock, diagnostic: vi.fn() }));

import { syncWindowFrame } from '../windowChrome';

const root = () => document.documentElement;

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockResolvedValue(undefined);
  root().removeAttribute('style');
  delete root().dataset.toolWindow;
});

afterEach(() => { vi.clearAllMocks(); });

it('paints the main window frame with the chrome color', () => {
  root().style.setProperty('--chrome-bg', '#303030');
  root().style.setProperty('--surface', '#2B2B2B');

  syncWindowFrame();

  expect(invokeMock).toHaveBeenCalledWith('apply_window_frame', { color: '#303030' });
});

it('paints a tool window frame with the surface color', () => {
  root().dataset.toolWindow = 'true';
  root().style.setProperty('--chrome-bg', '#303030');
  root().style.setProperty('--surface', '#F5F5F5');

  syncWindowFrame();

  expect(invokeMock).toHaveBeenCalledWith('apply_window_frame', { color: '#F5F5F5' });
});

it('keeps the previous frame when the theme has no color for it', () => {
  syncWindowFrame();

  expect(invokeMock).not.toHaveBeenCalled();
});

it('ignores a rejected frame update', async () => {
  root().style.setProperty('--chrome-bg', 'rgb(48, 48, 48)');
  invokeMock.mockRejectedValue(new Error('window unavailable'));

  syncWindowFrame();
  await Promise.resolve();

  expect(invokeMock).toHaveBeenCalledWith('apply_window_frame', { color: 'rgb(48, 48, 48)' });
});
