import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Terminal } from '@ui/icons';
import { BashIcon, CmdIcon, PowerShellIcon, SshIcon, ZshIcon, shellIconFor } from '../shellIcons';

describe('shellIconFor', () => {
  it('maps every supported shell to its brand mark and falls back to the terminal icon', () => {
    expect(shellIconFor('powershell')).toBe(PowerShellIcon);
    expect(shellIconFor('pwsh')).toBe(PowerShellIcon);
    expect(shellIconFor('zsh')).toBe(ZshIcon);
    expect(shellIconFor('bash')).toBe(BashIcon);
    expect(shellIconFor('cmd')).toBe(CmdIcon);
    expect(shellIconFor(undefined)).toBe(Terminal);
    expect(shellIconFor(null)).toBe(Terminal);
    expect(shellIconFor('fish')).toBe(Terminal);
  });

  it('renders a shell mark at the requested size with its shell data attribute', () => {
    const { container } = render(createElement(shellIconFor('bash'), { size: 20 }));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('data-shell-mark', 'bash');
    expect(svg).toHaveAttribute('width', '20');
  });

  it('pins the SSH mark to the theme color even when a caller passes one', () => {
    const { container } = render(createElement(SshIcon, { size: 20, style: { color: 'red' } }));
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg).toHaveAttribute('data-shell-mark', 'ssh');
    expect(svg.style.color).toBe('var(--success)');
  });
});
