import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AppShell from '../AppShell';

vi.mock('@platform/runtime', () => ({ isMacOS: true }));
vi.mock('@app/layout/WorkspaceShell', () => ({ default: () => <main>Workspace</main> }));
vi.mock('@app/layout/ApplicationOverlays', () => ({ default: () => null }));
vi.mock('@ui/OverlayScrollbars', () => ({ default: () => null }));
afterEach(cleanup);
it('marks the native window edge without adding a layout border around the workspace', () => {
  const view = render(<AppShell />);
  const window = view.container.querySelector('.application-window');
  expect(window).toHaveAttribute('data-platform', 'macos');
  expect(window).toHaveStyle({ overflow: 'hidden' });
  expect(window?.getAttribute('style')).toContain('height: 100vh');
  expect(window?.getAttribute('style')).not.toContain('border:');
  expect(view.getByRole('main')).toBeInTheDocument();
});
