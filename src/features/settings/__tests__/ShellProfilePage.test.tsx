import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ShellProfilePage, { ShellProfileTitle } from '../pages/shellProfilePage';
import { useShellProfiles } from '@config/shellProfiles';
import { useTerminalDefaults } from '@config/terminalDefaults';

const defaults = useTerminalDefaults.getState();
afterEach(() => {
  cleanup();
  useShellProfiles.setState({ profiles: {} });
  useTerminalDefaults.setState(defaults, true);
});

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

it('uses the page title to switch profiles and omits the opening mode for fixed-mode shells', () => {
  const view = render(<ShellProfileTitle shell="powershell" onChange={(shell) => view.rerender(<ShellProfilePage shell={shell} />)} />);
  const picker = screen.getByRole('combobox', { name: 'Shell 配置文件' });
  expect(picker).toHaveTextContent('Windows PowerShell');
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole('option', { name: 'CMD' }));
  expect(screen.getByRole('textbox', { name: '配置名称' })).toHaveAttribute('placeholder', 'CMD');
  expect(screen.queryByRole('radiogroup', { name: '打开方式' })).not.toBeInTheDocument();
});
