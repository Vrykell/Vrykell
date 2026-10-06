import { fireEvent, render, screen } from '@testing-library/react';
import { Brain } from '@ui/icons';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import StateIconButton from '../StateIconButton';

describe('persistent option feedback', () => {
  it('exposes and retains icon toggle state after clicking and leaving', () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <StateIconButton icon={Brain} title="深度思考" on={on} onClick={() => setOn(!on)} />;
    }
    render(<Harness />);
    const button = screen.getByRole('button', { name: '深度思考' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    fireEvent.mouseLeave(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.querySelectorAll('svg')).toHaveLength(1);
    expect(button.querySelector('svg')).toHaveStyle({ width: '18px', height: '18px' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});
