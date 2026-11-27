import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SettingsNavigation from '../components/SettingsNavigation';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { useSettingsNavigationStore } from '../stores/navigation';
import { isWindows } from '@platform/runtime';

function Navigation() {
  return <SettingsNavigation navigation={useSettingsNavigation()} />;
}

afterEach(() => {
  cleanup();
  useSettingsNavigationStore.setState({ selected: 'ai-model' });
});

it('keeps the complete directory visible after selecting a page', () => {
  render(<Navigation />);
  const directory = screen.getByRole('complementary', { name: '设置目录' });
  expect(directory.querySelectorAll('.sidebar-row')).toHaveLength(isWindows ? 23 : 22);
  expect(screen.queryByRole('button', { name: '联网搜索' })).toBeNull();
  expect(screen.getByRole('button', { name: '关于' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '子代理' })).toBeNull();
  expect(screen.queryByRole('button', { name: '定时任务' })).toBeNull();
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

it('lists Shell profiles under Terminal as a single destination', () => {
  render(<Navigation />);
  const terminal = screen.getByText('终端', { exact: true }).parentElement!;
  const profiles = within(terminal).getByRole('button', { name: 'Shell 配置文件' });
  expect(within(terminal).getByRole('button', { name: '历史命令' })).toBeVisible();
  expect(profiles.querySelector('svg rect')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'CMD' })).not.toBeInTheDocument();
  fireEvent.click(profiles);
  expect(profiles).toHaveAttribute('aria-current', 'page');
});

it('switches hover presentation without changing the selected page or keyboard focus', () => {
  render(<Navigation />);
  const directory = screen.getByRole('complementary', { name: '设置目录' });
  const language = screen.getByRole('button', { name: '语言' });
  language.focus();
  fireEvent.keyDown(language, { key: 'ArrowDown' });
  expect(directory).toHaveAttribute('data-keyboard-navigation', 'true');
  fireEvent(screen.getByRole('button', { name: '模型行为' }), new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 30 }));
  expect(directory).toHaveAttribute('data-keyboard-navigation', 'false');
  expect(language).toHaveFocus();
  expect(useSettingsNavigationStore.getState().selected).toBe('ai-model');
});
