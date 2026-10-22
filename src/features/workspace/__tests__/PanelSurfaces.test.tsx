import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PanelSurfaces from '../components/PanelSurfaces';
import SidePanel from '../components/SidePanel';
import { useDockStore } from '../stores/dock';
import { useUiStore } from '../stores/ui';

const lifecycle = vi.hoisted(() => ({ mounts: 0, stops: 0 }));
vi.mock('@features/files/components/PanelFiles', () => ({ default: function Files() {
  const [value, setValue] = useState('');
  useEffect(() => { lifecycle.mounts += 1; return () => { lifecycle.stops += 1; }; }, []);
  return <input aria-label="File panel draft" value={value} onChange={event => setValue(event.target.value)} />;
} }));
const snapshot = useDockStore.getState();
afterEach(() => { cleanup(); useDockStore.setState(snapshot, true); lifecycle.mounts = 0; lifecycle.stops = 0; });

it('retains the same panel DOM and local state through side moves, closure and reopening', () => {
  useUiStore.setState({ settingsOpen: false });
  useDockStore.setState({ leftZone: [], rightZone: ['files', 'chat', 'git', 'command-history'], leftPanels: [], rightPanels: ['files'] });
  const { unmount } = render(<PanelSurfaces><SidePanel side="left" /><SidePanel side="right" /></PanelSurfaces>);
  const input = screen.getByRole('textbox', { name: 'File panel draft' });
  fireEvent.change(input, { target: { value: 'Keep this state' } });
  expect(input.closest('[data-panel-slot]')).toHaveAttribute('data-panel-slot', 'right');
  act(() => useDockStore.getState().moveButton('files', 'left'));
  expect(screen.getByRole('textbox', { name: 'File panel draft' })).toBe(input);
  expect(input.closest('[data-panel-slot]')).toHaveAttribute('data-panel-slot', 'left');
  expect(input).toHaveValue('Keep this state');
  act(() => useDockStore.getState().closePanel('files'));
  expect(screen.queryByRole('textbox', { name: 'File panel draft' })).toBeNull();
  act(() => { useDockStore.getState().openPanel('files'); useDockStore.getState().moveButton('files', 'right'); });
  expect(screen.getByRole('textbox', { name: 'File panel draft' })).toBe(input);
  expect(input).toHaveValue('Keep this state');
  expect(lifecycle).toEqual({ mounts: 1, stops: 0 });
  unmount(); expect(lifecycle.stops).toBe(1);
});
