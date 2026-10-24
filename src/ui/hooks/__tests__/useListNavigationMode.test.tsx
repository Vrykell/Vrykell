import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useListNavigationMode } from '../useListNavigationMode';

function Example() {
  const navigation = useListNavigationMode();
  return <div {...navigation.props} data-testid="list"><button>First</button><button>Second</button></div>;
}

describe('list navigation mode', () => {
  it('switches between actual pointer movement and keyboard input without moving focus', () => {
    render(<Example />);
    const list = screen.getByTestId('list');
    const first = screen.getByRole('button', { name: 'First' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(list).toHaveAttribute('data-keyboard-navigation', 'true');
    fireEvent(screen.getByRole('button', { name: 'Second' }), new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 20 }));
    expect(list).toHaveAttribute('data-keyboard-navigation', 'false');
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Home' });
    expect(list).toHaveAttribute('data-keyboard-navigation', 'true');
  });

  it('ignores stationary pointer events produced by keyboard scrolling and layout changes', () => {
    render(<Example />);
    const list = screen.getByTestId('list');
    fireEvent(list, new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 20 }));
    fireEvent.keyDown(list, { key: 'End' });
    fireEvent(list, new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 20 }));
    expect(list).toHaveAttribute('data-keyboard-navigation', 'true');
    fireEvent(list, new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 21 }));
    expect(list).toHaveAttribute('data-keyboard-navigation', 'false');
    fireEvent.keyDown(list, { key: 'Control' });
    expect(list).toHaveAttribute('data-keyboard-navigation', 'false');
  });

  it('recognizes a pointer returning to the same coordinates after leaving the list', () => {
    render(<Example />);
    const list = screen.getByTestId('list');
    fireEvent(list, new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 20 }));
    fireEvent.pointerLeave(list);
    fireEvent.keyDown(list, { key: 'End' });
    fireEvent(list, new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 20 }));
    expect(list).toHaveAttribute('data-keyboard-navigation', 'false');
  });
});
