import { useEffect, useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SettingsScreen from '../components/SettingsScreen';

vi.mock('../pages/SettingsView', () => ({ default: function SettingsDestination() {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return <><button aria-current="page">Section</button><input ref={input} aria-label="Search destination" /></>;
} }));

it('lets a requested field take focus after the screen establishes its default navigation focus', () => {
  render(<SettingsScreen />);
  expect(screen.getByRole('textbox', { name: 'Search destination' })).toHaveFocus();
});
