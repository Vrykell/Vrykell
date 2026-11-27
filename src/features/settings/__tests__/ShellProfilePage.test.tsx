import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ShellProfilePage, { ShellProfileTitle } from '../pages/shellProfilePage';
import { useSettingsNavigationStore } from '../stores/navigation';
import { useShellProfiles } from '@config/shellProfiles';
import { useTerminalDefaults } from '@config/terminalDefaults';

const defaults = useTerminalDefaults.getState();
const initialNavigation = useSettingsNavigationStore.getState();
afterEach(() => {
  cleanup();
  useShellProfiles.setState({ profiles: {} });
  useTerminalDefaults.setState(defaults, true);
  useSettingsNavigationStore.setState(initialNavigation, true);
});

it('groups identity, startup and menu settings without duplicating shell headings', () => {
  useSettingsNavigationStore.getState().openShellProfile('zsh');
  render(
    <>
      <h1>
        <ShellProfileTitle />
      </h1>
      <ShellProfilePage />
    </>,
  );
  const identity = screen.getByRole('group', { name: '名称与标签' });
  const startup = screen.getByRole('group', { name: '启动' });
  const menu = screen.getByRole('group', { name: '菜单与默认项' });
  expect(within(identity).getByRole('textbox', { name: '配置名称' })).toBeVisible();
  expect(within(identity).getByRole('textbox', { name: '标签页标题' })).toBeVisible();
  expect(within(startup).getByRole('textbox', { name: '启动目录' })).toBeVisible();
  expect(within(startup).getByRole('button', { name: '浏览…' })).toBeVisible();
  expect(within(startup).getByRole('radiogroup', { name: '打开方式' })).toBeVisible();
  fireEvent.click(within(menu).getByRole('switch', { name: '在新建终端菜单中显示' }));
  expect(useShellProfiles.getState().profiles.zsh?.hidden).toBe(true);
});

it('switches profiles and omits the mode setting for a classic-only shell', () => {
  useShellProfiles.getState().update('zsh', { name: 'Build' });
  useShellProfiles.getState().update('cmd', { name: 'Local' });
  useSettingsNavigationStore.getState().openShellProfile('zsh');
  render(
    <>
      <h1>
        <ShellProfileTitle />
      </h1>
      <ShellProfilePage />
    </>,
  );
  expect(screen.getByRole('textbox', { name: '配置名称' })).toHaveValue('Build');
  const picker = screen.getByRole('combobox', { name: 'Shell 配置文件' });
  expect(screen.getByRole('heading', { level: 1 })).toContainElement(picker);
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole('option', { name: 'CMD' }));
  expect(picker).toHaveTextContent('CMD');
  expect(screen.getByRole('textbox', { name: '配置名称' })).toHaveValue('Local');
  const startup = screen.getByRole('group', { name: '启动' });
  expect(within(startup).getByRole('textbox', { name: '启动目录' })).toBeVisible();
  expect(within(startup).queryByText('打开方式')).not.toBeInTheDocument();
});
