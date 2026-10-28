import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemePage } from '../pages/themePage';
import { useTerminalThemeStore } from '../model/terminalTheme';

const theme = vi.hoisted(() => ({ mode: 'dark', preference: 'system', setMode: vi.fn() }));
const platform = vi.hoisted(() => ({ nativeMaterial: true }));
vi.mock('@app/providers/ThemeProvider', () => ({ useTheme: () => theme }));
vi.mock('@platform/runtime', () => ({
  get supportsNativeMaterial() { return platform.nativeMaterial; },
  isMacOS: false,
  isWindows: false,
  isLinux: true,
  usesCustomWindowControls: true,
}));

beforeEach(() => {
  platform.nativeMaterial = true;
  theme.preference = 'system';
  theme.setMode.mockClear();
  useTerminalThemeStore.setState({ config: { opacity: 1, backgroundImage: null, vars: {} } });
});
afterEach(() => vi.restoreAllMocks());

it('uses the shared sliding mode control and previews only the applied palette', () => {
  render(<ThemePage />);
  expect(screen.getByRole('radio', { name: '跟随系统' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getAllByRole('radio')).toHaveLength(8);
  expect(screen.getByRole('radio', { name: '默认深色' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByRole('radio', { name: '默认浅色' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: '始终浅色' }));
  expect(theme.setMode).toHaveBeenCalledWith('light');
});

it('changes only the chosen mode palette and supports arrow-key selection', async () => {
  theme.preference = 'dark';
  const update = vi.spyOn(useTerminalThemeStore.getState(), 'update').mockResolvedValue();
  render(<ThemePage />);
  expect(screen.queryByRole('radiogroup', { name: '浅色配色' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Dracula' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith({ darkPreset: 'dracula' }));
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Dracula' }), { key: 'ArrowRight' });
  expect(screen.getByRole('radio', { name: 'Nord' })).toHaveFocus();
  expect(update).toHaveBeenLastCalledWith({ darkPreset: 'nord-dark' });
});

it('hides the desktop material control where window effects are unsupported', () => {
  platform.nativeMaterial = false;
  render(<ThemePage />);
  expect(screen.queryByRole('switch', { name: '桌面材质' })).toBeNull();
  expect(screen.getByRole('radiogroup', { name: '主题模式' })).toBeInTheDocument();
});

it('lets desktop color be disabled while preserving other appearance preferences', async () => {
  useTerminalThemeStore.setState({ config: { opacity: 1, backgroundImage: null, vars: {}, desktopTint: true } });
  const update = vi.spyOn(useTerminalThemeStore.getState(), 'update').mockResolvedValue();
  render(<ThemePage />);
  const toggle = screen.getByRole('switch', { name: '桌面材质' });
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(toggle);
  await waitFor(() => expect(update).toHaveBeenCalledWith({ desktopTint: false }));
});
