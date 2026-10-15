import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Terminal } from '@ui/icons';
import { BashIcon, CmdIcon, PowerShellIcon, SshIcon, ZshIcon, shellIconFor } from '../shellIcons';

afterEach(cleanup);

describe('shellIconFor', () => {
  it('restores the colored terminal tile at its original 20px row size', () => {
    const { container } = render(createElement(ZshIcon));
    expect(container.querySelector('svg')).toHaveAttribute('width', '20');
    expect(container.querySelector('svg')).toHaveAttribute('height', '20');
    expect(container.querySelector('svg')).toHaveAttribute('data-shell-mark', 'zsh');
    expect(container.querySelector('rect')).toHaveAttribute('width', '22');
    expect(container.querySelector('rect')).toHaveAttribute('height', '18');
    expect(container.querySelector('rect')).toHaveAttribute('rx', '3.5');
    expect(container.querySelector('path')).toHaveAttribute('d', 'm6 8 4 4-4 4M12 16h6');
    expect(container.querySelector('path')).toHaveAttribute('stroke', 'var(--shell-tile-ink)');
  });
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

  it('allows an explicit color while keeping the SSH mark geometry', () => {
    const { container } = render(createElement(SshIcon, { size: 20, style: { color: 'var(--group-rose)' } }));
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg).toHaveAttribute('data-shell-mark', 'ssh');
    expect(svg.style.color).toBe('var(--group-rose)');
  });

  it.each(['zsh', 'bash'])('keeps the %s mark readable through the theme color', (shell) => {
    const { container } = render(createElement(shellIconFor(shell), { size: 20 }));
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.style.color).toBe(`var(--shell-${shell}-accent)`);
    expect(svg).toHaveAttribute('data-shell-mark', shell);
    expect(svg).toHaveAttribute('height', '20');
    const fills = [...svg.querySelectorAll('[fill]')].map(element => element.getAttribute('fill'));
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every(fill => fill === 'currentColor' || fill === 'none' || fill === 'var(--shell-tile-ink)')).toBe(true);
    expect(svg.querySelector('text')).toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
