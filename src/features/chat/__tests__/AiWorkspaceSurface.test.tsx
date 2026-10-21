import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import AiWorkspaceSurface, { AiWorkspaceProvider } from '../components/AiWorkspaceSurface';

const lifecycle = vi.hoisted(() => ({ mounts: 0, stops: 0 }));
vi.mock('../components/HarnessWorkspace', () => ({ default: function Conversation() {
  const [draft, setDraft] = useState('');
  useEffect(() => { lifecycle.mounts += 1; return () => { lifecycle.stops += 1; }; }, []);
  return <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />;
} }));
afterEach(() => { cleanup(); lifecycle.mounts = 0; lifecycle.stops = 0; });

it('moves the existing conversation node without restarting it or dropping local state', () => {
  const view = (placement: 'main' | 'side') => <AiWorkspaceProvider placement={placement} mainActive headerActive sideActive>
    <AiWorkspaceSurface placement="main" /><AiWorkspaceSurface placement="side" />
  </AiWorkspaceProvider>;
  const { rerender, unmount } = render(view('main'));
  const input = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(input, { target: { value: 'Unsent work' } });
  expect(input.closest('[data-testid="ai-surface-main"]')).not.toBeNull();
  act(() => rerender(view('side')));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
  expect(input).toHaveValue('Unsent work');
  expect(input.closest('[data-testid="ai-surface-side"]')).not.toBeNull();
  act(() => rerender(view('main')));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
  expect(lifecycle.mounts).toBe(1);
  expect(lifecycle.stops).toBe(0);
  unmount(); expect(lifecycle.stops).toBe(1);
});
