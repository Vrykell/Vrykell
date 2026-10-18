import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AppShell from '../AppShell';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';

vi.mock('@platform/runtime', () => ({ isMacOS: true }));
vi.mock('@app/layout/WorkspaceShell', () => ({ default: () => <main>Workspace</main> }));
vi.mock('@app/layout/ApplicationOverlays', () => ({ default: () => null }));
vi.mock('@ui/OverlayScrollbars', () => ({ default: () => null }));
afterEach(() => {
  cleanup();
  useTerminalThemeStore.setState({ config: { opacity: 1, backgroundImage: null, vars: {} }, loaded: false, wallpaperDataUrl: null });
});
it('marks the native window edge without adding a layout border around the workspace', () => {
  const view = render(<AppShell />);
  const window = view.container.querySelector('.application-window');
  expect(window).toHaveAttribute('data-platform', 'macos');
  expect(window).toHaveStyle({ overflow: 'hidden' });
  expect(window?.getAttribute('style')).toContain('height: 100vh');
  expect(window?.getAttribute('style')).not.toContain('border:');
  expect(view.getByRole('main')).toBeInTheDocument();
});

it('publishes the applied opacity for surfaces portaled outside the window', () => {
  useTerminalThemeStore.setState({
    config: { opacity: 0.6, backgroundImage: '/wallpaper.png', vars: {} },
    wallpaperDataUrl: 'asset:///wallpaper.png',
  });
  const view = render(<AppShell />);
  expect(view.container.querySelector('.application-window')).toHaveStyle({ opacity: '0.6' });
  expect(document.documentElement.style.getPropertyValue('--app-opacity')).toBe('0.6');
});

it('publishes full opacity while no wallpaper is applied', () => {
  useTerminalThemeStore.setState({ config: { opacity: 0.6, backgroundImage: null, vars: {} } });
  render(<AppShell />);
  expect(document.documentElement.style.getPropertyValue('--app-opacity')).toBe('1');
});

it('drops the published opacity when the shell unmounts', () => {
  const view = render(<AppShell />);
  expect(document.documentElement.style.getPropertyValue('--app-opacity')).toBe('1');
  view.unmount();
  expect(document.documentElement.style.getPropertyValue('--app-opacity')).toBe('');
});
