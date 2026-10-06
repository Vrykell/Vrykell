import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Terminal } from '@ui/icons';
import { PowerShellIcon, ZshIcon, shellIconFor } from '../shellIcons';

describe('shellIconFor', () => {
  it('uses a brand mark for powershell/pwsh/zsh and the terminal icon otherwise', () => {
    expect(shellIconFor('powershell')).toBe(PowerShellIcon);
    expect(shellIconFor('pwsh')).toBe(PowerShellIcon);
    expect(shellIconFor('zsh')).toBe(ZshIcon);
    expect(shellIconFor('bash')).toBe(Terminal);
    expect(shellIconFor('cmd')).toBe(Terminal);
    expect(shellIconFor(undefined)).toBe(Terminal);
    expect(shellIconFor(null)).toBe(Terminal);
  });

  it('renders the mark at the requested size with its shell data attribute', () => {
    const { container } = render(createElement(shellIconFor('zsh'), { size: 20 }));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('data-shell-mark', 'zsh');
    expect(svg).toHaveAttribute('width', '20');
  });
});
