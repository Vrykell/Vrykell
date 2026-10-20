import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SettingsNavigation from '../components/SettingsNavigation';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { useSettingsNavigationStore } from '../stores/navigation';

function Navigation() {
  return <SettingsNavigation navigation={useSettingsNavigation()} />;
}

afterEach(() => { cleanup(); useSettingsNavigationStore.setState({ selected: 'ai-model' }); });

it('keeps the complete directory visible after selecting a page', () => {
  render(<Navigation />);
  const directory = screen.getByRole('complementary', { name: '设置目录' });
  expect(directory.querySelectorAll('.sidebar-row')).toHaveLength(24);
  expect(screen.getByRole('button', { name: '语言' })).toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: '版本控制' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '模型行为' }));
  expect(useSettingsNavigationStore.getState().selected).toBe('ai-behavior');
  expect(screen.getByRole('button', { name: '模型行为' })).toHaveAttribute('aria-current', 'page');
  expect(directory).toBeVisible();
});

it('supports keyboard selection without folding the directory', () => {
  render(<Navigation />);
  fireEvent.keyDown(screen.getByRole('button', { name: '语言' }), { key: 'Enter' });
  expect(useSettingsNavigationStore.getState().selected).toBe('application-language');
  fireEvent.keyDown(screen.getByRole('button', { name: '字体与显示' }), { key: ' ' });
  expect(screen.getByRole('button', { name: '字体与显示' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('complementary', { name: '设置目录' })).toBeVisible();
});
