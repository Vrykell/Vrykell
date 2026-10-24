import { memo } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useState } from 'react';
import WorkspaceHeader, { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from '../WorkspaceHeader';

it('keeps header consumers stable while their parent resizes', () => {
  const renderHeader = vi.fn();
  const Header = memo(function Header() {
    renderHeader();
    return <WorkspaceHeader><button>Header action</button></WorkspaceHeader>;
  });
  function Layout() {
    const [width, setWidth] = useState(200);
    return <WorkspaceHeaderProvider><button onClick={() => setWidth(value => value + 10)}>Resize</button><div style={{ width }}><WorkspaceHeaderSlot /><Header /></div></WorkspaceHeaderProvider>;
  }
  render(<Layout />);
  const before = renderHeader.mock.calls.length;
  for (let index = 0; index < 10; index += 1) fireEvent.click(screen.getByText('Resize'));
  expect(renderHeader).toHaveBeenCalledTimes(before);
  expect(screen.getByText('Header action')).toBeVisible();
  expect(document.querySelector('.workspace-instance-bar')).toContainElement(screen.getByText('Header action'));
});
