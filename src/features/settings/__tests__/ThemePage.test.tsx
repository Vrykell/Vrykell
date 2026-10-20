import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemePage } from '../pages/themePage';
import { useTerminalThemeStore } from '../model/terminalTheme';

const theme = vi.hoisted(() => ({ preference: 'system', setMode: vi.fn() }));
vi.mock('@app/providers/ThemeProvider', () => ({ useTheme: () => theme }));

afterEach(() => vi.restoreAllMocks());

it('shows all three preview choices and applies a selected mode', () => {
  render(<ThemePage />);
  const system = screen.getByRole('radio', { name: '跟随系统' });
  expect(system).toHaveAttribute('aria-checked', 'true');
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  expect(document.querySelectorAll('.theme-mode-preview')).toHaveLength(3);
  fireEvent.click(screen.getByRole('radio', { name: '浅色' }));
  expect(theme.setMode).toHaveBeenCalledWith('light');
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
