import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import ContextMenu from '../ContextMenu';

describe('independent action menus', () => {
  it('replaces an existing menu even when opened without a pointer press', () => {
    function Example() {
      const [first, setFirst] = useState(true);
      const [second, setSecond] = useState(false);
      return <>
        <button onClick={() => setSecond(true)}>Open another</button>
        {first && <ContextMenu anchor={{ x: 0, y: 0 }} items={[{ label: 'First action', onClick: () => {} }]} onClose={() => setFirst(false)} />}
        {second && <ContextMenu anchor={{ x: 20, y: 20 }} items={[{ label: 'Second action', onClick: () => {} }]} onClose={() => setSecond(false)} />}
      </>;
    }
    render(<Example />);
    fireEvent.click(screen.getByText('Open another'));
    expect(screen.queryByText('First action')).toBeNull();
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    fireEvent.pointerDown(screen.getByText('Second action'));
    expect(screen.getByRole('menu')).toBeVisible();
    fireEvent.pointerDown(document.body, { button: 2 });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
