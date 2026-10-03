import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CurrentDir } from '@features/terminal/components/InputEditor';

describe('CurrentDir', () => {
  it.each(['C:\\projects\\app', '/home/user/app', '\\\\server\\share', '~/project'])('preserves the path prefix for %s', dir => {
    render(<CurrentDir dir={dir} />);
    expect(screen.getByTitle(dir).textContent).toBe(dir);
  });

  it('retains the complete path in the tooltip when shortened', () => {
    const dir = '/home/user/projects/a-long-project-directory';
    render(<CurrentDir dir={dir} />);
    expect(screen.getByTitle(dir).textContent).toBe(`…${dir.slice(-19)}`);
  });
});
