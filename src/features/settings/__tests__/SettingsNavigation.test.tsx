import { useCallback, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SettingsNavigation from '../components/SettingsNavigation';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { useSettingsNavigationStore } from '../stores/navigation';

function Navigation() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const navigation = useSettingsNavigation();
  return <div data-testid="layout" data-open={open}>
    <button ref={trigger} onClick={() => setOpen(true)}>Open directory</button>
    <SettingsNavigation navigation={navigation} open={open} onClose={close} trigger={trigger} />
    <button>Content control</button>
  </div>;
}
afterEach(() => { cleanup(); useSettingsNavigationStore.setState({ selected: 'ai-model' }); });

it('shows the full directory without a local search and returns focus after selecting a page', () => {
  render(<Navigation />);
  expect(screen.queryByRole('textbox')).toBeNull();
  const trigger = screen.getByText('Open directory');
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: '模型配置' })).toHaveFocus();
  expect(screen.getByRole('complementary', { name: '设置目录' }).querySelectorAll('.sidebar-row')).toHaveLength(18);
  expect(screen.getByRole('button', { name: '历史命令' })).toBeVisible();
  fireEvent.keyDown(screen.getByRole('button', { name: '模型行为' }), { key: 'Enter' });
  expect(useSettingsNavigationStore.getState().selected).toBe('ai-behavior');
  expect(screen.getByTestId('layout')).toHaveAttribute('data-open', 'false');
  expect(trigger).toHaveFocus();
});

it('dismisses on Escape, outside press and keyboard focus leaving the directory', () => {
  render(<Navigation />);
  const trigger = screen.getByText('Open directory');
  fireEvent.click(trigger);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(screen.getByTestId('layout')).toHaveAttribute('data-open', 'false');
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByText('Content control'));
  expect(screen.getByTestId('layout')).toHaveAttribute('data-open', 'false');
  fireEvent.click(trigger);
  fireEvent.blur(screen.getByRole('button', { name: '模型配置' }), { relatedTarget: screen.getByText('Content control') });
  expect(screen.getByTestId('layout')).toHaveAttribute('data-open', 'false');
});
