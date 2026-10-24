import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import KeyHint, { shortcutKeys } from '@ui/feedback/KeyHint';
import { isMacOS } from '@platform/runtime';

describe('shared key hints', () => {
  it('resolves cross-platform modifier labels before rendering shared shortcut badges', () => {
    expect(shortcutKeys('Ctrl/Cmd+Shift+S')).toEqual([isMacOS ? 'Meta' : 'Control', 'Shift', 'S']);
    expect(shortcutKeys('CmdOrCtrl+F')).toEqual([isMacOS ? 'Meta' : 'Control', 'F']);
  });
  it('renders modifiers as icons and retains a readable accessible shortcut', () => {
    const { container } = render(<KeyHint shortcut="Shift+Meta+S" />);
    expect(container.querySelector('kbd')).toHaveAttribute('aria-label', 'Shift+Meta+S');
    expect(container.querySelectorAll('[data-key-icon]')).toHaveLength(2);
    expect(screen.getByText('S')).toBeVisible();
    expect(container.textContent).not.toContain('⇧');
    expect(container.textContent).not.toContain('⌘');
  });

  it('accepts existing shortcut labels and navigation keys', () => {
    expect(shortcutKeys('⌥⌘D')).toEqual(['Alt', 'Meta', 'D']);
    expect(shortcutKeys('Ctrl+Enter')).toEqual(['Control', 'Enter']);
    const { container } = render(<KeyHint shortcut="Escape" />);
    expect(container.querySelector('[data-key-icon="Escape"]')).toBeTruthy();
  });
  it('renders editing and navigation keys without textual substitute symbols', () => {
    const { container } = render(<KeyHint shortcut="Home+End+Space+Delete+PageUp+PageDown" />);
    expect(container.querySelectorAll('[data-key-icon]')).toHaveLength(6);
    expect(container.textContent).toBe('');
    expect(shortcutKeys('←+→')).toEqual(['ArrowLeft', 'ArrowRight']);
  });
});
