import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import AppMark from '../AppMark';
import { harnessMark } from '@features/agent/components/HarnessBadge';

afterEach(cleanup);
it('uses the application asset as the default identity fallback', () => {
  expect(harnessMark('unrecognized')).toBe(AppMark);
  const { container } = render(<AppMark size={20} />);
  expect(container.querySelector('image')).toHaveAttribute('href', '/app-icon.svg');
  expect(container.querySelector('mask')).toBeNull();
});
