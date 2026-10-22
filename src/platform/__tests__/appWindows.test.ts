import { beforeEach, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    constructor(label: string, options: unknown) { create(label, options); }
  },
}));

beforeEach(() => vi.clearAllMocks());

it('opens a full application window with the current route and desktop bounds', async () => {
  const { openAppWindow } = await import('../appWindows');
  openAppWindow();
  expect(create).toHaveBeenCalledWith(expect.stringMatching(/^app-/), expect.objectContaining({
    url: `${location.pathname}${location.search}`, title: 'Vrykell', width: 1280, height: 800, minWidth: 640, minHeight: 480,
  }));
});
