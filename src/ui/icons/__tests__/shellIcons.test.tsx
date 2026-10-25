import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { act } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { hostIconFor, shellIconFor, SshIcon, TerminalIcon, TerminalProfileIcon } from '@ui/icons/shellIcons';
import { useHostSystems } from '@config/hostSystems';

afterEach(() => { cleanup(); useHostSystems.setState({ systems: {} }); });

it.each([undefined, '', 'unrecognized'])('uses the generic terminal identity as the fallback for %s', shell => {
  expect(shellIconFor(shell)).toBe(TerminalIcon);
});

it('keeps the blue shell panel independent from hidden copies and the generic terminal fallback', () => {
  const { container } = render(<><div hidden><TerminalProfileIcon shellType="powershell" /></div><TerminalProfileIcon shellType="pwsh" /><TerminalProfileIcon /></>);
  expect(container.querySelector('[data-shell-mark="powershell"]')).toHaveStyle({ color: 'var(--chart-blue)' });
  for (const icon of container.querySelectorAll('[data-shell-mark="powershell"]')) {
    expect(icon.querySelector('path')).toHaveAttribute('fill', 'currentColor');
    expect(icon.querySelector('[id]')).toBeNull();
    expect(icon.innerHTML).not.toContain('url(');
  }
  expect(container.querySelector('[data-shell-mark="terminal"]')).not.toHaveStyle({ color: 'var(--chart-blue)' });
});

it('uses orange and green for the two command shell identities', () => {
  const { container } = render(<><TerminalProfileIcon shellType="zsh" /><TerminalProfileIcon shellType="bash" /></>);
  expect(container.querySelector('[data-shell-mark="zsh"]')).toHaveStyle({ color: 'var(--shell-zsh-accent)' });
  expect(container.querySelector('[data-shell-mark="bash"]')).toHaveStyle({ color: 'var(--group-green)' });
});

it.each(['zsh', 'bash', 'cmd', 'powershell', 'fish', 'git-bash', 'python', 'node'])('renders the %s identity at the requested size', shell => {
  const { container } = render(createElement(shellIconFor(shell), { size: 18 }));
  expect(container.querySelector('svg')).toHaveAttribute('data-shell-mark', shell);
  expect(container.querySelector('svg')).toHaveAttribute('width', '18');
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});

it.each([undefined, '', 'unknown', 'Linux', 'Linux aarch64'])('uses the default remote system icon for %s', system => {
  expect(hostIconFor(system)).toBe(SshIcon);
});

it.each(['Ubuntu', 'Debian', 'Fedora', 'CentOS', 'Arch', 'Darwin', 'Windows'])('distinguishes a known %s host', system => {
  expect(hostIconFor(system)).not.toBe(SshIcon);
});

it('updates remote icons when authenticated system metadata arrives', () => {
  const { container } = render(<TerminalProfileIcon kind="ssh" connectionId="remote" />);
  expect(container.querySelector('svg')).toHaveAttribute('data-shell-mark', 'linux');
  act(() => useHostSystems.getState().remember('remote', 'Ubuntu'));
  expect(container.querySelector('svg')).toHaveAttribute('data-shell-mark', 'ubuntu');
});
