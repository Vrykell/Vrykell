import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DollarSign, Zap, ArrowDown, iconSizes } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';

afterEach(cleanup);
it('uses equally sized SVGs for command and AI mode controls', () => {
  const view = render(<><IconButton aria-label="Command"><DollarSign size={iconSizes.control} /></IconButton><IconButton aria-label="AI"><Zap size={iconSizes.control} /></IconButton></>);
  for (const svg of view.container.querySelectorAll('svg')) expect(svg).toHaveStyle({ width: '18px', height: '18px' });
});
it('renders the latest-output action as an accessible compact button', () => {
  const view = render(<IconButton compact aria-label="Jump to latest output" data-tip-shortcut="End"><ArrowDown size={iconSizes.compact} /></IconButton>);
  expect(view.getByRole('button', { name: 'Jump to latest output' })).toHaveAttribute('data-tip-shortcut', 'End');
  expect(view.container.querySelector('svg')).toHaveStyle({ width: '16px', height: '16px' });
});
