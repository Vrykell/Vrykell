import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SettingsNavigation from '../components/SettingsNavigation';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { useSettingsNavigationStore } from '../stores/navigation';
import { useSessionStore } from '@features/workspace';

function Navigation() { return <SettingsNavigation navigation={useSettingsNavigation()} />; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); useSettingsNavigationStore.setState({ selected: 'ai-model' }); });

it('keeps every page accessible while searching and closes search when switching pages', async () => {
  const { container } = render(<Navigation />);
  const trigger = screen.getByRole('button', { name: '搜索设置…' });
  fireEvent.click(trigger);
  const search = screen.getByRole('textbox', { name: '搜索设置…' });
  await waitFor(() => expect(search).toHaveFocus());
  fireEvent.change(search, { target: { value: '补全防抖' } });
  expect(container.querySelectorAll('.settings-search-result')).toHaveLength(1);
  const pages = container.querySelectorAll('.settings-navigation-list [role="button"]');
  expect(pages).toHaveLength(17);
  fireEvent.click(screen.getByRole('button', { name: '模型配置' }));
  expect(search).toHaveValue('');
  expect(container.querySelector('aside')).toHaveAttribute('data-search-open', 'false');
});

it('navigates results by keyboard, returns focus on Escape and opens the indexed field', async () => {
  const open = vi.spyOn(useSessionStore.getState(), 'openSettingsTab').mockImplementation(() => {});
  const { container } = render(<Navigation />);
  const trigger = screen.getByRole('button', { name: '搜索设置…' });
  const search = screen.getByRole('textbox', { name: '搜索设置…' });
  fireEvent.click(trigger);
  fireEvent.change(search, { target: { value: '补全防抖' } });
  const result = container.querySelector<HTMLButtonElement>('.settings-search-result')!;
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  await waitFor(() => expect(result).toHaveFocus());
  fireEvent.keyDown(result, { key: 'ArrowUp' });
  expect(result).toHaveFocus();
  fireEvent.keyDown(result, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(container.querySelector('aside')).toHaveAttribute('data-search-open', 'false');
  fireEvent.click(trigger);
  fireEvent.click(result);
  expect(open).toHaveBeenCalledOnce();
  expect(useSettingsNavigationStore.getState().selected).toBe('ai-behavior');
  expect(search).toHaveValue('');
});
