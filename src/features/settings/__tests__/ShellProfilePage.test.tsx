import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ShellProfilePage from '../pages/shellProfilePage';
import { useShellProfiles } from '@config/shellProfiles';
import { useTerminalDefaults } from '@config/terminalDefaults';

const defaults = useTerminalDefaults.getState();
afterEach(() => { cleanup(); useShellProfiles.setState({ profiles: {} }); useTerminalDefaults.setState(defaults, true); });

it('groups identity, startup and menu settings without duplicating shell headings', () => {
  render(<ShellProfilePage shell="zsh" />);
  const identity = screen.getByRole('group', { name: '名称与标签' });
  const startup = screen.getByRole('group', { name: '启动' });
  const menu = screen.getByRole('group', { name: '菜单与默认项' });
  expect(within(identity).getByRole('textbox', { name: '配置名称' })).toBeVisible();
  expect(within(identity).getByRole('textbox', { name: '标签页标题' })).toBeVisible();
  expect(within(startup).getByRole('textbox', { name: '启动目录' })).toBeVisible();
  expect(within(startup).getByRole('button', { name: '浏览…' })).toBeVisible();
  fireEvent.click(within(menu).getByRole('switch', { name: '在新建终端菜单中显示' }));
  expect(useShellProfiles.getState().profiles.zsh?.hidden).toBe(true);
});
