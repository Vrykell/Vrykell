import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const appWindow = {
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(() => {})),
  };

  return {
    appWindow,
    getCurrentWindow: vi.fn(() => appWindow),
  };
});

vi.mock('@platform/runtime', () => ({ usesCustomWindowControls: true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: mocks.getCurrentWindow }));

import WindowControls from './WindowControls';

describe('WindowControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appWindow.isMaximized.mockResolvedValue(false);
    mocks.appWindow.onResized.mockResolvedValue(() => {});
  });

  it('renders the three controls and forwards their actions to the window', () => {
    render(<WindowControls />);

    fireEvent.click(screen.getByTestId('window-minimize'));
    fireEvent.click(screen.getByTestId('window-maximize'));
    fireEvent.click(screen.getByTestId('window-close'));

    expect(mocks.appWindow.minimize).toHaveBeenCalledTimes(1);
    expect(mocks.appWindow.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(mocks.appWindow.close).toHaveBeenCalledTimes(1);
  });

  it('uses the restore label after the window reports maximized state', async () => {
    mocks.appWindow.isMaximized.mockResolvedValue(true);

    render(<WindowControls />);

    expect(await screen.findByRole('button', { name: '还原窗口' })).toBeInTheDocument();
  });
});
